import SwiftUI

/// Generic empty state shown in lists and grids that have no rows yet.
///
/// Example:
/// ```swift
/// EmptyState(
///     icon: "tray",
///     title: "No transactions",
///     message: "Your history will appear here once you send or receive."
/// )
/// ```
public struct EmptyState: View {

    @Environment(\.themePalette) private var palette
    private let icon: String
    private let title: String
    private let message: String
    private let ctaTitle: String?
    private let onCTA: (@MainActor () -> Void)?

    public init(
        icon: String,
        title: String,
        message: String,
        ctaTitle: String? = nil,
        onCTA: (@MainActor () -> Void)? = nil
    ) {
        self.icon = icon
        self.title = title
        self.message = message
        self.ctaTitle = ctaTitle
        self.onCTA = onCTA
    }

    public var body: some View {
        VStack(spacing: Spacing.md) {
            Image(systemName: icon)
                .font(.system(size: 48, weight: .light))
                .foregroundStyle(palette.textMuted)
            Text(title)
                .font(Typography.title3)
                .foregroundStyle(palette.textPrimary)
            Text(message)
                .font(Typography.body)
                .foregroundStyle(palette.textSecondary)
                .multilineTextAlignment(.center)
            if let ctaTitle, let onCTA {
                Button(ctaTitle) {
                    onCTA()
                    Haptics.selection()
                }
                .buttonStyle(.borderedProminent)
                .tint(palette.accent)
                .padding(.top, Spacing.xs)
            }
        }
        .padding(Spacing.xl)
        .frame(maxWidth: .infinity)
    }
}
