# Data Usage Disclosure — Aethelred Wallet

This document is the source of truth for the "Privacy practices" tab
in the Chrome Web Store Developer Dashboard. Each row corresponds
directly to a checkbox Chrome asks the developer to toggle. The
"Collected?" column records the answer we submit; the "Notes" column
records the justification reviewers can read when deciding whether to
accept the disclosure.

---

## 1. What user data does the extension collect?

| Data type | Collected? | Notes |
|---|---|---|
| **Personally identifiable information** (names, addresses, emails, ages, identification numbers) | **No** | The extension does not ask for or record any PII. |
| **Health information** | No | Not applicable. |
| **Financial and payment information** | **Yes — Local Only** | Wallet addresses, balances, and transaction data are stored in `chrome.storage.local` to provide wallet functionality. This data is never transmitted to the publisher. |
| **Authentication information** | **Yes — Local Only** | The user's encrypted private keys and wallet password hash are stored locally to authenticate signing requests. Never transmitted to any server. |
| **Personal communications** (emails, texts, chat messages) | No | Not applicable. |
| **Location** | No | Not collected. |
| **Web history** | No | The extension does not read or transmit browsing history. `activeTab` is used only when the user explicitly invokes the extension. |
| **User activity** (network monitoring, clicks, mouse position, scroll, keystroke logging) | No | Not collected. |
| **Website content** (text, images, sounds, videos, hyperlinks) | No | The content script only exchanges EIP-1193 provider messages; it does not read page content. |

**Key:**
- **No** = Not collected at all.
- **Yes — Local Only** = Stored on the user's device in
  `chrome.storage.local`. Never transmitted to Aethelred Foundation
  servers, never sold, never shared.

## 2. Certifications (the three mandatory Chrome Web Store affirmations)

The dashboard requires three explicit affirmations. We check all
three:

- [x] **I do not sell or transfer user data to third parties, outside
      of the approved use cases.**
      Aethelred Foundation never sells, rents, or shares user data.
      The only third parties the extension communicates with are
      public blockchain RPC endpoints, a price API, and an IPFS
      gateway — all initiated by the user's own transaction / display
      actions, not by the publisher.

- [x] **I do not use or transfer user data for purposes that are
      unrelated to my item's single purpose.**
      All data the extension handles is used solely to provide wallet
      functionality (signing, balance display, transaction history).
      No data is repurposed for marketing, advertising, analytics, or
      any feature unrelated to the stated single purpose.

- [x] **I do not use or transfer user data to determine
      creditworthiness or for lending purposes.**
      Aethelred Foundation does not operate any creditworthiness
      engine or lending product. Wallet data is never used for such
      purposes.

## 3. Data usage statement (freeform field)

Paste this into the "How will the collected data be used?" freeform
field in the dashboard:

```
Aethelred Wallet stores the user's wallet state (encrypted private
keys, account addresses, balances, transaction history, policy
bundle, and audit log) in chrome.storage.local on the user's device.
This data is used solely to provide the extension's single purpose —
a self-custodial EVM wallet — and is NEVER sold, transferred,
synced to a remote server, or used for any unrelated purpose. When
the user approves a transaction, the transaction is submitted
directly from the user's browser to a public blockchain RPC
endpoint; Aethelred Foundation has no server that receives or
inspects this traffic.
```

## 4. Data retention

- On-device storage is retained until the user uninstalls the
  extension or uses the in-app "Reset wallet" action. Chrome removes
  `chrome.storage.local` automatically on uninstall.
- Aethelred Foundation retains no data because Aethelred Foundation
  does not receive any data.

## 5. How this document stays accurate

Every material change to the data the extension handles MUST also
update this file. The submission checklist
(`CHECKLIST.md`) lists "DATA_USAGE_DISCLOSURE matches current data
practices" as a mandatory pre-submit item.
