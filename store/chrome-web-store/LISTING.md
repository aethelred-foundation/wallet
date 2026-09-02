# Chrome Web Store Listing — Aethelred Wallet

This is the release-reviewed copy for the Chrome Web Store Developer Dashboard. It must describe only capabilities enabled in the packaged production build.

## Extension name

`Aethelred Wallet`

## Short description

```
Self-custodial wallet with explicit dApp permissions, passkey protection, policy review, and verifiable local audit history.
```

## Category

Primary: **Productivity**

## Language

- Primary: English (United States)
- Included localization: Spanish
- Other localizations remain unavailable until their reviewed locale bundles ship.

## Full description

```
Aethelred Wallet is a self-custodial browser wallet for the Aethelred
public testnet and supported EVM networks.

The wallet keeps recovery material encrypted on the user's device and
requires an explicit decision before granting a website access or
signing a request. Connected-site permissions can be reviewed and
revoked from the wallet. Revocation immediately removes that site's
wallet authority.

CURRENT CAPABILITIES

• Create a new wallet or import a valid BIP-39 recovery phrase.
• Encrypt local key material with a wallet password.
• Optionally require a device passkey or compatible security key when
  unlocking the wallet.
• View live balances returned by the selected network.
• Send native assets and standard ERC-20 transfers using exact chain
  units, live gas estimation, review, signing, and broadcast.
• Connect compatible browser dApps through the injected EIP-1193
  provider, with explicit account permission and origin isolation.
• Review and revoke connected-site sessions.
• Switch among the networks packaged with the wallet; connected dApps
  receive standard account and chain change events.
• Apply wallet policy checks before sensitive requests proceed.
• Maintain a local hash-chained audit history for wallet events.
• Build a deterministic extension archive with a SHA-256 manifest.

SAFETY MODEL

Private keys and recovery phrases are not sent to dApps. Website
requests are attributed to their origin and must pass wallet permission
and policy checks. Passkey challenges are one-time, origin-bound, and
verified by the extension before unlock authority is granted.

This wallet is non-custodial. Aethelred Foundation cannot recover a
lost password or recovery phrase, reverse a signed transaction, or
restore funds sent to the wrong address.

FEATURE AVAILABILITY

Experimental surfaces such as WalletConnect, swaps, token-approval
indexing, protocol catalogs, rewards, machine delegation, regulatory
credentials, and digital-asset records are not enabled in this release.
They will not be advertised as available until connected to audited,
authoritative services and covered by release tests.

PRIVACY

Wallet secrets remain encrypted on the user's device. The extension
contacts the selected blockchain RPC endpoints and configured market
data endpoint to provide requested wallet information. See the current
privacy policy at https://aethelred.org/privacy before installation.

SUPPORT

Issues: https://github.com/aethelred-foundation/wallet/issues
Security: security@aethelred.org
General: support@aethelred.org
```

## Key features

- Self-custodial encrypted local key storage
- BIP-39 wallet creation and import validation
- Password and optional passkey-protected unlock
- Native-asset and ERC-20 transfers with live fee estimation
- EIP-1193 browser dApp connections with explicit permission
- Connected-site review and revocation
- Packaged multi-network switching and standard provider events
- Policy review before sensitive wallet requests
- Local hash-chained audit history
- Deterministic release archives with SHA-256 manifests
