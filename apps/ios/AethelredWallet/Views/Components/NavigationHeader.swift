import SwiftUI

/// Custom navigation header used on views that present full-screen sheets
/// with their own chrome (i.e. onboarding, approvals).
///
/// Example:
/// ```swift
/// NavigationHeader(
///     title: "Security",
///     onBack: { dismiss() },
///     trailing: { Image(systemName: Icons.share) }
/// )
/// ```
public struct NavigationHeader<Trailing: View>: View {

    @Environment(\.themePalette) private var palette
    private let title: String
    private let subtitle: String?
    private let onBack: (@MainActor () -> Void)?
    private let trailing: Trailing

    public init(
        title: String,
        subtitle: String? = nil,
        onBack: (@MainActor () -> Void)? = nil,
        @ViewBuilder trailing: () -> Trailing = { EmptyView() }
    ) {
        self.title = title
        self.subtitle = subtitle
        self.onBack = onBack
        self.trailing = trailing()
    }

    public var body: some View {
        HStack(alignment: .center) {
            if let onBack {
                Button {
                    onBack()
                    Haptics.selection()
                } label: {
                    Image(systemName: Icons.back)
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(palette.textPrimary)
                }
                .frame(width: 40, height: 40)
                .accessibilityLabel("Back")
            }
            VStack(alignment: .center, spacing: 2) {
                Text(title)
                    .font(Typography.title3)
                    .foregroundStyle(palette.textPrimary)
                if let subtitle {
                    Text(subtitle)
                        .font(Typography.caption)
                        .foregroundStyle(palette.textSecondary)
                }
            }
            .frame(maxWidth: .infinity)
            trailing
                .frame(width: 40, height: 40, alignment: .trailing)
        }
        .padding(.horizontal, Spacing.md)
        .padding(.top, Spacing.xs)
    }
}
