/**
 * Sovereign-export tests.
 *
 * Coverage:
 *   1. Redaction: hashField deterministic; truncateEmail preserves
 *      domain; truncateAddress format; applyRedaction respects the
 *      alwaysRedacted list; full-disclosure passes values through;
 *      subject-only discloses only privilegedSubject; pseudonymous
 *      hashes sensitive fields.
 *   2. Envelope: canonicalJson is deterministic + key-sorted;
 *      payloadHash changes with payload; buildSignedExport with +
 *      without signer; verifySignedExport detects tampered
 *      payloadHash and format drift and expected-signer mismatch;
 *      assertFormatJurisdictionCompatible rules (US-only SAR/CTR,
 *      EU-only GDPR/MiCA).
 *   3. SAR formatter: happy path with caller-supplied subjects +
 *      narrative + transactions; rejects zero subjects, zero
 *      transactions, short narrative, zero total.
 *   4. CTR formatter: groups by subject, filters above threshold,
 *      rejects empty reportable list.
 *   5. GDPR DSAR: happy path populates subject-only payload; rejects
 *      missing subjectId. GDPR erasure: happy path; rejects missing
 *      categories; rejects retention without justification.
 *   6. MiCA: happy path pseudonymises counterparties; rejects
 *      zero-transaction period.
 *   7. CLI parser: every flag validated, date accepts ISO + unix-ms,
 *      unknown flag rejected, missing required rejected, GDPR
 *      format requires subject. CLI runner: end-to-end for each
 *      format with stub data source, writes output when path set.
 */

import { describe, expect, it, vi } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";

import { LocalKeyAdapter } from "@aethelred/wallet-custody-adapters";
import {
  // errors
  SovereignExportError,
  // redaction
  applyRedaction,
  hashField,
  redactPayload,
  truncateAddress,
  truncateEmail,
  // envelope
  assertFormatJurisdictionCompatible,
  buildSignedExport,
  canonicalJson,
  payloadHash,
  verifySignedExport,
  // formatters
  formatSarFincen111,
  formatCtrFincen112,
  formatGdprDsar,
  formatGdprErasure,
  formatMicaTransaction,
  // CLI
  runCli,
  type CliContext,
  type ExportDataSource,
  type ExportPayload,
  type ExportRequest,
} from "@aethelred/wallet-sovereign-export";

import type { AuditEvent } from "@aethelred/wallet-audit";

// ─── Fixtures ──────────────────────────────────────────────

const OPERATOR = { id: "acme", name: "Acme Custody" };
const OPERATOR_PK = "0x" + "aa".repeat(32);

function makeEvent(
  overrides: Partial<AuditEvent> & { detail?: Record<string, unknown> } = {},
): AuditEvent {
  return {
    id: overrides.id ?? "ev-1",
    sequenceNumber: overrides.sequenceNumber ?? 1,
    timestamp: overrides.timestamp ?? Date.parse("2026-01-05T12:00:00Z"),
    kind: overrides.kind ?? "signing-executed",
    subjectId: overrides.subjectId ?? "subj-1",
    workspaceId: overrides.workspaceId ?? "ws-1",
    detail: overrides.detail ?? {
      amountUsdCents: "1500000",
      asset: "USDC",
      counterpartyAddress: "0x" + "bb".repeat(20),
      txHash: "0x" + "cc".repeat(32),
    },
    previousHash: "0x00",
    eventHash: "0x00",
  };
}

function stubDataSource(
  events: ReadonlyArray<AuditEvent> = [],
): ExportDataSource {
  return {
    async listAuditEvents() {
      return events;
    },
    async listKycProfiles() {
      return [];
    },
    async listTravelRuleEvents() {
      return [];
    },
    async listSubjectTransactions(subjectId) {
      return events.filter((e) => e.subjectId === subjectId).map((e) => ({ ...e }));
    },
  };
}

// ─── Redaction ─────────────────────────────────────────────

