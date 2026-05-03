/**
 * Tests for `JsonFeedLiabilityAttestor` — the reference implementation
 * of `LiabilityAttestor` that fetches a signed JSON snapshot from
 * an HTTP feed.
 *
 * Coverage targets:
 *
 *   1. Happy path — well-formed feed → parsed attestation
 *   2. Network failures — fetch throws, non-2xx, AbortController timeout
 *   3. Parse failures — non-JSON body, missing fields, wrong types,
 *      malformed signature, malformed coverage
 *   4. Freshness — stale snapshot rejected; future-dated rejected;
 *      maxAgeMs=0 disables the gate
 *   5. Signature verification — verifier returns false → null;
 *      verifier throws → null; PASSTHROUGH accepts;
 *      REJECT_ALL rejects
 *   6. Forward compatibility — extra fields in the feed are tolerated
 *   7. bigint coverage parsing — accepts number, numeric string,
 *      and "<digits>n" bigint string
 *
 * The contract everywhere: never throw, return `null` on every
 * failure mode so `captureLiabilitySnapshot` produces
 * `liabilityUnknown: true` events.
 */

import { describe, expect, it, vi } from "vitest";

import {
  CUSTODIAN_IDS,
  JsonFeedLiabilityAttestor,
  PASSTHROUGH_VERIFIER,
  REJECT_ALL_VERIFIER,
  captureLiabilitySnapshot,
  type CustodianLiabilityAttestation,
  type FetchLike,
  type OracleSignatureVerifier,
} from "@aethelred/wallet-custody-adapters";

// ─── Helpers ──────────────────────────────────────────────────────

function fakeFetch(opts: {
  readonly body?: string;
  readonly status?: number;
  readonly throwOnFetch?: boolean;
  readonly delayMs?: number;
}): FetchLike {
  return async (_url, init) => {
    if (opts.throwOnFetch) throw new Error("network");
    if (opts.delayMs && opts.delayMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, opts.delayMs);
        if (init?.signal) {
          init.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timeout);
              reject(new Error("aborted"));
            },
            { once: true },
          );
        }
      });
    }
    return {
      ok: (opts.status ?? 200) >= 200 && (opts.status ?? 200) < 300,
      status: opts.status ?? 200,
      async text() {
        return opts.body ?? "";
      },
    };
  };
}

function feedJson(
  overrides: Partial<{
    custodianId: string;
    slaStatus: string;
    insuranceCoverage: unknown;
    insuranceCurrency: string;
    attestedAt: number;
    oracleId: string;
    signature: string;
  }> = {},
): string {
  return JSON.stringify({
    custodianId: CUSTODIAN_IDS.komainu,
    slaStatus: "operational",
    insuranceCoverage: "50000000000n",
    insuranceCurrency: "USD",
    attestedAt: 1_700_000_000_000,
    oracleId: "chainlink:custody:komainu",
    signature: "0x" + "ab".repeat(32),
    ...overrides,
  });
}

const NOW = 1_700_000_000_500;

// ─── Happy path ────────────────────────────────────────────────────

