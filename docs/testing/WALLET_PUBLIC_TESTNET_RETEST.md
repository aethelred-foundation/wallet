# Wallet Public-Testnet Retest

Use the `wallet-extension-dist` artifact produced by CI for the exact commit under test. Do not test a local preview build: development previews intentionally contain roadmap-only surfaces that are absent from production.

Status: this artifact is a **public-testnet candidate**, not a “100% complete” wallet, production approval, signed store release, or Chrome Web Store acceptance. A passing retest supplies evidence for the next release gate; it does not replace independent security review or store review.

## Installation

1. Download and unzip `wallet-extension-dist` from the commit's successful CI run.
2. Open a fresh Chrome profile and navigate to `chrome://extensions`.
3. Enable Developer mode, choose **Load unpacked**, and select the unzipped artifact.
4. Record the git commit, Chrome version, operating system, extension ID, and selected network in the test report.

## Required smoke path

1. Create a wallet and confirm the recovery phrase can be restored in a disposable second profile.
2. Import a known public-testnet wallet; verify invalid and checksum-invalid phrases are rejected without overwriting the current vault.
3. Lock and unlock with the correct and incorrect password.
4. Enroll a passkey, lock, unlock with the passkey, and confirm a cancelled or replayed passkey assertion cannot unlock.
5. Create a second account, switch accounts, close/reopen the popup, and verify the selected account remains authoritative.
6. Switch to the Aethelred public testnet; verify the header and a connected dApp receive the new chain ID.
7. Send a small native transfer to a 20-byte `0x` address. Confirm the review recipient, exact native amount and base units, immutable gas limit, max fee, priority fee, maximum fee, submitted hash, and receipt on the matching explorer.
8. Send a small ERC-20 transfer. Confirm the review shows the human recipient separately from the token contract, the exact token amount and base units, zero native value, the immutable gas tuple, maximum native fee, submitted hash, and matching token-transfer receipt. Treat an enabled approval button without authoritative spending fields as release-blocking.
9. Exercise a stale approval if two wallet surfaces can observe the same request: resolve it in one surface, then act on the stale card in the other. The stale action must show an error, retain/refresh the card, and must not show success feedback or navigate away unless the background explicitly returned `ok: true`.
10. Open **Activity** after the real transfers. A native send and contract interaction must render without a crash; incomplete legacy records must use neutral labels such as **Transaction** or **Amount unavailable**, not an invented asset or transaction type.
11. Enter an `aethel1…` recipient in **Send**. The current EVM-only transaction path must reject it before review. Do not convert it silently; native-chain sending remains unavailable until a dedicated pipeline is released.
12. Confirm insufficient funds, malformed decimal amounts, unavailable gas estimates, rejected signatures, and reverted transactions fail without a success screen.

## dApp matrix

Run this sequence from each official public-testnet deployment: Cruzible, ZeroID, Shiora, NoblePay, and TerraQura.

1. Open the dApp before connecting and confirm no account is exposed.
2. Select **Connect wallet** and confirm the wallet shows the requesting origin, requested accounts, and permissions.
3. Reject once; confirm the dApp receives a user-rejection error and no session appears.
4. Approve once; confirm the dApp receives only the approved account.
5. Submit one harmless signing request, inspect it, reject it, and confirm the dApp handles rejection.
6. Where the dApp has a funded public-testnet action, approve one transaction and confirm the real chain receipt before either app reports success.
7. In **Connected Sites**, revoke the origin. Confirm the dApp receives `accountsChanged([])` and subsequent account/signing requests fail until a new connection is approved.
8. Repeat after locking the wallet and after restarting Chrome.

## Record upload and access grants

- Uploading an image or record does not inherently require a wallet signature. A wallet prompt is expected only when the dApp calls the provider to request a signature, permission, or transaction.
- An on-chain access grant must show an Aethelred Wallet transaction/signature review and must not report success until the authoritative response succeeds. An off-chain grant must document and validate its authenticated API/consent path instead.
- If the browser shows **Access Granted** and **Request validation failed** for the same attempt, record it as a dApp release-blocking state-consistency defect; the wallet cannot repair a request the dApp never sent to its provider.
- Capture the failing request payload with secrets removed, HTTP/RPC status and response body, selected record ID, grantee/provider identity, scope, expiry, chain ID, wallet account, and whether any EIP-1193 request reached the wallet.

For Shiora specifically, repeat the original random-image scenario without assuming that upload itself should open MetaMask or Aethelred Wallet. The pass condition is determined by the actual grant architecture: an on-chain grant must reach Aethelred Wallet for review, while an off-chain grant must complete through its documented authenticated consent API. The contradictory **Access Granted** plus **Request validation failed** state remains release-blocking.

## Approval, audit, About, and clipboard truthfulness

1. In a dApp transaction approval, verify the visible recipient, amount, asset, contract, native value, chain, and fee tuple against the request captured in the dApp console and the eventual chain transaction. Do not accept an unstructured summary as the source of truth.
2. Open **Reports** after generating wallet activity. A non-empty event count must not by itself say the SHA-256 chain is verified. A verified label is valid only when the background returns a complete-chain verification result; unavailable, empty, rehydration-failed, or integrity-failed states must be shown explicitly.
3. Open **About**. The installed manifest version may be shown. Build date, commit, release channel, and active deployment profile must say **Unavailable** when the installed runtime does not authoritatively provide them. The page must not show a fabricated package count, release notes, or label a default profile as active.
4. Copy an address, transaction identifier, and the About version, then compare the clipboard contents. Copied/checkmark feedback may appear only after the browser confirms the write. If clipboard permission can be denied in the test environment, denial must show failure feedback and must never show copied success.
5. From an extension-owned bridge test harness, call each reserved tenant method: `tenant-list`, `tenant-plan-migration`, `tenant-execute-migration`, and `tenant-verify-continuity`. Each must return error code `4200`; an empty list, `null` plan, placeholder receipt, or other success-shaped result is release-blocking.

## Expected unavailable surfaces

The production candidate intentionally does not expose WalletConnect, swaps, token-approval indexing, an app catalog, governance voting, rewards, machine delegation, regulatory credentials, identity verification, digital-asset records, tenant migration, native `aethel1…` sending, or transaction-detail shortcuts. Reserved tenant-migration calls must fail with code `4200`, not a success-shaped placeholder. Their appearance as functional controls is a release-blocking defect.

## Failure report

For every failure, attach:

- exact dApp URL and origin;
- wallet commit and extension ID;
- selected account and chain ID (never attach a recovery phrase or private key);
- expected and actual result;
- wallet/background console error;
- dApp console error and failing RPC method;
- transaction hash when one exists;
- screenshot or screen recording with secrets removed.
