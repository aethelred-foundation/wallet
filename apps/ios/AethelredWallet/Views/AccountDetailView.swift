import SwiftUI

/// Per-account detail — shows address, security policy, and lifecycle
/// actions such as "Remove account".
@MainActor
struct AccountDetailView: View {

    let account: WalletAccount
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let theme = ThemeColors.forScheme(colorScheme)
        ScrollView {
            VStack(alignment: .leading, spacing: ThemeSpacing.lg) {
                GlassCard {
                    VStack(alignment: .leading, spacing: ThemeSpacing.sm) {
                        Text("Address")
                            .font(.caption)
                            .foregroundStyle(theme.inkSoft)
                        Text(account.address)
                            .font(.system(size: 14, design: .monospaced))
                            .foregroundStyle(theme.ink)
                            .textSelection(.enabled)
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: ThemeSpacing.sm) {
                        Text("Security")
                            .font(.headline)
                            .foregroundStyle(theme.ink)
                        Label(account.devicePolicy.displayName, systemImage: "cpu.fill")
                            .foregroundStyle(theme.accent)
                        let gateLabel = account.gate == .everySignature
                            ? "Face ID required on every signature"
                            : "Face ID within active session"
                        Label(gateLabel, systemImage: "faceid")
                            .foregroundStyle(theme.ink)
                    }
                }

                GlassCard {
                    VStack(alignment: .leading, spacing: ThemeSpacing.sm) {
                        Text("Subject")
                            .font(.caption)
                            .foregroundStyle(theme.inkSoft)
                        Text(account.subjectId)
                            .font(.system(size: 14, design: .monospaced))
                            .foregroundStyle(theme.ink)
                    }
                }

                Spacer()
            }
            .padding(ThemeSpacing.lg)
        }
        .background(theme.background.ignoresSafeArea())
        .navigationTitle(account.label)
    }
}
