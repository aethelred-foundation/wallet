import SwiftUI

/// Three-step send flow — recipient, amount, confirm.
@MainActor
struct SendView: View {

    @EnvironmentObject private var appState: AppState
    @Environment(\.colorScheme) private var colorScheme
    @StateObject private var viewModel = SendViewModel(
        network: NetworkRegistry.ethereumMainnet,
        signer: DeterministicStubSigner(),
        biometrics: BiometricUnlock(),
        audit: AuditCapture()
    )

    var body: some View {
        let theme = ThemeColors.forScheme(colorScheme)
        NavigationStack {
            VStack(spacing: ThemeSpacing.lg) {
                stepIndicator(theme: theme)
                GlassCard {
                    switch viewModel.step {
                    case .recipient: recipientStep(theme: theme)
                    case .amount: amountStep(theme: theme)
                    case .confirm: confirmStep(theme: theme)
                    }
                }
                Spacer()
                primaryButton(theme: theme)
            }
            .padding(.horizontal, ThemeSpacing.lg)
            .navigationTitle("Send")
            .background(theme.background.ignoresSafeArea())
        }
    }

    private func stepIndicator(theme: ThemeColors) -> some View {
        HStack(spacing: ThemeSpacing.sm) {
            ForEach([SendViewModel.Step.recipient, .amount, .confirm], id: \.rawValue) { step in
                Capsule()
                    .fill(step.rawValue <= viewModel.step.rawValue ? theme.accent : theme.surfaceElevated)
                    .frame(height: 4)
            }
        }
        .padding(.horizontal, ThemeSpacing.md)
    }

    private func recipientStep(theme: ThemeColors) -> some View {
        VStack(alignment: .leading, spacing: ThemeSpacing.sm) {
            Text("Recipient address")
                .font(.caption)
                .foregroundStyle(theme.inkSoft)
            TextField("0x…", text: $viewModel.recipient)
                .textInputAutocapitalization(.never)
                .disableAutocorrection(true)
                .font(.system(size: 16, design: .monospaced))
                .foregroundStyle(theme.ink)
        }
    }

    private func amountStep(theme: ThemeColors) -> some View {
        VStack(alignment: .leading, spacing: ThemeSpacing.sm) {
            Text("Amount")
                .font(.caption)
                .foregroundStyle(theme.inkSoft)
            TextField("0.0", value: $viewModel.amount, format: .number)
                .keyboardType(.decimalPad)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(theme.ink)
            Text("ETH on Ethereum Mainnet")
                .font(.footnote)
                .foregroundStyle(theme.inkSoft)
        }
    }

    private func confirmStep(theme: ThemeColors) -> some View {
        VStack(alignment: .leading, spacing: ThemeSpacing.md) {
            row(label: "To", value: viewModel.recipient, theme: theme)
            row(label: "Amount", value: "\(viewModel.amount) ETH", theme: theme)
            row(label: "Network", value: "Ethereum Mainnet", theme: theme)
            if let error = viewModel.lastError {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(theme.danger)
            }
            if let hash = viewModel.broadcastHash {
                row(label: "Tx hash", value: hash, theme: theme)
            }
        }
    }

    private func row(label: String, value: String, theme: ThemeColors) -> some View {
        HStack(alignment: .top) {
            Text(label)
                .foregroundStyle(theme.inkSoft)
                .frame(width: 80, alignment: .leading)
            Text(value)
                .foregroundStyle(theme.ink)
                .font(.system(size: 14, design: .monospaced))
                .lineLimit(2)
                .truncationMode(.middle)
        }
    }

    private func primaryButton(theme: ThemeColors) -> some View {
        Button {
            if viewModel.step == .confirm {
                Task {
                    if let account = appState.currentAccount {
                        await viewModel.submit(account: account)
                    }
                }
            } else {
                viewModel.advance()
            }
        } label: {
            Text(viewModel.step == .confirm ? "Sign & broadcast" : "Continue")
                .font(.system(size: 17, weight: .semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, ThemeSpacing.md)
                .background(theme.accent)
                .foregroundStyle(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: ThemeRadius.button))
        }
        .disabled(viewModel.isSubmitting)
        .padding(.bottom, ThemeSpacing.lg)
    }
}
