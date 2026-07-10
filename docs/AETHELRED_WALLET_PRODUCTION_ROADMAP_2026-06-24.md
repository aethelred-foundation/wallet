# Aethelred Wallet — Production Roadmap & Gap Tracker

**Created:** 2026-06-24 · **Source:** external advisory review (consultant) + repo diligence
**Companion to:** `AETHELRED_WALLET_STATUS_REPORT_2026-06-24.md`

> Operationalizes the consultant's advisory into a tracked program. Each item has a
> **severity**, an **owner** (🛠️ engineering / 🧭 founder decision / 🤝 external vendor),
> an **effort** estimate, **status**, and the **next concrete action**. The consultant's
> assessment — "feature-complete at the design layer, assurance-incomplete at the trust
> layer" — is the organizing thesis.

**Status legend:** ⬜ not started · 🟡 in progress · 🔵 blocked-on-decision · ✅ done

> **Progress update (2026-06-24).** The four no-external-dependency engineering
> gaps are **shipped** — real, typed, tested code (no stubs), all on branch
> `feat/wallet-gaps-7702-vara-recovery-trezor` (+46 tests, full suite green at
> 1,872):
> - **Gap 8 — EIP-7702** authorization primitive (`f26885e`)
> - **Gap 14 — VARA controls** (`1ff26be`)
> - **Gap 11 — guardian social recovery** (`34013c4`)
> - **Gap 7 — Trezor backend** (`b6670b4`)
>
> Remaining items need founder decisions (license, audit RFP, MPC build-vs-buy,
> screening vendor) or external vendors — see §F. The Dependabot remediation
> (§A #2) is diagnosed with a recipe in Appendix A but blocked locally on an
> npm-overrides quirk; land it via CI or the existing Dependabot PRs.

---

## A. Hard gates + critical ship-blockers

| # | Item | Sev | Owner | Effort | Status | Next action |
|---|------|-----|-------|--------|--------|-------------|
| 1 | **External crypto + contract audit** (Trail of Bits / Spearbit / Zellic) | Critical | 🧭→🤝 | 6–8 wks · $150–250k | ⬜ | Issue RFPs **this week** (Q3 slots fill 6–8 wks out). Audit-scope + threat-model docs already written — attach them. |
| 2 | **Dependabot: 1 critical + 17 high** | Critical | 🛠️ | ~1 wk | 🟡 | Diagnosed (see Appendix A). Merge Dependabot PRs #179/#180 in CI **or** apply the override set. |
| 3 | **Smart-contract deployment + testnet soak** | Critical | 🛠️ | 6-wk soak | ⬜ | Deploy AgentBudget + Notary to **Sepolia + Base Sepolia**, *paused* behind a guardian multisig; 6-wk soak → Base mainnet. |
| 4 | **License resolution** | Critical | 🧭 | 1 day | 🔵 | Consultant recommends **BSL 1.1** (Uniswap/Aave model). Decide → I add `LICENSE` + headers. |
| 5 | **SOC-2 Type 1** | High | 🧭→🤝 | 8–12 wks | ⬜ | Engage Vanta/Drata + auditor **now** so the report lands concurrent with the security audit. Control mapping already exists. |

---

## B. High-priority feature gaps (pre-launch, not post)

| # | Item | Sev | Owner | Effort | Status | Next action |
|---|------|-----|-------|--------|--------|-------------|
| 6 | **MPC-TSS custody** (institutional standard) | High | 🧭→🛠️ | 8–12 wks | 🔵 | Decide build-vs-partner: Silence Labs SDK / ZenGo lib vs. in-house. Current Shamir 2-of-2 loses to every institutional security committee without this. |
| 7 | **Trezor hardware wallet** | High | 🛠️ | 2–3 wks | ⬜ | Implement via Trezor Connect SDK (today: throws "not implemented"). ~30% enterprise HW share. |
| 8 | **EIP-7702 (EOA delegation)** | High | 🛠️ | 3–4 wks | ⬜ | Add alongside ERC-4337 in `smart-account`; lets enterprises use existing EOAs. Add **before audit scope closes**. |
| 9 | **Live on-chain screening** (Chainalysis KYT / TRM / Elliptic) | High | 🛠️ | 2–3 wks | ⬜ | Wire pre-signing circuit-breaker that blocks if destination scores above risk threshold (FATF/MiCA require pre-execution screening). |
| 10 | **Travel-rule interop (TRISA / OpenVASP)** | High | 🛠️ | 4–6 wks | ⬜ | Required for EU/MiCA TFR (CASP-to-CASP, no min threshold). Regulatory Passport must emit/receive TRISA messages. |
| 11 | **Key recovery / social recovery** | High | 🛠️ | 3–4 wks | ⬜ | Guardian model (ERC-4337) or threshold-encrypted backup. Enterprise's catastrophic risk is key loss at offboarding, not hacks. |

---

## C. Mobile, distribution, compliance

| # | Item | Sev | Owner | Effort | Status | Next action |
|---|------|-----|-------|--------|--------|-------------|
| 12 | **Native mobile (iOS-first for MENA/GCC)** | High | 🧭→🛠️ | ~10 wks, 3 eng | 🔵 | VARA expects fully functional iOS/Android. WebView shell is a demo. Decide staffing; ship before CWS submission. |
| 13 | **Chrome Web Store submission readiness** | Med | 🛠️+🧭 | 4–8 wk review | ⬜ | Need: live privacy-policy URL, host-permission disclosure, support email + ToS, **remove unshipped-feature claims** (Trezor, native mobile) from listing. |
| 14 | **VARA (Abu Dhabi) specific controls** | High | 🧭→🛠️ | ~4 wks | ⬜ | VARA is the **primary** jurisdiction (not MiCA): (a) registered wallet addresses, (b) AED 3,500 travel-rule threshold, (c) proof-of-reserves for custodial, (d) 24-hr incident reporting. None explicit in compliance modules today. |

---

## D. "Best-wallet" parity scorecard (consultant)

| Capability | Incumbents | Effort | Status |
|---|---|---|---|
| MPC-TSS custody | Fireblocks, Copper, Privy | 8–12 wks | ⬜ |
| EIP-7702 delegation | MetaMask Institutional | 3–4 wks | ⬜ |
| TRISA travel-rule interop | Notabene, Sygna | 4–6 wks | ⬜ |
| Social/guardian recovery | Safe, Argent | 3–4 wks | ⬜ |
| Live on-chain screening | Rabby, MM Institutional | 2–3 wks | ⬜ |
| Trezor support | Every major wallet | 2–3 wks | ⬜ |
| VARA-specific controls | — | 4 wks | ⬜ |

---

## E. Sequenced plan (consultant's cadence)

**This month (Jun–Jul 2026)**
- [ ] Merge all Dependabot PRs — clear the critical CVE (gap 2)
- [ ] Issue audit RFPs to Trail of Bits / Spearbit / Zellic (gap 1)
- [ ] Deploy contracts to Sepolia + Base Sepolia with guardian pause (gap 3)
- [ ] Resolve license → BSL 1.1 (gap 4)
- [ ] Begin SOC-2 Type 1 engagement (gap 5)

**Q3 2026 (pre-audit completion)** — gaps 9, 10, 8, 11, 12 (live screening, TRISA, EIP-7702, social recovery, native mobile MVP)

**Q4 2026 (post-audit)** — gaps 6, 3, 13, 14 (MPC-TSS, mainnet deploy, CWS submission, VARA registration + SOC-2 attestation)

---

## F. Decisions needed from you (the founder)

These gate engineering and I should **not** assume them:

1. **License → BSL 1.1?** (consultant's recommendation) — confirm and I'll add it.
2. **Audit firm shortlist + budget** ($150–250k) — who do I draft the RFP to first?
3. **MPC-TSS: build vs. partner** (Silence Labs / ZenGo vs. in-house)?
4. **Native mobile staffing** — fund a 3-engineer, 10-week sprint now, or defer?
5. **Screening vendor** — Chainalysis KYT, TRM Labs, or Elliptic?
6. **GTM lead** — compliance story (regulated enterprises) vs. agent-native story (agentic-commerce builders)?
7. **Push/merge authority** — may I merge the Dependabot PRs to `main` and open the engineering PRs (gaps 7/8/9/11)?

---

## G. What I can start immediately on your go-ahead

Pure engineering, no external dependency, I can execute and keep tests green:

- **Gap 2** — dependency remediation (recipe in Appendix A)
- **Gap 7** — Trezor Connect integration
- **Gap 8** — EIP-7702 delegation in `smart-account`
- **Gap 9** — live-screening circuit-breaker interface (+ a Chainalysis/TRM adapter once you pick a vendor)
- **Gap 11** — guardian/social-recovery module
- **Gap 14** — VARA control stubs in the compliance layer (registered-address registry, AED 3,500 threshold, proof-of-reserves attestation, 24-hr incident hook)

Tell me which to take first; I'll build it the way the existing code is built (typed, tested, no stubs).

---

## Appendix A — Dependency remediation recipe (gap 2)

**Findings (verified 2026-06-24):**
- 1 **critical**: `shell-quote` (newline escaping) → patched `1.8.4`.
- 17 **high**: `axios` (6), `ws` (3), `tar-fs` (3), `form-data`, `fast-uri`, `tmp`, `basic-ftp`, `vite`.
- **Source:** most trace to `expo → react-native → metro` (the `apps/mobile` preview shell) and the Vite/build toolchain — i.e., **build/dev-time transitives, not shipped in the extension bundle**. Runtime risk to the wallet is low; the *procurement-scanner* risk is high, so they must still be cleared.

**Recommended fix (two compatible paths):**
1. **Merge the existing Dependabot PRs** (#179 runtime-patches, #180 dev-dependencies) in CI — they already resolve a chunk of these with green CI.
2. **Pin patched transitives via `overrides`** in the root `package.json`, regenerate the lockfile in CI, and let the build + 1,826-test suite gate it:
   ```json
   "overrides": {
     "shell-quote": "^1.8.4", "axios": "^1.16.0", "basic-ftp": "^5.3.1",
     "fast-uri": "^3.1.2", "form-data": "^4.0.6", "tar-fs": "^3.1.1",
     "tmp": "^0.2.6", "vite": "^8.0.16", "ws": "^8.21.0"
   }
   ```
   *Note:* applying these locally was blocked by an npm/workspace quirk (overrides weren't ingested into the lockfile after multiple installs) — needs a clean CI environment or a `npm@latest` re-resolve to land. `ws` spans majors (7→8) so verify the build after.

**Done-when:** `npm audit` reports 0 critical / 0 high, the deterministic extension build is unchanged, and the test suite stays green.