describe("JsonFeedLiabilityAttestor: happy path", () => {
  it("parses a well-formed feed with passthrough verifier", async () => {
    const attestor = new JsonFeedLiabilityAttestor({
      custodianId: CUSTODIAN_IDS.komainu,
      feedUrl: "https://oracle.example.com/komainu",
      verifier: PASSTHROUGH_VERIFIER,
      fetch: fakeFetch({ body: feedJson() }),
      now: () => NOW,
    });
    const att = await attestor.fetchAttestation();
    expect(att).not.toBeNull();
    expect(att!.custodianId).toBe(CUSTODIAN_IDS.komainu);
    expect(att!.slaStatus).toBe("operational");
    expect(att!.insuranceCoverage).toBe(50_000_000_000n);
    expect(att!.insuranceCurrency).toBe("USD");
    expect(att!.attestedAt).toBe(1_700_000_000_000);
    expect(att!.signature).toBe("0x" + "ab".repeat(32));
  });

  it("composes with captureLiabilitySnapshot end-to-end", async () => {
    const attestor = new JsonFeedLiabilityAttestor({
      custodianId: CUSTODIAN_IDS.komainu,
      feedUrl: "https://oracle.example.com/komainu",
      verifier: PASSTHROUGH_VERIFIER,
      fetch: fakeFetch({ body: feedJson() }),
      now: () => NOW,
    });
    const snapshot = await captureLiabilitySnapshot({
      transactionId: "0xtx-001",
      attestor,
      now: () => NOW,
    });
    expect(snapshot.liabilityUnknown).toBe(false);
    expect(snapshot.attestation!.insuranceCoverage).toBe(50_000_000_000n);
  });

  it("tolerates unknown extra fields in the feed (forward-compat)", async () => {
    const body = JSON.stringify({
      custodianId: CUSTODIAN_IDS.komainu,
      slaStatus: "operational",
      insuranceCoverage: 50_000_000_000,
      insuranceCurrency: "USD",
      attestedAt: 1_700_000_000_000,
      oracleId: "chainlink:custody:komainu",
      signature: "0x" + "ab".repeat(32),
      // Future fields the feed might add — must not break parsing.
      schemaVersion: 2,
      issuerJurisdiction: "JE",
      extraMetadata: { foo: "bar" },
    });
    const attestor = new JsonFeedLiabilityAttestor({
      custodianId: CUSTODIAN_IDS.komainu,
      feedUrl: "https://oracle.example.com/komainu",
      verifier: PASSTHROUGH_VERIFIER,
      fetch: fakeFetch({ body }),
      now: () => NOW,
    });
    const att = await attestor.fetchAttestation();
    expect(att).not.toBeNull();
    expect(att!.insuranceCoverage).toBe(50_000_000_000n);
  });
});

// ─── Network failures ─────────────────────────────────────────────

describe("JsonFeedLiabilityAttestor: network failures (never throw)", () => {
  it("fetch throws → null", async () => {
    const attestor = new JsonFeedLiabilityAttestor({
      custodianId: CUSTODIAN_IDS.komainu,
      feedUrl: "https://oracle.example.com/komainu",
      verifier: PASSTHROUGH_VERIFIER,
      fetch: fakeFetch({ throwOnFetch: true }),
      now: () => NOW,
    });
    expect(await attestor.fetchAttestation()).toBeNull();
  });

  it("non-2xx status → null", async () => {
    const attestor = new JsonFeedLiabilityAttestor({
      custodianId: CUSTODIAN_IDS.komainu,
      feedUrl: "https://oracle.example.com/komainu",
      verifier: PASSTHROUGH_VERIFIER,
      fetch: fakeFetch({ status: 503, body: "service unavailable" }),
      now: () => NOW,
    });
    expect(await attestor.fetchAttestation()).toBeNull();
  });

  it("timeout aborts and returns null", async () => {
    const attestor = new JsonFeedLiabilityAttestor({
      custodianId: CUSTODIAN_IDS.komainu,
      feedUrl: "https://oracle.example.com/komainu",
      verifier: PASSTHROUGH_VERIFIER,
      fetch: fakeFetch({ body: feedJson(), delayMs: 100 }),
      timeoutMs: 10,
      now: () => NOW,
    });
    expect(await attestor.fetchAttestation()).toBeNull();
  });
});

// ─── Parse failures ───────────────────────────────────────────────

