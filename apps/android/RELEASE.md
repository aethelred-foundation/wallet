# Aethelred Wallet Android Release Checklist

## Signing

* Enrol in Play App Signing. Upload key lives outside the repo.
* Provision env vars for CI:
  * `AETHELRED_SIGNING_STORE_FILE`
  * `AETHELRED_SIGNING_STORE_PASSWORD`
  * `AETHELRED_SIGNING_KEY_ALIAS`
  * `AETHELRED_SIGNING_KEY_PASSWORD`
* Verify fingerprint matches the Play Console record after the CI build.

## Store listing

* App name: Aethelred.
* Short description: "Sovereign policy-aware wallet".
* Full description: pull from marketing copy (not this repo).
* Screenshots: minimum 2, maximum 8, phone + tablet.
* Privacy policy URL required — host under `aethelred.network/privacy`.
* Data safety form: declare WorkManager telemetry, push tokens, and
  clipboard usage.

## Pre-release verification

* `./gradlew clean lint test` — zero warnings.
* `./gradlew connectedDebugAndroidTest` — all pass on API 33 emulator.
* `./gradlew :app:assembleRelease` — builds with R8 enabled.
* `./gradlew :app:minifyReleaseWithR8 --full-mode` — no missing -keep
  rules.
* Manual smoke on:
  * Pixel 7 (StrongBox).
  * Samsung Galaxy A series (Knox policy).
  * Low-end spec emulator (`Pixel 5` image, 2 GB RAM).
* Deep link + app shortcut smoke:
  * Launcher long-press shortcuts resolve.
  * `aethelred://wallet/send?recipient=0x…` routes to Send.
  * `wc:<topic>` pairs into the WalletConnect flow.
* Biometric flow:
  * Cold-start lock gate.
  * Cryptographic binding at signing time.
  * Fallback via `Authenticators.DEVICE_CREDENTIAL`.

## Release notes cadence

Following iOS team convention: one-line summary per rollout, dated
entry in `CHANGELOG.md` (repo root), linked from the Play Console
release notes field.

## Rollback

Play Console -> Releases -> Halt rollout. Files a bug automatically
against the Android Wallet GA board.

## Post-release monitoring

* Crashlytics: alert on >= 1% crash-free drop in the first 24h.
* Audit fanout backlog: control-plane dashboard.
* Session rate: Firebase Crashlytics + analytics, opt-in only.
