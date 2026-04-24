# Aethelred Wallet — SOC-2 Control Mapping for the Agent-native Moat

> **Classification:** Internal / Auditor-shared
> **Owner:** Ramesh Tamilselvan (<rameshtamilselvan@gmail.com>)
> **Status:** Draft — complement to [`SOC2_SCOPE.md`](SOC2_SCOPE.md)
> **Applies to:** Packages `#51–#65` shipped across 2026-04 (the 12 moat
> packages + Foundry contracts + RPC adapters + integration demo)
> **Last updated:** 2026-04-24

## 1. Purpose

`SOC2_SCOPE.md` defines the audit boundary and TSC selection for the
wallet platform as a whole. **This document is the per-package control
mapping for the agent-native moat set** — it answers the auditor's
question "for each new system component you shipped, what control is
it implementing and what's the evidence trail?"

Hand this to the engagement lead alongside `SOC2_SCOPE.md`. Together
they cover (a) the audit boundary and (b) the specific TSC controls
each moat package evidences.

## 2. Trust Service Criteria coverage by package

The moat set evidences controls across four TSC categories. The
existing `SOC2_SCOPE.md` selects **Security (CC)** + **Confidentiality
(C)** for Type 1 with **Availability (A)** added for Type 2; this
mapping adds **Processing Integrity (PI)** as a stretch goal because
several moat packages have cryptographic-integrity properties that
naturally satisfy PI criteria.

| TSC | Packages with load-bearing controls |
|-----|--------------------------------------|
| CC1 — Control environment | (governance; not moat-specific) |
| CC2 — Communication | `mcp-server` (policy-gated tool disclosure) |
| CC3 — Risk assessment | `reputation` (ERC-8004 risk signals) |
| CC4 — Monitoring | `notarization` (on-chain anchoring) |
| CC5 — Control activities | `agent-budget`, `intent-router`, `invoice` |
| CC6 — Logical access | `custody-adapters`, `agent-budget` (session keys) |
| CC7 — System operations | `paymaster-sponsor`, `rpc-adapters` |
| CC8 — Change management | (existing CI/CD; not moat-specific) |
| CC9 — Risk mitigation | `reputation` (VC gates), `paymaster-sponsor` (kill switch) |
| A1 — Availability | `notarization` (cadence), `paymaster-sponsor` (rate limits) |
| C1 — Confidentiality | `custody-adapters` (Nitro TEE), `sovereign-export` |
| PI1 — Processing integrity | `x402` (TEE binding), `notarization` (Merkle) |

## 3. Per-package control mapping

Each row below answers five auditor questions:

1. **What does the package do?** (scope)
2. **Which TSC controls does it evidence?** (coverage)
3. **What's the automated evidence?** (reproducible test / log / on-chain proof)
4. **What's the manual evidence?** (document / policy / operator attestation)
5. **Out-of-scope caveats.** (what the package does NOT cover)

---

### 3.1 `@aethelred/wallet-x402` (PR #51)

**Scope:** HTTP 402 Payment Required protocol with TEE-attestation
binding. The moat cornerstone.

**TSC controls evidenced:**

| Control | Point |
|---------|-------|
| **CC6.1** (Logical access restrictions) | Payment authorisation requires EIP-712 signature from the agent's control key; no payment lands without a verifiable cryptographic artefact. |
| **CC6.6** (Transmission of data) | TEE attestation binds every payment to a fresh silicon-signed quote. The facilitator verifies the quote before honouring the payment. |
| **PI1.2** (Processing integrity — input validation) | `bindingHash = sha256(structHash \|\| sha256(canonicalQuoteBytes))` enforces that the signed quote corresponds to exactly this payment struct. |
| **PI1.4** (Output accuracy) | ECDSA recovery + quote measurement cross-check means downstream parties can independently verify every field. |

**Automated evidence:**
- Test suite: `apps/extension/src/test/x402-*.test.ts` (64 tests).
- Verification primitive: `verifyAttestationBinding()` — pure function
  with test vectors.
- `computeBindingHash()` produces byte-identical output across
  platforms.

**Manual evidence:**
- `packages/x402/README.md` — protocol + attestation flow.
- `ARCHITECTURE.md` §2 — the moat cornerstone rationale.

