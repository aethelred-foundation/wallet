# `@aethelred/wallet-sovereign-export`

Regulator-format compliance exports with signed envelopes + CLI.

Five formats ship:

- **`sar-fincen-111`** — FinCEN Suspicious Activity Report (US).
- **`ctr-fincen-112`** — FinCEN Currency Transaction Report (US, > $10k).
- **`gdpr-dsar`** — EU GDPR Articles 15 + 20 (right of access + portability).
- **`gdpr-erasure`** — EU GDPR Article 17 (right to erasure confirmation).
- **`mica-transaction`** — EU MiCA (Regulation 2023/1114) transaction reporting.

Every export carries an **EIP-712 signed envelope** so regulators verify
the report came from an authorised operator and hasn't been tampered
with. Signatures work with any `CustodyAdapter` — including Nitro-
enclave-sealed signers.

## Why this package exists

Regulated operators need to file SAR / CTR / GDPR DSAR / MiCA reports.
MoltPe's compliance story is "we handle it, trust our pipeline." Wrong
shape for:

- Operators who self-host wallets + need their own audit chain.
- Multi-jurisdiction operators who need simultaneous US + EU reporting.
- Regulators who want to verify the export authenticity without
  trusting the platform vendor.

Our formatters are pure functions; the envelope is signed; the CLI is
dep-free Node. Operators run it in their compliance pipeline without
embedding our TS API.

## Quick start

### From TypeScript

```ts
import {
  formatSarFincen111,
  buildSignedExport,
} from "@aethelred/wallet-sovereign-export";
import { LocalKeyAdapter } from "@aethelred/wallet-custody-adapters";

const signer = new LocalKeyAdapter({ privateKey: process.env.OPERATOR_PK! });

const payload = await formatSarFincen111({
  request: {
    format: "sar-fincen-111",
    jurisdiction: "US",
    range: { fromMs: period.start, toMs: period.end },
    operatorId: "acme-custody",
    operatorDisplayName: "Acme Custody LLC",
  },
  dataSource: yourDataSource,
  filingType: "initial",
  suspiciousActivityCategories: ["structuring"],
  narrative: "Repeated deposits just below the $10,000 threshold ...",
  subjects: [
    { subjectId: "subj-1", role: "subject", name: "Alice Doe", country: "US" },
  ],
  filingInstitution: {
    legalName: "Acme Custody LLC",
    tin: "12-3456789",
    jurisdiction: "US",
  },
});

const signed = await buildSignedExport({
  request,
  payload,
  signer: signer.asTypedDataSigner(),
});

// signed.envelope.signature verifies against signer.address.
```

### From the CLI

```bash
aethelred-export \
  --format sar-fincen-111 \
  --jurisdiction US \
  --from 2026-01-01 \
  --to 2026-01-31 \
  --operator-id acme-custody \
  --operator-name "Acme Custody LLC" \
  --output /var/compliance/out/sar-jan-2026.json
```

The CLI accepts ISO-8601 datetimes or unix-ms integers for `--from`/
`--to`. Flags `--subject` (required for GDPR formats), `--output`
(path; defaults to stdout), `--no-sign` (emit unsigned envelope for
dev/testing), and `--help` are available.

## What each formatter does

### SAR (FinCEN 111)

- Pulls signing-executed audit events in range, normalises into
  `SarTransaction` records.
- Requires at least one subject, one transaction, a ≥20-char
  narrative, and a non-zero total.
- Caller supplies filing institution identity + subjects + narrative
  at filing time — SAR requires structured PII that the audit log
  alone doesn't carry.
- Redaction profile: `full-disclosure` (FinCEN requires raw PII).

### CTR (FinCEN 112)

- Groups transactions by subject; filters to groups whose total
  exceeds the $10,000 reporting threshold (configurable).
- Rejects reports with zero reportable entities (would be a
  FinCEN-side reject).

### GDPR DSAR (articles 15 + 20)

- Pulls audit events + transactions for a specific subject.
- Redacts everything *except* the requesting subject (`subject-only`
  profile).
- Declares retention period so subjects know when data is scheduled
  for removal.

### GDPR Erasure (article 17)

- Confirmation payload only — actual deletion happens in the
  operator's backend.
