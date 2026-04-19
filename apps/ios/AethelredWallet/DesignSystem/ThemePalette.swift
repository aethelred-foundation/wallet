import SwiftUI

/// Expanded palette with 30+ semantic tokens beyond what
/// ``ThemeColors`` started with. ``ThemeColors`` remains for backward
/// compatibility — new screens import the richer ``ThemePalette``.
///
/// Example:
/// ```swift
/// let palette = ThemePalette.forScheme(colorScheme)
/// Text("hi").foregroundStyle(palette.textPrimary)
/// ```
public struct ThemePalette: Sendable {

    // MARK: Backgrounds
    public let backgroundPrimary: Color
    public let backgroundElevated: Color
    public let surfaceBase: Color
    public let surfaceRaised: Color
    public let surfaceOverlay: Color
    public let surfaceTranslucent: Color

    // MARK: Text
    public let textPrimary: Color
    public let textSecondary: Color
    public let textMuted: Color
    public let textOnAccent: Color
    public let textDestructive: Color
    public let textLink: Color
    public let textMono: Color

    // MARK: Interactive / controls
    public let accent: Color
    public let accentSoft: Color
    public let accentContrast: Color
    public let accentHover: Color
    public let accentPressed: Color

    // MARK: Status
    public let success: Color
    public let successSoft: Color
    public let warning: Color
    public let warningSoft: Color
    public let danger: Color
    public let dangerSoft: Color
    public let info: Color
    public let infoSoft: Color

    // MARK: Borders + dividers
    public let borderSubtle: Color
    public let borderStrong: Color
    public let divider: Color

    // MARK: Specialty tokens
    public let chainPill: Color
    public let riskLow: Color
    public let riskMedium: Color
    public let riskHigh: Color
    public let skeletonBase: Color
    public let skeletonHighlight: Color

    /// Derive the active palette from a resolved color scheme.
    public static func forScheme(_ scheme: ColorScheme) -> ThemePalette {
        switch scheme {
        case .light: return .light
        case .dark: return .dark
        @unknown default: return .dark
        }
    }

    // MARK: Presets

    public static let dark = ThemePalette(
        backgroundPrimary: Color(red: 0x0B / 255, green: 0x0B / 255, blue: 0x0D / 255),
        backgroundElevated: Color(red: 0x12 / 255, green: 0x12 / 255, blue: 0x15 / 255),
        surfaceBase: Color(red: 0x1C / 255, green: 0x1C / 255, blue: 0x21 / 255),
        surfaceRaised: Color(red: 0x23 / 255, green: 0x23 / 255, blue: 0x29 / 255),
        surfaceOverlay: Color.white.opacity(0.08),
        surfaceTranslucent: Color.white.opacity(0.04),
        textPrimary: Color(red: 0xED / 255, green: 0xED / 255, blue: 0xF0 / 255),
        textSecondary: Color(red: 0xB3 / 255, green: 0xB3 / 255, blue: 0xBE / 255),
        textMuted: Color(red: 0x73 / 255, green: 0x73 / 255, blue: 0x7E / 255),
        textOnAccent: Color.white,
        textDestructive: Color(red: 0xFF / 255, green: 0x5C / 255, blue: 0x55 / 255),
        textLink: Color(red: 0x7E / 255, green: 0xA4 / 255, blue: 0xFF / 255),
        textMono: Color(red: 0xE0 / 255, green: 0xE0 / 255, blue: 0xE8 / 255),
        accent: Color(red: 0xC4 / 255, green: 0x1E / 255, blue: 0x1E / 255),
        accentSoft: Color(red: 0xC4 / 255, green: 0x1E / 255, blue: 0x1E / 255).opacity(0.18),
        accentContrast: Color.white,
        accentHover: Color(red: 0xE2 / 255, green: 0x36 / 255, blue: 0x36 / 255),
        accentPressed: Color(red: 0xA8 / 255, green: 0x15 / 255, blue: 0x15 / 255),
        success: Color(red: 0x34 / 255, green: 0xC7 / 255, blue: 0x59 / 255),
        successSoft: Color(red: 0x34 / 255, green: 0xC7 / 255, blue: 0x59 / 255).opacity(0.14),
        warning: Color(red: 0xFF / 255, green: 0x9F / 255, blue: 0x0A / 255),
        warningSoft: Color(red: 0xFF / 255, green: 0x9F / 255, blue: 0x0A / 255).opacity(0.14),
        danger: Color(red: 0xFF / 255, green: 0x3B / 255, blue: 0x30 / 255),
        dangerSoft: Color(red: 0xFF / 255, green: 0x3B / 255, blue: 0x30 / 255).opacity(0.14),
        info: Color(red: 0x4C / 255, green: 0x8D / 255, blue: 0xFF / 255),
        infoSoft: Color(red: 0x4C / 255, green: 0x8D / 255, blue: 0xFF / 255).opacity(0.12),
        borderSubtle: Color.white.opacity(0.06),
        borderStrong: Color.white.opacity(0.14),
        divider: Color.white.opacity(0.08),
        chainPill: Color(red: 0x2C / 255, green: 0x31 / 255, blue: 0x3A / 255),
        riskLow: Color(red: 0x34 / 255, green: 0xC7 / 255, blue: 0x59 / 255),
        riskMedium: Color(red: 0xFF / 255, green: 0xB3 / 255, blue: 0x33 / 255),
        riskHigh: Color(red: 0xFF / 255, green: 0x3B / 255, blue: 0x30 / 255),
        skeletonBase: Color.white.opacity(0.05),
        skeletonHighlight: Color.white.opacity(0.12)
    )