describe("JsonFeedLiabilityAttestor: parse failures", () => {
  it("non-JSON body → null", async () => {
    const attestor = new JsonFeedLiabilityAttestor({
      custodianId: CUSTODIAN_IDS.komainu,
      feedUrl: "https://oracle.example.com/komainu",
      verifier: PASSTHROUGH_VERIFIER,
      fetch: fakeFetch({ body: "<html>nope</html>" }),
      now: () => NOW,
    });
    expect(await attestor.fetchAttestation()).toBeNull();
  });

  it("missing required fields → null", async () => {
    const cases = [
      feedJson({ custodianId: undefined as unknown as string }),
      feedJson({ slaStatus: undefined as unknown as string }),
      feedJson({ insuranceCoverage: undefined }),
      feedJson({ insuranceCurrency: undefined as unknown as string }),
      feedJson({ attestedAt: undefined as unknown as number }),
      feedJson({ oracleId: undefined as unknown as string }),
    ];
    for (const body of cases) {
      const attestor = new JsonFeedLiabilityAttestor({
        custodianId: CUSTODIAN_IDS.komainu,
        feedUrl: "https://oracle.example.com/komainu",
        verifier: PASSTHROUGH_VERIFIER,
        fetch: fakeFetch({ body }),
        now: () => NOW,
      });
      expect(await attestor.fetchAttestation()).toBeNull();
    }
  });

  it("wrong-type fields → null", async () => {
    // slaStatus must be one of the three canonical values
    const attestor = new JsonFeedLiabilityAttestor({
      custodianId: CUSTODIAN_IDS.komainu,
      feedUrl: "https://oracle.example.com/komainu",
      verifier: PASSTHROUGH_VERIFIER,
      fetch: fakeFetch({ body: feedJson({ slaStatus: "garbage" }) }),
      now: () => NOW,
    });
    expect(await attestor.fetchAttestation()).toBeNull();
  });

  it("malformed signature (non-hex) → null", async () => {
    const attestor = new JsonFeedLiabilityAttestor({
      custodianId: CUSTODIAN_IDS.komainu,
      feedUrl: "https://oracle.example.com/komainu",
      verifier: PASSTHROUGH_VERIFIER,
      fetch: fakeFetch({ body: feedJson({ signature: "not-hex-data" }) }),
      now: () => NOW,
    });
    expect(await attestor.fetchAttestation()).toBeNull();
  });

  it("malformed coverage (negative number) → null", async () => {
    const attestor = new JsonFeedLiabilityAttestor({
      custodianId: CUSTODIAN_IDS.komainu,
      feedUrl: "https://oracle.example.com/komainu",
      verifier: PASSTHROUGH_VERIFIER,
      fetch: fakeFetch({ body: feedJson({ insuranceCoverage: -1 }) }),
      now: () => NOW,
    });
    expect(await attestor.fetchAttestation()).toBeNull();
  });
});

// ─── Freshness gate ───────────────────────────────────────────────

describe("JsonFeedLiabilityAttestor: freshness gate", () => {
  it("rejects stale snapshots (older than maxAgeMs)", async () => {
    const attestor = new JsonFeedLiabilityAttestor({
      custodianId: CUSTODIAN_IDS.komainu,
      feedUrl: "https://oracle.example.com/komainu",
      verifier: PASSTHROUGH_VERIFIER,
      fetch: fakeFetch({
        body: feedJson({ attestedAt: NOW - 11 * 60 * 1_000 }), // 11min ago
      }),
      maxAgeMs: 10 * 60 * 1_000, // 10min
      now: () => NOW,
    });
    expect(await attestor.fetchAttestation()).toBeNull();
  });

  it("accepts snapshots within maxAgeMs", async () => {
    const attestor = new JsonFeedLiabilityAttestor({
      custodianId: CUSTODIAN_IDS.komainu,
      feedUrl: "https://oracle.example.com/komainu",
      verifier: PASSTHROUGH_VERIFIER,
      fetch: fakeFetch({
        body: feedJson({ attestedAt: NOW - 5 * 60 * 1_000 }), // 5min ago
      }),
      maxAgeMs: 10 * 60 * 1_000,
      now: () => NOW,
    });
    expect(await attestor.fetchAttestation()).not.toBeNull();
  });

  it("rejects future-dated snapshots (clock skew defense)", async () => {
    // A snapshot dated in the future is suspicious — either the
    // oracle's clock is broken or someone is replaying with edited
    // timestamps. Reject either way.
    const attestor = new JsonFeedLiabilityAttestor({
      custodianId: CUSTODIAN_IDS.komainu,
      feedUrl: "https://oracle.example.com/komainu",
      verifier: PASSTHROUGH_VERIFIER,
      fetch: fakeFetch({
        body: feedJson({ attestedAt: NOW + 60 * 1_000 }), // 1min in future
      }),
      now: () => NOW,
    });
    expect(await attestor.fetchAttestation()).toBeNull();
  });

  it("maxAgeMs=0 disables freshness gating", async () => {
    // Documented as not-recommended-for-prod, but the flag exists for
    // testing + air-gapped environments where the clock isn't trusted.
    const attestor = new JsonFeedLiabilityAttestor({
      custodianId: CUSTODIAN_IDS.komainu,
      feedUrl: "https://oracle.example.com/komainu",
      verifier: PASSTHROUGH_VERIFIER,
      fetch: fakeFetch({
        body: feedJson({ attestedAt: NOW - 365 * 24 * 60 * 60 * 1_000 }), // 1yr ago
      }),
      maxAgeMs: 0,
      now: () => NOW,
    });
    expect(await attestor.fetchAttestation()).not.toBeNull();
  });
});

