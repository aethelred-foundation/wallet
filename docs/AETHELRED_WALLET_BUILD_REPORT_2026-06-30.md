# Aethelred Wallet — Detailed Build Report

**Prepared:** 2026-06-30 · **For:** external advisory review
**Version:** `0.9.0-beta.1` · **Repository:** `aethelred-foundation/wallet` (private, BSL-1.1)
**Supersedes:** `AETHELRED_WALLET_STATUS_REPORT_2026-06-24.md` (now stale — much shipped since)

> **Purpose.** A complete, current, honest account of everything built in the
> wallet across the last development cycle, so an external consultant can advise
> on **what to focus next** and **what to fix in the current build**. Sections 8
> and 9 are written specifically for that review — they call out the real gaps
> and open risks without softening them.

---

## 1. Executive summary

Since the 2026-06-24 advisory, the wallet has closed the consultant's **entire
"best-wallet" engineering parity scorecard (7/7)** and added a **sophisticated,
enforced compliance pipeline** on top. The work landed in three open PRs
(#184–#186), is fully unit-tested (**1,901 extension tests green**, `tsc` clean,
performance budgets pass), and follows the existing codebase's idioms (typed,
documented, no shipped stubs).

**Maturity: feature-complete-and-then-some at the engineering layer; still
assurance-incomplete at the trust layer.** The compliance/custody *capabilities*
are now genuinely best-in-class and composable. What stands between this and
production is **(a)** external assurance (audit, SOC-2, dependency remediation),
**(b)** one reviewed integration step (wiring the new pipeline into the live
signing path), and **(c)** vendor/staffing decisions. None of those are "write
more code" — they are human-gated.

**The single most important thing for the consultant to weigh in on:** we have
built a large amount of sophisticated, *un-audited, not-yet-enforced* compliance
and custody machinery. Is the right next move to **harden and wire in what
exists** (audit + integration), or to keep widening the surface? Our read is the
former; we want a second opinion.

---

## 2. What shipped this cycle (three PRs)

### PR #184 — Popup UI + preview hardening
`fix/popup-i18n-and-header`
- `84f1bdf` — fixed an i18n namespace bug (every `t()` call rendered the raw key
  across all views); removed the header "LIVE" label; added lazy-chunk load
  retry so a transient chunk fetch failure no longer renders a view as an error.
- `70895de` — content-hashed preview-build filenames + `build:preview` script to
  defeat browser cache staleness during preview.

### PR #185 — Four consultant gaps (custody + jurisdiction)
`feat/wallet-gaps-7702-vara-recovery-trezor`
- `f26885e` — **EIP-7702** authorization primitive (`packages/smart-account/src/eip7702.ts`).
- `1ff26be` — **VARA (Abu Dhabi) controls** (`packages/compliance/src/vara-controls.ts`).
- `34013c4` — **Guardian social recovery** (`packages/core/src/social-recovery.ts`).
- `b6670b4` — **Trezor backend** (`packages/core/src/custody/trezor.ts`).
- `e5b8c0d` — status report + production roadmap docs.

### PR #186 — Compliance pipeline + commercial items
`chore/license-rfp-screening-mpc`
- `a1f791e` — **BSL 1.1 license** (`LICENSE`, manifests, README).
- `405d04b` — **Live on-chain screening** circuit breaker (`live-screening.ts`).
- `79cff5a` — **Vendor-agnostic MPC-TSS** adapter (`custody-adapters/src/mpc-tss-adapter.ts`).
- `4164c13` — **Audit RFP** package (`docs/security/AUDIT_RFP_2026-06-24.md`).
- `c830c7b` — **TRISA/OpenVASP travel-rule interop** (IVMS101) (`travel-rule-interop.ts`).
- `515e1d0` — **Transaction authorization pipeline** (`authorization-pipeline.ts`).
- `1613cc6` — **Aggregating multi-vendor screening** (`screening-risk-engine.ts`).
- `f8e3d85` — **Behavioral anomaly engine** (`behavioral-anomaly.ts`).
- `55f558d` — **Institutional pipeline factory** (`institutional-pipeline.ts`).

---

## 3. The enforced compliance/custody architecture

The defining design property is **composability**: every gate is a pluggable,
vendor-agnostic primitive that snaps into a single ordered, fail-closed,
audited pre-signing decision.

```
buildInstitutionalAuthorizationPipeline(tier, deps)
  │   (one-call factory — encodes stage order, fail-closed posture, tier strictness)
  │
  ├─ screening      AggregatingScreeningProvider → LiveScreeningGate
  │                 (parallel multi-vendor, quorum + fail-closed, weighted/max
  │                  combine, categorical sanctions block)
  ├─ anomaly        BehavioralAnomalyEngine
  │                 (per-subject Welford baseline + structuring / amount-z-spike /
  │                  new-counterparty / dormancy / rapid-repeat heuristics)
  ├─ travel-rule    TravelRuleInteropEngine (IVMS101; TRISA/OpenVASP/Sygna/Notabene)
  └─ policy         existing @aethelred/wallet-policy engine
        │
        ▼  aggregate = most-severe (block ≻ review ≻ allow); fail-closed on stage
        │  error; sovereign tier escalates review→block; every decision audit-hooked
   authorizeOrThrow(context)
        │
        ▼
   signing:  MPC-TSS  /  Ledger (WebHID)  /  Trezor (Connect)  +  EIP-7702 delegation
        │
        ▼
   recovery: guardian social recovery (M-of-N + timelock + owner veto)
```

