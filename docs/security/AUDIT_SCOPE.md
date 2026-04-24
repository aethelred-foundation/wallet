# Aethelred Wallet — Security Audit Scoping Document

> **Classification:** Shareable with vetted audit firms under NDA
> **Owner:** Ramesh Tamilselvan (<rameshtamilselvan@gmail.com>)
> **Status:** Draft — ready for firm outreach
> **Target engagement window:** Q3 2026 (scoping Q2 2026)
> **Complement to:** [`THREAT_MODEL.md`](THREAT_MODEL.md) (STRIDE) and
> [`SECURITY_MODEL.md`](SECURITY_MODEL.md) (architectural controls)
> **Last updated:** 2026-04-24

## 1. Purpose

This document is the scoping package for a third-party security
review of the Aethelred agent-native moat stack (packages `#51–#65`,
shipped 2026-04). Handed to audit firms (Trail of Bits, Zellic,
Spearbit, OpenZeppelin, Code4rena, or equivalents) for quoting.

Three outcomes for the engagement:

1. **Attestation of cryptographic soundness** across the moat set —
   public-facing report auditors ship for our review.
2. **Remediation actions** with severity classification.
3. **Integration signal for SOC-2 Type 1** — the audit report is one
   of the evidence artefacts cited in
   [`SOC2_MOAT_CONTROL_MAPPING.md`](../compliance/SOC2_MOAT_CONTROL_MAPPING.md).

## 2. What firms should bid on

The scope has **three concurrent streams**:

| Stream | Subject | Rough effort |
|--------|---------|--------------|
| **A. Solidity contracts** | `contracts/src/AgentBudget.sol` + `contracts/src/Notary.sol` (future: `VerifyingPaymaster.sol` once we adopt the EF reference) | 2–3 weeks |
| **B. Cryptographic primitives** | EIP-712 implementations across `custody-adapters`, `x402`, `invoice`, `intent-router`, `paymaster-sponsor`; Merkle proofs across `audit` + `notarization`; Shamir 2-of-2 key-split correctness | 3–4 weeks |
| **C. TEE attestation binding** | `packages/x402/src/tee-attestation.ts` + custody-adapter Nitro flow; focus on the `bindingHash = sha256(structHash \|\| sha256(canonicalQuoteBytes))` construct | 1–2 weeks |

Total calendar: **6–8 weeks**, one principal + one associate typical.

## 3. Code under review

### 3.1 In scope — Solidity

| File | LOC | Role |
|------|----:|------|
| `contracts/src/AgentBudget.sol` | ~180 | Per-agent rolling-window spend caps + session keys |
| `contracts/src/Notary.sol` | ~60 | On-chain Merkle root anchor |
| `contracts/script/Deploy.s.sol` | ~70 | CREATE2 deterministic deployment |

**Not in scope (Solidity):** `VerifyingPaymaster.sol` — we'll adopt
the EF reference once deployed; separate audit budget.

### 3.2 In scope — TypeScript

| Package | Lines of concern |
|---------|------------------|
| `packages/x402` | EIP-712 hash computation, TEE attestation binding, signature verification |
| `packages/custody-adapters` | `eip712-hash.ts`, `shamir-2of2-adapter.ts` (`splitPrivateKey` / `reconstructKey`), `nitro-enclave-adapter.ts` (client-side recovery cross-check) |
| `packages/intent-router` | `intent-envelope.ts` (signature verify), `router.ts` (replay + deadline + fill verification) |
| `packages/agent-budget` | `calldata.ts` (ABI encoders), `session-key.ts` (key gen + zeroisation) |
| `packages/invoice` | `eip712-invoice.ts` (canonical encoding, signer-mismatch detection) |
| `packages/paymaster-sponsor` | `paymaster-signer.ts` (EIP-712 + 129-byte paymasterData layout), `sponsor-service.ts` (request-id derivation) |
| `packages/notarization` | `calldata.ts`, `inclusion.ts` (`verifyAnchoredProof`, `compareRecords`) |
| `packages/audit/merkle-batch.ts` | Merkle tree construction + proof generation — tested but has never had cryptographic review |

**Not in scope:** JSX / React components, Vite config, build scripts,
mobile Expo shell. These are product-layer and have been reviewed
internally; not part of this engagement.

### 3.3 In scope — cryptographic constructs

List of specific claims the auditor is asked to validate:

