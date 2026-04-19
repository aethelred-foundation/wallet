import SwiftUI

/// Rounded square button with a gradient icon — used in the action row
/// on Home and Portfolio.
///
/// Example:
/// ```swift
/// ActionTile(icon: Icons.send, label: "Send") { showSend = true }
/// ```
public struct ActionTile: View {

    @Environment(\.themePalette) private var palette
    private let icon: String
    private let label: String
    private let gradient: LinearGradient
    private let onTap: @MainActor () -> Void

    public init(
        icon: String,
        label: String,
        gradient: LinearGradient = Gradients.accentSweep,
        onTap: @escaping @MainActor () -> Void
    ) {
        self.icon = icon
        self.label = label
        self.gradient = gradient
        self.onTap = onTap
    }

    public var body: some View {
        Button {
            Haptics.click()
            onTap()
        } label: {
            VStack(spacing: Spacing.xxs) {
                ZStack {
                    RoundedRectangle(cornerRadius: Radii.lg, style: .continuous)
                        .fill(palette.surfaceRaised)
                    RoundedRectangle(cornerRadius: Radii.lg, style: .continuous)
                        .fill(gradient)
                        .opacity(0.22)
                    Image(systemName: icon)
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundStyle(palette.accent)
                }
                .frame(height: 56)
                Text(label)
                    .font(Typography.caption)
                    .foregroundStyle(palette.textSecondary)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(HapticPressButtonStyle())
        .accessibilityLabel(Text(label))
    }
}
