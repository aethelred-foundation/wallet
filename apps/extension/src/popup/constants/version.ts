/**
 * Central version constants for the Aethelred Wallet.
 *
 * Follows Semantic Versioning 2.0.0 (https://semver.org):
 *   MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]
 *
 * Cross-platform conventions:
 *   - iOS App Store: Version + separate Build number
 *   - Android Play Store: versionName + versionCode
 *   - Chrome Web Store: dot-separated integer string (4 parts max)
 *
 * Change only these constants to bump the version — every UI surface
 * reads from here so there's a single source of truth.
 */

/** Semver-compliant version string (package.json, manifest, analytics) */
export const SEMVER = "0.9.0-beta.1";

/** Human-readable display version (hero cards, settings, dev tools) */
export const DISPLAY_VERSION = "0.9.0 Beta 1";

/** Short form for tight spaces (profile menu subtitle) */
export const SHORT_VERSION = "v0.9.0 Beta";

/** Monotonically-increasing build number (iOS App Store convention).
 *  Derived: major×100 + minor×10 + beta number = 0×100 + 9×10 + 1 = 91 */
export const BUILD_NUMBER = 91;

/** Release codename — major design milestone identifier */
export const CODENAME = "Apple Grade";

/** Release channel: alpha | beta | rc | stable */
export const CHANNEL: "alpha" | "beta" | "rc" | "stable" = "beta";

/** Build metadata (date-based, YYYYMMDD format) */
export const BUILD_DATE = "2026-04-14";

/** Total packages in the monorepo (shown in About page) */
export const PACKAGE_COUNT = 11;

/** Git commit short SHA (7 hex chars) — in CI this would come from
 *  `git rev-parse --short HEAD` injected via a build-time env var.
 *  Format matches what GitHub, git log --oneline, and most CI systems
 *  display (e.g. "a3f8c2d"). */
export const GIT_SHA = "a3f8c2d";

/** Copyright year range */
export const COPYRIGHT_YEAR = "2025–2026";
