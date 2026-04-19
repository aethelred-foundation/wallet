# Chrome Web Store Listing — Aethelred Wallet

The exact copy to paste into the Chrome Web Store Developer Dashboard's
"Store listing" tab. Keep this file under source control so the
listing and the code can be reviewed together.

---

## Extension name

`Aethelred Wallet`

(Maximum 45 characters. Current: 16 characters.)

## Short description

**(Chrome max 132 chars. Current: 128.)**

```
Policy-driven, compliance-native wallet for sovereign, enterprise, and personal operations. Every transaction is explainable.
```

## Category

Primary: **Productivity**

(Chrome's category taxonomy does not include a "Crypto" or "Wallet"
bucket; Productivity is the best fit used by established wallets such
as MetaMask and Rabby. The single-purpose statement makes the wallet
scope unambiguous to reviewers.)

## Language

- Primary listing language: **English (United States)**
- Planned localizations (deferred to post-launch): Spanish, Japanese,
  Korean, French, German, Simplified Chinese, Portuguese (Brazil).

## Full description (approx. 1,000 words)

```
Aethelred Wallet is a browser extension for operators who treat
self-custody as a workflow, not an accident. It brings policy controls,
compliance telemetry, and explainable approvals to every signing
decision — so individuals, teams, and sovereign entities can all use
the same trust surface without fighting it.

WHY ANOTHER WALLET?

Most Ethereum-compatible wallets were built as browser plug-ins that
grew up alongside consumer DeFi. That heritage still shows: private
keys are minted once and trusted forever, policies are afterthoughts
bolted onto an enterprise SKU, and every approval screen looks the same
regardless of who's approving what.

Aethelred Wallet is built the other way around. Policy is the first-
class primitive. Every signing decision flows through a declarative
rule set that the user — or their organization — has authored and can
audit. Policies describe allowed contract targets, spending caps,
chain restrictions, quorum requirements, simulation preconditions, and
compliance gates. The approval UI shows each rule that fired and why,
so there is never a "trust me, it's fine" button.

CORE CAPABILITIES

• MULTI-CHAIN EVM SUPPORT
  Ethereum, Polygon, Base, Optimism, Arbitrum, Avalanche, BSC, Gnosis,
  Linea, Scroll, Mantle, Celo, Fantom, Blast, opBNB, and the Aethelred
  network — plus configured testnets (Sepolia, Polygon Amoy,
  Base Sepolia). Chain selection is explicit, not implicit, and the
  network switcher surfaces whether you are on mainnet, a testnet, or
  the Aethelred sovereign network.

• POLICY-DRIVEN APPROVALS
  Every signature request is evaluated against the active policy
  bundle. Rules describe allowed contract targets, spending caps,
  token allowlists, chain restrictions, quorum requirements, and
  compliance preconditions. When a rule blocks or flags a transaction,
  the explanation is visible in plain English in the approval UI.

• TRANSACTION SIMULATION
  Before the user sees an approval prompt, the wallet simulates the
  transaction against a local fork of the target chain. The user sees
  the asset movements, state changes, and estimated gas BEFORE
  confirming — so malicious contracts that try to drain an account are
  visible before the signature is produced.

• HARDWARE WALLET INTEGRATION
  Native support for Ledger and Trezor signing over USB / WebHID. The
  hardware device sees the raw intent (chain ID, contract, call data)
  before signing; the desktop UI renders the same data next to the
  device for byte-level comparison.

• PASSKEY & SMART ACCOUNT SUPPORT
  Optional passkey enrollment for sessions that must re-authenticate
  without re-exposing recovery material. ERC-4337 smart-account support
  lets teams deploy modular account abstraction without giving up the
  familiar wallet-popup flow for EOA operators.

• FIRST-PARTY DAPP CATALOG
  Pre-registered allowlist of first-party Aethelred apps (Cruzible,
  Terraqura, ZeroID, NoblePay, Shiora). These apps bypass the
  permission-ladder for UX, but every call they make still passes
  through the policy engine — first-party is a trust signal, not a
  bypass.

• EXPORTABLE AUDIT LOG
  Every approval, rejection, chain switch, and contract interaction is
  written to a local append-only audit log. The log can be exported as
  signed JSON for SOC-2 evidence, compliance review, or incident
  response. The log never leaves the user's machine unless the user
  explicitly exports it.

• WALLETCONNECT V2
  Standard support for WalletConnect v2 so Aethelred can be used with
  any dapp that follows the standard — even dapps that have never heard
  of Aethelred. All WalletConnect sessions are still subject to the
  policy engine.

• DETERMINISTIC BUILDS
  Every release ships with a `SHA256SUMS` manifest. The Chrome Web
  Store submission ZIP is reproducible from a tagged commit, so users
  and auditors can verify the bytes Google serves match the source in
  the public repository.

• LOCAL-ONLY STATE
  Wallet state (keys, accounts, policies, audit log) lives in
  chrome.storage on the user's machine. No data is synced to Aethelred
  or any other server. There is no telemetry, no analytics pixel, no
  crash reporter that phones home.

WHO THIS IS FOR

• SOVEREIGN OPERATORS — nation-state treasuries, municipal funds, and
  public-sector entities that need policy-enforced custody they can
  audit end to end. Policies can be co-signed by multiple quorum
  members. Exports produce evidence-grade audit artifacts.

• ENTERPRISES — finance teams, DAO treasuries, and custody operators
  that need roles, spending limits, chain restrictions, and the ability
  to prove to an auditor that every signature matched a policy.

• INDIVIDUALS — operators who simply want to understand what they are
  signing. Even the personal profile benefits from simulation, policy
  explanations, and exportable audit history.

WHAT THIS WALLET IS NOT

• This is not a custodial wallet. Aethelred Foundation never holds,
  controls, or can recover your keys. A lost recovery phrase means
  lost funds — no exceptions.
• This is not a yield product. The wallet displays balances and lets
  you transact; it does not auto-stake, auto-lend, or route orders on
  your behalf.
• This is not a bridge. It talks to the chains you select via public
  RPC endpoints; it does not custody or lock assets in any bridge
  contract.

OPEN-SOURCE GOVERNANCE

Source code lives at https://github.com/aethelred-foundation. Every
release is signed and tagged; the Chrome Web Store submission is built
from the tagged commit with a reproducible hash so independent
reviewers can verify the artifact Google ships matches the public
source.

PRIVACY POLICY

The full privacy policy is published at https://aethelred.org/privacy
and is included in this release as `PRIVACY_POLICY.md` inside the
Chrome Web Store submission bundle. In short: all sensitive data stays
on your machine; no analytics, telemetry, or third-party marketing.

FEEDBACK & SUPPORT

• Issues: https://github.com/aethelred-foundation/wallet/issues
• Security: security@aethelred.org (PGP key published at
  https://aethelred.org/.well-known/pgp.asc)
• General: support@aethelred.org

Aethelred Wallet — self-custody with a paper trail.
```

## Key features (checkbox bullets for the listing)

Paste each bullet into the Chrome Web Store "Features" list:

- Policy-driven approval engine — every signature explained in plain English
- Transaction simulation on a local fork before you approve
- Multi-chain EVM support: Ethereum, Polygon, Base, Optimism, Arbitrum and 15+ other networks
- Native Ledger and Trezor hardware wallet support over WebHID / WebUSB
- Passkey enrollment for session re-authentication
- ERC-4337 smart-account support
- WalletConnect v2 for any standards-compliant dapp
- First-party dapp catalog (Cruzible, Terraqura, ZeroID, NoblePay, Shiora)
- Exportable, signed audit log suitable for SOC-2 evidence
- Local-only state — no telemetry, no analytics, no remote sync
- Deterministic builds with SHA-256 manifests for auditor verification
- Open-source and publicly reviewable