**Out of scope for this control:**
- The TEE silicon itself (AWS Nitro / Intel TDX / GCP CS) — attested
  by the hardware vendor, verified by our `packages/compliance/tee-
  attestation.ts`.
- Facilitator operational security — the customer's concern.

---

### 3.2 `@aethelred/wallet-mcp-server` (PR #52)

**Scope:** Policy-gated Model Context Protocol server for LLM tool
dispatch.

**TSC controls evidenced:**

| Control | Point |
|---------|-------|
| **CC2.2** (Internal communication of policies) | Tools declare their policy requirements as structured metadata; LLM clients see only what they're authorised to invoke. |
| **CC5.1** (Control activity selection) | The dispatcher pipeline (Route → Validate → Rate-limit → Policy gate → Audit pre-call → Handler → Audit post-call) is the explicit control activity. |
| **CC5.2** (Development of control activities) | Every handler passes through the policy gate before execution; no dispatch bypass path exists. |
| **CC6.3** (Authorisation + change management for access) | Policy changes (adding / removing tools) are themselves audit events. |
| **CC7.3** (Incident detection) | Info-disclosure hardening: unknown handler errors are sanitised to "Tool handler threw an internal error" — never leak internal state. |

**Automated evidence:**
- Test suite: `apps/extension/src/test/mcp-server.test.ts` (20 tests).
- Info-disclosure regression test: confirms raw error messages like
  `SELECT * FROM pg_shadow` never leak over the wire.

**Manual evidence:**
- `packages/mcp-server/README.md` — dispatch pipeline documentation.

**Out of scope:** LLM provider security, prompt injection defence at
the LLM layer.

---

### 3.3 `@aethelred/wallet-custody-adapters` (PR #54)

**Scope:** Pluggable signing backends (Local / Shamir / Ledger / Nitro
/ Fireblocks) under one `CustodyAdapter` contract.

**TSC controls evidenced:**

| Control | Point |
|---------|-------|
| **CC6.1** (Logical access restrictions) | Private key material is tiered: dev (local memory), parity (Shamir 2-of-2), hardware (Ledger), TEE (Nitro), MPC (Fireblocks). Customer picks the tier that matches its threat model. |
| **CC6.6** (Transmission of data between parties) | All five adapters produce byte-identical EIP-712 digests; no adapter-specific drift. |
| **C1.1** (Confidentiality of data) | Nitro adapter never exposes private keys outside the enclave; attestation binds to the payment struct hash. |
| **C1.2** (Disposal of confidential information) | `dispose()` zeroises in-memory key material and Shamir shares. |

**Automated evidence:**
- Test suite: `apps/extension/src/test/custody-adapters.test.ts` (29 tests).
- Critical invariant: LocalKey and Shamir adapters produce signatures
  that recover to the same address — enforced empirically per test.
- Nitro defense-in-depth: compromised-enclave test shows a lying
  enclave returning a wrong-key signature is rejected.

**Manual evidence:**
- `packages/custody-adapters/README.md` — tier comparison + security
  notes per adapter.
- TEE attestation chain docs (vendor-supplied for Nitro).

**Out of scope:**
- Hardware vendor security (Ledger, AWS Nitro, Fireblocks MPC cohort).
- Adapter-external key generation ceremonies.

---

### 3.4 `@aethelred/wallet-reputation` (PR #56)

**Scope:** ERC-8004 agent identity bridge + deterministic reputation
aggregator + VC-gated receiver policy.

**TSC controls evidenced:**

| Control | Point |
|---------|-------|
| **CC3.1** (Risk identification) | Reputation signals (VCs, payment history, fraud reports, TEE drift events) are the explicit risk-identification inputs. |
| **CC3.4** (Risk mitigation through controls) | VC gates with composable rules (require-KYC, require-min-tier, require-fresh-vc, custom predicates) are the mitigations. |
| **CC5.1/CC5.2** (Control activity selection + development) | Gate rules are pure functions; the gate combinator owns ordering + short-circuit. |
| **CC9.1/CC9.2** (Vendor and business partner risk) | The caller pins its own trusted-issuer set — the package doesn't impose ours. |

**Automated evidence:**
- Test suite: `apps/extension/src/test/reputation-bridge.test.ts` (43 tests).
- Deterministic scoring: same inputs always produce same `transparency`
  trace; every signal enumerated with its applied weight.
