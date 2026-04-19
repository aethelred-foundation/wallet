# Security Policy

> **Last updated:** 2026-04-19
> **Owner:** Ramesh Tamilselvan — `security@aethelred.org`
> **Applies to:** `aethelred-foundation/wallet` (Chrome extension, Expo mobile
> shell, Phoenix/Elixir control-plane)

The Aethelred Wallet holds customer signing material, transaction data, and
regulated compliance records for enterprise and sovereign clients. We take
every credible security report seriously and respond on the SLAs below.

## 1. Scope

### 1.1 In scope

The following components are covered by this policy. Security research
targeting any of them is welcome:

- **Chrome MV3 extension** (`apps/extension/`) — popup, options UI, service
  worker (`background.ts`), content script (`content.ts`), inpage provider
  (`inpage.ts`), and the `content-bridge` message channel between them.
- **Mobile WebView shell** (`apps/mobile/`) — Expo React Native wrapper that
  embeds the extension popup.
- **Wallet control-plane** (`elixir/`) — Phoenix service that orchestrates
  approvals, aggregates audit events, and dispatches push notifications.
- **Wallet workspace packages** (`packages/`) — `core`, `audit`, `policy`,
  `approval`, `compliance`, `identity`, `connect`, `chain`, `simulation`,
  `deployment`. Logic flaws in these packages are in scope, including:
  - Signing / EIP-712 / RLP encoding (`packages/core/signer.ts`,
    `transaction.ts`, `rlp.ts`, `eip712.ts`).
  - Tamper-evident audit-chain handling
    (`packages/audit/event-store.ts`, `event-capture.ts`).
  - Policy engine bypass or false-approve
    (`packages/policy/engine.ts`, `velocity-tracker.ts`).
  - Quorum / approval workflow skip or replay (`packages/approval/`).
  - Passkey / WebAuthn flows, including §6.1.1 clone-detection bypass.
- **Build pipeline** (`.github/workflows/ci.yml`, `dependabot.yml`) —
  workflow-injection, artifact-poisoning, or supply-chain issues.

### 1.2 Out of scope

These are excluded from this policy. Some are covered under separate
programs; others are categorically not our responsibility:

- **The Aethelred L1 blockchain and its validators.** Governed by the L1
  security policy; report those issues via the L1 repo.
- **Third-party dApps** registered in the wallet's dApp catalog
  (TerraQura, Cruzible, NoblePay, and any other integrated dApps). Each
  dApp operator is responsible for its own security posture. Issues
  that let a malicious dApp escape the wallet's isolation boundary
  *are* in scope — report those here.
- **User devices and endpoints.** Malware on the user's machine, shoulder
  surfing, compromised browser installs, or OS-level key logging are not
  issues we can mitigate from inside the wallet. If you find a wallet
  behavior that amplifies device compromise (e.g. key material written to
  disk outside IndexedDB + WebCrypto), that *is* in scope.
- **Third-party RPC providers** (llamarpc, publicnode, ankr, etc.). The
  wallet multi-provider-rotates requests; RPC-level censorship is a known
  risk. Request-manipulation vulnerabilities in our RPC client
  (`packages/chain/`) are in scope.
- **Social engineering / phishing** against Aethelred employees,
  contractors, or contributors. Not a valid research target.
- **Physical attacks** (office break-ins, cold-boot on employee laptops,
  etc.). Not a valid research target.
- **Denial-of-service through raw volume** at public endpoints. Rate-limit
  bypasses or amplification bugs are in scope.
- **Theoretical attacks without a working proof-of-concept.** Include a
  PoC or clear reproduction path.

## 2. Reporting a vulnerability

### 2.1 Channel

Email **`security@aethelred.org`** with:

1. A clear title (e.g. "Policy engine bypass via velocity-tracker reset").
2. Affected component(s) — path in the repo is ideal.
3. Reproduction steps, ideally against a local build (see
   `AETHELRED_WALLET_BUILD_PLAN_2026-04-10.md` for environment setup).
4. Your assessment of impact.
5. Your contact handle for follow-up.

PGP-encrypted reports are accepted. Key fingerprint and rotation schedule
are published at `https://aethelred.org/.well-known/security.txt`.

GitHub Security Advisories (private) are also accepted on
`aethelred-foundation/wallet` for researchers who prefer that workflow.

### 2.2 Please do NOT

- File a public GitHub issue for anything that could be exploited.
- Tweet, blog, or post to chat communities before the coordinated
  disclosure window elapses (see §3).
- Attempt to pivot from the wallet into Aethelred corporate
  infrastructure.
- Test against live customer wallets or control-plane tenants you do
  not own.
- Exfiltrate data beyond the minimum needed to prove the vulnerability.
  Screenshot one record, not the table.
- Auto-scan production endpoints at rates likely to degrade service.
- Solicit monetary payment before a fix is available. We pay bounties
  (see §5) but not ransoms.

## 3. Response SLAs

| Stage | Target | What happens |
|-------|--------|--------------|
| **Acknowledge** | 48 hours | You receive a human reply confirming receipt, assigning an internal tracking ID, and indicating a triage owner. |
| **Triage** | 5 business days | Severity classified (see IR runbook §1), reproducibility confirmed, owning engineer assigned. |
| **Resolve** | Per severity | P0: 72 hours. P1: 14 days. P2: 30 days. P3: next release. See `docs/runbooks/INCIDENT_RESPONSE.md`. |
| **Disclose** | 90 days or fix-shipped, whichever is sooner | Coordinated advisory; researcher credited unless they opt out. |

If we miss an SLA, we will tell you why in the same thread. We do not go
silent.

## 4. Safe harbor

We consider security research conducted in good faith and within this
policy to be:

- Authorized under the Computer Fraud and Abuse Act (and similar laws in
  other jurisdictions).
- Authorized under Section 1201 of the DMCA for the narrow purpose of
  good-faith security testing of our software.
- Exempt from our acceptable-use clauses that otherwise prohibit reverse
  engineering, tampering with traffic, or automated scanning.
- Not subject to civil action by Aethelred Foundation for the research
  itself.

"Good faith" means: you follow this policy, you stop when asked, you do
not intentionally harm users, and you give us a reasonable chance to fix
before public disclosure.

If legal action is initiated by a third party against you for research
performed within this policy, Aethelred Foundation will make this
authorization known.

## 5. Rewards

We run a discretionary bounty program. Ranges are indicative, not a
contract, and scale with severity and quality of the report:

| Severity | Example | Range (USD) |
|----------|---------|-------------|
| Critical (P0) | Private-key leak, audit-chain forge, policy bypass | $10,000 – $50,000 |
| High (P1) | Quorum bypass, passkey clone undetected, RCE in extension | $2,500 – $10,000 |
| Medium (P2) | Signing UI spoof, policy false-approve under edge case | $500 – $2,500 |
| Low (P3) | Information leak with minimal impact, hardening opportunities | $100 – $500 |

First valid reporter for a given issue is rewarded. Duplicates receive a
public credit but no bounty.

## 6. Hall of fame

Researchers credited with valid reports are listed at
`https://aethelred.org/security/hall-of-fame` unless they opt out. We
list name, handle, or pseudonym per researcher preference.

## 7. Policy revisions

This policy is versioned in the repo. Material changes are announced in
repo release notes and at `https://aethelred.org/security/policy`.
Researchers are bound by the version of the policy in effect at the time
they submitted their report.
