# Aethelred Wallet — STRIDE Threat Model

> **Last updated:** 2026-04-19
> **Owner:** Ramesh Tamilselvan — `security@aethelred.org`
> **Classification:** Internal / Auditor-shared
> **Methodology:** STRIDE (Spoofing, Tampering, Repudiation, Information
> disclosure, Denial of service, Elevation of privilege)
> **Applies to:** `aethelred-foundation/wallet` at the commit matched by this
> doc's `Last updated` date.

This document is the formal threat model required by
`docs/compliance/SOC2_SCOPE.md` §5 critical-gap item #1. It enumerates
assets, trust boundaries, and per-STRIDE-category threats with their
mitigations and residual risks. It is scoped to the wallet itself; the
Aethelred L1 chain and integrated third-party dApps are out of scope.

## 1. Asset inventory

Assets are ranked by blast radius. Losing a higher-ranked asset implies
all lower-ranked assets are compromised for that user.

| # | Asset | Where it lives | Sensitivity | Notes |
|---|-------|----------------|-------------|-------|
| 1 | **Customer private keys** | IndexedDB, AES-GCM encrypted via WebCrypto, key-wrapping in `packages/core/master-key.ts` + `secure-storage.ts` | Confidentiality-critical | Never leaves the device. No cloud backup. Recovery via seed phrase re-import only. |
| 2 | **Master-key encryption passphrase** | In-memory only, derived via Argon2id, zeroed on popup close | Confidentiality-critical | Never persisted. Passkey unlock re-derives from WebAuthn user verification. |
| 3 | **Passkey WebAuthn credentials** | Platform authenticator (TPM, Secure Enclave, Windows Hello) | Confidentiality-critical | Private half never exits the authenticator; public half stored in extension. |
| 4 | **Audit-chain events** | IndexedDB, SHA-256 hash-linked in `packages/audit/event-store.ts` | Integrity-critical | Tamper-evident by design; export via `evidence-builder.ts` for auditors. |
| 5 | **Workspace policy definitions** | IndexedDB, loaded by `packages/policy/engine.ts` | Integrity-critical | Policy changes themselves are audited events. |
| 6 | **Approval workflow state** | IndexedDB + control-plane mirror, `packages/approval/` | Integrity-critical | Quorum state must not be forgeable. |
| 7 | **Session / auth tokens** | Session storage (popup lifetime) + short-lived JWT to control-plane | Confidentiality-high | Rotated on every popup open. |
| 8 | **Compliance records** (KYC, travel-rule, screening results) | IndexedDB, classified by `packages/compliance/data-classification.ts` | Confidentiality-high | PII subject to GDPR / regional residency requirements. |
| 9 | **RPC request traffic** | In flight over TLS to public providers | Confidentiality-medium | Metadata (addresses, balances queried) leaks to providers; multi-provider rotation mitigates. |
| 10 | **Source code + build artifacts** | GitHub private repo + Chrome Web Store signed bundle | Integrity-critical | Supply-chain compromise would affect all users. |

## 2. Trust boundaries

The wallet operates across six distinct trust zones. Each zone-crossing
is a potential attack surface.

