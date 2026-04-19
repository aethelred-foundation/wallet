# Aethelred Wallet — Privacy Policy

**Effective date**: 2026-04-19
**Last revised**: 2026-04-19
**Public URL**: https://aethelred.org/privacy
**Contact**: privacy@aethelred.org

---

## 1. Who this policy covers

This policy covers the **Aethelred Wallet** Chrome browser extension
published by the Aethelred Foundation ("we", "us"). It describes what
data the extension handles, what we as the publisher can and cannot
see, and the rights you retain as a user.

The policy applies only to the Chrome extension. It does NOT cover
any third-party dapp you choose to connect the wallet to — each dapp
has its own privacy policy which you should review independently.

## 2. Short version

- The extension stores everything locally on your machine. We (the
  publisher) have no server that receives your keys, balances,
  transaction history, or browsing activity.
- The extension does NOT include analytics, telemetry, crash
  reporters, or any form of tracking pixel.
- The extension DOES talk to public blockchain RPC endpoints and a
  public price API so it can show accurate information. Those third
  parties can see the IP address your browser uses when making the
  request, plus whatever public blockchain state your request
  references.

## 3. Data we collect

**We (Aethelred Foundation) collect none of the following from the
extension itself:**

| Category | Collected by us? |
|---|---|
| Personally identifiable information (name, email, etc.) | No |
| Wallet addresses | No |
| Transaction history | No |
| Private keys or recovery phrases | No (never leaves your device) |
| Browsing history | No |
| Device identifiers | No |
| Location | No |
| Analytics / telemetry | No |

If you email us at `privacy@aethelred.org` or
`security@aethelred.org`, we obviously receive the contents of your
email. We treat that correspondence as confidential and do not link it
to any extension usage — because we have no extension usage data to
link it to.

## 4. Data stored locally on your device

The extension stores the following in `chrome.storage.local` on your
machine:

- **Encrypted wallet vault**: private keys, derived accounts, and
  recovery material. Encrypted with a key derived from your wallet
  password via PBKDF2 + AES-GCM.
- **Policy bundle**: the rules you or your organization have authored
  for approving transactions.
- **Audit log**: an append-only local record of every approval,
  rejection, and chain switch.
- **Active network selection, UI preferences, IPFS gateway URL**.

This data never leaves your device unless YOU actively export it (for
example, via the audit-log export feature for SOC-2 evidence). When
you uninstall the extension, Chrome deletes this storage.

## 5. Third parties the extension talks to

To show balances, submit transactions, and fetch NFT metadata, the
extension makes direct network requests from YOUR browser to the
following third parties:

### Blockchain JSON-RPC providers (public tier, no API key)

| Provider | Chains | What they see |
|---|---|---|
| llamarpc.com | Ethereum, Polygon, Base, Optimism, Arbitrum, BSC | Your IP, the JSON-RPC method + args you send, the block state you read |
| publicnode.com | Ethereum, Polygon, Base, Optimism, Arbitrum, Avalanche, BSC, Gnosis, Linea, Mantle, Fantom, Blast, opBNB, testnets | same |
| rpc.ankr.com | Ethereum, Polygon, BSC, Avalanche, Arbitrum, Optimism, Scroll, Mantle, Celo, Fantom, Blast | same |
| cloudflare-eth.com | Ethereum | same |
| rpc.aethelred.network | Aethelred sovereign network (operated by Aethelred Foundation) | same |

Each provider has its own privacy policy governing what they do with
request logs.

### Market data

| Provider | Purpose | What they see |
|---|---|---|
| api.coingecko.com | Price quotes + trending-news feed | Your IP and the static price / trending endpoints the extension calls. No wallet address is sent. |

### IPFS gateway (for NFT metadata)

| Provider | Purpose | What they see |
|---|---|---|
| ipfs.io (default; user-configurable) | Fetch content-addressed NFT metadata | Your IP and the IPFS CIDs your wallet references |

### Dapps you connect to via WalletConnect or direct injection

When you connect to a dapp, the dapp sees your wallet address, the
chain you are on, and the signatures you approve. This is intrinsic to
the operation of the dapp, not a data-collection by Aethelred. The
extension enforces that dapps only see what they explicitly request
and you explicitly approve.

## 6. Data we do NOT collect or share

- We do NOT sell any data.
- We do NOT use any data for advertising.
- We do NOT share data with data brokers, marketing vendors, or
  analytics platforms.
- We do NOT operate any server that receives your keys, addresses,
  transaction history, balances, or personal identifiers from the
  extension.

## 7. Your rights

You always have the right to:

- **Inspect**: all wallet data is on your local machine. Use Chrome
  DevTools (Application → Storage → Extensions) to see exactly what
  the extension stored.
- **Export**: the audit log can be exported as a signed JSON file
  from the Options page. Your recovery phrase can be revealed for
  backup from the Options page (after password re-entry).
- **Delete**: uninstalling the extension removes all local state.
  Alternatively the Options page exposes a "Reset wallet" button that
  zeroes storage without uninstalling.

You do not need to contact us to exercise these rights — they are
always available to you directly.

## 8. Security

- Private keys are encrypted at rest with AES-GCM 256. The key is
  derived from your wallet password via PBKDF2-HMAC-SHA256 with a
  per-install random salt.
- The extension's content script only exchanges structured messages
  between a dapp and the wallet; it never eavesdrops on page content.
- The extension ships no remote-code-loaded scripts. Every line of
  JavaScript in the extension is present in the published ZIP and
  reviewable at https://github.com/aethelred-foundation.
- Every Chrome Web Store release ships with a `SHA256SUMS` manifest
  so auditors can verify the bytes Chrome serves match the public
  source.

## 9. Children

The extension is not directed to children under 13 and does not
knowingly collect data from anyone — including children — because it
does not collect data from users at all.

## 10. Changes to this policy

If we materially change this policy we will:

1. Bump the "Effective date" and "Last revised" fields at the top.
2. Publish the diff at
   https://github.com/aethelred-foundation/wallet/commits/main/store/chrome-web-store/PRIVACY_POLICY.md.
3. Surface an in-extension notice on next launch with a link to the
   new policy.

We do not email users about policy changes because we have no email
addresses on file.

## 11. Contact

For privacy-related questions or to report a suspected data-handling
issue:

- Email: privacy@aethelred.org
- Security (encrypted): security@aethelred.org (PGP key at
  https://aethelred.org/.well-known/pgp.asc)
- Postal: Aethelred Foundation, privacy request, address listed at
  https://aethelred.org/contact

We respond to privacy inquiries within 10 business days.