    public static let light = ThemePalette(
        backgroundPrimary: Color.white,
        backgroundElevated: Color(red: 0xF8 / 255, green: 0xF8 / 255, blue: 0xFA / 255),
        surfaceBase: Color(red: 0xF2 / 255, green: 0xF2 / 255, blue: 0xF6 / 255),
        surfaceRaised: Color(red: 0xEC / 255, green: 0xEC / 255, blue: 0xF2 / 255),
        surfaceOverlay: Color.black.opacity(0.04),
        surfaceTranslucent: Color.black.opacity(0.02),
        textPrimary: Color(red: 0x14 / 255, green: 0x14 / 255, blue: 0x17 / 255),
        textSecondary: Color(red: 0x3C / 255, green: 0x3C / 255, blue: 0x43 / 255),
        textMuted: Color(red: 0x6E / 255, green: 0x6E / 255, blue: 0x75 / 255),
        textOnAccent: Color.white,
        textDestructive: Color(red: 0xC2 / 255, green: 0x1E / 255, blue: 0x24 / 255),
        textLink: Color(red: 0x2D / 255, green: 0x5E / 255, blue: 0xD3 / 255),
        textMono: Color(red: 0x20 / 255, green: 0x20 / 255, blue: 0x27 / 255),
        accent: Color(red: 0xC4 / 255, green: 0x1E / 255, blue: 0x1E / 255),
        accentSoft: Color(red: 0xC4 / 255, green: 0x1E / 255, blue: 0x1E / 255).opacity(0.10),
        accentContrast: Color.white,
        accentHover: Color(red: 0xB3 / 255, green: 0x1A / 255, blue: 0x1A / 255),
        accentPressed: Color(red: 0x8F / 255, green: 0x12 / 255, blue: 0x14 / 255),
        success: Color(red: 0x2E / 255, green: 0x8F / 255, blue: 0x3E / 255),
        successSoft: Color(red: 0x2E / 255, green: 0x8F / 255, blue: 0x3E / 255).opacity(0.12),
        warning: Color(red: 0xD9 / 255, green: 0x7A / 255, blue: 0x00 / 255),
        warningSoft: Color(red: 0xD9 / 255, green: 0x7A / 255, blue: 0x00 / 255).opacity(0.12),
        danger: Color(red: 0xD9 / 255, green: 0x2D / 255, blue: 0x20 / 255),
        dangerSoft: Color(red: 0xD9 / 255, green: 0x2D / 255, blue: 0x20 / 255).opacity(0.10),
        info: Color(red: 0x2D / 255, green: 0x5E / 255, blue: 0xD3 / 255),
        infoSoft: Color(red: 0x2D / 255, green: 0x5E / 255, blue: 0xD3 / 255).opacity(0.10),
        borderSubtle: Color.black.opacity(0.06),
        borderStrong: Color.black.opacity(0.14),
        divider: Color.black.opacity(0.06),
        chainPill: Color(red: 0xE6 / 255, green: 0xE6 / 255, blue: 0xEC / 255),
        riskLow: Color(red: 0x2E / 255, green: 0x8F / 255, blue: 0x3E / 255),
        riskMedium: Color(red: 0xD9 / 255, green: 0x7A / 255, blue: 0x00 / 255),
        riskHigh: Color(red: 0xD9 / 255, green: 0x2D / 255, blue: 0x20 / 255),
        skeletonBase: Color.black.opacity(0.04),
        skeletonHighlight: Color.black.opacity(0.08)
    )
}

/// SwiftUI environment key so deeply-nested views can read the palette
/// without chaining ``ThemePalette/forScheme(_:)``.
private struct ThemePaletteKey: EnvironmentKey {
    static let defaultValue: ThemePalette = .dark
}

public extension EnvironmentValues {
    var themePalette: ThemePalette {
        get { self[ThemePaletteKey.self] }
        set { self[ThemePaletteKey.self] = newValue }
    }
}
