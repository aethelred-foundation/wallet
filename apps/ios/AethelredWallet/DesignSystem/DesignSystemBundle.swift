import SwiftUI

/// Convenience aggregator for UI code that wants a single injection
/// point for every design-system dimension.
///
/// Rather than wiring ``Spacing``, ``Radii``, ``Typography``,
/// ``ThemePalette``, etc. individually, screens can pull the whole
/// bundle from the environment.
///
/// Example:
/// ```swift
/// @Environment(\.designSystem) private var design
/// ```
public struct DesignSystemBundle: Sendable {
    public let palette: ThemePalette

    public static func forScheme(_ scheme: ColorScheme) -> DesignSystemBundle {
        DesignSystemBundle(palette: .forScheme(scheme))
    }
}

private struct DesignSystemKey: EnvironmentKey {
    static let defaultValue: DesignSystemBundle = .init(palette: .dark)
}

public extension EnvironmentValues {
    /// Snapshot of the active design-system tokens for this view tree.
    var designSystem: DesignSystemBundle {
        get { self[DesignSystemKey.self] }
        set { self[DesignSystemKey.self] = newValue }
    }
}

/// View modifier that injects the active design-system bundle so child
/// views can read `@Environment(\.designSystem)` without the caller
/// knowing the underlying color scheme.
public struct DesignSystemInjector: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme

    public func body(content: Content) -> some View {
        content
            .environment(\.designSystem, DesignSystemBundle.forScheme(colorScheme))
            .environment(\.themePalette, ThemePalette.forScheme(colorScheme))
    }
}

public extension View {
    /// Wire the current design system into the environment.
    func withDesignSystem() -> some View { modifier(DesignSystemInjector()) }
}
