# Aethelred Wallet — iOS (Native)

Native SwiftUI implementation of the Aethelred Wallet mobile client. This
package is the sibling of `apps/mobile/` (Expo WebView shell) and
`apps/extension/` (MV3 browser extension). It is **not** a WebView — it
is a hand-authored iOS app that talks to the same control-plane APIs the
other clients use.

Scope of this phase-0 scaffolding:

- Secure-Enclave-backed key storage and signing.
- Biometric gate on every signature ceremony (Face ID / Touch ID).
- App-lock lifecycle (cold launch, background snap, inactivity grace).
- Core wallet surfaces: Home (balance + tokens), Accounts, Send,
  Receive, Settings, Approval sheet.
- Port of the `@aethelred/audit` hash-linked event chain, Merkle
  batching, and the `@aethelred/policy` engine.
- Port of the `@aethelred/wallet-chain` network registry (26 networks).
- EIP-1559 transaction encoding + RLP + Keccak-256 (pure Swift).

This is a **defensible foundation**, not a complete wallet. The
"Production follow-ups" section near the bottom lists everything an iOS
engineer must close before shipping to the App Store.

---

## Table of contents

1. System requirements
2. Generating the Xcode project with XcodeGen
3. Building and running
4. Running tests
5. Repository layout
6. Architecture overview
7. Secure Enclave + biometric signing — how it actually works
8. App lifecycle and the lock screen
9. Networking
10. Design tokens
11. Shared contracts with the control plane
12. SwiftLint and strict concurrency
13. CI guidance
14. Production follow-ups
15. Known gaps / not-implemented-yet list
16. Troubleshooting

---

## 1. System requirements

| Component          | Minimum                                   |
|--------------------|-------------------------------------------|
| macOS              | 14.0 Sonoma                               |
| Xcode              | 16.0                                      |
| Swift              | 5.10 (project is Swift 6-ready, strict)   |
| iOS deployment     | 17.0 (required for platform passkeys)     |
| Device for signing | Any iPhone or iPad with Secure Enclave    |
| Simulator          | iPhone 15 / 15 Pro (iOS 17.2+) supported  |

Developer-account requirements:

- Paid Apple Developer Program membership.
- A signing team ID configured in `AethelredWallet.xcodeproj/project.yml`
  under `settings.base.DEVELOPMENT_TEAM`.
- App Groups + Keychain access group set up on the provisioning
  profile — the bundle identifier is `network.aethelred.wallet`.
- Associated Domains entitlement for `webcredentials:aethelred.network`
  (required for platform passkeys).

If you do not have a team ID yet, XcodeGen will still generate the
project; signing will fall back to "Sign to Run Locally" and
hardware-backed keys will not be available.

---

## 2. Generating the Xcode project with XcodeGen

The canonical source-of-truth for the Xcode project is
`apps/ios/AethelredWallet.xcodeproj/project.yml`. We do **not** check in
`project.pbxproj` — hand-edited pbxproj files fight every other engineer
on the team. XcodeGen produces a deterministic project from the YAML.

Install once:

```bash
brew install xcodegen
```

Regenerate the project any time you add files, targets, or
entitlements:

```bash
cd apps/ios
xcodegen generate
```

After the first `xcodegen generate`, open the freshly created project:

```bash
open AethelredWallet.xcodeproj
```

You should see two targets — `AethelredWallet` (the app) and
`AethelredWalletTests` — and a single scheme `AethelredWallet` with
Build / Test / Run / Archive actions wired up.

---

## 3. Building and running

### From Xcode

1. Open `AethelredWallet.xcodeproj`.
2. Pick the `AethelredWallet` scheme.
3. Select a destination (simulator or device).
4. Build with `⌘B`, run with `⌘R`.

### From the CLI