- Gate rule error handling: rule-throws-exception captured as
  structured failure, never bypasses the gate.

**Manual evidence:**
- `packages/reputation/README.md` — composition guide.
- `ARCHITECTURE.md` — VC gate composition rule (invoice > merchant
  default > none).

**Out of scope:**
- Issuer identity verification — pinned by operator.
- ERC-8004 on-chain registry code — external spec.

---

### 3.5 `@aethelred/wallet-intent-router` (PR #55)

**Scope:** EIP-712 typed intents + solver marketplace + composable
payment gate.

**TSC controls evidenced:**

| Control | Point |
|---------|-------|
| **CC5.1** (Control activity selection) | The orchestration pipeline is explicit: verifyIntentSignature → assertIntentFresh → nonceStore.claim → paymentGate → solvers.quote → pickBest → settle → verifyFillAgainstQuote. |
| **CC6.2** (User identification + authentication) | Intents are signed EIP-712; nonce replay guard is atomic; deadline enforcement is absolute. |
| **CC7.2** (Monitor anomalies) | Per-stage audit events via pluggable `AuditSink`. |
| **CC9.1** (Risk mitigation for third parties) | Solver `publicKeyHex` allows verification of solver quotes; malformed quote / wrong solverId / pre-expired quote all rejected. |

**Automated evidence:**
- Test suite: `apps/extension/src/test/intent-router.test.ts` (29 tests).
- Replay guard: InMemoryNonceStore atomic claim semantics verified.
- Fill verification: per-kind rules (transfer `==`, swap `≥`,
  payment `≤`) tested at boundary.

**Manual evidence:**
- `packages/intent-router/README.md` — pipeline + fill verification rules.

**Out of scope:**
- Solver implementations (Uniswap / CoW / x402 facilitator) — separate packages.

---

### 3.6 `@aethelred/wallet-agent-budget` (PR #53)

**Scope:** On-chain per-agent rolling-window spend caps + scoped
session keys.

**TSC controls evidenced:**

| Control | Point |
|---------|-------|
| **CC5.2** (Control activity development) | Separation of Budget / Session / Spend — the three-entity model is the design control. |
| **CC5.3** (Policy enforcement) | Caps enforced on-chain; `canSpend` view provides dry-run for paymasters / routers. |
| **CC6.1/CC6.2** (Logical access + authentication) | Session keys are ephemeral secp256k1; zeroised on dispose. |
| **CC6.3** (Authorisation management) | `revokeSession(sessionKey)` takes effect atomically — pre-signed UserOps can't outrun revocation (the canonical "revocation-race atomicity" property). |

**Automated evidence:**
- Foundry suite: `contracts/test/AgentBudget.t.sol` (16 tests, incl. the
  `test_revocation_race_atomic` property).
- TS suite: `apps/extension/src/test/agent-budget.test.ts` (33 tests).
- Atomic revocation: proven in Solidity tests — the contract reads
  Session state on every `spend()`, so revocation is a single block.

**Manual evidence:**
- `packages/agent-budget/README.md`.
- `contracts/README.md` — gas targets + deterministic deployment.

**Out of scope:**
- Contract deployment operational security (multisig, deployment
  ceremony).
- External audit (pending, see `AUDIT_SCOPE.md`).

---

### 3.7 `@aethelred/wallet-invoice` (PR #57)

**Scope:** Self-sovereign merchant invoices + `/pay/:slug` surface.

**TSC controls evidenced:**

| Control | Point |
|---------|-------|
| **CC5.1** (Control activity selection) | Invoice state machine (`draft → open → paid | expired | void`) with enforced transitions. |
| **CC6.6** (Transmission of information) | EIP-712 merchant profile + invoice signatures; recipient verifies both. |
| **PI1.1** (Quality of input) | Canonical invoice id `keccak256(canonicalJson(body))` — deterministic; any field tampering caught at verify time. |
| **PI1.5** (Output fulfils objectives) | Projection to x402 `PaymentRequirement` is a pure function; same input always produces same output. |

**Automated evidence:**
- Test suite: `apps/extension/src/test/invoice.test.ts` (36 tests).
- State transitions: every invalid transition rejected; paid transition requires receipt.
- Gate composition rule verified: invoice gate > merchant default > none.

**Manual evidence:**
- `packages/invoice/README.md` — signing chain + gate composition rule.