- Enforces `retainedForLegalObligationMs` → `retentionJustification`
  coupling per GDPR art. 17(3).

### MiCA transaction reporting

- Pulls audit events, pseudonymises sender/receiver (hashes counterparty
  commitments per ESMA draft), emits aggregates.
- Default `serviceCategory` configurable for events that don't carry
  one.

## Signed envelope

Every export ships with an `ExportEnvelope` EIP-712-signed over:

```
format, jurisdiction, operatorId, fromMs, toMs, generatedAtMs, payloadHash
```

`payloadHash` is `sha256(canonicalJson(payload))`. Regulators can
verify the payload hasn't been altered by recomputing the hash and
checking the envelope signature — without parsing payload internals.

Signatures work with:

- `LocalKeyAdapter` — operator's EOA signing key.
- `LedgerHsmAdapter` — hardware-rooted.
- `NitroEnclaveAdapter` — TEE-sealed (high-trust operators who want
  to prove their compliance pipeline runs attested code).

## Redaction policies

Each format picks a default profile; callers can override:

| Profile            | Behaviour                                           |
| ------------------ | --------------------------------------------------- |
| `full-disclosure`  | Raw PII passed through; only `alwaysRedacted` fields redacted. |
| `subject-only`     | Raw PII for `privilegedSubject`; hash/truncate everyone else. |
| `hashed`           | SHA-256 → 8-char hash for every sensitive field.    |
| `pseudonymous`     | Counterparties hashed; amounts disclosed.           |

Sensitive fields (defined in `redaction.ts`): `name`, `email`, `phone`,
`address`, `identifierValue`, `passportNumber`, `driversLicenseNumber`,
`taxId`, `ssn`, `counterpartyAddress`, `counterparty`, `sender`,
`receiver`.

## Error codes

Structured throws with a stable `code`:

| Category | Codes |
| -------- | ----- |
| Input validation | `export-request-malformed`, `date-range-invalid`, `subject-not-found`, `report-format-unsupported`, `jurisdiction-unsupported` |
| Schema | `schema-field-missing`, `schema-field-invalid`, `amount-threshold-not-met`, `reportable-entity-count-zero` |
| PII | `pii-redaction-failed`, `pii-over-redacted` |
| Signing | `export-signer-mismatch`, `export-signature-invalid`, `export-integrity-mismatch` |
| CLI | `cli-argument-invalid`, `cli-datasource-unreachable` |

## What this package DOES NOT do

- Implement the HTTP interface to regulator portals. Different
  regulators have different submission flows (FinCEN BSA E-Filing,
  EU DAC8 gateways, national competent authorities). This package
  produces the standardised payload; shipping it to the regulator is
  the operator's downstream integration.
- Delete data. `gdpr-erasure` produces a confirmation payload; actual
  deletion happens in the operator's storage layer.
- Fetch data from a wallet. `ExportDataSource` is an interface — wire
  it to your audit log + DB + chain indexer.
- Compose complex narratives. SAR narrative text is caller-supplied;
  the formatter only validates length.

## Integration with the rest of the stack

- **Audit package** (`@aethelred/wallet-audit`): `ExportDataSource`
  reads `AuditEvent[]` directly.
- **Compliance package** (`@aethelred/wallet-compliance`): KYC
  profiles, travel-rule events flow in via the same interface.
- **Custody adapters** (`@aethelred/wallet-custody-adapters`): any
  adapter signs the envelope.
- **Compliance reports**: the existing `ReportGenerator` from the
  compliance package handles KYC / SOC2 / general audit trails. This
  package handles the regulator-specific formats on top.

## Testing

```bash
npx vitest run sovereign-export
```

42 tests cover: redaction (deterministic, profile behaviours), envelope
(canonicalJson stability, payloadHash sensitivity, unsigned + signed
paths, tampering + signer-mismatch detection, jurisdiction
compatibility), SAR formatter (happy path + every rejection), CTR
formatter (grouping + threshold + override), GDPR DSAR + erasure
(happy path + missing-subject + retention-without-justification),
MiCA (pseudonymisation + zero-transaction rejection), CLI (every flag
validated + missing-required + unknown-flag + unknown-format + range
direction + GDPR-requires-subject + end-to-end with signer + stdout +
file output + ISO/unix-ms date formats), payloadHash integrity against
external sha256.
