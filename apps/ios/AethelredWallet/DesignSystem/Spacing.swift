import SwiftUI

/// Design-token spacing scale used across the app.
///
/// Values mirror the `--space-*` variables defined in the browser
/// extension's `premium-global.css`, translated from an 8pt-first grid
/// with a 4pt extension for tight copy rhythms.
///
/// Example:
/// ```swift
/// VStack(spacing: Spacing.md) { ... }
///     .padding(Spacing.lg)
/// ```
public enum Spacing {
    /// 4pt — half-step for stacked icon + label pairs.
    public static let xxs: CGFloat = 4
    /// 8pt — baseline row gap (matches `--space-8` in the extension).
    public static let xs: CGFloat = 8
    /// 12pt — micro-grid step for card internals.
    public static let sm: CGFloat = 12
    /// 16pt — default card padding.
    public static let md: CGFloat = 16
    /// 20pt — loose row gap between glass cards.
    public static let mdLarge: CGFloat = 20
    /// 24pt — section spacing on marketing-style surfaces.
    public static let lg: CGFloat = 24
    /// 32pt — hero offsets.
    public static let xl: CGFloat = 32
    /// 40pt — top-of-screen breathing room.
    public static let xxl: CGFloat = 40
    /// 48pt — reserved for the very largest heroes.
    public static let xxxl: CGFloat = 48
    /// 64pt — used only by the launch-like lock screen.
    public static let huge: CGFloat = 64

    /// Return the spacing token closest to a given raw value. Useful
    /// when porting hard-coded numbers from a design spec.
    public static func nearest(to raw: CGFloat) -> CGFloat {
        let tokens: [CGFloat] = [xxs, xs, sm, md, mdLarge, lg, xl, xxl, xxxl, huge]
        return tokens.min(by: { abs($0 - raw) < abs($1 - raw) }) ?? md
    }
}

/// Raw-number helpers for layout where Spacing enum isn't ergonomic —
/// e.g. paddings in toolbars and HStack spacers that need integer raw.
public enum InsetScale {
    public static let rowVertical: CGFloat = Spacing.xs
    public static let rowHorizontal: CGFloat = Spacing.md
    public static let sheetTop: CGFloat = Spacing.xl
    public static let tabBarBottom: CGFloat = 26
}
