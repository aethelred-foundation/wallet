# Single Purpose Statement — Aethelred Wallet

Chrome Web Store requires every extension to declare a single, narrow
purpose. The purpose below is the one we submit verbatim to the
Developer Dashboard.

---

## Single purpose (verbatim)

```
Aethelred Wallet is a self-custodial Ethereum-compatible browser wallet
that lets the user manage accounts, review transaction details, and
approve or reject signature requests from blockchain applications
(dapps). Its single purpose is to be a policy-aware signing surface
for the EVM ecosystem: it holds the user's keys on-device, evaluates
every signing request against user-authored policies, and presents the
request for the user's explicit approval.

Every other feature the extension exposes — transaction simulation,
hardware-wallet integration, audit log export, WalletConnect
sessions — exists in service of that single purpose. The extension is
not a general-purpose browser tool, does not inject ads, does not
tamper with page content outside of the standard EIP-1193 provider
injection, and does not perform functions unrelated to wallet
operations.
```

## Why this is a single purpose

A browser wallet is a classic single-purpose extension: its scope is
one protocol surface (EIP-1193) and one user task (review + sign).
Every subsystem listed in the listing (policy engine, simulation,
hardware support, audit log) is a refinement of that one task, not a
separate feature.

## What the extension does NOT do

- Does NOT act as a shopping assistant, ad blocker, tab manager, or
  any other generic browser tool.
- Does NOT act as a bridge or trading router — it displays accounts
  and brokers signatures; any asset movement is initiated by a dapp
  the user connected to, not by the wallet.
- Does NOT include unrelated "bonus" features like email integration,
  social media posting, or file uploads.