**Decoupling note:** the compliance package has **no dependency on the policy or
audit packages** — policy is injected as a function and audit is an `onDecision`
hook. This keeps each layer independently testable and avoids dependency cycles.

---

## 4. New modules — detail

| Module | File | What it does | Sophistication | Tests |
|---|---|---|---|---|
| EIP-7702 | `smart-account/eip7702.ts` | In-place EOA delegation: hash/sign/recover/verify authorization, encode `authorization_list` | sign→ecrecover round-trip + substitution guards | 14 |
| VARA controls | `compliance/vara-controls.ts` | Registered addresses, AED 3,500 travel-rule threshold, proof-of-reserves, 24-hr incident reporting | UAE-specific, the home jurisdiction | 13 |
| Social recovery | `core/social-recovery.ts` | M-of-N guardian owner rotation, timelock, owner veto | can't drop set below threshold; threshold+timelock enforced | 9 |
| Trezor | `core/custody/trezor.ts` | Trezor Connect backend (sibling to Ledger), reuses HW error taxonomy | refuses to blind-sign; injectable client seam | 10 |
| Live screening | `compliance/live-screening.ts` | Pre-signing circuit breaker, pluggable `ScreeningProvider` | fail-closed default; TTL cache; throws `ScreeningBlockedError` | 12 |
| MPC-TSS | `custody-adapters/mpc-tss-adapter.ts` | Vendor-agnostic threshold-sig custody (`ThresholdSigner` seam) | **recovery cross-check** rejects a cohort signing for the wrong key | 9 |
| TRISA / IVMS101 | `compliance/travel-rule-interop.ts` | Build/validate IVMS101 + protocol-agnostic transport | FATF R.16 above-threshold originator rule | 12 |
| Authorization pipeline | `compliance/authorization-pipeline.ts` | Ordered, fail-closed, audited multi-stage gate | severity aggregation; collect-all/fail-fast; tier escalation | 15 |
| Aggregating screening | `compliance/screening-risk-engine.ts` | Multi-vendor screening as a `ScreeningProvider` | quorum/fail-closed; category overrides (sanctions→100) | 9 |
| Behavioral anomaly | `compliance/behavioral-anomaly.ts` | Per-subject AML monitoring | Welford online variance; assess(pure)/record split | 12 |
| Institutional factory | `compliance/institutional-pipeline.ts` | One-call assembly of the enforced pipeline per tier | incremental stage opt-in; per-tier posture | 6 |

All eleven are **vendor-agnostic**: a deployment supplies an adapter
(Chainalysis/TRM/Elliptic; Silence Labs/ZenGo/Sodot; a TRISA network) against a
tested interface, with no change to the signing path.

---

## 5. Full feature inventory (with honest status)

Legend: ✅ built & tested · 🟡 partial / preview-grade · 🟦 scaffolded · ❌ not started

| Capability | Status | Note |
|---|---|---|
| Key mgmt, signing, EIP-712, RLP | ✅ | audited `@noble` primitives |
| ERC-4337 v0.6 + v0.7 smart accounts | ✅ | `smart-account` |
| **EIP-7702 EOA delegation** | ✅ | **new** |
| Multi-chain (EVM + BTC + Solana) | ✅ | adapter packages |
| Ledger hardware wallet | ✅ | WebHID |
| **Trezor hardware wallet** | ✅ | **new** (was a throw) |
| **MPC-TSS custody** | ✅ (code) | **new**, vendor-agnostic; no live vendor wired |
| **Guardian social recovery** | ✅ | **new** |
| Compliance suite (KYC/travel-rule/screening/cases) | ✅ | typed modules |
| **Live on-chain screening (pre-sign gate)** | ✅ (code) | **new**; default provider is a noop |
| **Aggregating multi-vendor screening** | ✅ | **new** |
| **Behavioral anomaly / AML monitoring** | ✅ | **new**; thresholds need real-data tuning |
| **TRISA/OpenVASP IVMS101 interop** | ✅ (code) | **new**; no live transport wired |
| **VARA jurisdiction controls** | ✅ | **new** |
| **Enforced authorization pipeline + factory** | ✅ | **new**; *not yet wired into `background.ts`* |
| Policy + approvals (5 quorum types) | ✅ | `policy`, `approval` |
| Tamper-evident audit chain + export | ✅ | SHA-256 hash-chain |
| WebAuthn / passkey 2FA | ✅ | clone-detection |
| On-chain contracts (AgentBudget, Notary) | 🟡 | written + forge-tested, **undeployed** |
| Native mobile (iOS/Android) | 🟦 | Expo WebView shell; native scaffolded |

---

## 6. Engineering quality

- **1,901 extension unit tests** passing (118 files); **+~110 new tests** this
  cycle; `tsc --noEmit` clean; **performance/bundle budgets pass** (size-limit
  green — `popup.js` under gzip limit, images optimized).
