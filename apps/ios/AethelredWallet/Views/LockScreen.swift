import SwiftUI

/// Full-screen lock gate shown on cold launch and whenever the app
/// transitions to the foreground after its inactivity window.
///
/// The screen exposes exactly one affordance: "Unlock with Face ID".
/// Success calls ``AppState/unlock()``; failure leaves the gate up and
/// surfaces the error so the user can retry.
@MainActor
struct LockScreen: View {

    @EnvironmentObject private var appState: AppState
    @Environment(\.colorScheme) private var colorScheme
    @State private var isAuthenticating: Bool = false
    @State private var errorMessage: String?

    private let biometrics: BiometricUnlocking

    init(biometrics: BiometricUnlocking = BiometricUnlock()) {
        self.biometrics = biometrics
    }

    var body: some View {
        let theme = ThemeColors.forScheme(colorScheme)
        ZStack {
            theme.background.ignoresSafeArea()
            VStack(spacing: ThemeSpacing.xl) {
                Spacer()
                Image(systemName: "lock.shield.fill")
                    .font(.system(size: 72))
                    .foregroundStyle(theme.accent)
                    .accessibilityHidden(true)

                VStack(spacing: ThemeSpacing.sm) {
                    Text("Aethelred")
                        .font(.system(size: 34, weight: .bold))
                        .foregroundStyle(theme.ink)
                    Text("Your keys never leave this device.")
                        .font(.system(size: 16))
                        .foregroundStyle(theme.inkSoft)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, ThemeSpacing.xl)
                }

                Spacer()
                Button(action: unlockTapped) {
                    HStack(spacing: ThemeSpacing.sm) {
                        Image(systemName: "faceid")
                        Text("Unlock with Face ID")
                            .font(.system(size: 17, weight: .semibold))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, ThemeSpacing.md)
                    .background(theme.accent)
                    .foregroundStyle(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: ThemeRadius.button))
                }
                .disabled(isAuthenticating)
                .padding(.horizontal, ThemeSpacing.xl)

                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(theme.danger)
                        .padding(.horizontal, ThemeSpacing.xl)
                }
                Spacer().frame(height: ThemeSpacing.xxl)
            }
        }
        .onAppear {
            Task { await attemptUnlockAutomatically() }
        }
    }

    private func unlockTapped() {
        Task { await performUnlock() }
    }

    private func attemptUnlockAutomatically() async {
        // Defer the auto-prompt by a hair so SwiftUI commits the locked
        // chrome before the system biometric sheet takes over — avoids
        // the sheet flashing against a transparent background.
        try? await Task.sleep(nanoseconds: 120_000_000)
        await performUnlock()
    }

    private func performUnlock() async {
        guard !isAuthenticating else { return }
        isAuthenticating = true
        defer { isAuthenticating = false }
        do {
            _ = try await biometrics.requestAuthentication(
                reason: "Unlock Aethelred Wallet"
            )
            await appState.unlock()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