**Out of scope:**
- Merchant registration / identity verification — customer responsibility.

---

### 3.8 `@aethelred/wallet-paymaster-sponsor` (PR #58)

**Scope:** USDC gas sponsorship for ERC-4337 UserOperations.

**TSC controls evidenced:**

| Control | Point |
|---------|-------|
| **CC7.1** (Security monitoring) | Sponsor policy pipeline with composable rules (kill switch, blocklist, rate limit, max per request, reputation, budget). |
| **CC9.1** (Business partner risk mitigation) | Sponsor never custodies user funds — contract settles atomically at UserOp execution. Service compromise doesn't compromise user funds. |
| **A1.2** (Availability monitoring) | Rate limits + per-agent + per-window caps prevent DoS; kill switch provides emergency stop without redeploy. |
| **CC6.6** (Transmission of data) | Paymaster approval EIP-712 signature + 129-byte paymasterData layout verified on-chain. |
| **PI1.2** (Input validation) | UserOp hash mismatch, chain-id-unsupported, past validUntil all rejected. |

**Automated evidence:**
- Test suite: `apps/extension/src/test/paymaster-sponsor.test.ts` (37 tests).
- Replay guard: deterministic `requestId = keccak(userOpHash || validUntil
  || validAfter || priceQuoteId)` — collision is the replay-detection
  signal.

**Manual evidence:**
- `packages/paymaster-sponsor/README.md`.
- `docs/sales/ONE-PAGER.md` — commercial model.

**Out of scope:**
- Paymaster contract deployment + funding operational security.
- Price oracle integrity (Chainlink / Pyth / in-house — customer's
  contract choice).

---

### 3.9 `@aethelred/wallet-sovereign-export` (PR #59)

**Scope:** SAR / CTR / GDPR / MiCA regulator-format exports with
signed envelopes.

**TSC controls evidenced:**

| Control | Point |
|---------|-------|
| **C1.1** (Confidentiality — protection of data) | Export envelopes are EIP-712 signed; integrity of the export package is cryptographically verifiable by the regulator. |
| **C1.2** (Disposal of confidential information) | GDPR DSAR template includes explicit data-lineage + erasure-scope fields. |
| **CC2.3** (External communications) | Regulator-format exports match the filing format required by the jurisdiction (SAR/BSA for FinCEN, CTR, GDPR DSAR, MiCA transaction receipts). |
| **CC9.1/CC9.2** (Legal + regulatory compliance) | Template versioning + signed-by-subject envelopes. |

**Automated evidence:**
- Test suite: `apps/extension/src/test/sovereign-export.test.ts` (~37 tests).
- Template validator ensures payloads match the expected jurisdiction
  schema.

**Manual evidence:**
- `packages/sovereign-export/README.md`.
- Per-jurisdiction regulator schema documentation (FinCEN, EBA, MAS).

**Out of scope:**
- Regulatory interpretation of when to file — customer's legal team.
- Jurisdiction-specific filing deadlines.

---

### 3.10 `@aethelred/wallet-notarization` (PR #60)

**Scope:** On-chain Merkle anchoring for the audit trail.

**TSC controls evidenced:**

| Control | Point |
|---------|-------|
| **CC4.1/CC4.2** (Monitoring controls + evaluation) | Every 15-minute batch anchored on-chain provides tamper-evident audit. |
| **CC7.3** (Incident detection) | `AnchoredProof` bundles allow regulators to verify events against mainnet independent of the operator. |
| **PI1.2/PI1.3** (Processing integrity — input + processing) | `verifyAnchoredProof` cryptographically verifies the claim; `compareRecords` enumerates declared-vs-fetched mismatches. |
| **PI1.4** (Output accuracy) | On-chain Merkle root is canonical; off-chain claim is a Merkle proof. |

**Automated evidence:**
- Foundry suite: `contracts/test/Notary.t.sol` (7 tests incl. 256-run
  fuzz on `anchor(root, count)` field preservation).
- TS suite: `apps/extension/src/test/notarization.test.ts` (31 tests).
- Deterministic: same `eventHash` always produces same inclusion
  proof; `verifyAnchoredProof` is a pure verification primitive.

**Manual evidence:**
- `packages/notarization/README.md`.
- `contracts/deployments.json` — pinned Notary contract address.