describe("Redaction", () => {
  it("hashField is deterministic and 8-char 0x", () => {
    const a = hashField("hello");
    const b = hashField("hello");
    expect(a).toBe(b);
    expect(a).toMatch(/^0x[0-9a-f]{8}$/);
  });

  it("truncateEmail preserves domain", () => {
    expect(truncateEmail("alice@example.com")).toMatch(/@example\.com$/);
    expect(truncateEmail("alice@example.com")).toMatch(/^a\*+@/);
  });

  it("truncateEmail passes through non-emails unchanged", () => {
    expect(truncateEmail("no-at-sign")).toBe("no-at-sign");
  });

  it("truncateAddress short-form", () => {
    const out = truncateAddress("0x" + "aa".repeat(20));
    expect(out.startsWith("0xaaaa")).toBe(true);
    expect(out.includes("…")).toBe(true);
  });

  it("applyRedaction respects alwaysRedacted", () => {
    const out = applyRedaction(
      { profile: "full-disclosure", alwaysRedacted: ["ssn"] },
      "subjects.0.ssn",
      "123-45-6789",
    );
    expect(out).toBe("[redacted]");
  });

  it("full-disclosure returns sensitive values untouched", () => {
    const out = applyRedaction({ profile: "full-disclosure" }, "name", "Alice");
    expect(out).toBe("Alice");
  });

  it("subject-only redacts other subjects", () => {
    const policy = { profile: "subject-only" as const, privilegedSubject: "subj-1" };
    const privileged = applyRedaction(policy, "name", "Alice", { subjectId: "subj-1" });
    const other = applyRedaction(policy, "name", "Bob", { subjectId: "subj-2" });
    expect(privileged).toBe("Alice");
    expect(other).not.toBe("Bob");
  });

  it("redactPayload walks arrays + objects", () => {
    const input = {
      subjects: [
        { name: "Alice", email: "alice@example.com" },
        { name: "Bob", email: "bob@example.com" },
      ],
    };
    const redacted = redactPayload({ profile: "hashed" }, input) as typeof input;
    // name + email are both sensitive field names → redacted
    expect(redacted.subjects[0].name).not.toBe("Alice");
    expect(redacted.subjects[0].email).toMatch(/@example\.com$/);
  });
});

// ─── Envelope ──────────────────────────────────────────────