```bash
# Build for the simulator
xcodebuild \
  -scheme AethelredWallet \
  -destination "platform=iOS Simulator,name=iPhone 15" \
  build

# Build for a physical device (requires provisioning)
xcodebuild \
  -scheme AethelredWallet \
  -destination "generic/platform=iOS" \
  build
```

Expected build output: zero warnings, zero errors. The project is
configured with `SWIFT_TREAT_WARNINGS_AS_ERRORS=YES` — any new
deprecation notice becomes a failure and must be fixed, not silenced.

### Swift Package Manager fallback

A secondary `Package.swift` targets only the non-UI `Core/*` modules so
`swift build` and `swift test` can run on Linux CI runners. UIKit /
SwiftUI surfaces are intentionally excluded.

```bash
swift build
swift test
```

---

## 4. Running tests

### From Xcode

`⌘U` on the `AethelredWallet` scheme runs both unit and integration
tests. Coverage is collected by default (see `project.yml`).

### From the CLI

```bash
xcodebuild test \
  -scheme AethelredWallet \
  -destination "platform=iOS Simulator,name=iPhone 15"
```

For a deterministic pass on CI the simulator name should match what
`xcrun simctl list` reports exactly; the scaffolded `Makefile` (future
follow-up) should pin to a specific runtime.

The test bundle exercises:

- `RLPTests` — EIP-1559 vectors and RLP primitive encodings.
- `Secp256k1SignerTests` — DER-to-raw (r||s) conversion plus the
  deterministic stub contract.
- `AuditCaptureTests` — hash chain linking, tamper-detection.
- `MerkleBatchTests` — root construction and per-leaf inclusion
  proofs, duplicate rejection.
- `PolicyEngineTests` — decision outcomes against canonical rules.
- `RpcClientTests` — full JSON-RPC envelope happy path, RPC error
  propagation, endpoint rotation under transport failure.

Secure-Enclave integration tests require a physical device; they live
in the app target and are excluded from the CI matrix. Wire them up
through a separate scheme once device-lab access is available.

---

## 5. Repository layout

```
apps/ios/
├── AethelredWallet.xcodeproj/
│   └── project.yml                  # XcodeGen spec — regenerate after changes
├── AethelredWallet/
│   ├── App/
│   │   ├── AethelredWalletApp.swift # @main entry + scene routing
│   │   ├── AppState.swift           # ObservableObject session/root state
│   │   └── AppLockCoordinator.swift # Lifecycle-driven lock decisions
│   ├── Core/
│   │   ├── Crypto/                  # Signer, key store, Keccak-256
│   │   ├── Networking/              # JSON-RPC client + network registry
│   │   ├── Transaction/             # RLP + EIP-1559 encoder
│   │   ├── Audit/                   # Port of packages/audit
│   │   ├── Identity/                # Account + Subject + passkey registry
│   │   └── Policy/                  # Port of packages/policy engine
│   ├── Auth/
│   │   ├── BiometricUnlock.swift    # LAContext wrapper
│   │   └── PasskeyEnrollment.swift  # ASAuthorizationController
│   ├── Views/                       # SwiftUI surfaces + components
│   ├── ViewModels/                  # @MainActor view models
│   ├── Assets.xcassets/             # AppIcon + AccentColor (Contents.json only)
│   ├── Info.plist
│   └── AethelredWallet.entitlements
├── AethelredWalletTests/            # XCTest suite
├── Package.swift                    # Secondary SwiftPM build
├── .swiftlint.yml                   # Strict lint ruleset
└── README.md
```

Anything under `Assets.xcassets` is represented as the `Contents.json`
metadata; actual PNGs (AppIcon, launch image) are a design-team TODO.

---

## 6. Architecture overview

The app is split into four layers that never cross in the wrong
direction:

1. **Views** (`SwiftUI`) — render state, forward user intent to
   ViewModels. Never touch Security.framework or RPC directly.
2. **ViewModels** (`@MainActor ObservableObject`) — hold published
   state, coordinate async flows, call into Core protocols.
