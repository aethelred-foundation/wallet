# Aethelred iOS Wallet — Testing

## Pyramid

```
┌────────────────────────────┐
│ Snapshot / UI (future)     │
├────────────────────────────┤
│ ViewModel unit tests       │
├────────────────────────────┤
│ Core primitives            │  ← biggest layer
└────────────────────────────┘
```

## Test files

Located in `AethelredWalletTests/`:

| File | Purpose |
| --- | --- |
| AuditCaptureTests | Hash-chain continuity, canonical JSON bytes. |
| MerkleBatchTests | Batch finalization, proof verification. |
| PolicyEngineTests | Rule priority, predicate matchers. |
| Secp256k1SignerTests | DER → raw RS conversion, Secure Enclave path. |
| RLPTests | EIP-1559 RLP invariants. |
| RpcClientTests | Endpoint rotation, error surfacing. |
| DesignSystemTests | Spacing / radii monotonicity. |
| ServiceLayerTests | GasOracle + NonceManager + DeepLink + Workflow + Analytics. |
| DeepLinkTests | wc://, aethelred://, universal links. |
| TxSimulatorTests | Revert decoding, stub fixtures. |
| WorkflowServiceTests | Quorum progression. |
| CredentialServiceTests | Presentation builder determinism. |
| SemanticParityTests | iOS ↔ TS byte-identical audit events + Merkle roots. |
| PersistenceTests | Domain ↔ SwiftData converter round-trip. |
| GasOracleTests | Cached suggestions. |
| NonceManagerTests | Replace / resync semantics. |
| PriceServiceTests | CoinGecko payload normalization. |
| PolicyEvaluatorTests | Context builder + cache. |
| PushPayloadTests | Notification kind decoding. |

## Mocking

Every async dep has a `Stub*` or `Spy*` type in the same file:
- `StubHTTPTransport` — tests inject canned (Data, URLResponse) pairs.
- `StubGasOracle` — deterministic tier list.
- `StubTxSimulator` — fixture-only.
- `StubPriceService` / `StubEnsResolver` — table-backed.
- `AuditRecordingSpy` — captures every emitted event.

## Running tests

```bash
# Fast path — core + service tests
swift test --package-path apps/ios

# Full iOS simulator run (requires Xcode toolchain)
cd apps/ios && xcodebuild test \
   -scheme AethelredWallet \
   -destination 'platform=iOS Simulator,name=iPhone 15'
```

## Semantic parity

`SemanticParityTests` reconstructs merkle roots and audit-event hashes
manually — they must match what the `packages/audit` TypeScript library
produces for the same inputs. If this breaks, the audit chain has
desynced and the control plane cannot accept events from iOS.

## What's not covered

- **Face ID / Touch ID prompts** — require a real device; mocked via
  `AlwaysSucceedBiometricUnlock`.
- **CoreBluetooth hardware wallet** — requires a paired device; the
  bridge throws `HardwareWalletError.notImplemented` until wired up.
- **APNs token delivery** — requires an entitled build + push
  certificate; `PushNotificationService` decoding is unit-tested.
- **SwiftData migrations** — currently only V1 exists; test when V2
  ships.
