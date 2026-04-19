import SwiftUI

/// Inline alert banner — info / success / warning / danger variants.
///
/// Example:
/// ```swift
/// InlineAlert(style: .warning, title: "High gas fees", message: "Wait for the mempool to settle.")
/// ```
public struct InlineAlert: View {

    public enum Style: Sendable, Equatable {
        case info, success, warning, danger
    }

    @Environment(\.themePalette) private var palette
    private let style: Style
    private let title: String
    private let message: String?
    private let onDismiss: (@MainActor () -> Void)?

    public init(
        style: Style,
        title: String,
        message: String? = nil,
        onDismiss: (@MainActor () -> Void)? = nil
    ) {
        self.style = style
        self.title = title
        self.message = message
        self.onDismiss = onDismiss
    }

    public var body: some View {
        HStack(alignment: .top, spacing: Spacing.xs) {
            Image(systemName: iconName)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(tint)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(Typography.label)
                    .foregroundStyle(palette.textPrimary)
                if let message {
                    Text(message)
                        .font(Typography.caption)
                        .foregroundStyle(palette.textSecondary)
                }
            }
            Spacer(minLength: 0)
            if let onDismiss {
                Button {
                    onDismiss()
                } label: {
                    Image(systemName: Icons.close)
                        .foregroundStyle(palette.textSecondary)
                }
                .accessibilityLabel("Dismiss alert")
            }
        }
        .padding(Spacing.sm)
        .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: Radii.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Radii.md, style: .continuous)
                .strokeBorder(tint.opacity(0.28), lineWidth: 1)
        )
    }

    private var iconName: String {
        switch style {
        case .info: return Icons.info
        case .success: return Icons.success
        case .warning: return Icons.warning
        case .danger: return Icons.danger
        }
    }

    private var tint: Color {
        switch style {
        case .info: return palette.info
        case .success: return palette.success
        case .warning: return palette.warning
        case .danger: return palette.danger
        }
    }
}
