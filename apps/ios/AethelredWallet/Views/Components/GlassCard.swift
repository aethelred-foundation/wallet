import SwiftUI

/// Reusable frosted-glass card used for every elevated surface.
///
/// The visual language deliberately echoes the browser extension's
/// "GlassCard" component — subtle material blur, 1px accent border, and
/// 16pt corner radius.
public struct GlassCard<Content: View>: View {

    @Environment(\.colorScheme) private var colorScheme
    private let padding: CGFloat
    private let content: Content

    public init(padding: CGFloat = ThemeSpacing.lg, @ViewBuilder content: () -> Content) {
        self.padding = padding
        self.content = content()
    }

    public var body: some View {
        let theme = ThemeColors.forScheme(colorScheme)
        content
            .padding(padding)
            .background(
                RoundedRectangle(cornerRadius: ThemeRadius.card, style: .continuous)
                    .fill(theme.surface.opacity(0.86))
            )
            .overlay(
                RoundedRectangle(cornerRadius: ThemeRadius.card, style: .continuous)
                    .strokeBorder(theme.accent.opacity(0.18), lineWidth: 1)
            )
            .shadow(color: Color.black.opacity(0.24), radius: 18, y: 12)
    }
}