3. **Core** (actors + structs) — domain logic, typed errors, zero
   SwiftUI imports. Every Core dependency is a `Sendable` protocol so
   tests inject fakes.
4. **Platform** (`Security`, `LocalAuthentication`,
   `AuthenticationServices`) — concrete implementations live in
   `Core/Crypto`, `Auth`.

Dependency wiring is explicit — we do NOT ship a DI container. Each
top-level view creates its ViewModel with production defaults; tests
use init-injection.

---

## 7. Secure Enclave + biometric signing — how it actually works

1. Account creation (`SecureEnclaveKeyStore.generateAccount`)
   - Builds a `SecAccessControl` with `.privateKeyUsage` and
     `.biometryCurrentSet` flags.
   - Sets `kSecAttrAccessible` to
     `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`.
   - Sets `kSecAttrTokenID` to `kSecAttrTokenIDSecureEnclave` on
     capable devices. On simulator / older iPads it falls back to a
     keychain-only key; the reported `DevicePolicy` changes
     accordingly.
   - Creates the key with `SecKeyCreateRandomKey` and persists
     metadata (public key, EVM address, keychain tag) in Keychain.

2. Signing (`SecureEnclaveSignerP256.sign`)
   - Caller (usually `SendViewModel.submit`) first requests an
     `LAContext` through `BiometricUnlock.requestAuthentication`.
   - That `LAContext` is held in Swift memory until
     `SecKeyCreateSignature` resolves — the system binds the context
     to the key operation so the biometric prompt appears exactly once
     per signature.
   - The resulting DER signature is converted to raw `(r || s)` by
     `convertDerSignatureToRawRS`.
   - EIP-1559 signing is assembled in `EIP1559Signing.sign`, which
     wraps `signingHash` + signer + serialization.

> **Important.** The Secure Enclave only supports P-256. Ethereum
> requires secp256k1. This scaffold uses P-256 so the ceremony and
> biometric flow are real, but the resulting `(r, s, yParity)` is not
> a valid EVM signature against an EVM address derived from a
> secp256k1 public key. Wire in `swift-secp256k1` (see section 14)
> before attempting a live broadcast.

---

## 8. App lifecycle and the lock screen

`AppLockCoordinator` subscribes to the SwiftUI `scenePhase` environment
value plus `UIApplication.didEnterBackgroundNotification`. Its
decisions:

- Transition to `.background` or `.inactive` → call
  `AppState.lock(reason: .background)`. This happens BEFORE the system
  takes its app-switcher thumbnail, so the thumbnail captures the lock
  screen instead of account balances.
- Transition back to `.active` →
  - If the user was only gone briefly (< `inactivityGraceSeconds`),
    the lock stays up because cold launch always starts locked; the
    user still authenticates on the explicit `LockScreen`. The
    coordinator does NOT auto-unlock — biometrics drive unlocking.
  - If more than the grace period elapsed, `.inactivity` is recorded
    in the audit trail.

`AppState.touchActivity()` should be called whenever meaningful user
input is captured (submit button taps, scroll-driven reloads). Future
work: add a SwiftUI `ViewModifier` that plumbs this through gesture
recognizers automatically.

---

## 9. Networking

`RpcClient` is an actor. Each public method (`getBalance`,
`sendRawTransaction`, etc.) walks
`NetworkDefinition.rpcEndpoints` in order:

- Transport-level failures (URL error, non-2xx HTTP) rotate to the
  next endpoint.
- JSON-RPC application errors are not retried — they indicate the node
  understood the request and rejected it, so the caller should surface
  the typed `RpcError.jsonRpcError`.
- If every endpoint fails at the transport layer, the caller gets
  `RpcError.allEndpointsExhausted` with the list of reasons.

The `HTTPTransport` abstraction exists exclusively for testing; in
production the default `URLSession.shared` is used.

---

## 10. Design tokens

Tokens live in `Views/Components/ThemeColors.swift`:

