# Aethelred Wallet Android Testing Strategy

## Test pyramid

```
         ┌──────────────────────────────┐
         │     End-to-end (physical     │
         │      devices + Firebase)     │
         └──────────────────────────────┘
        ┌────────────────────────────────┐
        │    Instrumented Compose tests   │
        │       (androidTest/)             │
        └────────────────────────────────┘
     ┌──────────────────────────────────────┐
     │  Robolectric + Hilt tests (unit/)     │
     │  Uri parsing, Room round-trips, etc.  │
     └──────────────────────────────────────┘
┌───────────────────────────────────────────────┐
│           Pure JVM unit tests                   │
│  Crypto vectors, audit/merkle, policy rules,    │
│  design-system invariants, service behaviour    │
└───────────────────────────────────────────────┘
```

The bulk of coverage lives at the bottom two layers — they run in under
30 seconds on a developer laptop. Instrumented tests run in CI on a
single API-33 emulator; the top of the pyramid runs on Firebase Test Lab
for release candidates only.

## Directory layout

* `app/src/test/kotlin/...` — JVM tests. No Android SDK needed unless the
  test is annotated with `@RunWith(RobolectricTestRunner::class)`.
* `app/src/androidTest/kotlin/...` — Instrumented tests. Deploy to a
  device or emulator via `./gradlew connectedDebugAndroidTest`.

## JVM tests

| Subject                          | File                                                         |
| -------------------------------- | ------------------------------------------------------------ |
| secp256k1 signer input guards    | `Secp256k1SignerTest`                                        |
| RLP encoder yellow-paper vectors | `RLPTest`                                                    |
| Audit chain tamper detection     | `AuditCaptureTest`                                           |
| Merkle inclusion proofs          | `MerkleBatchTest`                                            |
| Policy rule semantics            | `PolicyEngineTest`                                           |
| Design-token invariants          | `DesignSystemTests`                                          |
| Deep-link parsing                | `DeepLinkTest` (Robolectric)                                 |
| Gas oracle + `MockWebServer`     | `GasOracleTest`                                              |
| Nonce manager                    | `NonceManagerTest`                                           |
| TxSimulator                      | `TxSimulatorTest`                                            |
| Price service shape              | `PriceServiceTest`                                           |
| ENS resolver helpers             | `EnsResolverTest`                                            |
| Workflow quorum transitions      | `WorkflowServiceTest`                                        |
| Credential presentation builder  | `CredentialServiceTest`                                      |
| Room persistence                 | `RoomPersistenceTest` (Robolectric)                          |
| AuditCapture / TS parity         | `SemanticParityTest`                                         |

## Instrumented tests

| Subject                     | File                             |
| --------------------------- | -------------------------------- |
| Biometric probe path        | `BiometricUnlockTest`            |
| Compose primitive rendering | `ComposeScreenTest`              |
| WorkManager worker invariant | `WorkManagerTest`               |

## Writing a new test

* Prefer JVM unit tests over instrumented tests. Instrumented tests are
  fragile against OEM ROMs and slow in CI.
* Never add fingerprint hardware expectations to a JVM test.
* Stub every network call through `MockWebServer` — the real RPC
  endpoints in `NetworkRegistry` are not for tests.
* Keep test fixtures minimal. The wallet's business rules are in Kotlin,
  not JSON test vectors.

## Running the suite

```bash
./gradlew test                         # JVM + Robolectric
./gradlew connectedDebugAndroidTest    # Instrumented
./gradlew lint                         # Detekt + AGP lint
```