**Out of scope:**
- Chain consensus — mainnet Ethereum is the trust root.
- Anchor submission key management — operator responsibility.

---

### 3.11 `@aethelred/wallet-integration` (PR #61) + `@aethelred/wallet-rpc-adapters` (PR #65)

**Scope:** Composition layer + end-to-end demo + JSON-RPC adapters.

**TSC controls evidenced:**

| Control | Point |
|---------|-------|
| **CC8.1** (Change management) | End-to-end demo is the reference integration — any change to a package surface breaks the demo immediately. |
| **CC5.1** (Control activity selection) | Composition adapters (`AgentBudgetGate`, `ReputationSponsorPolicy`, `BudgetSponsorPolicy`) are the load-bearing glue; test-enforced. |
| **CC7.3** (Incident detection) | `npm run demo` provides a < 1-second smoke test for every moat layer. |
| **A1.2** (Monitor health) | RPC adapter errors surface as typed `JsonRpcError` — operable diagnostics. |

**Automated evidence:**
- `apps/extension/src/test/integration.test.ts` (14 tests) + CLI smoke (`npm run demo:quiet`, exit 0).
- `apps/extension/src/test/rpc-adapters.test.ts` (15 tests).

**Manual evidence:**
- `packages/integration/README.md` + `packages/rpc-adapters/README.md`.
- `ARCHITECTURE.md` + `docs/sales/ONE-PAGER.md`.

**Out of scope:**
- RPC endpoint operational security — customer's RPC provider contract.

## 4. Evidence assembly for Type 1 engagement

When the auditor asks for control evidence, the mapping above points
to three evidence tiers per control:

1. **Automated (reproducible):** `npx vitest run <package>` or `forge
   test` — evidence regenerated on every CI run.
2. **Documentary:** package README, root ARCHITECTURE.md, sales
   artifacts. Version-pinned to the commit under audit.
3. **Observational (Type 2 only):** CloudWatch / Datadog / on-chain
   transaction logs proving the controls operated during the
   observation window.

Hand the auditor:
- This document (control mapping)
- `SOC2_SCOPE.md` (boundary + TSC selection)
- `THREAT_MODEL.md` (STRIDE coverage)
- `ARCHITECTURE.md` (system overview)
- A git-bundle of the repository at the audit tag

That's the Type 1 evidence package. Type 2 adds the observation-
window log exports.

## 5. Gaps + remediation roadmap

| Gap | Severity | Remediation | Target |
|-----|----------|-------------|--------|
| No external security audit of contracts / TS | High | Engage Trail of Bits / Zellic / Spearbit — see `docs/security/AUDIT_SCOPE.md`. | Q3 2026 |
| Observability stack (CloudWatch / Datadog) not yet deployed | Medium | Scoped in [`OBSERVABILITY_SCOPE.md`](OBSERVABILITY_SCOPE.md) — 4-phase rollout with per-package signals, SLO targets, alert taxonomy, vendor RFP checklist. | Q3 2026 |
| SOC-2 Type 2 operating-effectiveness evidence gap | Medium | Requires ≥ 3-month observation window post-deployment. | Q4 2026 / Q1 2027 |
| Chain-id resolver not ERC-8004-registry-backed yet | Low | `InMemoryERC8004Resolver` in demo; viem-backed resolver once spec stabilises. | Q3 2026 |
| Mobile native implementation (iOS / Android) | Low | Currently Expo shell; native Q3 roadmap. | Q3 2026 |

## 6. Auditor interaction checklist

When the engagement lead starts:

- [ ] Share this document + `SOC2_SCOPE.md` + `THREAT_MODEL.md`.
- [ ] Grant read access to the private GitHub repo (or provide a tag
  bundle).
- [ ] Schedule walkthroughs per control area (security / confidentiality /
  availability if in scope).
- [ ] Provide access to the CI dashboard (for automated evidence).
- [ ] Identify the customer-controlled scope boundary (endpoint /
  device security, RPC providers, custody vendor contracts).
- [ ] Lock the audit commit hash early; no moving target.

## 7. Document ownership

- **Technical owner:** Ramesh Tamilselvan
  (<rameshtamilselvan@gmail.com>).
- **Revision cadence:** Quarterly, or on every material moat-package
  change.
- **Next review:** Q3 2026 (post-first-audit feedback).