```
  ┌──────────────────────────────────────────────────────────────────┐
  │  Zone 0: Public Internet / dApp webpage DOM                      │
  │    (untrusted; adversary may fully control)                      │
  └────────────────────────────┬─────────────────────────────────────┘
                               │ window.postMessage
  ┌────────────────────────────▼─────────────────────────────────────┐
  │  Zone 1: Inpage provider (apps/extension/src/inpage.ts)          │
  │    (runs in page main world; same origin as the dApp)            │
  └────────────────────────────┬─────────────────────────────────────┘
                               │ window.postMessage + origin check
  ┌────────────────────────────▼─────────────────────────────────────┐
  │  Zone 2: Content script (content.ts + content-bridge.ts)         │
  │    (runs in isolated world; cannot touch page JS variables)      │
  └────────────────────────────┬─────────────────────────────────────┘
                               │ chrome.runtime.sendMessage
  ┌────────────────────────────▼─────────────────────────────────────┐
  │  Zone 3: Background service worker (background.ts)               │
  │    (privileged; holds long-lived state and orchestrates signing) │
  └──────────┬──────────────────────────────┬────────────────────────┘
             │ chrome.runtime (popup open)  │ HTTPS + JWT
             ▼                              ▼
  ┌──────────────────────────┐   ┌─────────────────────────────────┐
  │  Zone 4: Popup UI        │   │  Zone 5: Elixir control-plane   │
  │   (React 18, jsdom tests)│   │   (approval mirroring, pushes)  │
  └──────────────────────────┘   └─────────────────────────────────┘
                                              │
                                              ▼
                                  ┌─────────────────────────────────┐
                                  │  Zone 6: Aethelred L1           │
                                  │   (external — out of scope)     │
                                  └─────────────────────────────────┘
```

Key properties auditors should verify:
- Zones 0↔1 communicate only via `postMessage` with origin verification.
- Zones 1↔2 rely on Chrome's isolated-world guarantee — code in zone 2
  cannot be reached by `window.*` manipulation in zone 0.
- Zones 2↔3 use `chrome.runtime` with a message-schema validator in
  `apps/extension/src/content-bridge.ts`.
- Zones 3↔5 use TLS 1.3 with JWTs pinned to the current workspace.
- No zone below 3 has access to decrypted key material except during an
  active signing request, and only the zone-3 signer sees plaintext
  (see `packages/core/signer.ts`).

## 3. STRIDE threat catalog

Likelihood: Low / Medium / High.
Impact: Low / Medium / High / Critical.
Residual risk is the remaining risk after listed mitigations.

### 3.1 Spoofing — impersonating a user, component, or origin

| # | Threat | Component | Likelihood | Impact | Mitigation | Residual |
|---|--------|-----------|------------|--------|------------|----------|
| S1 | Malicious webpage spoofs a legitimate dApp origin to request signing. | Zone 0 → Zone 1 (`inpage.ts`) | High | High | Every `eth_*` request displays full origin + contract target in the popup. Destination-allowlist policy rules in `packages/policy/engine.ts`. User education in popup. | User may still click through on a visually similar origin (e.g. Unicode homoglyphs). Popup surfaces punycode form. |
| S2 | Attacker enrols a second passkey on a compromised session to persist access. | `apps/extension/src/popup` WebAuthn flow | Medium | Critical | Enrolment requires user-verification (UV bit) plus second-factor attestation, and triggers a workspace-wide `passkey_enrolled` audit event with 24h quorum confirmation. | Collusion between attacker + owner bypasses; detected post-hoc via audit export. |
| S3 | Content script impersonates a background service-worker reply to the popup. | Zone 2 ↔ Zone 3 message channel | Low | High | `chrome.runtime.sendMessage` sender identity is enforced by Chrome; background validates sender URL matches extension origin. | Chrome zero-day in isolated-world guarantee. No in-wallet mitigation; relies on Google patch cadence. |
| S4 | Control-plane JWT replayed after workspace member removed. | Zone 3 → Zone 5 | Medium | High | JWTs are short-lived (5 min) and bound to the workspace identity cert; member removal revokes the cert in `packages/identity/`. | 5-minute replay window remains; accepted risk pending session-revocation push. |

### 3.2 Tampering — unauthorized modification of data or code