1. **`computeTypedDataDigest`** (`packages/custody-adapters/src/eip712-hash.ts`) is a correct and complete implementation of EIP-712 v4 for the subset we use (address / bool / bytesN / bytes / string / uint/int / nested structs; arrays deliberately rejected).
2. **`bindingHash = sha256(structHash || sha256(canonicalQuoteBytes))`** (`packages/x402/src/attestation-binding.ts`) is a collision-resistant binding that defends against adapter-swap + quote-cache attacks.
3. **`splitPrivateKey` / `reconstructKey`** (`packages/custody-adapters/src/shamir-2of2-adapter.ts`) correctly implements additive 2-of-2 secret sharing over the secp256k1 curve order `n`.
4. **`computeInvoiceId`** (`packages/invoice/src/eip712-invoice.ts`) is deterministic and domain-separated; id collisions are cryptographically infeasible for non-identical bodies.
5. **`buildRequestId`** (`packages/paymaster-sponsor/src/sponsor-service.ts`) — request-id uniqueness under honest inputs; replay-resistance on second-use.
6. **`verifyAnchoredProof`** (`packages/notarization/src/inclusion.ts`) is a sound verifier — no leaf / no sibling / no direction substitution can produce a passing proof against a mismatched root.
7. **`AgentBudget.spend`** (contract) — atomic revocation: a session key revocation at block `n` prevents any spend at block `n+1` regardless of whether a user-op was pre-signed at block `n-1`.

### 3.4 Out of scope

- **The Aethelred L1 blockchain** (separate engagement).
- **Third-party dApps** integrated via the dApp catalog.
- **Hardware vendor security** (Ledger, AWS Nitro, Fireblocks MPC
  cohort) — attested by vendors.
- **Noble crypto primitives** (`@noble/secp256k1`, `@noble/hashes`) —
  already independently audited.
- **Mobile app Expo shell** — product layer, out of scope.
- **User endpoint security** — out of scope.

## 4. Known-assumption register

The auditor should confirm — or challenge — each of the following
assumptions the system relies on:

| # | Assumption | Where it lives | Confidence |
|---|------------|----------------|-----------:|
| 1 | `@noble/secp256k1` and `@noble/hashes` are cryptographically sound for the use cases here (ECDSA signing, keccak-256, SHA-256, HMAC). | Every crypto code path | High — vendor audited |
| 2 | Node 18+ / browser `crypto.getRandomValues` provides CSPRNG-grade randomness. | Session-key generation, nonces, slug generation | High — platform guarantee |
| 3 | AWS Nitro quote attestation (verified by our `packages/compliance/tee-attestation.ts`) is vendor-sound. | Nitro custody flow, x402 attestation binding | High — vendor + PCR measurement |
| 4 | The canonical CREATE2 deployer at `0x4e59b44847b379578588920cA78FbF26c0B4956C` will be available on every target chain. | `contracts/script/Deploy.s.sol` | High — industry standard |
| 5 | EIP-712 typed-data encoding is stable across wallets (MetaMask / Rabby / Frame / our own `CustodyAdapter`). | Every cross-component signature | Medium — spec has had historical ambiguities |
| 6 | Rolling-window tumbling-reset semantics in `AgentBudget` match operator intent. | `contracts/src/AgentBudget.sol` | Needs confirmation |
| 7 | The `@aethelred/wallet-audit` Merkle tree (sha256, standard binary) is collision-resistant under the sha256 assumption. | Audit trail + notarization | High — standard construction |
| 8 | `keccak_256(compressed-pubkey-33-bytes)` mapped to `bytes32` in the EIP-712 profile is a sound binding of the merchant's public key. | `packages/invoice/src/eip712-invoice.ts` — `hashPublicKey` | Needs review |

Row 8 is the single highest-priority item we want the auditor to
challenge — we chose to hash the 33-byte compressed pubkey to bytes32
to fit EIP-712's native types, accepting a loss of direct recoverability
from the profile signature alone. Review should confirm this is
acceptable given that recovery happens via the `signer` address (also
carried in the profile).

## 5. Threat actors

Mirrors the assumptions in `THREAT_MODEL.md`:

1. **Compromised enclave.** A Nitro instance lies about which key it
   signed with. Defence: client-side ECDSA recovery + attestation
   PCR measurement — both must agree.
2. **Malicious session key holder.** A session key tries to spend
   more than authorised OR after revocation. Defence: on-chain
   atomic revocation (the moat property).
3. **Quote-cache attacker.** TEE provider returns a cached quote
   that matches a previous struct hash. Defence: the binding hash
   includes canonical quote bytes + struct hash — a new payment
   requires a fresh quote.
4. **Malicious merchant.** Publishes a signed invoice with a tampered
   field post-signing. Defence: deterministic `computeInvoiceId` +
   verification at the pay-surface resolver.