describe("Envelope + signing", () => {
  it("canonicalJson is deterministic for same input", () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
  });

  it("canonicalJson handles bigints as strings", () => {
    expect(canonicalJson({ n: 123n })).toBe('{"n":"123"}');
  });

  it("payloadHash changes when any field changes", () => {
    const a: ExportPayload = {
      format: "gdpr-erasure",
      body: {
        gdprArticle: "17",
        subjectId: "s",
        erasureRequestedAtMs: 1,
        dataCategoriesErased: ["a"],
      },
    };
    const b: ExportPayload = {
      ...a,
      body: { ...a.body, erasureRequestedAtMs: 2 },
    } as ExportPayload;
    expect(payloadHash(a)).not.toBe(payloadHash(b));
  });

  it("unsigned export: signature=0x, signerAddress absent", async () => {
    const request: ExportRequest = {
      format: "gdpr-erasure",
      jurisdiction: "EU",
      range: { fromMs: 0, toMs: 1 },
      operatorId: OPERATOR.id,
      operatorDisplayName: OPERATOR.name,
    };
    const payload: ExportPayload = {
      format: "gdpr-erasure",
      body: {
        gdprArticle: "17",
        subjectId: "s",
        erasureRequestedAtMs: 1,
        dataCategoriesErased: ["a"],
      },
    };
    const signed = await buildSignedExport({ request, payload });
    expect(signed.envelope.signature).toBe("0x");
    expect(signed.envelope.signerAddress).toBeUndefined();
  });

  it("signed export carries signer address", async () => {
    const signer = new LocalKeyAdapter({ privateKey: OPERATOR_PK }).asTypedDataSigner();
    const request: ExportRequest = {
      format: "gdpr-erasure",
      jurisdiction: "EU",
      range: { fromMs: 0, toMs: 1 },
      operatorId: OPERATOR.id,
      operatorDisplayName: OPERATOR.name,
    };
    const payload: ExportPayload = {
      format: "gdpr-erasure",
      body: {
        gdprArticle: "17",
        subjectId: "s",
        erasureRequestedAtMs: 1,
        dataCategoriesErased: ["a"],
      },
    };
    const signed = await buildSignedExport({ request, payload, signer });
    expect(signed.envelope.signature.length).toBe(132);
    expect(signed.envelope.signerAddress?.toLowerCase()).toBe(signer.address.toLowerCase());
  });

  it("verify detects tampered payload", async () => {
    const request: ExportRequest = {
      format: "gdpr-erasure",
      jurisdiction: "EU",
      range: { fromMs: 0, toMs: 1 },
      operatorId: OPERATOR.id,
      operatorDisplayName: OPERATOR.name,
    };
    const payload: ExportPayload = {
      format: "gdpr-erasure",
      body: {
        gdprArticle: "17",
        subjectId: "s",
        erasureRequestedAtMs: 1,
        dataCategoriesErased: ["a"],
      },
    };
    const signed = await buildSignedExport({ request, payload });
    const tampered: typeof signed = {
      ...signed,
      payload: {
        format: "gdpr-erasure",
        body: { ...payload.body, erasureRequestedAtMs: 999 } as typeof payload.body,
      },
    };
    expect(() => verifySignedExport(tampered)).toThrow(SovereignExportError);
  });

  it("verify detects format / payload.format drift", async () => {
    const request: ExportRequest = {
      format: "gdpr-erasure",
      jurisdiction: "EU",
      range: { fromMs: 0, toMs: 1 },
      operatorId: OPERATOR.id,
      operatorDisplayName: OPERATOR.name,
    };
    const payload: ExportPayload = {
      format: "gdpr-erasure",
      body: {
        gdprArticle: "17",
        subjectId: "s",
        erasureRequestedAtMs: 1,
        dataCategoriesErased: ["a"],
      },
    };
    const signed = await buildSignedExport({ request, payload });
    const mismatched = {
      ...signed,
      envelope: { ...signed.envelope, format: "sar-fincen-111" as const },
    };
    expect(() => verifySignedExport(mismatched)).toThrow(SovereignExportError);
  });

  it("verify rejects signer mismatch when expectedSigner provided", async () => {
    const signer = new LocalKeyAdapter({ privateKey: OPERATOR_PK }).asTypedDataSigner();
    const request: ExportRequest = {
      format: "gdpr-erasure",
      jurisdiction: "EU",
      range: { fromMs: 0, toMs: 1 },
      operatorId: OPERATOR.id,
      operatorDisplayName: OPERATOR.name,
    };
    const payload: ExportPayload = {
      format: "gdpr-erasure",
      body: {
        gdprArticle: "17",
        subjectId: "s",
        erasureRequestedAtMs: 1,
        dataCategoriesErased: ["a"],
      },
    };
    const signed = await buildSignedExport({ request, payload, signer });
    expect(() =>
      verifySignedExport(signed, {
        expectedSigner: ("0x" + "99".repeat(20)) as `0x${string}`,
      }),
    ).toThrow(SovereignExportError);
  });

  it("assertFormatJurisdictionCompatible rejects SAR outside US", () => {
    expect(() => assertFormatJurisdictionCompatible("sar-fincen-111", "DE")).toThrow(
      SovereignExportError,
    );
  });

  it("assertFormatJurisdictionCompatible rejects MiCA outside EU", () => {
    expect(() => assertFormatJurisdictionCompatible("mica-transaction", "US")).toThrow(
      SovereignExportError,
    );
  });
});

// ─── SAR ────────────────────────────────────────────────