| Token               | Dark     | Light    |
|---------------------|----------|----------|
| `background`        | #121212  | #FFFFFF  |
| `surface`           | #1E1E20  | #ECECF0  |
| `ink`               | #E5E5E7  | #1C1C1E  |
| `inkSoft`           | #9A9AA2  | #5F5F66  |
| `accent`            | #C41E1E  | #C41E1E  |
| `success`           | #34C759  | #2EA144  |
| `danger`            | #FF3B30  | #D92D20  |
| Radius `.card`      | 16       | 16       |
| Radius `.button`    | 12       | 12       |
| Radius `.hero`      | 22       | 22       |

Typography uses SF Pro Display (system) for hero numbers, SF Pro Text
for body copy, SF Mono for addresses and transaction hashes.

---

## 11. Shared contracts with the control plane

The iOS app is the third client of the Aethelred control plane (after
the browser extension and the webapp). Shapes that cross the boundary
are mirrored carefully here:

- `AuditEvent` and `AuditEventKind` — exact string-match of
  `packages/audit/src/types.ts`.
- `MerkleProof` / `FinalizedBatch` — exact shape of
  `packages/audit/src/merkle-batch.ts`; roots computed on device must
  match roots computed in TypeScript byte-for-byte.
- `PolicyContext` and `PolicyEvaluationResult` — mirror
  `packages/policy/src/types.ts`. Rule JSON fetched from the control
  plane can be decoded directly into `PolicyRule`.
- `NetworkDefinition` — port of `packages/chain/src/networks.ts`. The
  iOS test suite asserts the registry carries the same 26 networks.

The server-side consumer is the Elixir `event-ingestion` service
(Elixir Platform repo, `audit-fanout` module). Event JSON bytes are
canonical — do not reformat.

---

## 12. SwiftLint and strict concurrency

`.swiftlint.yml` ships with an opinionated ruleset:

- `print()` is forbidden — use `os.Logger` or feed the audit log.
- TODO / FIXME must carry an assignee: `TODO: (owner-handle)
  description`.
- `force_cast`, `force_try`, `force_unwrapping` are **errors**, not
  warnings. The only suppressed site is a single `SecItemCopyMatching`
  cast in `SecureEnclaveKeyStore` (explicitly annotated).
- `line_length`, `identifier_name`, `file_length`, `type_body_length`,
  `cyclomatic_complexity` — all configured with tightened thresholds.
- `SWIFT_STRICT_CONCURRENCY=complete` — the project treats data races
  as compile errors. Every shared type is `Sendable`; UI types are
  `@MainActor`; actors are used wherever mutable state crosses task
  boundaries (`AuditCapture`, `MerkleBatch`, `RpcClient`).

Run the linter:

```bash
brew install swiftlint
cd apps/ios
swiftlint --strict
```

---

## 13. CI guidance

A dedicated GitHub Actions workflow is a follow-up, but the minimum
should be:

1. `xcodegen generate`
2. `swiftlint --strict`
3. `xcodebuild test -scheme AethelredWallet -destination
   "platform=iOS Simulator,OS=17.2,name=iPhone 15"`
4. (Linux runner, optional) `swift test` against the Core-only
   `Package.swift` target.

The repo uses `setup-xcode` and `xcpretty` by convention. Artifacts to
upload: the `.xcresult` bundle and the SwiftLint report.

---

## 14. Production follow-ups

The iOS team **must** close each of these before shipping an App Store
release. Rough priority (highest first):

1. **swift-secp256k1 SwiftPM dependency.** The Secure Enclave only
   supports P-256; EVM transactions require secp256k1. Wire in
   `https://github.com/GigaBitcoin/secp256k1.swift` (or equivalent),
   replace `SecureEnclaveSignerP256` with a secp256k1 signer that
   keeps keys in the Secure Enclave via an intermediate ECIES-wrapped
   blob, and verify against the official EIP-155 / EIP-1559 test
   vectors.
