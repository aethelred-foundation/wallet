import SwiftUI

/// Connected sites — list of active WalletConnect sessions with
/// disconnect affordance.
@MainActor
struct ConnectedSitesView: View {

    @Environment(\.themePalette) private var palette
    @State private var sites: [ConnectedSite] = ConnectedSitesView.sample

    var body: some View {
        NavigationStack {
            List {
                if sites.isEmpty {
                    emptySection
                } else {
                    ForEach(sites) { site in
                        siteRow(site)
                            .listRowBackground(palette.surfaceBase)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(palette.backgroundPrimary.ignoresSafeArea())
            .navigationTitle("Connected sites")
            .navigationBarTitleDisplayMode(.large)
        }
    }

    private var emptySection: some View {
        Section {
            EmptyState(
                icon: Icons.walletconnect,
                title: "Nothing connected",
                message: "When you connect to a dApp through WalletConnect, it will show up here."
            )
        }
    }

    private func siteRow(_ site: ConnectedSite) -> some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: Icons.dapp)
                .foregroundStyle(palette.accent)
                .frame(width: 36, height: 36)
                .background(palette.accentSoft, in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(site.name).font(Typography.bodyCompact).foregroundStyle(palette.textPrimary)
                Text(site.origin).font(Typography.monoCaption).foregroundStyle(palette.textSecondary)
                HStack(spacing: Spacing.xxs) {
                    ForEach(site.chainIds, id: \.self) { chainId in
                        Text("#\(chainId)")
                            .font(.system(size: 10, weight: .semibold))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(palette.chainPill, in: Capsule())
                            .foregroundStyle(palette.textSecondary)
                    }
                }
            }
            Spacer()
            Button {
                if let idx = sites.firstIndex(of: site) {
                    sites.remove(at: idx)
                }
                Haptics.warning()
            } label: {
                Image(systemName: Icons.revoked)
                    .foregroundStyle(palette.danger)
            }
            .accessibilityLabel("Disconnect \(site.name)")
        }
        .padding(.vertical, Spacing.xxs)
    }

    struct ConnectedSite: Identifiable, Equatable {
        let id: String
        let name: String
        let origin: String
        let chainIds: [Int]
    }

    static let sample: [ConnectedSite] = [
        .init(id: "1", name: "Uniswap", origin: "app.uniswap.org", chainIds: [1, 137, 42161]),
        .init(id: "2", name: "Aave", origin: "app.aave.com", chainIds: [1]),
        .init(id: "3", name: "ENS", origin: "app.ens.domains", chainIds: [1])
    ]
}