| # | Threat | Component | Likelihood | Impact | Mitigation | Residual |
|---|--------|-----------|------------|--------|------------|----------|
| T1 | Attacker rewrites an audit event in IndexedDB to hide a signing event. | `packages/audit/event-store.ts` | Medium | Critical | Every event is SHA-256 hash-linked to its predecessor; `evidence-builder.ts` re-verifies the chain before export, and gaps raise a `chain_break` alert. | Attacker who rewrites ALL subsequent events can produce a valid alternate chain; mitigated at Type-2 by notarizing the head hash to Aethelred L1. Today, still theoretical. |
| T2 | Supply-chain compromise of an npm dependency injects malicious code into the extension build. | `package-lock.json`, Dependabot PRs, `@noble/*` deps | Medium | Critical | Dependencies pinned in `package-lock.json`; `npm ci --ignore-scripts` in CI (`.github/workflows/ci.yml`); weekly Dependabot updates with grouped review; zero-dep `@noble/hashes` + `@noble/secp256k1` for crypto path. | Transitive dep zero-days between weekly reviews. Partially mitigated by dev/prod grouping rules in `.github/dependabot.yml`. |
| T3 | Policy definition tampered with in IndexedDB to silently raise spend limits. | `packages/policy/engine.ts` | Medium | Critical | Policy changes flow through the approval engine (quorum required for high-tier workspaces); changes emit audit events with before/after diff; velocity tracker enforces at evaluation time. | Local attacker with DB write access can bypass approval on single-signer personal tier; mitigated by tier: enterprise/sovereign tiers force quorum. |
| T4 | Malicious content-script message alters an outbound transaction's `to` address between popup display and signer. | Zone 2 → Zone 3 handoff, `packages/core/signer.ts` | Low | Critical | Signer re-reads the canonical transaction from the approval record in Zone 3 before signing; content-bridge payloads are schema-validated. EIP-712 domain pinning in `packages/core/eip712.ts` catches typed-data swaps. | Clicking-through users who do not re-read the popup confirmation. |

### 3.3 Repudiation — denying that an action occurred

| # | Threat | Component | Likelihood | Impact | Mitigation | Residual |
|---|--------|-----------|------------|--------|------------|----------|
| R1 | A workspace operator denies approving a transaction after the fact. | `packages/approval/` + audit chain | Medium | High | Each approval step records the acting subject (`packages/identity/`), passkey credential ID, and signed quorum record. Audit export via `packages/audit/export.ts` produces tamper-evident evidence for disputes. | Operator shares credentials; mitigated by passkey non-extractability. |
| R2 | A reviewer denies viewing a compliance filing that should have triggered escalation. | `packages/compliance/filing-tracker.ts` | Low | Medium | `viewed_at` timestamp with passkey-attested session ID on every filing open; case-management events in `case-management.ts` are audit-chain entries. | Honest reviewers may still fail to click through deep content; UX mitigation only. |
| R3 | Attacker re-plays an old approval signature claiming it's fresh. | `packages/approval/` quorum evaluator | Low | High | Approval records include workspace nonce + expiry; signer enforces monotonic nonce. | None material. |

### 3.4 Information disclosure — exposing confidential data

| # | Threat | Component | Likelihood | Impact | Mitigation | Residual |
|---|--------|-----------|------------|--------|------------|----------|
| I1 | Private-key material leaks to the content script via a logging regression. | `packages/core/key-manager.ts`, `signer.ts` | Low | Critical | Keys decrypted only inside the service-worker signer; TypeScript types force opaque `SecretKeyHandle` through the API; CI typecheck blocks `any`-typed key paths; test suite asserts serialization output never contains 32-byte hex. | New signer paths added without tests could regress; mitigated by code review + 112 test suite gate. |
| I2 | Memory dump of the service worker exposes decrypted keys post-signing. | JS engine memory | Medium | High | Signer zeroizes the `Uint8Array` buffer on completion (`packages/core/signer.ts`); WebCrypto operations use non-extractable `CryptoKey` handles where possible. | JS GC timing is not deterministic; true zeroization not guaranteed for all intermediate buffers. |
| I3 | Transaction metadata (addresses, balances) leaks to RPC providers. | `packages/chain/` | High | Low | Multi-provider rotation across llamarpc / publicnode / ankr / custom; no auth headers tied to user identity. | Fundamental to public RPC model; users seeking privacy must self-host or tunnel. |
| I4 | Popup-rendered secrets leak via screen-capture malware or screenshot-indexing OS features. | `apps/extension/src/popup` | Medium | High | Seed-phrase display uses per-letter reveal with `aria-live=off`; copy-to-clipboard clears after 30 s; popup blurs on lose-focus during sensitive flows. | OS-level capture (iOS auto-screenshot, macOS QuickTime) cannot be prevented from within the browser. |