5. **Malicious solver.** Returns a valid-looking quote for the
   wrong intent. Defence: `pickBest` reject criteria + `verifyFill
   AgainstQuote`.
6. **Sponsor-side replay.** A sponsored request is submitted twice
   with the same quote. Defence: deterministic `requestId` +
   ledger duplicate rejection.
7. **Audit-trail forgery.** Operator tries to edit a past audit
   event after anchoring. Defence: `verifyAnchoredProof` compared
   against the on-chain root from `Notary`.

## 6. What auditors should deliver

### 6.1 Expected artefacts

1. **Initial kickoff report** (week 1) — scoping confirmation +
   assumption challenges + risk-prioritised plan for the remaining
   weeks.
2. **Interim findings** (mid-engagement) — critical + high-severity
   findings as they're identified, giving engineering time to
   remediate in parallel.
3. **Final written report** — auditor-branded, public-shareable
   redacted version + internal full version.
4. **Remediation verification** (post-fix) — either confirmation that
   findings were addressed or residual-risk call-outs.

### 6.2 Severity classification

Standard OpenZeppelin / ToB severity schema:

- **Critical** — immediate loss of funds, bypass of access control, or permanent data loss.
- **High** — conditional loss of funds, correctness violation under specific conditions.
- **Medium** — incorrect behaviour without loss, hardening required.
- **Low** — cosmetic, convention deviation, defence-in-depth.
- **Informational** — style / gas optimisation / documentation improvement.

## 7. Commercial envelope

Indicative budget: **$80k–$250k** depending on firm + engagement
depth. Fixed-fee preferred over hourly. No engagement contingent on
specific findings — the auditor is paid regardless of what they find.

### 7.1 Firms invited to bid

- **Trail of Bits** — preferred for the cryptographic + TEE layer;
  strong ECDSA / MPC / Shamir review track record.
- **Spearbit** — preferred for the Solidity layer; marketplace model
  allows specialist pairing.
- **OpenZeppelin** — strong Solidity baseline; may pair well with
  the ERC-4337 ecosystem given their integration.
- **Zellic** — competitive on mixed cryptographic + Solidity scopes.
- **Code4rena** — contest model could supplement a firm engagement
  with wider coverage on specific contracts.

### 7.2 Selection criteria

1. Proven track record on ECDSA + TEE-attestation-binding reviews.
2. Willingness to sign a mutual NDA.
3. Response within 2 weeks of this document being shared.
4. Fixed-fee proposal with calendar timeline + deliverable list.
5. Public-shareable redacted report at the end — critical for
   procurement.

## 8. Engagement logistics

- **Code access:** Private git-bundle of the repo at a pinned tag.
  Auditors do not get write access. Pull-request comments + Slack
  channel for clarifications.
- **Commit hash locked** at engagement start. Any upstream changes
  go into a separate branch that's out of scope.
- **Weekly sync:** 30-min video call with the technical owner + any
  domain specialists.
- **Finding intake:** auditor's issue tracker (GitHub Issues on their
  side or their preferred tool). We triage within 48 hours.
- **Remediation:** engineering team owns fixes; auditor verifies
  before signing off.

## 9. Post-engagement actions

When the engagement closes:

1. **Publish public report** (redacted) — marketing + procurement
   value.
2. **Update `SOC2_MOAT_CONTROL_MAPPING.md` §5** — close the "no
   external audit" gap.
3. **Deploy audited contract versions** to mainnet + update
   `contracts/deployments.json`.
4. **Remove "reference-only" caveat** from `ARCHITECTURE.md`.
5. **Update `README.md` tests badge** to include an "Audited"
   shield.

## 10. Questions for prospective firms

Please include answers to these in your proposal:

1. Have you audited comparable TEE-attestation-binding constructs
   before? If so, what patterns did you find most frequently vulnerable?
2. Your approach to reviewing hand-rolled ABI encoders
   (`custody-adapters/eip712-hash.ts`) vs library-backed ones.
3. Scope of your coverage for the Shamir 2-of-2 split — do you
   validate against malformed-share attacks, or only happy-path
   reconstruction?
4. Rate for the non-Solidity portion (packages 2 and 3 of stream B +
   stream C).
5. Do you offer **retainer-model** follow-ups for incremental
   contract or package changes, or only point-in-time engagements?

## 11. Contacts

- **Technical + commercial owner:** Ramesh Tamilselvan
  (<rameshtamilselvan@gmail.com>)
- **Engineering point of contact:** same (this is a solo-founder
  setup; follow-up engineers onboard Q3 2026).

Firm proposals via email; NDA before repo access.