2. **App Attest entitlement.** Protects RPC calls against forged
   clients. Required for any partner-facing integration.
3. **Push Notifications entitlement.** Needed for real-time
   approval-required fanout when the app is backgrounded.
4. **WalletConnect v2 SDK integration.** The URL-scheme handler is
   wired; the handshake / session logic is not.
5. **Apple Pay entitlement** *(only if monetization ships).*
6. **Signing identity + provisioning profile.** Must be set via
   `DEVELOPMENT_TEAM` in `project.yml` before release builds work.
7. **Keccak-256 performance.** The pure-Swift implementation is
   auditable but slow. Swap in a `swift-crypto` or wrapped-C
   implementation once the hashing becomes a measured bottleneck.
8. **Audit store persistence.** `AuditCapture` is currently in-memory.
   Persist through a `SQLite` (or Core Data) store, encrypted at rest
   with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`.
9. **Merkle batch notarization adapter.** Port
   `BatchNotarizationAdapter` from the TypeScript implementation so
   batches can publish to the Aethelred L1.
10. **App Groups for extension sharing.** If the companion Safari Web
    Extension ships, configure the `group.network.aethelred.wallet`
    App Group so wallet state can be shared safely.
11. **iPad layout + Stage Manager audit.** Currently iPhone-only
    (`TARGETED_DEVICE_FAMILY = "1"`).
12. **Localized strings.** All UI copy is English. Move strings into
    `Localizable.xcstrings` before opening additional markets.
13. **Accessibility audit.** VoiceOver labels on the hero balance,
    dynamic type support on the send flow.

---

## 15. Known gaps / not-implemented-yet list

The scaffolding consciously ships with these placeholders; tickets
should be opened for each:

- Token list is a hardcoded array — wire to the
  `@aethelred/wallet-chain` token service.
- QR code reading for recipient addresses (the Send screen accepts
  paste but not scan).
- Address-book resolution for `destinationCategory`.
- Real passkey challenge round-tripping with the control plane.
- Export evidence pack (button exists, no implementation).
- Settings → inactivity lock interval is read-only.
- Landing / onboarding flow after "Add account" — stub only.

---

## 16. Troubleshooting

**"Could not generate project" from `xcodegen`.**
Usually means the YAML parsed but a referenced path does not exist.
Check that every entry in `project.yml` `sources` and `resources`
exists under `apps/ios/AethelredWallet/`.

**Simulator build fails with `Secure Enclave not available`.**
The simulator does not expose the Secure Enclave. `DevicePolicy`
resolves to `.softwareOnly` and signing still works but with
software-backed keys. This is expected.

**"Face ID cannot authenticate you" on the simulator.**
Simulator Face ID is simulated — use the "Features → Face ID" menu to
send enrolled / match / no-match events. Biometrics failing on device
after you rotate enrolled fingerprints is by design: the
`.biometryCurrentSet` flag invalidates the key binding and the user
must re-enroll the account.

**Archive build fails with "No signing identity found".**
You need a paid Apple Developer account. Set `DEVELOPMENT_TEAM` in
`project.yml` and regenerate the project.

**Passkey registration sheet never appears.**
Check the `Associated Domains` entitlement — the value must be
`webcredentials:aethelred.network`, the backend must serve a valid
apple-app-site-association file, and the device must have iCloud
Keychain enabled.

---

## Control-plane integration pointer

- Audit fanout: `aethelred-elixir` repo →
  `apps/event_ingestion/lib/audit_fanout.ex`.
- Policy rules: fetched from
  `https://api.aethelred.network/v1/policy/bundles` and decoded into
  `[PolicyRule]`.
- Session tokens: exchanged through the passkey assertion flow on
  `POST https://api.aethelred.network/v1/sessions/exchange`.

See `AETHELRED_WALLET_ARCHITECTURE_RFC_2026-04-10.md` for the full
cross-plane contract.
