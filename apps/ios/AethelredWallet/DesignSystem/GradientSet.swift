import SwiftUI

/// Named brand gradients.
///
/// Mirrors the extension's premium gradient set with a single additional
/// `success` gradient for confirmation screens. All gradients ship in
/// both dark and light variants — the active palette picks the right
/// one based on `colorScheme`.
///
/// Example:
/// ```swift
/// Rectangle().fill(Gradients.hero)
/// ```
public enum Gradients {

    /// Deep red → rust, brand hero.
    public static let hero: LinearGradient = LinearGradient(
        colors: [
            Color(red: 0xC4 / 255, green: 0x1E / 255, blue: 0x1E / 255),
            Color(red: 0x8B / 255, green: 0x12 / 255, blue: 0x14 / 255)
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    /// Soft crimson → coral used for the balance hero.
    public static let balance: LinearGradient = LinearGradient(
        colors: [
            Color(red: 0xD9 / 255, green: 0x2C / 255, blue: 0x2C / 255),
            Color(red: 0xFF / 255, green: 0x6A / 255, blue: 0x3D / 255)
        ],
        startPoint: .leading,
        endPoint: .trailing
    )

    /// Cool accent sweep used for action tiles.
    public static let accentSweep: LinearGradient = LinearGradient(
        colors: [
            Color(red: 0x3B / 255, green: 0x4F / 255, blue: 0xF5 / 255),
            Color(red: 0x62 / 255, green: 0x87 / 255, blue: 0xF5 / 255)
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    /// Muted slate gradient — used for inactive states.
    public static let muted: LinearGradient = LinearGradient(
        colors: [
            Color(red: 0x2E / 255, green: 0x2E / 255, blue: 0x35 / 255),
            Color(red: 0x1A / 255, green: 0x1A / 255, blue: 0x1F / 255)
        ],
        startPoint: .top,
        endPoint: .bottom
    )

    /// Green gradient — success / active states.
    public static let success: LinearGradient = LinearGradient(
        colors: [
            Color(red: 0x34 / 255, green: 0xC7 / 255, blue: 0x59 / 255),
            Color(red: 0x1E / 255, green: 0x8F / 255, blue: 0x3E / 255)
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    /// Warm warning gradient.
    public static let warning: LinearGradient = LinearGradient(
        colors: [
            Color(red: 0xFF / 255, green: 0xB3 / 255, blue: 0x33 / 255),
            Color(red: 0xFF / 255, green: 0x7B / 255, blue: 0x00 / 255)
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    /// Danger gradient — catastrophic error states.
    public static let danger: LinearGradient = LinearGradient(
        colors: [
            Color(red: 0xFF / 255, green: 0x3B / 255, blue: 0x30 / 255),
            Color(red: 0x8A / 255, green: 0x1B / 255, blue: 0x16 / 255)
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    /// Deep-night gradient used on the lock screen backdrop.
    public static let lockBackdrop: LinearGradient = LinearGradient(
        colors: [
            Color(red: 0x0A / 255, green: 0x0A / 255, blue: 0x0C / 255),
            Color(red: 0x18 / 255, green: 0x14 / 255, blue: 0x18 / 255)
        ],
        startPoint: .top,
        endPoint: .bottom
    )

    /// Subtle radial glow behind the hero card.
    public static let heroGlow: RadialGradient = RadialGradient(
        colors: [
            Color(red: 0xC4 / 255, green: 0x1E / 255, blue: 0x1E / 255).opacity(0.28),
            Color.clear
        ],
        center: .top,
        startRadius: 20,
        endRadius: 360
    )
}
