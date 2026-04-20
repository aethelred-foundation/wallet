# Aethelred Wallet — Security model addendum

> **Scope.** This document complements `docs/security/THREAT_MODEL.md` with a
> structured treatment of the wallet's attack surface, trust boundaries,
> defense-in-depth layers, and named attack classes. It is intended for
> engineers extending the wallet, security reviewers conducting an audit,
> and enterprise customers performing a vendor-risk assessment.
>
> **Status.** Reviewed 2026-04-19. The model tracks the code that ships in
> `main`; see the revision log at the bottom for prior versions.

## 1. Attack surface map

The wallet executes inside a Chrome Manifest V3 (MV3) extension. MV3
splits a wallet into several isolated JavaScript contexts, each with a
distinct attack surface:

| Context | Entry point | What it can do | What it cannot do |
|---------|-------------|----------------|-------------------|
| **Popup UI** | `popup.html` → `apps/extension/src/popup/` | Render React UI, read extension-local storage, message the background via `chrome.runtime.sendMessage`. | Cannot touch raw decrypted key material; signing flows round-trip to the service worker. |
| **Options page** | `options.html` → `apps/extension/src/options/` | Same capabilities as popup. Used for settings the user would not complete in a narrow popup. | Same restrictions as popup. |
| **Background service worker** | `background.ts` | Hold decrypted vault in memory, sign transactions, receive `chrome.runtime.sendMessage` from popup/content script. | Cannot touch the DOM of web pages; cannot be framed. |
| **Content script** | `content.ts` | Runs inside dApp page frames. Injects `inpage.js` and brokers `window.postMessage` ↔ `chrome.runtime.sendMessage`. | Cannot read or write extension storage; cannot access wallet state directly. Only brokers messages. |
| **Inpage provider** | `inpage.js` | Exposes the `window.ethereum` EIP-1193 provider to the dApp. Runs in the page's world. | Cannot read anything the dApp does not already have access to. Cannot touch the wallet vault. |
| **Hardware wallet transport** | `@ledgerhq/hw-transport-webhid` | Talks to a physically-connected Ledger device over WebHID. Requires an explicit user gesture per session. | Cannot run without a user-granted WebHID permission. |

### 1.1 External surfaces reachable from the wallet

- **RPC endpoints.** Every chain the wallet supports corresponds to one
  or more `host_permissions` entries in the manifest. Traffic is
  HTTPS-only; `connect-src` is restricted to those origins by the CSP.
- **CoinGecko price feed.** Read-only GETs for price quotes.
- **IPFS gateway.** Read-only GETs for NFT metadata (content-addressed).
- **Aethelred control plane.** OIDC-authenticated; only contacted when
  the user explicitly enables the compliance / control-plane features.

There is **no telemetry endpoint**, **no analytics pixel**, and **no
third-party script** baked into the extension.

## 2. Trust boundaries

The wallet places three hard trust boundaries between layers:

1. **The user's device vs everything else.** Private keys, seed
   phrases, and WebAuthn credentials never leave the device in
   plaintext. Encryption at rest uses AES-GCM with a key derived from
   the user's passphrase via Argon2id. The vault is stored in
   `chrome.storage.local`, never in `localStorage` (which is shared
   across all origin scripts) and never in `chrome.storage.sync`
   (which round-trips through Google account sync).

2. **The popup vs the background service worker.** The popup cannot
   access decrypted key material. Every signing operation is routed
   as a typed RPC call into the service worker, which holds the
   vault, applies policy, records the audit event, and returns only
   the signature.

3. **The content script vs the wallet state.** Content scripts run
   inside arbitrary dApp origins. They cannot read wallet state;
   their only job is to serialise EIP-1193 calls onto the
   `chrome.runtime.sendMessage` channel and deliver responses back to
   the page.

Any change that blurs one of these boundaries is a security event
requiring explicit review by CODEOWNERS.

## 3. Known attack classes and mitigations

### 3.1 Clickjacking

**Threat.** A malicious host page renders the wallet popup (or a
look-alike) inside an `<iframe>` and captures key material through
UI redressing.

**Mitigations.**
- MV3 popups cannot be framed by extension runtime design.
- `use-phishing-check.ts` and `use-integrity-check.ts` both assert
  `window.self === window.top` on mount; a frame-detected state
  triggers the full-screen security warning instead of the wallet UI.
- CSP declares `frame-ancestors 'none'`.

### 3.2 Cross-site scripting (XSS)