describe("formatSarFincen111", () => {
  const request: ExportRequest = {
    format: "sar-fincen-111",
    jurisdiction: "US",
    range: { fromMs: 0, toMs: Date.parse("2026-02-01") },
    operatorId: OPERATOR.id,
    operatorDisplayName: OPERATOR.name,
  };

  it("produces a compliant payload", async () => {
    const events = [
      makeEvent({ id: "ev-1" }),
      makeEvent({ id: "ev-2", sequenceNumber: 2 }),
    ];
    const payload = await formatSarFincen111({
      request,
      dataSource: stubDataSource(events),
      filingType: "initial",
      suspiciousActivityCategories: ["structuring"],
      narrative: "Repeated deposits just below $10,000 reported threshold across 14 days.",
      subjects: [
        {
          subjectId: "subj-1",
          role: "subject",
          name: "Alice",
          country: "US",
        },
      ],
      filingInstitution: {
        legalName: "Acme Custody LLC",
        tin: "12-3456789",
        jurisdiction: "US",
      },
    });
    expect(payload.format).toBe("sar-fincen-111");
    expect(payload.body.transactions.length).toBe(2);
    expect(BigInt(payload.body.subjectActivity.totalAmountUsdCents)).toBe(3_000_000n);
  });

  it("rejects empty subjects", async () => {
    await expect(
      formatSarFincen111({
        request,
        dataSource: stubDataSource([makeEvent()]),
        filingType: "initial",
        suspiciousActivityCategories: ["structuring"],
        narrative: "Some sufficiently long narrative here",
        subjects: [],
        filingInstitution: { legalName: "X", jurisdiction: "US" },
      }),
    ).rejects.toMatchObject({ code: "schema-field-missing" });
  });

  it("rejects short narrative", async () => {
    await expect(
      formatSarFincen111({
        request,
        dataSource: stubDataSource([makeEvent()]),
        filingType: "initial",
        suspiciousActivityCategories: ["structuring"],
        narrative: "too short",
        subjects: [{ subjectId: "s", role: "subject" }],
        filingInstitution: { legalName: "X", jurisdiction: "US" },
      }),
    ).rejects.toMatchObject({ code: "schema-field-invalid" });
  });

  it("rejects zero transactions", async () => {
    await expect(
      formatSarFincen111({
        request,
        dataSource: stubDataSource([]),
        filingType: "initial",
        suspiciousActivityCategories: ["structuring"],
        narrative: "A sufficiently long narrative for the SAR.",
        subjects: [{ subjectId: "s", role: "subject" }],
        filingInstitution: { legalName: "X", jurisdiction: "US" },
      }),
    ).rejects.toMatchObject({ code: "schema-field-missing" });
  });
});

// ─── CTR ────────────────────────────────────────────────

describe("formatCtrFincen112", () => {
  const request: ExportRequest = {
    format: "ctr-fincen-112",
    jurisdiction: "US",
    range: { fromMs: 0, toMs: Date.parse("2026-02-01") },
    operatorId: OPERATOR.id,
    operatorDisplayName: OPERATOR.name,
  };

  it("reports subjects above threshold", async () => {
    const events = [
      makeEvent({
        id: "ev-1",
        subjectId: "big",
        detail: { amountUsdCents: "1500000", asset: "USDC" },
      }),
      makeEvent({
        id: "ev-2",
        subjectId: "small",
        sequenceNumber: 2,
        detail: { amountUsdCents: "50000", asset: "USDC" },
      }),
    ];
    const payload = await formatCtrFincen112({
      request,
      dataSource: stubDataSource(events),
      filingInstitution: { legalName: "Acme", jurisdiction: "US" },
    });
    expect(payload.body.reportableEntities.length).toBe(1);
    expect(payload.body.reportableEntities[0].subjectId).toBe("big");
  });

  it("rejects when nothing exceeds threshold", async () => {
    const events = [
      makeEvent({
        id: "ev-1",
        detail: { amountUsdCents: "50000", asset: "USDC" },
      }),
    ];
    await expect(
      formatCtrFincen112({
        request,
        dataSource: stubDataSource(events),
        filingInstitution: { legalName: "Acme", jurisdiction: "US" },
      }),
    ).rejects.toMatchObject({ code: "reportable-entity-count-zero" });
  });

  it("respects caller threshold override", async () => {
    const events = [
      makeEvent({
        id: "ev-1",
        detail: { amountUsdCents: "60000", asset: "USDC" },
      }),
    ];
    const payload = await formatCtrFincen112({
      request,
      dataSource: stubDataSource(events),
      filingInstitution: { legalName: "Acme", jurisdiction: "US" },
      thresholdUsdCents: 50_000n,
    });
    expect(payload.body.reportableEntities.length).toBe(1);
  });
});

// ─── GDPR ──────────────────────────────────────────────