// ─── Signature verification ───────────────────────────────────────

describe("JsonFeedLiabilityAttestor: signature verification", () => {
  it("REJECT_ALL_VERIFIER → null (verification failed)", async () => {
    const attestor = new JsonFeedLiabilityAttestor({
      custodianId: CUSTODIAN_IDS.komainu,
      feedUrl: "https://oracle.example.com/komainu",
      verifier: REJECT_ALL_VERIFIER,
      fetch: fakeFetch({ body: feedJson() }),
      now: () => NOW,
    });
    expect(await attestor.fetchAttestation()).toBeNull();
  });

  it("PASSTHROUGH_VERIFIER → accepts (transport-trust mode)", async () => {
    // PASSTHROUGH is documented as the "we already trust the
    // transport" mode. The attestor still consumes the feed body
    // and returns the parsed attestation.
    const attestor = new JsonFeedLiabilityAttestor({
      custodianId: CUSTODIAN_IDS.komainu,
      feedUrl: "https://oracle.example.com/komainu",
      verifier: PASSTHROUGH_VERIFIER,
      fetch: fakeFetch({ body: feedJson() }),
      now: () => NOW,
    });
    expect(await attestor.fetchAttestation()).not.toBeNull();
  });

  it("verifier throws → null (defends buggy implementations)", async () => {
    const buggyVerifier: OracleSignatureVerifier = {
      verify: () => {
        throw new Error("verifier crashed");
      },
    };
    const attestor = new JsonFeedLiabilityAttestor({
      custodianId: CUSTODIAN_IDS.komainu,
      feedUrl: "https://oracle.example.com/komainu",
      verifier: buggyVerifier,
      fetch: fakeFetch({ body: feedJson() }),
      now: () => NOW,
    });
    expect(await attestor.fetchAttestation()).toBeNull();
  });

  it("verifier receives oracleId + payload + signature", async () => {
    // Verify the verifier is called with the documented inputs so
    // implementations can pin their key material per oracleId.
    const verifier = vi.fn<OracleSignatureVerifier["verify"]>(() => true);
    const attestor = new JsonFeedLiabilityAttestor({
      custodianId: CUSTODIAN_IDS.komainu,
      feedUrl: "https://oracle.example.com/komainu",
      verifier: { verify: verifier },
      fetch: fakeFetch({ body: feedJson() }),
      now: () => NOW,
    });
    await attestor.fetchAttestation();
    expect(verifier).toHaveBeenCalledTimes(1);
    const call = verifier.mock.calls[0]![0];
    expect(call.oracleId).toBe("chainlink:custody:komainu");
    expect(call.signature).toBe("0x" + "ab".repeat(32));
    // Cross-realm: jsdom's Uint8Array differs from the test runner's,
    // so `instanceof Uint8Array` returns false here even though the
    // value is byte-array-shaped. Check structural shape (length +
    // numeric byte access) instead.
    expect(typeof call.payload.length).toBe("number");
    expect(call.payload.length).toBeGreaterThan(0);
    // Payload excludes the signature (per documented canonical form).
    const text = new TextDecoder().decode(call.payload);
    expect(text).not.toContain("signature");
  });

  it("feed without signature skips verification (trusted transport mode)", async () => {
    const verifier = vi.fn<OracleSignatureVerifier["verify"]>(() => true);
    const body = JSON.stringify({
      custodianId: CUSTODIAN_IDS.komainu,
      slaStatus: "operational",
      insuranceCoverage: 50_000_000_000,
      insuranceCurrency: "USD",
      attestedAt: 1_700_000_000_000,
      oracleId: "internal-mtls-pinned",
      // signature omitted
    });
    const attestor = new JsonFeedLiabilityAttestor({
      custodianId: CUSTODIAN_IDS.komainu,
      feedUrl: "https://oracle.example.com/komainu",
      verifier: { verify: verifier },
      fetch: fakeFetch({ body }),
      now: () => NOW,
    });
    const att = await attestor.fetchAttestation();
    expect(att).not.toBeNull();
    expect(att!.signature).toBeUndefined();
    expect(verifier).not.toHaveBeenCalled();
  });
});

