# Aethelred Wallet — Changelog

All notable changes to the Aethelred Wallet browser extension.
Format follows [Keep a Changelog](https://keepachangelog.com/); this project is
in **public beta** and versions may move fast.

## [Unreleased]

### Added
- **Trezor hardware wallet** support, alongside the existing Ledger path —
  EIP-712 typed-data signing with the transaction decoded on-device.
- **Opt-in crash/error log.** Off by default. When enabled, recent view errors
  are stored **locally only** with every key, address, mnemonic, and opaque
  token redacted before storage. Nothing is transmitted; you export the log
  yourself and choose what to share. Support: report issues at
  `github.com/aethelred-foundation/wallet/issues`.

### Changed
- Default theme is now **dark**; a saved preference still wins.
- Injected provider brought to MetaMask parity (EIP-6963 discovery, legacy
  `enable`/`send`/`sendAsync`, and approval-driven methods that wait for you
  instead of timing out).

### Fixed
- Content↔inpage integrity stamping is now actually applied at build time
  (previously the check silently skipped).

## [0.9.0-beta.1]

- First public beta. EVM + native Cosmos signing, dApp-connection consent,
  institutional custody suite, and the seal/passport surfaces.
- **Testnet only.** tAETHEL has no monetary value; there is no token sale.