### 3.5 Denial of service — degradation or outage of wallet function

| # | Threat | Component | Likelihood | Impact | Mitigation | Residual |
|---|--------|-----------|------------|--------|------------|----------|
| D1 | Flood of approval requests from a malicious dApp exhausts the policy engine. | `packages/policy/engine.ts`, `velocity-tracker.ts` | High | Medium | Per-origin rate limit in the inpage→content bridge; velocity tracker tokens cap evaluation frequency; popup de-duplicates identical requests within 5 s. | Dedicated attacker could burn CPU on the service worker; Chrome eventually suspends. |
| D2 | Control-plane outage blocks enterprise-tier approvals that require the mirror. | `elixir/` service + Zone 3↔5 edge | Medium | High | Client-side quorum evaluation is authoritative; control-plane is a mirror for cross-device push, not a required path. Extension functions read-only during outage. | During outage, cross-device approval prompts are delayed; see `docs/compliance/BCP.md`. |
| D3 | All configured RPC providers are simultaneously rate-limiting or down. | `packages/chain/` | Low | Medium | Minimum three providers configured; user can add custom RPC in settings; cached last-known state shown with staleness banner. | No sign if chain itself halts; user-visible. |
| D4 | Malicious bundle pushed via Chrome Web Store update breaks the extension on launch, locking users out. | Chrome Web Store release path | Low | High | Staged rollout (1% → 10% → 100%) via Web Store release channels; `apps/extension/dist/` bundle size + smoke-test tripwire in CI; rollback is a single-click republish of the prior version. | Rollout telemetry is external to us; discovery relies on user reports and Web Store reviews. |

### 3.6 Elevation of privilege — gaining capabilities beyond one's role

| # | Threat | Component | Likelihood | Impact | Mitigation | Residual |
|---|--------|-----------|------------|--------|------------|----------|
| E1 | An `operator` role promotes itself to `owner` or `treasury-admin`. | `packages/identity/` role model | Low | Critical | Role changes require owner approval (quorum), emit an audit event with the role delta, and are rejected if the requesting subject is the target subject. | Collusion between two owners remains possible; accepted by design for the quorum model. |
| E2 | Machine-identity delegation scope is broadened beyond the original grant. | `packages/compliance/machine-identity.ts` | Low | High | Delegation records are signed by the granting owner and include explicit capability list; engine refuses any request outside that list; audit event on every delegated action. | Granting owner issues over-broad delegation by mistake; UX mitigates with "recommended capabilities" presets. |
| E3 | Content-script exploits a popup DOM injection to invoke privileged `chrome.runtime` calls. | Zone 2 → Zone 4 | Low | Critical | React 18 strict mode + no raw-HTML React sinks; CSP in `manifest.json` disallows inline script and `eval`; lint rules block unsafe HTML assignment. | Novel React gadget chains; mitigated by pen-test (scheduled, see SOC2_SCOPE.md §5 item 9). |
| E4 | Hardware-wallet transport (Ledger WebHID) is hijacked by a malicious extension running in the same browser profile. | Ledger path in `packages/core/custody/`, `@ledgerhq/hw-transport-webhid` | Medium | Critical | Chrome MV3 isolates extension origins; WebHID device permission is user-granted per origin; wallet displays device-fingerprint comparison on first connect. | Rogue extension granted HID permission by the user; fundamental Chrome limitation. |
| E5 | A `compliance-reviewer` role modifies an audit event to remove an alert before close-out. | `packages/audit/event-store.ts` + role model in `packages/identity/` | Low | Critical | Audit events are append-only at the storage layer; any "edit" is an additional event that preserves the original; reviewer role has no delete capability in the schema. | Reviewer with direct DB access bypasses the engine; mitigated by OS-level device security + enterprise-tier mandatory control-plane mirror. |
| E6 | Workspace imported with a malicious policy template that silently whitelists a destination address. | `packages/policy/templates.ts` + workspace import flow | Medium | Critical | Imported policies are previewed with a full diff against the default template before activation; import requires quorum approval for enterprise/sovereign tiers; policy evaluator logs every rule hit with a reason code so anomalies are traceable. | Personal-tier users importing blindly; mitigated by on-import warning banner + default-deny destination rules. |

