/*
 * Aethelred Wallet — root Gradle build file.
 *
 * Only plugin aliases live here; every plugin is applied in leaf modules
 * so accidental cross-module plugin leakage cannot happen. All versions
 * come from `gradle/libs.versions.toml`.
 */

plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.hilt) apply false
    alias(libs.plugins.ksp) apply false
}
