# Aethelred Wallet — Android

Native Android app for the Aethelred Wallet, written in Kotlin 2.0 and Jetpack
Compose. This directory is a standalone Gradle project — it does **not** share
a `node_modules/` workspace with the JavaScript packages elsewhere in the
monorepo. Open `apps/android/` as the Gradle project root in Android Studio.

This scaffolding is the starting point for a production-grade mobile wallet,
not a finished application. Expect the sections under **Production
follow-ups** at the end of this document to be closed out before the
app ships on the Play Store.

---

## Table of Contents

1. [System requirements](#system-requirements)
2. [Project layout](#project-layout)
3. [Getting started](#getting-started)
4. [Building](#building)
5. [Testing](#testing)
6. [Signing configuration](#signing-configuration)
7. [Architecture overview](#architecture-overview)
8. [Security posture](#security-posture)
9. [Shared design tokens](#shared-design-tokens)
10. [Control-plane integration](#control-plane-integration)
11. [Coding standards](#coding-standards)
12. [Common tasks](#common-tasks)
13. [Troubleshooting](#troubleshooting)
14. [Production follow-ups](#production-follow-ups)

---

## System requirements

| Tool                | Version                                                                 |
| ------------------- | ----------------------------------------------------------------------- |
| JDK                 | 17 (Temurin recommended)                                                |
| Android Studio      | Koala (2024.1.1) or newer — required for Kotlin 2.0 + Compose Multiplatform tooling |
| Android Gradle      | 8.7.2 (shipped via the project's Gradle wrapper)                        |
| Gradle              | 8.9+ (wrapper manages this)                                             |
| Kotlin              | 2.0.21                                                                  |
| compileSdk / targetSdk | 35 (Android 15)                                                      |
| minSdk              | 26 (Android 8.0 Oreo)                                                   |
| Hardware backing    | StrongBox preferred, TEE required                                       |

Pin the JDK with [SDKMAN](https://sdkman.io) so CI, contributors, and reviewers
share the same toolchain:

```bash
sdk install java 17.0.11-tem
sdk use java 17.0.11-tem
```

On macOS the Android SDK installs to `~/Library/Android/sdk`. Create a
`local.properties` file in this directory pointing at that install:

```properties
sdk.dir=/Users/you/Library/Android/sdk
```

---

## Project layout

```
apps/android/
├── build.gradle.kts          Root Gradle build — only plugin aliases.
├── settings.gradle.kts       Gradle module enumeration + repo config.
├── gradle.properties         JVM heap, Kotlin/Android flags.
├── gradle/libs.versions.toml Version catalogue (single source of truth).
├── app/
│   ├── build.gradle.kts      App module build — dependencies + lint.
│   ├── proguard-rules.pro    R8 keep rules for Hilt / kotlinx.serialization.
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── kotlin/xyz/aethelred/wallet/
│       │   ├── AethelredWalletApplication.kt
│       │   ├── MainActivity.kt
│       │   ├── auth/           BiometricUnlock, PasskeyEnrollment
│       │   ├── core/
│       │   │   ├── crypto/     Secp256k1Signer, Keccak256, StrongBoxKeyStore
│       │   │   ├── network/    RpcClient, NetworkRegistry, RpcError
│       │   │   ├── transaction/ Eip1559Transaction, RLP
│       │   │   ├── audit/      AuditCapture, MerkleBatch
│       │   │   ├── identity/   WalletAccount, Subject, CredentialStore
│       │   │   └── policy/     PolicyEngine, PolicyContext
│       │   ├── data/           SecureStore, WalletStateRepository
│       │   ├── di/             Hilt modules
│       │   ├── ui/
│       │   │   ├── AethelredWalletApp.kt
│       │   │   ├── AppNavigation.kt
│       │   │   ├── components/ CurrencyText, GlassCard, RiskBadge
│       │   │   ├── screens/    Lock, Home, Accounts, AccountDetail, Send, Receive, Approval, Settings
│       │   │   └── theme/      Color, Type, Shape, AethelredTheme
│       │   └── viewmodel/      WalletStateViewModel, SendViewModel, ApprovalViewModel
│       ├── res/
│       │   ├── values/         strings, themes, colors
│       │   ├── values-night/   dark-mode theme + colors
│       │   ├── xml/            backup_rules, data_extraction_rules, network_security_config
│       │   ├── mipmap-anydpi-v26/ adaptive launcher
│       │   └── drawable/       launcher foreground + background
│       └── assets/             reserved for bundled test fixtures
├── app/src/test/kotlin/…       JVM unit tests
├── app/src/androidTest/kotlin/… instrumented tests
├── README.md                   this file
└── .editorconfig
```

Gradle-generated artefacts (`build/`, `.gradle/`, `.idea/`, `local.properties`)
should be excluded via the repository's `.gitignore`.

---

## Getting started

```bash
# From the monorepo root:
cd apps/android

# One-time: install the Gradle wrapper if missing.
gradle wrapper --gradle-version 8.9

# Sync the project (Android Studio does this automatically).
./gradlew help
```

Open `apps/android/` in Android Studio. Wait for the Gradle sync to complete
— it downloads the AGP, Kotlin, Hilt, and Compose dependencies declared in
`gradle/libs.versions.toml`.

---

## Building

Debug builds are unoptimised, debuggable, and have `applicationIdSuffix=.debug`
so they live side-by-side with a release install.

```bash
./gradlew assembleDebug
./gradlew installDebug          # deploys to the active connected device
```

Release builds enable R8 minification + resource shrinking and require the
signing config described below.

```bash
./gradlew assembleRelease
```

CI workflow — the pipeline runs:

```bash
./gradlew clean lint test assembleDebug
```

and uploads `app/build/outputs/apk/debug/app-debug.apk` as a build artefact.

---

## Testing

### JVM unit tests

Runs without a device and covers the portable core:

```bash
./gradlew test
```

Coverage map:

| Test file                     | Subject                                                   |
| ----------------------------- | --------------------------------------------------------- |
| `Secp256k1SignerTest`         | Keccak-256 vectors + signer input-validation error paths. |
| `RLPTest`                     | RLP encoding against the yellow-paper Appendix B vectors. |
| `AuditCaptureTest`            | Hash-linked chain correctness + tamper detection.         |
| `MerkleBatchTest`             | Inclusion proofs for odd and even leaf counts.            |
| `PolicyEngineTest`            | Rule semantics for read-only, raw-sign, high-value flows. |

### Instrumented tests

Requires a connected device or emulator:

```bash
./gradlew connectedAndroidTest
```

`BiometricUnlockTest` exercises the `BiometricManager` probe. A full
end-to-end fingerprint flow needs Robolectric or an emulator with
`adb -e emu finger touch` scripted — this is a production follow-up.

---

## Signing configuration

Debug builds use the stock Android debug keystore (`~/.android/debug.keystore`)
auto-generated by the Android SDK.

Release builds require:

| Env var                | Purpose                                                        |
| ---------------------- | -------------------------------------------------------------- |
| `AETHELRED_SIGNING_STORE_FILE`     | Path to the upload keystore (`.jks`).              |
| `AETHELRED_SIGNING_STORE_PASSWORD` | Password for the keystore.                         |
| `AETHELRED_SIGNING_KEY_ALIAS`      | Alias of the signing key within the keystore.      |
| `AETHELRED_SIGNING_KEY_PASSWORD`   | Password for that alias.                           |

In CI these are injected from the secret manager. Locally, create
`~/.aethelred/android-signing.gradle.kts` and source it from `app/build.gradle.kts`
inside an `if (project.hasProperty(...))` guard — the scaffold keeps the
release `signingConfig` open so the integrator can drop the values in
without touching the build file in Git.

Recommended: adopt **Play App Signing** so the upload certificate is
separate from the long-lived app-signing certificate managed by Google.

---

## Architecture overview

- **Single activity + Compose.** `MainActivity` is a thin host; all UI
  lives inside Compose. Navigation is driven by `AppNavigation.kt` via
  `androidx.navigation.compose`.
- **Hilt DI.** Every singleton (signer, network registry, RPC client,
  audit capture, secure store, wallet state repository) is constructor-
  injected. Swap any of them in a test via `@TestInstallIn`.
- **StateFlow for UI state.** No `LiveData`. ViewModels expose a
  single `StateFlow<UiState>` and Compose collects it with
  `collectAsState()`.
- **Coroutines for IO.** Everything that touches disk or network is a
  `suspend` function pinned to `Dispatchers.IO` at the call site.
- **Sealed error hierarchies.** `SigningException` and `RpcError` are
  both sealed so consumers pattern-match without `else` branches.

### Data flow

1. **App launch** → `AethelredWalletApplication` wires the
   `ProcessLifecycleOwner` observer → `WalletStateRepository` starts in
   the `isLocked = true` state.
2. **LockScreen** is the default navigation destination. The user taps
   *Unlock with biometrics* → `BiometricUnlock.authenticate(activity)`
   runs the `BiometricPrompt`.
3. **On success** → `WalletStateRepository.markUnlocked()` flips the
   `StateFlow`. Navigation replaces the stack with `HomeScreen`.
4. **Sign flow** (future) → the Send / Approval screens ask the
   `Secp256k1Signer` for a signature. The keystore-backed implementation
   attaches a `CryptoObject(Signature)` to a new `BiometricPrompt`, so
   the signing material is bound to a fresh biometric gesture.
5. **Audit capture** — every semantic wallet event goes through
   `AuditCapture.record`. Events are hash-linked and roll up into a
   `MerkleBatch` that the control-plane notarises on the Aethelred L1.

---

## Security posture

| Control                                | Implementation                                                         |
| -------------------------------------- | ---------------------------------------------------------------------- |
| Hardware-backed signing keys           | `StrongBoxKeyStore` probes StrongBox → TEE → software fallback.        |
| Biometric-gated signatures             | `setUserAuthenticationRequired(true)` + `BiometricPrompt(CryptoObject)`. |
| Backup exclusion                       | `allowBackup=false` + `backup_rules.xml` + `data_extraction_rules.xml`. |
| Encrypted SharedPreferences            | `SecureStore` via `androidx.security.crypto` AES-256-GCM.             |
| Cleartext network blocked              | `network_security_config.xml` denies all cleartext.                    |
| Idle re-lock                           | 60-second window enforced inside `WalletStateRepository`.              |
| Deep-link hardening                    | `wc://` + `aethelred://wallet` intent filters scoped to MainActivity.  |

### secp256k1 caveat

Android's `AndroidKeyStore` natively supports secp256r1 (NIST P-256), not
secp256k1. The wallet uses a two-tier strategy:

1. A hardware-backed P-256 key serves as the wrapping key (KEK).
2. A separate secp256k1 private key — generated via a JNI-backed library
   — is stored encrypted by the KEK. At signing time the KEK unwraps the
   secp256k1 material inside the TEE's application memory, the signature
   is computed, and the key is zeroed again.

The scaffold leaves the JNI binding as a **TODO** in
`core/crypto/Secp256k1Signer.kt`. The canonical choice is
[`fr.acinq.secp256k1:secp256k1-kmp`](https://github.com/ACINQ/secp256k1-kmp);
[`org.bouncycastle:bcprov-jdk15on`](https://www.bouncycastle.org/) is an
acceptable pure-Java alternative while waiting on a crypto review.

---

## Shared design tokens

These tokens match the iOS wallet team so users feel at home on either
platform.

### Colour

| Role          | Light       | Dark        |
| ------------- | ----------- | ----------- |
| Background    | `#FFFFFF`   | `#121212`   |
| Surface       | `#ECECF0`   | `#1E1E20`   |
| Ink (primary) | `#1C1C1E`   | `#E5E5E7`   |
| Ink soft      | `#5F5F66`   | `#8E8E93`   |
| Accent        | `#C41E1E`   | `#C41E1E`   |
| Success       | `#2EA144`   | `#34C759`   |
| Warning       | `#FF9F0A`   | `#FF9F0A`   |
| Danger        | `#D92D20`   | `#FF3B30`   |

### Typography

Body / UI: system font (Roboto on AOSP / vendor default elsewhere).

Addresses: `FontFamily.Monospace`. Ship JetBrains Mono (or Roboto Mono
as a fallback) into `res/font/` to force the same look across devices.

### Corners

| Surface  | Radius |
| -------- | ------ |
| Hero     | 22dp   |
| Card     | 16dp   |
| Button   | 12dp   |
| Chip     | 8dp    |

---

## Control-plane integration

The Android wallet speaks to the Aethelred control-plane over HTTPS +
JSON. Concrete integration points:

1. **Audit fanout** — finalised `MerkleBatch` roots and their underlying
   events POST to `/v1/audit/batches`. The control-plane validates the
   hash chain and pins the root on the L1.
2. **Policy evaluation** — `PolicyEngine` is a local backstop. Before
   every signature the wallet also consults `/v1/policy/evaluate`. The
   remote verdict wins; the local engine only intervenes if the control
   plane is unreachable.
3. **Credential ceremony** — Passkey attestations emitted by
   `PasskeyEnrollment` are verified server-side via `/v1/credentials/attest`.
4. **Chain config snapshot** — On first launch the app fetches
   `/v1/chain/networks` and reconciles with `NetworkRegistry`. Upstream
   changes (new chain onboarding) reach mobile without a release.

The base URL and attestation certificate pins live in a `BuildConfig`
field injected by Gradle at build time. FOLLOW-UP(android-team): wire the
flavored build variants.

---

## Coding standards

- **Kotlin 2.0 explicit API** (`-Xexplicit-api=strict`). Every public
  symbol has a visibility modifier + return type.
- **No `!!`.** Lint fails the build. Use `checkNotNull` or safe casts.
- **No hard-coded UI strings.** Lint's `HardcodedText` rule is an error.
- **No `TODO` comments** in production code paths. File a tracking issue
  instead — our lint config treats TODOs as errors. Test-only scaffolding
  is excluded.
- **KDoc on every public symbol.** Classes, functions, and
  top-level properties must document intent.
- **Errors are sealed classes.** Pattern-match exhaustively at the edge.

Run the full lint + test + assemble pipeline before opening a PR:

```bash
./gradlew ktlintCheck lint test assembleDebug
```

(ktlintCheck is available once the team drops the jlleitschuh plugin in.)

---

## Common tasks

**Add a new chain** — extend `NetworkRegistry.kt` with a
`NetworkDefinition`; no XML or resource changes needed. Cross-reference
the TypeScript `packages/chain/src/networks.ts` to keep chain IDs in
lockstep.

**Add a new audit kind** — extend `AuditEventKind` with a new wire
string, update the control-plane schema, and add a unit test covering
the new kind.

**Add a new screen** — create a file under `ui/screens/`, add the
Composable, extend `WalletRoute` in `AppNavigation.kt`, and route to it.

**Add a new Hilt dependency** — constructor-inject where possible. Only
fall back to `@Module` / `@Provides` when third-party code can't be
annotated.

---

## Troubleshooting

**Gradle sync fails with `Unsupported class file major version 65`** —
your JDK is Java 21+. Switch to 17 (`sdk use java 17.0.11-tem`).

**Build fails on release due to R8 stripping a Hilt component** — audit
the relevant class and add a `-keep` rule to `app/proguard-rules.pro`.

**Biometric prompt flashes closed on Samsung** — Samsung's Knox policy
restricts `BIOMETRIC_STRONG` on some SKUs. `BiometricUnlock.canAuthenticate()`
degrades gracefully to `DEVICE_CREDENTIAL`.

**StrongBox unavailable at key generation** — the scaffolding catches
`StrongBoxUnavailableException` and retries with the TEE. If you see
soft-backed keys on production hardware, report a bug — it means the
device lied about `FEATURE_HARDWARE_KEYSTORE`.

---

## Production follow-ups

These items must close before the app ships on Google Play.

1. **secp256k1 JVM library** — decide between `secp256k1-kmp` and
   BouncyCastle, wire it into `KeyStoreSecp256k1Signer`, and add fuzzing
   coverage.
2. **Play signing upload** — enroll in Play App Signing; generate the
   upload keystore and inject via the CI secret manager.
3. **Play Integrity API** — attach device-integrity verdicts to every
   control-plane call to detect rooted / emulator environments.
4. **Firebase Crashlytics** — wire runtime crash reporting. Gate PII
   redaction inside `CrashHandler`.
5. **WalletConnect v2 SDK** — replace the placeholder deep-link stub
   with the real WalletConnect session + signing flow.
6. **Google Play Billing** — for premium policy templates / recurring
   subscriptions (if/when the product pushes that direction).
7. **Robolectric coverage** — elevate JVM tests to exercise Compose UI
   with fake biometric hardware.
8. **R8 keep-rules audit** — run `./gradlew :app:minifyReleaseWithR8 --full-mode`
   and add missing `-keep` rules before the first release.
9. **ktlint + Detekt** — wire both linters via Gradle plugins with
   matching `.editorconfig` rules.
10. **L10n pipeline** — translate `strings.xml` for Spanish, Portuguese,
    Japanese, Korean; hook Crowdin (or Lokalise) to the repo.
11. **QR rendering** — swap the ReceiveScreen placeholder for a
    deterministic QR renderer (`zxing-android-embedded` or Coil bitmap).
12. **Deep-link canary** — register a Play Store "app link" verifier
    domain for `aethelred://wallet` + verify via the `assetlinks.json`.

Track them all in the team's Jira board under the **Android Wallet GA**
epic.
