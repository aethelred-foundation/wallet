import SwiftUI

/// Primary dashboard — hero balance, quick actions, token list.
@MainActor
struct HomeView: View {

    @EnvironmentObject private var appState: AppState
    @Environment(\.colorScheme) private var colorScheme
    @StateObject private var viewModel = WalletStateViewModel(
        network: NetworkRegistry.ethereumMainnet
    )

    var body: some View {
        let theme = ThemeColors.forScheme(colorScheme)
        NavigationStack {
            ZStack {
                theme.background.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: ThemeSpacing.lg) {
                        heroSection(theme: theme)
                        actionsRow(theme: theme)
                        tokenList(theme: theme)
                    }
                    .padding(.horizontal, ThemeSpacing.lg)
                    .padding(.top, ThemeSpacing.md)
                }
                .refreshable { await refresh() }
            }
            .navigationTitle("Wallet")
            .navigationBarTitleDisplayMode(.inline)
        }
        .task { await refresh() }
    }

    private func heroSection(theme: ThemeColors) -> some View {
        GlassCard(padding: ThemeSpacing.xl) {
            VStack(alignment: .leading, spacing: ThemeSpacing.sm) {
                Text(viewModel.chainName.uppercased())
                    .font(.caption)
                    .foregroundStyle(theme.inkSoft)
                    .tracking(1.2)
                CurrencyText(amount: viewModel.heroBalance)
                    .foregroundStyle(theme.ink)
                Text(appState.currentAccount?.address ?? "No account selected")
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(theme.inkSoft)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
    }

    private func actionsRow(theme: ThemeColors) -> some View {
        HStack(spacing: ThemeSpacing.md) {
            actionButton(title: "Send", icon: "paperplane.fill", theme: theme)
            actionButton(title: "Receive", icon: "qrcode", theme: theme)
            actionButton(title: "Scan", icon: "camera.fill", theme: theme)
            actionButton(title: "Stake", icon: "lock.fill", theme: theme)
        }
    }

    private func actionButton(title: String, icon: String, theme: ThemeColors) -> some View {
        VStack(spacing: ThemeSpacing.xs) {
            RoundedRectangle(cornerRadius: ThemeRadius.button)
                .fill(theme.surfaceElevated)
                .frame(height: 56)
                .overlay {
                    Image(systemName: icon)
                        .foregroundStyle(theme.accent)
                        .font(.system(size: 22))
                }
            Text(title)
                .font(.caption)
                .foregroundStyle(theme.inkSoft)
        }
        .frame(maxWidth: .infinity)
    }

    private func tokenList(theme: ThemeColors) -> some View {
        GlassCard {
            VStack(alignment: .leading, spacing: ThemeSpacing.md) {
                Text("Tokens")
                    .font(.headline)
                    .foregroundStyle(theme.ink)
                ForEach(sampleTokens, id: \.symbol) { token in
                    tokenRow(token: token, theme: theme)
                }
            }
        }
    }

    private func tokenRow(token: SampleToken, theme: ThemeColors) -> some View {
        HStack {
            Circle()
                .fill(theme.surfaceElevated)
                .frame(width: 36, height: 36)
                .overlay {
                    Text(token.symbol.prefix(1))
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(theme.ink)
                }
            VStack(alignment: .leading, spacing: 2) {
                Text(token.name)
                    .foregroundStyle(theme.ink)
                Text(token.symbol)
                    .font(.footnote)
                    .foregroundStyle(theme.inkSoft)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(token.formattedBalance)
                    .foregroundStyle(theme.ink)
                Text(token.formattedUsd)
                    .font(.footnote)
                    .foregroundStyle(theme.inkSoft)
            }
        }
    }

    private func refresh() async {
        guard let account = appState.currentAccount else { return }
        await viewModel.refresh(for: account)
    }
}

/// Static sample data until the token service is wired up.
private struct SampleToken {
    let symbol: String
    let name: String
    let formattedBalance: String
    let formattedUsd: String
}

private let sampleTokens: [SampleToken] = [
    SampleToken(symbol: "ETH", name: "Ether", formattedBalance: "0.4281", formattedUsd: "$1,284.62"),
    SampleToken(symbol: "USDC", name: "USD Coin", formattedBalance: "2,145.21", formattedUsd: "$2,145.21"),
    SampleToken(symbol: "AETH", name: "Aethelred", formattedBalance: "—", formattedUsd: "—")
]
