# Inpage Provider Integrity & Handshake

This document describes the runtime integrity protections the
Aethelred Wallet applies to the injected `inpage.js` provider, and
the ECDH / HMAC handshake that authenticates every subsequent
bridge message.

## Threat model

`inpage.js` is injected into every dApp's main world. Three attack
classes are in scope:

### Attacks this design defeats

1. **In-page message forgery.** A hostile script on the dApp page —
   whether bundled with the site, injected by a rogue ad, or planted
   by a browser extension without permissions to read extension
   memory — cannot post a well-formed bridge message. Every
   `rpc-request` carries an HMAC-SHA-256 signature computed with a
   key derived from a one-time ECDH exchange. The attacker does not
   hold the key and cannot produce a valid signature.
2. **Counterfeit inpage bundle.** A fetch interceptor / DOM mutation
   attacker cannot substitute a modified `inpage.js`. The content
   script fetches `chrome.runtime.getURL("inpage.js")`, computes
   SHA-256 of the bytes, and compares against a build-time-stamped
   constant before injection. A mismatch aborts injection and logs a
   clear error to the console.
3. **Replay across correlation ids.** An attacker who copies a
   previously-valid signed message cannot re-use it with a different
   correlation id; the correlation id is part of the HMAC input.
4. **Cross-origin session hijack.** A session minted for origin A is
   bound to A — a request with the same sessionId + signature but a
   different origin is rejected at the background layer.

### Attacks this design does NOT defeat

- **A second extension that reads our extension's memory.** That is
  a Chrome sandbox-escape scenario and is out of scope.
- **A malicious build of our own extension.** Chrome's MV3
  signature already covers that. If an attacker ships their own
  extension impersonating Aethelred the user must trust the Chrome
  Web Store's signing chain — this document is about run-time
  integrity, not distribution integrity.
- **A dApp script that races `inpage.js` and replaces `window.ethereum`
  before anyone reads it.** The EIP-6963 announce flow mitigates this
  by giving dApps a separate discovery channel that cannot be
  shadowed — but it is the dApp's responsibility to use it.

## Protocol diagram

```
   ┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
   │ inpage.js    │     │  content.ts      │     │ background.ts   │
   │ (page world) │     │ (isolated world) │     │  (service wrk)  │
   └──────┬───────┘     └─────────┬────────┘     └────────┬────────┘
          │                       │                       │
          │  1. generate ECDH P-256 keypair               │
          │───────────────────────┐                       │
          │                       │                       │
          │  2. postMessage(handshake-init, pubJwk_A)     │
          │──────────────────────▶│                       │
          │                       │  3. forward           │
          │                       │──────────────────────▶│
          │                       │                       │
          │                       │    4. generate keypair_B
          │                       │       derive HMAC + seal keys
          │                       │       mint sessionId, seal w/ AES-GCM
          │                       │                       │
          │                       │  5. handshake-ack     │
          │                       │◀──────────────────────│
          │                       │  (pubJwk_B, saltHex,  │
          │                       │   sealedSessionId)    │
          │  6. relay ack         │                       │
          │◀──────────────────────│                       │
          │                                               │
          │  7. derive matching HMAC + seal keys          │
          │     unseal sessionId                          │
          │                                               │
          │  8. EVERY rpc-request now carries:            │
          │     { method, params, sessionId, hmac }       │
          │──────────────────────▶│──────────────────────▶│
          │                                              │
          │                              9. background    │
          │                                 re-computes   │
          │                                 HMAC, rejects │
          │                                 if mismatch   │
```

### Cryptographic choices

| Component        | Algorithm         | Notes                                    |
|------------------|-------------------|------------------------------------------|
| Key exchange     | ECDH over P-256   | Native in every `crypto.subtle` context  |
| Key derivation   | HKDF-SHA-256      | Distinct info strings for HMAC / AES     |
| Message auth     | HMAC-SHA-256      | Bound to kind / sessionId / correlationId|
| Session sealing  | AES-GCM, 256-bit  | 12-byte IV, 16-byte tag                  |
| Hash chain (int.)| SHA-256           | Emitted in `_integrity.json` at build    |

All crypto operations go through `crypto.subtle` only — no
third-party packages, no `@noble/*` re-use. The inpage context is a
classic `<script>` tag and has no module loader; keeping everything
on the Web Crypto API is the only option that works there.

## Key lifecycle

- **Ephemeral per page.** Both sides generate a fresh P-256 keypair
  at page load. Private keys are marked non-extractable — even a
  hostile page script that somehow acquired a `CryptoKey` reference
  could not export the raw bytes.
- **Rotated on navigation.** A fresh page navigation triggers a
  new `handshake-init`, yielding a new sessionId and a new HMAC key.
  Stale sessions are GC'd after 24 h or when the service worker
  evicts (MV3 cold-start).
- **Origin-bound.** The background stores the session keyed by both
  sessionId and the page's origin. A request whose origin doesn't
  match the session's origin is rejected with
  `reason: "origin-mismatch"`.

