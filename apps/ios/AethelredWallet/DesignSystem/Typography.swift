import SwiftUI

/// Typographic tokens for the iOS wallet.
///
/// Semantically-named styles that encapsulate size, weight, and design.
/// `@ScaledMetric` is applied at the `Font` level via Dynamic Type so
/// every surface respects the user's preferred text size without any
/// per-call wiring.
///
/// Example:
/// ```swift
/// Text("Balance")
///     .font(Typography.caption)
/// ```
public enum Typography {

    // MARK: - Display styles (SF Pro Display)

    /// 48pt bold hero — used only by the main balance.
    public static let hero: Font = .system(size: 48, weight: .bold, design: .default)

    /// 36pt bold — onboarding screen titles.
    public static let display: Font = .system(size: 36, weight: .bold, design: .default)

    /// 28pt semibold — modal titles, section heroes.
    public static let title: Font = .system(size: 28, weight: .semibold, design: .default)

    /// 22pt semibold — list headers.
    public static let title2: Font = .system(size: 22, weight: .semibold, design: .default)

    /// 20pt medium — card titles.
    public static let title3: Font = .system(size: 20, weight: .medium, design: .default)

    /// 17pt semibold — primary button text.
    public static let button: Font = .system(size: 17, weight: .semibold, design: .default)

    /// 17pt regular — body copy default.
    public static let body: Font = .system(size: 17, weight: .regular, design: .default)

    /// 16pt regular — body copy that sits under a title.
    public static let bodyCompact: Font = .system(size: 16, weight: .regular, design: .default)

    /// 15pt regular — subdued body (captions with context).
    public static let bodySmall: Font = .system(size: 15, weight: .regular, design: .default)

    /// 13pt medium — row metadata, labels.
    public static let label: Font = .system(size: 13, weight: .medium, design: .default)

    /// 12pt medium — captions.
    public static let caption: Font = .system(size: 12, weight: .medium, design: .default)

    /// 11pt medium — micro metadata.
    public static let micro: Font = .system(size: 11, weight: .medium, design: .default)

    /// 10pt regular — smallest legal/accessibility copy.
    public static let small: Font = .system(size: 10, weight: .regular, design: .default)

    /// 9pt regular — absolute smallest (debug overlay, version tags).
    public static let xsmall: Font = .system(size: 9, weight: .regular, design: .default)

    // MARK: - Monospaced styles (SF Mono)

    /// 24pt monospaced semibold — TX hashes, big amount cells.
    public static let monoTitle: Font = .system(size: 24, weight: .semibold, design: .monospaced)

    /// 17pt monospaced — body monospaced, addresses.
    public static let monoBody: Font = .system(size: 17, weight: .regular, design: .monospaced)

    /// 14pt monospaced — inline addresses, short hashes.
    public static let monoCompact: Font = .system(size: 14, weight: .regular, design: .monospaced)

    /// 12pt monospaced — metadata tail on transaction rows.
    public static let monoCaption: Font = .system(size: 12, weight: .regular, design: .monospaced)

    /// 11pt monospaced — developer panels.
    public static let monoMicro: Font = .system(size: 11, weight: .regular, design: .monospaced)
}

/// Scaled-metric wrapper so font sizes respect Dynamic Type without
/// callers needing to declare `@ScaledMetric` properties themselves.
public struct ScaledFont: ViewModifier {
    @ScaledMetric private var size: CGFloat
    private let weight: Font.Weight
    private let design: Font.Design

    public init(size: CGFloat, weight: Font.Weight = .regular, design: Font.Design = .default) {
        self._size = ScaledMetric(wrappedValue: size)
        self.weight = weight
        self.design = design
    }

    public func body(content: Content) -> some View {
        content.font(.system(size: size, weight: weight, design: design))
    }
}

public extension View {
    /// Apply a scaled-metric font. Prefer ``Typography`` tokens for
    /// established roles; use this when a one-off size is required.
    ///
    /// Example:
    /// ```swift
    /// Text("Hello").scaledFont(size: 14, weight: .semibold)
    /// ```
    func scaledFont(size: CGFloat, weight: Font.Weight = .regular, design: Font.Design = .default) -> some View {
        modifier(ScaledFont(size: size, weight: weight, design: design))
    }
}