## 4. Trust-boundary-specific analysis

### 4.1 Zone 0 → Zone 1 (dApp DOM → inpage provider)

Highest-frequency attack surface. All untrusted input crosses here.

- **Pre-dispatch validation:** `packages/connect/request-validator.ts`
  enforces EIP-1193 schema before the request is forwarded to zone 2.
- **Origin binding:** every request is tagged with `window.location.origin`
  at the inpage layer; zone 2 re-verifies against the sender frame.
- **Known residual:** a dApp may request signatures faster than the user
  can read them; throttling is the mitigation, not rejection.

### 4.2 Zone 2 → Zone 3 (content script → service worker)

- **Schema:** `content-bridge.ts` contains the full typed schema for
  cross-zone messages. Anything not matching is dropped and logged.
- **No key material traverses this boundary.** The signer returns only
  the final signed payload.

### 4.3 Zone 3 → Zone 5 (service worker → control-plane)

- **Transport:** TLS 1.3, HSTS, HPKP not used (Chrome removed support)
  but public-key pinning via workspace certificate in
  `packages/identity/validators.ts`.
- **Replay protection:** nonced JWTs with 5-minute expiry.
- **Idempotency:** approval-mirror writes are keyed by
  `(workspace_id, approval_id, step_id)`. Duplicate inbound calls are
  no-ops, not additive, which removes a class of replay attacks at
  the data layer even if JWT replay succeeded within its 5-minute
  window.
- **Schema enforcement on the Phoenix side:** `elixir/` services
  reject any request whose payload does not conform to the shared
  schema; this is belt-and-braces against a compromised Zone 3 that
  still holds a valid JWT.

### 4.4 Zone 4 popup — intra-zone threats

The popup is trusted by Zones 2 and 3 — but it renders untrusted
content (dApp names, transaction data, ABI-decoded calldata via
`packages/simulation/`). Intra-zone hardening:

- All untrusted strings flow through a typed React component boundary
  that refuses to accept raw HTML. Lint rules block the unsafe HTML
  assignment React patterns at review time.
- ABI decoding runs inside a worker; the decoded representation is a
  typed JS object, so even a malformed ABI cannot break out of its
  rendered scope.
- Copy-to-clipboard of sensitive fields (seed phrase, private key
  export) requires an explicit user gesture that the popup records as
  an audit event.

### 4.5 IndexedDB as a trust boundary

Though physically on the user's device, IndexedDB is a distinct trust
zone from the service worker: any process with the same origin can
read it. Controls in place:

- All persisted key material is AES-GCM encrypted at rest with a key
  wrapped by a WebCrypto non-extractable `CryptoKey` (see
  `packages/core/secure-storage.ts`).
- Audit events are hash-linked so tampering is detectable (§3.2 T1).
- Policy definitions and approval records include a workspace-scoped
  HMAC that the engine recomputes on load; any mismatch raises a
  `state_corruption` alert and puts the extension into read-only mode
  until the user re-authenticates.

## 5. Residual risk register

Consolidated from §3 for auditor convenience.