## Build-time integrity

`scripts/emit-integrity-manifest.mjs` runs as a post-build step
(wired into `apps/extension/package.json` → `build`). It walks
`dist/`, computes SHA-256 of every file, and writes a sorted,
timestamp-free `dist/_integrity.json` of the form:

```json
{
  "version": 1,
  "algorithm": "sha256",
  "files": {
    "background.js": "…",
    "content.js":    "…",
    "inpage.js":     "…",
    "…":             "…"
  }
}
```

The manifest is **deterministic**: sorted keys, no timestamps, LF
line endings, trailing newline. Supply-chain auditors compare the
file hash against the value pinned in release notes.

## Content-script integrity check

`vite-plugin-inpage-integrity.ts` stamps the content-script chunk
with the SHA-256 of the emitted `inpage.js`. At runtime, the
content script:

1. Fetches `chrome.runtime.getURL("inpage.js")`.
2. Computes SHA-256 of the response bytes with
   `crypto.subtle.digest`.
3. Compares against the stamped constant.
4. Refuses to inject on mismatch.

In development (`vite dev`), the plugin's `apply: "build"` gate
means the sentinel is not rewritten — the content script detects
this and skips the check, so dev-mode HMR still works.

## How to verify in DevTools

1. Open any dApp page (e.g. `https://app.example`).
2. Open the Chrome DevTools console.
3. Inspect `window.ethereum.isAethelred` — should be `true`.
4. If the integrity check failed, the console will contain:

   ```
   [aethelred] inpage integrity check failed — refusing to inject.
   expected=<64-char hex> actual=<64-char hex>
   ```

5. On the extension's background service-worker console
   (chrome://extensions → "service worker" link), successful
   handshakes are silent; rejected requests emit:

   ```
   [aethelred] rejecting unsigned inpage request
   (reason=<code>, origin=<https://dapp.example>)
   ```

Rejection codes:

| reason              | meaning                                                          |
|---------------------|------------------------------------------------------------------|
| `missing-session-id`| payload did not include a `sessionId`                            |
| `missing-hmac`      | payload did not include an `hmac`                                |
| `unknown-session`   | sessionId is not in the live session map                         |
| `origin-mismatch`   | session was minted for a different origin                        |
| `hmac-mismatch`     | signature did not verify against the derived HMAC key            |

## Incident response

**Symptom:** a dApp reports "wallet not connecting" but the extension
icon shows as active, and the service-worker console contains
`rejecting unsigned inpage request (reason=unknown-session)` lines.

**Likely cause:** the handshake never completed — usually because the
service worker was evicted mid-page-load and the session map was
dropped.

**Resolution steps:**

1. Ask the user to reload the dApp page. A fresh page load triggers a
   new handshake-init.
2. If the problem persists, check the content-script console for
   `[aethelred] inpage integrity check failed`. If present, the
   extension bundle was tampered with — DO NOT PROCEED. Reinstall
   the extension from the Chrome Web Store.
3. If the error is `origin-mismatch`, the user likely navigated
   cross-origin within the same tab without a full reload. Reload
   fixes it.

**Symptom:** a high rate of `hmac-mismatch` from a single origin.

**Likely cause:** a hostile script on that origin is attempting to
spoof bridge messages. The background is rejecting them as designed.

**Resolution:** audit the origin's page for unexpected scripts,
ad/marketing injections, or a compromised extension also running
against that tab. The user's funds are not at risk — every attempt
to forge a message is rejected before it reaches the signing path.

## Performance

Back-of-the-envelope micro-benchmarks on an M1 MacBook:

| Operation                    | Latency |
|------------------------------|---------|
| ECDH keypair generation      | ~1 ms   |
| HKDF key derivation          | ~0.5 ms |
| SHA-256 of 50 kB `inpage.js` | ~1 ms   |
| HMAC-SHA-256 sign (per req)  | ~0.1 ms |
| HMAC-SHA-256 verify (per req)| ~0.1 ms |

The handshake adds ~2 ms once per page load, amortized over every
subsequent request. Per-request signing adds ~0.2 ms round-trip.
These costs are negligible vs. the existing dispatch budget (p99
budget of the `rpc-request` handler is 500 ms).

## Where the code lives

| Concern                       | File                                                         |
|-------------------------------|--------------------------------------------------------------|
| Shared handshake primitives   | `packages/connect/src/inpage-handshake.ts`                   |
| Build-time integrity manifest | `scripts/emit-integrity-manifest.mjs`                        |
| Build-time hash stamping      | `apps/extension/vite-plugin-inpage-integrity.ts`             |
| Content-script integrity gate | `apps/extension/src/content.ts`                              |
| Content-script bridge + relay | `apps/extension/src/content-bridge.ts`                       |
| Background handshake handler  | `apps/extension/src/background/inpage-handshake-handler.ts`  |
| Inpage handshake + signing    | `apps/extension/src/inpage.ts`                               |
| Test surface                  | `apps/extension/src/test/inpage-integrity.test.ts`           |