// ─── Coverage parsing ─────────────────────────────────────────────

describe("JsonFeedLiabilityAttestor: insuranceCoverage parsing", () => {
  it("accepts a number value", async () => {
    const attestor = new JsonFeedLiabilityAttestor({
      custodianId: CUSTODIAN_IDS.komainu,
      feedUrl: "https://oracle.example.com/komainu",
      verifier: PASSTHROUGH_VERIFIER,
      fetch: fakeFetch({ body: feedJson({ insuranceCoverage: 50_000_000_000 }) }),
      now: () => NOW,
    });
    const att = (await attestor.fetchAttestation()) as CustodianLiabilityAttestation;
    expect(att.insuranceCoverage).toBe(50_000_000_000n);
  });

  it("accepts a numeric string", async () => {
    const attestor = new JsonFeedLiabilityAttestor({
      custodianId: CUSTODIAN_IDS.komainu,
      feedUrl: "https://oracle.example.com/komainu",
      verifier: PASSTHROUGH_VERIFIER,
      fetch: fakeFetch({ body: feedJson({ insuranceCoverage: "50000000000" }) }),
      now: () => NOW,
    });
    const att = (await attestor.fetchAttestation()) as CustodianLiabilityAttestation;
    expect(att.insuranceCoverage).toBe(50_000_000_000n);
  });

  it("accepts a 'n'-suffixed bigint string (canonical form)", async () => {
    const attestor = new JsonFeedLiabilityAttestor({
      custodianId: CUSTODIAN_IDS.komainu,
      feedUrl: "https://oracle.example.com/komainu",
      verifier: PASSTHROUGH_VERIFIER,
      fetch: fakeFetch({ body: feedJson({ insuranceCoverage: "50000000000n" }) }),
      now: () => NOW,
    });
    const att = (await attestor.fetchAttestation()) as CustodianLiabilityAttestation;
    expect(att.insuranceCoverage).toBe(50_000_000_000n);
  });

  it("rejects non-integer numeric strings", async () => {
    const attestor = new JsonFeedLiabilityAttestor({
      custodianId: CUSTODIAN_IDS.komainu,
      feedUrl: "https://oracle.example.com/komainu",
      verifier: PASSTHROUGH_VERIFIER,
      fetch: fakeFetch({ body: feedJson({ insuranceCoverage: "5e10" }) }),
      now: () => NOW,
    });
    expect(await attestor.fetchAttestation()).toBeNull();
  });
});
