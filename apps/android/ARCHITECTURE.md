# Aethelred Wallet Android Architecture

This document captures the layered architecture, decision log, and Hilt
module graph for the native Android wallet. Treat it as the canonical
reference for reviewers and new contributors.

## Layer diagram

```
+-----------------------------------------------------------+
|                           UI                               |
|  Compose screens (ui/screens), sheets (ui/sheets),         |
|  components (ui/components), theme (ui/theme)              |
+-----------------------------------------------------------+
|                        ViewModel                           |
|  HiltViewModel + StateFlow wrappers (viewmodel/)           |
+-----------------------------------------------------------+
|                         Services                           |
|  WalletConnect, Gas oracle, Nonce manager, Tx simulator,   |
|  Price service, ENS resolver, Deep links, App lock,        |
|  Analytics, Crash reporter, Policy evaluator,              |
|  Credential service, Audit service, Workflow service,      |
|  Clipboard service, Hardware wallet bridge                 |
+-----------------------------------------------------------+
|                           Core                             |
|  crypto (Secp256k1Signer, Keccak256, StrongBoxKeyStore)    |
|  network (RpcClient, NetworkRegistry)                      |
|  transaction (RLP, Eip1559Transaction)                     |
|  audit (AuditCapture, MerkleBatch)                         |
|  policy (PolicyEngine, PolicyContext)                      |
|  identity (WalletAccount, Subject, CredentialStore)        |
+-----------------------------------------------------------+
|                         Data                               |
|  Room database, DAOs, entities, secure preferences         |
+-----------------------------------------------------------+
|                         Platform                           |
|  AndroidKeyStore, BiometricPrompt, CredentialManager,      |
|  WorkManager, Glance widget, CameraX (QR)                  |
+-----------------------------------------------------------+
```

## Hilt module graph

```
SingletonComponent
├── CryptoModule
│     └── Secp256k1Signer -> KeyStoreSecp256k1Signer
├── NetworkModule
│     └── OkHttpClient
├── AppContextModule (reserved)
└── RoomModule
      ├── AethelredDatabase
      ├── AccountDao
      ├── TransactionDao
      ├── AuditEventDao
      ├── CredentialDao
      ├── SessionDao
      ├── NetworkDao
      ├── ApprovalDao
      ├── PasskeyDao
      └── TenantDao
```

All services (`core/services/*`) use `@Singleton` + constructor injection,
so Hilt auto-wires them through the graph without explicit modules.

## Decision log

### D-001 — Single Activity + Compose
The wallet hosts one `FragmentActivity` (required for `BiometricPrompt`)
and drives every screen through `androidx.navigation.compose`. Keeps the
back stack declarative and makes deep links trivial to wire.

### D-002 — Kotlin 2.0 explicit API
`-Xexplicit-api=strict` is enabled in `app/build.gradle.kts`. Every
public symbol carries a visibility modifier and explicit return type.
Tests can violate this because they live under `src/test/` which is
excluded from the strict-api rule.

### D-003 — Room over hand-rolled persistence
Room (2.7) replaces the early in-memory stores. Migration v1 -> v2 is
additive; destructive-fallback is deliberately OFF so a forgotten
migration crashes QA before shipping.

### D-004 — No third-party crypto deps in-tree
secp256k1 signing is fronted by a `KeyStoreSecp256k1Signer` stub that
throws until a JNI binding lands. Candidate libraries are documented in
README.md; the crypto review gate blocks shipping any release build
without the binding.

### D-005 — No third-party analytics SDK
`AnalyticsService` owns an in-memory ring of typed events and forwards
them through the audit chain. The wallet never phones home to a
third-party analytics provider. Opt-in is explicit.

### D-006 — Glance widget uses its own DataStore
Widget processes can't touch the AndroidKeyStore, so balance snapshots
persist through `preferencesDataStore("aethelred_widget")`. The main
process is responsible for writing fresh values; the widget reads only.

### D-007 — Navigation graph is flat
Every destination sits on the top-level graph. Sub-graphs (onboarding)
have been considered and rejected; flat navigation keeps deep links
simple and is well within Jetpack Navigation's scale limits.

### D-008 — Audit + Merkle pipeline mirrors the TS reference
Byte-for-byte canonicalisation matches `packages/audit/src/*`. The
`SemanticParityTest` guards against drift.

### D-009 — Design system expresses tokens as CompositionLocal
Spacing, radii, motion, elevation, and haptics are all supplied by
`AethelredTheme` via `CompositionLocal`. Screens never reach for a raw
`dp` literal.

### D-010 — WorkManager replaces per-screen polling
Balance refresh and pending-tx watchers run inside WorkManager so the
app behaves well on backgrounded devices and respects battery + Wi-Fi
constraints.

## Vendor dependencies still TODO

These deps require a legal / security review before shipping:
* `fr.acinq.secp256k1:secp256k1-kmp` (or BouncyCastle) for real signing.
* `com.reown:sign` + `com.reown:core` for WalletConnect v2.
* `com.google.firebase:firebase-messaging-ktx` for push.
* `com.google.firebase:firebase-crashlytics-ktx` for crash reporting.
* `com.squareup.retrofit2:retrofit` + Moshi for price feed (optional —
  OkHttp + kotlinx.serialization covers the interim needs).
* Ledger USB + BLE SDK for the hardware bridge.

## Follow-ups

* Build-variant flavors (debug/staging/release) for BuildConfig base URL.
* Play App Signing enrollment.
* Integrity API verdict on every control-plane call.
* Crowdin / Lokalise pipeline for strings.xml.