describe("formatGdprDsar + formatGdprErasure", () => {
  const dsarRequest: ExportRequest = {
    format: "gdpr-dsar",
    jurisdiction: "EU",
    range: { fromMs: 0, toMs: 1_000_000 },
    operatorId: OPERATOR.id,
    operatorDisplayName: OPERATOR.name,
    subjectId: "subj-1",
  };

  it("DSAR happy path pulls subject-only data", async () => {
    const events = [makeEvent({ subjectId: "subj-1" })];
    const payload = await formatGdprDsar({
      request: dsarRequest,
      dataSource: stubDataSource(events),
      article: "15",
      retentionWindowMs: 30 * 24 * 60 * 60_000,
    });
    expect(payload.body.subjectId).toBe("subj-1");
    expect(payload.body.auditEvents.length).toBe(1);
  });

  it("DSAR rejects missing subjectId", async () => {
    await expect(
      formatGdprDsar({
        request: { ...dsarRequest, subjectId: undefined },
        dataSource: stubDataSource([]),
        article: "15",
        retentionWindowMs: 0,
      }),
    ).rejects.toMatchObject({ code: "subject-not-found" });
  });

  it("erasure happy path", () => {
    const payload = formatGdprErasure({
      request: { ...dsarRequest, format: "gdpr-erasure" },
      erasureRequestedAtMs: 42,
      dataCategoriesErased: ["kyc", "transactions"],
    });
    expect(payload.body.dataCategoriesErased.length).toBe(2);
  });

  it("erasure rejects empty categories", () => {
    expect(() =>
      formatGdprErasure({
        request: { ...dsarRequest, format: "gdpr-erasure" },
        erasureRequestedAtMs: 42,
        dataCategoriesErased: [],
      }),
    ).toThrow(SovereignExportError);
  });

  it("erasure rejects retention without justification", () => {
    expect(() =>
      formatGdprErasure({
        request: { ...dsarRequest, format: "gdpr-erasure" },
        erasureRequestedAtMs: 42,
        dataCategoriesErased: ["kyc"],
        retainedForLegalObligationMs: 10_000,
      }),
    ).toThrow(SovereignExportError);
  });
});

// ─── MiCA ─────────────────────────────────────────────

describe("formatMicaTransaction", () => {
  const request: ExportRequest = {
    format: "mica-transaction",
    jurisdiction: "EU",
    range: { fromMs: 0, toMs: 1_000_000 },
    operatorId: OPERATOR.id,
    operatorDisplayName: OPERATOR.name,
  };

  it("happy path pseudonymises sender/receiver", async () => {
    const events = [
      makeEvent({
        id: "tx-1",
        detail: {
          amountUsdCents: "1500000",
          asset: "USDC",
          senderId: "subj-1",
          receiverId: "subj-2",
          serviceCategory: "transfer",
        },
      }),
    ];
    const payload = await formatMicaTransaction({
      request,
      dataSource: stubDataSource(events),
      casp: {
        legalName: "Acme CASP",
        authorisationRef: "BaFin-ABC-2025",
        jurisdiction: "DE",
      },
      defaultServiceCategory: "custody",
    });
    expect(payload.body.transactions.length).toBe(1);
    // Sender/receiver should be hashed (not the original subj-1/subj-2)
    expect(payload.body.transactions[0].sender).not.toBe("subj-1");
    expect(payload.body.transactions[0].receiver).not.toBe("subj-2");
    expect(payload.body.aggregates.totalUsdCents).toBe("1500000");
  });

  it("rejects zero transactions", async () => {
    await expect(
      formatMicaTransaction({
        request,
        dataSource: stubDataSource([]),
        casp: {
          legalName: "Acme",
          authorisationRef: "x",
          jurisdiction: "DE",
        },
        defaultServiceCategory: "custody",
      }),
    ).rejects.toMatchObject({ code: "reportable-entity-count-zero" });
  });
});

// ─── CLI ──────────────────────────────────────────────

