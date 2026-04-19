import SwiftUI

/// Corner radius scale used across the app.
///
/// Mirrors the extension's radius tokens (`--radius-sm` through
/// `--radius-2xl`) with an additional `pill` shortcut for fully-rounded
/// capsules.
///
/// Example:
/// ```swift
/// RoundedRectangle(cornerRadius: Radii.lg)
/// ```
public enum Radii {
    /// 8pt — inline controls, chips.
    public static let sm: CGFloat = 8
    /// 12pt — buttons, input fields.
    public static let md: CGFloat = 12
    /// 16pt — cards, list rows.
    public static let lg: CGFloat = 16
    /// 20pt — sheets, modal containers.
    public static let xl: CGFloat = 20
    /// 24pt — hero cards, top-level dashboards.
    public static let xxl: CGFloat = 24
    /// 32pt — balance hero on the Home view.
    public static let hero: CGFloat = 32
    /// Very large radius used as a stand-in for fully-rounded capsules.
    public static let pill: CGFloat = 999
}

/// Shape presets built from ``Radii`` so callers don't duplicate style
/// arguments. `continuous` corners are preferred for iOS 17+ surfaces.
public enum ShapePresets {
    /// Continuous square with the button radius.
    public static var button: RoundedRectangle {
        RoundedRectangle(cornerRadius: Radii.md, style: .continuous)
    }

    /// Continuous square with the card radius.
    public static var card: RoundedRectangle {
        RoundedRectangle(cornerRadius: Radii.lg, style: .continuous)
    }

    /// Continuous square with the sheet radius.
    public static var sheet: RoundedRectangle {
        RoundedRectangle(cornerRadius: Radii.xl, style: .continuous)
    }

    /// Continuous square with the hero radius.
    public static var hero: RoundedRectangle {
        RoundedRectangle(cornerRadius: Radii.hero, style: .continuous)
    }
}
