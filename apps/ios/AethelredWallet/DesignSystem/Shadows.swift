import SwiftUI

/// Elevation tokens for shadow + blur treatments.
///
/// Each elevation level has light/dark variants that respect the
/// surrounding color scheme. Shadows are applied through the view
/// modifier extension so the color stays consistent with the palette
/// rather than hard-coded black.
///
/// Example:
/// ```swift
/// Text("Hi").elevation(.level2)
/// ```
public enum Elevation: Int, Sendable, CaseIterable {
    /// No shadow.
    case level0 = 0
    /// Ambient separation, used on tiles.
    case level1 = 1
    /// Default card shadow.
    case level2 = 2
    /// Modal / sheet shadow.
    case level3 = 3
    /// Popover / hero card.
    case level4 = 4
    /// Full-screen chrome shadow under the tab bar.
    case level5 = 5
}

/// Shadow preset derived from elevation and scheme.
public struct ShadowPreset: Sendable {
    public let color: Color
    public let radius: CGFloat
    public let x: CGFloat
    public let y: CGFloat

    public init(color: Color, radius: CGFloat, x: CGFloat, y: CGFloat) {
        self.color = color
        self.radius = radius
        self.x = x
        self.y = y
    }
}

public extension Elevation {

    /// Resolve the shadow preset for this elevation level in the given
    /// scheme. Dark mode uses softer, lower-opacity shadows because
    /// high-contrast shadows look artificial against dark surfaces.
    func preset(for scheme: ColorScheme) -> ShadowPreset {
        switch (self, scheme) {
        case (.level0, _):
            return ShadowPreset(color: .clear, radius: 0, x: 0, y: 0)
        case (.level1, .light):
            return ShadowPreset(color: Color.black.opacity(0.06), radius: 4, x: 0, y: 2)
        case (.level1, .dark):
            return ShadowPreset(color: Color.black.opacity(0.35), radius: 4, x: 0, y: 2)
        case (.level2, .light):
            return ShadowPreset(color: Color.black.opacity(0.08), radius: 10, x: 0, y: 6)
        case (.level2, .dark):
            return ShadowPreset(color: Color.black.opacity(0.40), radius: 10, x: 0, y: 6)
        case (.level3, .light):
            return ShadowPreset(color: Color.black.opacity(0.10), radius: 18, x: 0, y: 12)
        case (.level3, .dark):
            return ShadowPreset(color: Color.black.opacity(0.50), radius: 18, x: 0, y: 12)
        case (.level4, .light):
            return ShadowPreset(color: Color.black.opacity(0.12), radius: 26, x: 0, y: 16)
        case (.level4, .dark):
            return ShadowPreset(color: Color.black.opacity(0.55), radius: 26, x: 0, y: 16)
        case (.level5, .light):
            return ShadowPreset(color: Color.black.opacity(0.14), radius: 32, x: 0, y: 22)
        case (.level5, .dark):
            return ShadowPreset(color: Color.black.opacity(0.62), radius: 32, x: 0, y: 22)
        @unknown default:
            return ShadowPreset(color: Color.black.opacity(0.3), radius: 8, x: 0, y: 4)
        }
    }
}

private struct ElevationModifier: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme
    let elevation: Elevation

    func body(content: Content) -> some View {
        let preset = elevation.preset(for: colorScheme)
        return content.shadow(color: preset.color, radius: preset.radius, x: preset.x, y: preset.y)
    }
}

public extension View {
    /// Apply the shadow token for a given elevation. Shadows are
    /// scheme-aware so there is never a per-call branch on dark mode.
    func elevation(_ level: Elevation) -> some View {
        modifier(ElevationModifier(elevation: level))
    }
}