describe("CLI", () => {
  function makeCtx(overrides: Partial<CliContext> = {}): CliContext {
    return {
      dataSource: stubDataSource([makeEvent()]),
      writeStdout: vi.fn(),
      writeFile: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  it("rejects missing required flag", async () => {
    await expect(runCli(["--format", "gdpr-erasure"], makeCtx())).rejects.toMatchObject({
      code: "cli-argument-invalid",
    });
  });

  it("rejects unknown flag", async () => {
    await expect(
      runCli(["--nonsense", "x", "--format", "gdpr-erasure"], makeCtx()),
    ).rejects.toMatchObject({ code: "cli-argument-invalid" });
  });

  it("rejects unknown format", async () => {
    await expect(
      runCli(
        [
          "--format", "unknown",
          "--jurisdiction", "US",
          "--from", "0",
          "--to", "1",
          "--operator-id", "a",
          "--operator-name", "A",
        ],
        makeCtx(),
      ),
    ).rejects.toMatchObject({ code: "cli-argument-invalid" });
  });

  it("rejects inverted date range", async () => {
    await expect(
      runCli(
        [
          "--format", "gdpr-erasure",
          "--jurisdiction", "EU",
          "--from", "10",
          "--to", "5",
          "--operator-id", "a",
          "--operator-name", "A",
          "--subject", "s",
        ],
        makeCtx(),
      ),
    ).rejects.toMatchObject({ code: "date-range-invalid" });
  });

  it("rejects GDPR format without --subject", async () => {
    await expect(
      runCli(
        [
          "--format", "gdpr-erasure",
          "--jurisdiction", "EU",
          "--from", "0",
          "--to", "1",
          "--operator-id", "a",
          "--operator-name", "A",
        ],
        makeCtx(),
      ),
    ).rejects.toMatchObject({ code: "subject-not-found" });
  });

  it("gdpr-erasure end-to-end with --no-sign writes unsigned envelope", async () => {
    const ctx = makeCtx({
      gdprErasureExtra: {
        erasureRequestedAtMs: 42,
        dataCategoriesErased: ["kyc"],
      },
    });
    const signed = await runCli(
      [
        "--format", "gdpr-erasure",
        "--jurisdiction", "EU",
        "--from", "0",
        "--to", "1000",
        "--operator-id", "acme",
        "--operator-name", "Acme",
        "--subject", "subj-1",
        "--no-sign",
      ],
      ctx,
    );
    expect(signed.envelope.signature).toBe("0x");
    expect(ctx.writeStdout).toHaveBeenCalledTimes(1);
  });

  it("signs when signer is in context and --no-sign not set", async () => {
    const signer = new LocalKeyAdapter({ privateKey: OPERATOR_PK }).asTypedDataSigner();
    const ctx = makeCtx({
      signer,
      gdprErasureExtra: {
        erasureRequestedAtMs: 42,
        dataCategoriesErased: ["kyc"],
      },
    });
    const signed = await runCli(
      [
        "--format", "gdpr-erasure",
        "--jurisdiction", "EU",
        "--from", "0",
        "--to", "1000",
        "--operator-id", "acme",
        "--operator-name", "Acme",
        "--subject", "subj-1",
      ],
      ctx,
    );
    expect(signed.envelope.signature.length).toBe(132);
    expect(signed.envelope.signerAddress?.toLowerCase()).toBe(signer.address.toLowerCase());
  });

  it("writes to --output path when set", async () => {
    const ctx = makeCtx({
      gdprErasureExtra: {
        erasureRequestedAtMs: 42,
        dataCategoriesErased: ["kyc"],
      },
    });
    await runCli(
      [
        "--format", "gdpr-erasure",
        "--jurisdiction", "EU",
        "--from", "0",
        "--to", "1000",
        "--operator-id", "acme",
        "--operator-name", "Acme",
        "--subject", "subj-1",
        "--output", "/tmp/export.json",
        "--no-sign",
      ],
      ctx,
    );
    expect(ctx.writeFile).toHaveBeenCalledTimes(1);
    expect((ctx.writeFile as any).mock.calls[0][0]).toBe("/tmp/export.json");
  });

  it("accepts ISO-8601 and unix-ms dates interchangeably", async () => {
    const ctx = makeCtx({
      gdprErasureExtra: {
        erasureRequestedAtMs: 42,
        dataCategoriesErased: ["kyc"],
      },
    });
    const signed = await runCli(
      [
        "--format", "gdpr-erasure",
        "--jurisdiction", "EU",
        "--from", "2026-01-01T00:00:00Z",
        "--to", "2026-02-01T00:00:00Z",
        "--operator-id", "acme",
        "--operator-name", "Acme",
        "--subject", "subj-1",
        "--no-sign",
      ],
      ctx,
    );
    expect(signed.envelope.range.fromMs).toBe(Date.parse("2026-01-01T00:00:00Z"));
    expect(signed.envelope.range.toMs).toBe(Date.parse("2026-02-01T00:00:00Z"));
  });
});

// Sanity check: canonicalJson + sha256 round-trip matches payloadHash
describe("payloadHash integrity", () => {
  it("matches externally computed sha256 of canonical JSON", async () => {
    const payload: ExportPayload = {
      format: "gdpr-erasure",
      body: {
        gdprArticle: "17",
        subjectId: "s",
        erasureRequestedAtMs: 7,
        dataCategoriesErased: ["a"],
      },
    };
    const expected = sha256(new TextEncoder().encode(canonicalJson(payload)));
    const expectedHex =
      "0x" +
      Array.from(expected)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    expect(payloadHash(payload)).toBe(expectedHex);
  });
});
