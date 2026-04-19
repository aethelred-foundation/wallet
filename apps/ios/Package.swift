// swift-tools-version: 5.10
//
// Secondary build system for the Aethelred Wallet iOS app. The canonical
// build system is the XcodeGen-generated AethelredWallet.xcodeproj; this
// Package.swift is kept in sync so that:
//
//   1. CI can run `swift build` and `swift test` against the non-UI
//      portions (Core/*) without spinning up a simulator.
//   2. Non-Apple tooling (e.g. SwiftLint, swift-format, jazzy) can resolve
//      the targets without parsing an .xcodeproj.
//
// SwiftUI / UIKit surfaces are intentionally excluded from the SwiftPM
// targets because swift build cannot link UIKit on Linux runners; the
// iOS-only code lives in AethelredWallet/Views and AethelredWallet/Auth.

import PackageDescription

let package = Package(
    name: "AethelredWallet",
    platforms: [
        .iOS(.v17),
        .macOS(.v14)
    ],
    products: [
        .library(
            name: "AethelredWalletCore",
            targets: ["AethelredWalletCore"]
        )
    ],
    dependencies: [
        // PRODUCTION FOLLOW-UP: swap swift-crypto's secp256k1 helper in once
        // Apple's Crypto package gains full secp256k1 support, OR wire up
        // https://github.com/GigaBitcoin/secp256k1.swift via a tag pin.
        //
        // .package(url: "https://github.com/GigaBitcoin/secp256k1.swift.git",
        //          from: "0.12.0"),
    ],
    targets: [
        .target(
            name: "AethelredWalletCore",
            path: "AethelredWallet",
            exclude: [
                "App",
                "Auth",
                "Views",
                "ViewModels",
                "Assets.xcassets",
                "Info.plist"
            ],
            sources: [
                "Core"
            ]
        ),
        .testTarget(
            name: "AethelredWalletCoreTests",
            dependencies: ["AethelredWalletCore"],
            path: "AethelredWalletTests"
        )
    ],
    swiftLanguageVersions: [.v5]
)
