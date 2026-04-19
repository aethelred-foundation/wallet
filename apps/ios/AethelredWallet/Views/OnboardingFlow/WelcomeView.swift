import SwiftUI

/// Onboarding splash — sets tone for the product before the user
/// commits to creating or importing a wallet.
@MainActor
struct WelcomeView: View {

    @Environment(\.themePalette) private var palette
    let onCreate: () -> Void
    let onImport: () -> Void

    var body: some View {
        ZStack {
            palette.backgroundPrimary.ignoresSafeArea()
            Gradients.heroGlow
                .ignoresSafeArea()
                .accessibilityHidden(true)
            VStack(spacing: Spacing.lg) {
                Spacer()
                Image(systemName: Icons.shield)
                    .font(.system(size: 84))
                    .foregroundStyle(palette.accent)
                    .accessibilityHidden(true)
                Text("Aethelred")
                    .font(Typography.display)
                    .foregroundStyle(palette.textPrimary)
                Text("A self-custody wallet for people, organizations, and the machines they delegate to.")
                    .font(Typography.body)
                    .foregroundStyle(palette.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, Spacing.xl)
                Spacer()
                VStack(spacing: Spacing.xs) {
                    Button(action: onCreate) {
                        Text("Create a new wallet")
                            .font(Typography.button)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, Spacing.sm)
                            .background(palette.accent, in: RoundedRectangle(cornerRadius: Radii.md))
                            .foregroundStyle(palette.textOnAccent)
                    }
                    .buttonStyle(HapticPressButtonStyle())
                    Button(action: onImport) {
                        Text("I already have a wallet")
                            .font(Typography.button)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, Spacing.sm)
                            .background(palette.surfaceBase, in: RoundedRectangle(cornerRadius: Radii.md))
                            .foregroundStyle(palette.textPrimary)
                    }
                    .buttonStyle(HapticPressButtonStyle())
                }
                .padding(.horizontal, Spacing.lg)
                Text("Your keys never leave this device.")
                    .font(Typography.caption)
                    .foregroundStyle(palette.textMuted)
                    .padding(.bottom, Spacing.md)
            }
        }
    }
}
