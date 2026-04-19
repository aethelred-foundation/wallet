# Aethelred iOS Wallet — Architecture

## Layers

```
SwiftUI Views          ← AethelredWallet/Views/**
   │
   │ @EnvironmentObject / @Observable
   ▼
ViewModels             ← AethelredWallet/ViewModels/**
   │
   │ async calls
   ▼
Services               ← AethelredWallet/Services/**
   │
   │ Foundation, CryptoKit, URLSession
   ▼
Core primitives        ← AethelredWallet/Core/**
   │
   ▼
SwiftData persistence  ← AethelredWallet/Data/**
```

Rule-of-thumb: views never touch Core directly. Services own the
business logic, Core owns the deterministic primitives (hashing,
signing, policy evaluation). Data is a SwiftData model actor that
services query through typed methods.

## Concurrency

- Swift 6 strict concurrency. No `@preconcurrency` anywhere.
- Long-lived singletons are either `@MainActor` (AppState, AppLockCoordinator)
  or actors (AuditCapture, MerkleBatch, GasOracle, NonceManager).
- Every service has a deterministic test double that satisfies the
  same protocol.

## Key modules

### Core
| Module | Purpose |
| --- | --- |
| Core/Audit | Hash-chained audit events + Merkle batching. Byte-compatible with the TS reference. |
| Core/Crypto | Secure Enclave key store + P-256 signer + Keccak256 + secp256k1 shim. |
| Core/Networking | NetworkRegistry (29 chains) + async JSON-RPC client with endpoint rotation. |
| Core/Policy | Deterministic policy engine with typed conditions. |
| Core/Transaction | EIP-1559 RLP encoder + EthereumSignature types. |
| Core/Identity | WalletAccount + Subject + passkey credential metadata. |

### Services
| Service | Purpose |
| --- | --- |
| GasOracle | 4-tier EIP-1559 fee suggestions with 30s cache. |
| NonceManager | Per-(account, chain) nonce tracker that survives reorgs. |
| TxSimulator | `eth_call` + trace fold into a typed result. |
| PriceService | CoinGecko-backed spot prices + 60s cache. |
| EnsResolver | name.eth + reverse lookup with cache. |
| DeepLinkService | Parses `wc://`, `aethelred://`, and universal links. |
| WalletConnectService | Reown SDK wrapper (interface today; impl later). |
| PushNotificationService | APNs registration + typed payload routing. |
| BackgroundTaskScheduler | BGTaskScheduler wrapper for balance refresh + pending-tx poll. |
| AppLockManager | Inactivity timer + lock policy config. |
| AnalyticsService | Privacy-first journal (opt-in). |
| CrashReporter | Breadcrumbs + non-fatal capture (no third-party SDK). |
| PolicyEvaluator | Context builder + cached evaluation. |
| CredentialService | Verifiable credential CRUD + presentation builder. |
| AuditService | Capture + Merkle batcher + persistence. |
| WorkflowService | Multi-sig quorum tracker. |
| BalanceRefreshService | Cross-chain balance poller. |
| HardwareWalletBridge | CoreBluetooth scan + stub sign (Ledger SDK TODO). |

### Data (SwiftData)
- StoredAccount, StoredTransaction, StoredAuditEvent
- StoredCredential, StoredSession, StoredNetwork
- StoredApproval, StoredPasskeyCredential, StoredTenantProfile

All access funnels through `WalletPersistenceActor` (a `@ModelActor`).
Schema is pinned at V1; V2 should add a `VersionedSchema` in
`Data/SchemaMigration.swift`.

## App Group

`group.network.aethelred.wallet` — shared between the main app, the
BalanceWidget, and the App Intents. Holds:
- `widget.balance.totalUsd`
- `widget.balance.deltaPct24h`
- `widget.balance.accountLabel`

## Widget

A WidgetKit extension (`AethelredWalletWidget/`) with small + medium
variants. TimelineProvider refreshes hourly and pulls from the App
Group container populated by `BalanceWidgetCache`.

## Localization

- `Resources/en.lproj/Localizable.strings` + `ar.lproj/Localizable.strings`
- Modern `Localizable.xcstrings` catalog for new strings.
- Typed access via `Resources/Strings.swift`.

## Vendor dependencies (stubbed)

| Dep | Why | File that marks the TODO |
| --- | --- | --- |
| swift-secp256k1 | Real EVM recovery bytes | Core/Crypto/Secp256k1Signer.swift |
| ReownSDK | WalletConnect v2 | Services/WalletConnectService.swift |
| Ledger SDK | Hardware wallet signing | Services/HardwareWalletBridge.swift |
| Sentry / Crashlytics | Crash reporting | Services/CrashReporter.swift |

Every TODO is commented in-line; nothing is taken as a silent dep.