**Threat.** Injected `<script>` content or a reflected-XSS vector
executes in the popup context and exfiltrates keys or signs
unauthorised transactions.

**Mitigations.**
- MV3 bans inline `<script>` and `'unsafe-inline'` in `script-src`.
- Our extension CSP further narrows `script-src 'self'` and
  disallows `'unsafe-eval'`.
- React 18's automatic escaping covers every view rendering.
- Semgrep rule `aethelred.runtime.no-eval` blocks `eval`, `Function`
  constructor, and string-timer forms at CI.

### 3.3 Extension impersonation

**Threat.** A malicious Chrome extension publishes a wallet look-alike
and tricks users into importing their mnemonic.

**Mitigations.**
- `use-integrity-check.ts` verifies `chrome.runtime.id` at startup.
- The Chrome Web Store submission flow is governed by
  `PERMISSION_JUSTIFICATIONS.md`, reducing social-engineering attack
  surface at review time.
- Recovery-phrase reveal requires full-screen phishing-check pass.

### 3.4 Side-channel timing attacks

**Threat.** A hostile process on the same machine measures cache
residency or branch-predictor state to reconstruct a key during
signing.

**Mitigations.**
- Signing runs inside the service worker context; the user's web page
  cannot measure it directly.
- `@noble/secp256k1` is constant-time by construction.
- Scheduling jitter introduced by Chrome's service-worker lifecycle
  further attenuates fine-grained timing correlation.

### 3.5 Spectre / Meltdown transient execution

**Threat.** A hostile page exploits speculative execution to read
memory across the extension / renderer boundary.

**Mitigations.**
- Chrome enables Site Isolation and cross-origin isolation by default
  for MV3 extensions.
- The wallet is compatible with `cross-origin-isolated` — no cross-
  origin iframes or cross-origin-resource-sharing dependencies.
- Speculation-barrier hardening is a browser responsibility; we
  monitor Chromium security bulletins.

### 3.6 Supply-chain poisoning

**Threat.** A transitive dependency ships a malicious update that
lands in the wallet via `npm install`.

**Mitigations.**
- Pinned lockfile; CI `npm ci` refuses out-of-date lockfiles.
- Dependabot + weekly vulnerability gate fails on HIGH/CRITICAL
  advisories.
- Semgrep supply-chain ruleset + CodeQL semantic scan.
- SBOM emitted per commit and attached to releases.
- SLSA v1.0 Build L2 provenance attestation per release.

### 3.7 Malicious dApp requests

**Threat.** A dApp issues a mis-framed EIP-712 payload to trick the
user into signing a transfer of assets or approvals beyond what the
UI describes.

**Mitigations.**
- Transaction simulation (`packages/simulation/`) decodes and
  explains the intent before signing.
- Policy engine (`packages/policy/`) applies velocity limits,
  allowlists, and denylists.
- WebAuthn / passkey 2FA is required for high-value transactions.

## 4. Defense-in-depth layers

The wallet does not rely on any single control. Every security-
critical action passes through multiple independent layers:

1. **Manifest-level CSP.** MV3 refuses to install a manifest whose
   declared CSP allows remote scripts.
2. **Runtime integrity probe.** `use-integrity-check.ts` re-verifies
   runtime id, frame state, origin, and CSP on every popup mount.
3. **Isolated contexts.** Popup ↔ background ↔ content split is
   enforced by the browser, not by our code.
4. **Policy engine.** Every signing request passes through
   `packages/policy/engine.ts` before the service worker touches key
   material.
5. **Biometric gate.** Passkey-enforced transactions require a
   WebAuthn assertion per request (configurable).
6. **Audit chain.** Every state-changing event lands on the tamper-
   evident audit log.
7. **SES (Secure EcmaScript) TODO.** Evaluation of whether to wrap
   dApp-facing globals in an SES compartment for additional
   script-boundary hardening. Tracked in the phase-2 epics.

## 5. Biometric gate on the signer

The wallet's signing flow sits inside the service worker. A signature
request that originates from the popup (or the content script on
behalf of a dApp) is routed through:

```
request → policy engine → (if passkey required) WebAuthn challenge
        → vault unlock → sign → audit log → response
```

The WebAuthn step is non-skippable when a policy requires it: the
service worker will not load the private key into memory unless the
browser returns a signed WebAuthn assertion for the right credential
id.

## 6. Revision log

| Date | Revision | Notes |
|------|----------|-------|
| 2026-04-19 | v1.0 | Initial addendum. |