| ID | Residual | Owner | Accepted? | Closure path |
|----|----------|-------|-----------|--------------|
| RR-01 | Homoglyph origin spoofing (S1) | UX lead | Partial | Add confusables-detection library in Q3 2026. |
| RR-02 | Audit-chain tampering when attacker rewrites full chain (T1) | Core lead | No — closure planned | L1 notarization of chain-head hash, Phase 2 "Moat 1". Tracked in PHASE2 tickets. |
| RR-03 | Transitive dep zero-days between Dependabot cycles (T2) | Platform lead | Yes (business risk accepted) | Evaluate `socket.dev` or `npm audit signatures` automation. |
| RR-04 | OS-level screen capture of seed display (I4) | UX lead | Yes (out of wallet's control) | User education; hardware-wallet path for high-value keys. |
| RR-05 | Rogue co-resident extension hijacks Ledger HID (E4) | Core lead | Yes | Chrome platform limitation; mitigated by user education. |
| RR-06 | Control-plane cross-device push delay during outage (D2) | Platform lead | Yes | Multi-region deploy post-Phase 2. |
| RR-07 | 5-minute JWT replay window after member removal (S4) | Identity lead | Yes (short window) | Add server-push revocation when control-plane supports it. |
| RR-08 | Discovery of bad Web-Store rollout lags user reports (D4) | Platform lead | Yes | Status-page + in-extension feedback channel in Q3 2026. |
| RR-09 | Non-deterministic JS GC prevents hard memory zeroization (I2) | Core lead | Yes | Platform limitation; compensated by short-lived decryption scope. |
| RR-10 | Homoglyph / Unicode confusables not yet blocked in destination allowlist (S1) | Policy lead | Partial | Confusables detection library evaluation in Q3 2026. |

## 6. Review cadence

- **On every architectural RFC** that changes trust boundaries or adds a
  new external integration, this doc must be revisited in the RFC review
  checklist.
- **Quarterly** — owner re-walks the threat list and updates likelihoods
  based on incident history, new CVEs, and pen-test findings.
- **Annually** — external pen-test (Trail of Bits / Spearbit / Halborn per
  SOC2_SCOPE §5) produces a written report that is cross-referenced here.

## 7. Assumptions + out-of-scope attacks

Auditors often ask which attacks we have chosen not to analyse. Listed
here so the answer is not guesswork:

- **L1 validator compromise.** Out of scope — governed by the L1
  security programme. The wallet treats the L1 as a trusted oracle for
  finality and re-reads canonical state from it.
- **Government-scale coercion of a single user.** Out of scope of
  technical controls. The workspace tier + quorum design *reduces* the
  blast radius of coercing one custodian, but cannot defend against a
  full-quorum compel. Mitigations are legal and contractual, not
  technical.
- **Side-channel attacks on Chrome's V8 JIT or on the user's CPU.**
  Hypothetical but not actionable from within the wallet; deferred to
  browser + OS vendor. Noted because a Type-2 auditor will ask.
- **Social-engineering of workspace members to approve bad
  transactions.** Out of scope for threat modelling; in scope for the
  UX design (clear transaction summaries, simulation output via
  `packages/simulation/`).

## 8. Document maintenance

This model is code-adjacent: every PR that adds a new package,
external integration, or privileged capability must either (a) cite
an existing row in this table or (b) add a new row. Reviewers enforce
this via the PR checklist. Updates that only clarify wording do not
need a version bump; material additions bump the `Last updated` date
and trigger a notice in the quarterly compliance review.

## 9. Related documents

- `docs/compliance/SOC2_SCOPE.md` — mapping of threats to CC6/CC7 controls.
- `docs/runbooks/INCIDENT_RESPONSE.md` — what to do when a threat
  materializes.
- `docs/compliance/BCP.md` — continuity plan for availability-class threats.
- `docs/compliance/VENDOR_LIST.md` — supply-chain risk detail for T2.
- `.github/SECURITY.md` — external-facing disclosure policy.
- `CODE_OF_CONDUCT.md` — contribution-integrity controls (§3.2 human
  attribution policy reduces tampering + elevation risk).
- `AETHELRED_WALLET_ARCHITECTURE_RFC_2026-04-10.md` — canonical architecture
  reference for component names used here.
- `AETHELRED_WALLET_PRD_2026-04-10.md` — product requirements that define
  the "customer value" side of each trade-off.
