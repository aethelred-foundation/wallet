/*
 * Aethelred Wallet — Android project settings.
 *
 * Declares the plugin and dependency repositories the build resolves against
 * and enumerates every Gradle sub-project. Kept deliberately tiny today
 * (single `:app` module) with room to grow — the `core` directories inside
 * `:app` are candidates to graduate to their own modules (`:core-crypto`,
 * `:core-audit`) once the team is ready to sink the build-time cost.
 *
 * Gradle 8.9+ is required. Android Gradle Plugin 8.7+ (Koala or newer).
 */

pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

@Suppress("UnstableApiUsage")
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "aethelred-wallet-android"
include(":app")