- **No shipped stubs** discipline (e.g. Trezor *throws* rather than fakes; MPC
  adapter *rejects* a mismatched-recovery signature).
- **Deterministic production builds** for supply-chain verification.
- **Documentation depth**: threat model (STRIDE), audit scope + RFP, SOC-2 scope,
  this report, and the production roadmap.

---

## 7. How to verify (for the reviewer)

```bash
cd apps/extension
npx vitest run        # 1,901 tests
npx tsc --noEmit      # type-check
npm run size          # performance budgets
# preview the wallet UI:
npm run build:preview && (cd dist && python3 -m http.server 3301)  # http://localhost:3301/popup.html
```

---

## 8. Production-readiness gates (the hard blockers)

These are unchanged in nature from the prior advisory and remain the gate to
production. **All are human-gated, not code:**

| Gate | Status | Detail |
|---|---|---|
| **External crypto + contract audit** | ❌ | RFP ready to send (ToB/Spearbit/Zellic, $150–250k). The new hand-rolled crypto (EIP-7702 auth hashing, MPC recovery cross-check, Shamir) has **never had external review** — this is now a *larger* surface than at the last advisory. |
| **Smart-contract deployment** | ❌ | `deployments.json` empty; on-chain spend caps + anchoring not live. |
| **SOC-2 Type 1** | ❌ | scope/control-mapping exist; engagement not started. |
| **Dependabot: 1 critical + 17 high** | ⚠️ | **conclusively un-fixable locally** — npm refuses to apply root `overrides` in this `file:`-workspace monorepo across all four install strategies (likely an npm bug). Needs a CI runner or a `workspace:`-protocol migration. The Dependabot PRs (#179/#180) currently fail CI. |
| **Licensing** | ✅ | resolved → BSL 1.1. |
| **Native mobile** | 🟦 | staffing decision (3-eng × ~10 wk). |

---

## 9. Issues to review / fix in the current build (consultant focus)

Written candidly — these are the things we most want a second set of eyes on:

1. **The new compliance pipeline is built but NOT yet enforced in the running
   product.** All eleven modules are SDK primitives. The signing worker
   (`apps/extension/src/background.ts`, ~4,100 lines) still enforces only the
   *policy* engine in its `Validate → Policy → Simulate → Approve → Sign`
   pipeline. Wiring `authorizeOrThrow()` in at the `handlePrepareTx` policy step
   is now a ~2-line change (via the factory) but is a **trust-boundary edit** we
   deliberately deferred for human review. **Q: is our caution right, or should
   this be wired immediately?**

2. **Default providers are permissive.** `NoopScreeningProvider` /
   `NoopTravelRuleTransport` return benign/allow. Until a real vendor adapter is
   wired, the gates *pass*. This is honest (and warns at runtime), but means the
   controls are "ready" not "active." **Q: acceptable for pilot, or must a real
   vendor be wired before any claim of enforcement?**

3. **Un-audited hand-rolled cryptography expanded.** EIP-7702 authorization
   hashing, the MPC recovery cross-check, and the existing Shamir/EIP-712 code
   are correctness-critical and unaudited. **Q: should we freeze the crypto
   surface and audit now, before adding more?**

4. **Behavioral-anomaly thresholds are heuristic.** The flag weights and
   score→decision cutoffs are reasonable defaults but untuned against real
   transaction data — risk of false positives/negatives. **Q: tune with
   synthetic data now, or wait for pilot data?**

5. **Three PRs are open and unmerged** (#184–#186), stacked conceptually but on
   independent branches off `main`. They will have minor merge-order
   considerations in the `compliance/index.ts` and `core/index.ts` barrels.
   **Q: merge order / should they be consolidated?**

6. **Contracts undeployed + reference-only** — the agent-native moat's on-chain
   guarantees are not live on any chain.

7. **No integration/e2e test of the full enforced chain in the live worker** —
   the modules are unit-tested in isolation and composed in tests, but there is
   no end-to-end test proving a real `eth_sendTransaction` is blocked by, say, a
   sanctioned destination. (Blocked on item 1.)

---

## 10. Our recommended focus — for the consultant to confirm or redirect

1. **Freeze the engineering surface; start the external audit** (RFP is ready).
   The crypto + custody surface is now large and unaudited — this is the long
   pole and the credibility gate.
2. **Wire the authorization pipeline into `background.ts`** as a small, separately
   reviewed commit, with an end-to-end test (close items 1 + 7).
3. **Resolve Dependabot in CI** (clean-room override regen).
4. **Pick the first real vendors** (screening + MPC) and implement the one
   adapter each — turning "ready" into "active."
5. **Decide native-mobile staffing** and contract-deployment sequencing.

**The core question for you:** we believe the right move is to *harden, audit,
and wire in* what exists rather than keep widening the feature surface. Do you
agree, or is there a capability gap you'd prioritize first?

---

*Figures verified against the repository on 2026-06-30: 1,901 tests, `tsc` clean,
size budgets green. Commit hashes and file paths are exact and reviewable on the
three open PRs.*
