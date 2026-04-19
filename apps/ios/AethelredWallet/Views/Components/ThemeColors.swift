import SwiftUI

/// Design-token palette used across the iOS app.
///
/// Tokens are kept in a struct (not `Color` extensions) so light/dark
/// variants can be passed around explicitly — a lot of the wallet's
/// surfaces need to override the system color scheme for contrast.
public struct ThemeColors: Sendable {

    public let background: Color
    public let surface: Color
    public let surfaceElevated: Color
    public let ink: Color
    public let inkSoft: Color
    public let accent: Color
    public let success: Color
    public let warning: Color
    public let danger: Color

    public static let dark = ThemeColors(
        background: Color(red: 0x12 / 255, green: 0x12 / 255, blue: 0x12 / 255),
        surface: Color(red: 0x1E / 255, green: 0x1E / 255, blue: 0x20 / 255),
        surfaceElevated: Color(red: 0x24 / 255, green: 0x24 / 255, blue: 0x28 / 255),
        ink: Color(red: 0xE5 / 255, green: 0xE5 / 255, blue: 0xE7 / 255),
        inkSoft: Color(red: 0x9A / 255, green: 0x9A / 255, blue: 0xA2 / 255),
        accent: Color(red: 0xC4 / 255, green: 0x1E / 255, blue: 0x1E / 255),
        success: Color(red: 0x34 / 255, green: 0xC7 / 255, blue: 0x59 / 255),
        warning: Color(red: 0xFF / 255, green: 0x9F / 255, blue: 0x0A / 255),
        danger: Color(red: 0xFF / 255, green: 0x3B / 255, blue: 0x30 / 255)
    )

    public static let light = ThemeColors(
        background: Color.white,
        surface: Color(red: 0xEC / 255, green: 0xEC / 255, blue: 0xF0 / 255),
        surfaceElevated: Color(red: 0xF6 / 255, green: 0xF6 / 255, blue: 0xF8 / 255),
        ink: Color(red: 0x1C / 255, green: 0x1C / 255, blue: 0x1E / 255),
        inkSoft: Color(red: 0x5F / 255, green: 0x5F / 255, blue: 0x66 / 255),
        accent: Color(red: 0xC4 / 255, green: 0x1E / 255, blue: 0x1E / 255),
        success: Color(red: 0x2E / 255, green: 0xA1 / 255, blue: 0x44 / 255),
        warning: Color(red: 0xFF / 255, green: 0x9F / 255, blue: 0x0A / 255),
        danger: Color(red: 0xD9 / 255, green: 0x2D / 255, blue: 0x20 / 255)
    )

    /// Derive the active palette from a resolved `ColorScheme`.
    public static func forScheme(_ scheme: ColorScheme) -> ThemeColors {
        switch scheme {
        case .dark: return .dark
        case .light: return .light
        @unknown default: return .dark
        }
    }
}

/// Radius design tokens.
public enum ThemeRadius {
    public static let card: CGFloat = 16
    public static let button: CGFloat = 12
    public static let hero: CGFloat = 22
}

/// Spacing scale used across the app.
public enum ThemeSpacing {
    public static let xs: CGFloat = 4
    public static let sm: CGFloat = 8
    public static let md: CGFloat = 12
    public static let lg: CGFloat = 16
    public static let xl: CGFloat = 24
    public static let xxl: CGFloat = 32
}
