import SwiftUI

/// Full-screen sheet shown when the app needs Face ID for a signature.
/// The sheet itself does NOT present the system biometric prompt — iOS
/// handles that. Instead this view exists so the app can communicate
/// intent clearly before surrendering to the system sheet.
@MainActor
struct BiometricPromptSheet: View {

    @Environment(\.themePalette) private var palette
    @Environment(\.dismiss) private var dismiss
    let reason: String
    let onConfirm: () -> Void

    var body: some View {
        VStack(spacing: Spacing.md) {
            Spacer()
            Image(systemName: Icons.faceid)
                .font(.system(size: 90))
                .foregroundStyle(palette.accent)
                .accessibilityHidden(true)
            Text("Face ID required")
                .font(Typography.title)
                .foregroundStyle(palette.textPrimary)
            Text(reason)
                .font(Typography.body)
                .foregroundStyle(palette.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, Spacing.xl)
            Spacer()
            Button {
                Haptics.selection()
                onConfirm()
                dismiss()
            } label: {
                Text("Unlock with Face ID")
                    .font(Typography.button)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, Spacing.sm)
                    .background(palette.accent, in: RoundedRectangle(cornerRadius: Radii.md))
                    .foregroundStyle(palette.textOnAccent)
            }
            Button("Cancel") {
                dismiss()
            }
            .padding(.top, Spacing.xs)
            .padding(.bottom, Spacing.md)
        }
        .padding(Spacing.lg)
        .background(palette.backgroundPrimary.ignoresSafeArea())
    }
}
