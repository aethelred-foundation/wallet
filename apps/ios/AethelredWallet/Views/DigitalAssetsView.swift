import SwiftUI

/// Digital assets — NFTs + verifiable credentials, grid style.
@MainActor
struct DigitalAssetsView: View {

    @Environment(\.themePalette) private var palette
    @State private var tab: AssetTab = .nfts

    var body: some View {
        NavigationStack {
            VStack(spacing: Spacing.md) {
                Picker("Tab", selection: $tab) {
                    ForEach(AssetTab.allCases, id: \.self) { item in
                        Text(item.label).tag(item)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, Spacing.md)

                ScrollView {
                    LazyVGrid(columns: [
                        GridItem(.flexible(), spacing: Spacing.sm),
                        GridItem(.flexible(), spacing: Spacing.sm)
                    ], spacing: Spacing.sm) {
                        switch tab {
                        case .nfts:
                            ForEach(Self.nfts, id: \.name) { asset in
                                assetCard(asset)
                            }
                        case .credentials:
                            ForEach(Self.credentials, id: \.name) { asset in
                                assetCard(asset)
                            }
                        }
                    }
                    .padding(Spacing.md)
                }
            }
            .background(palette.backgroundPrimary.ignoresSafeArea())
            .navigationTitle("Digital assets")
        }
    }

    private func assetCard(_ asset: AssetEntry) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            ZStack {
                asset.color.opacity(0.35)
                Image(systemName: asset.icon)
                    .font(.system(size: 32))
                    .foregroundStyle(asset.color)
            }
            .frame(height: 140)
            .clipShape(RoundedRectangle(cornerRadius: Radii.md))
            Text(asset.name)
                .font(Typography.bodyCompact)
                .foregroundStyle(palette.textPrimary)
            Text(asset.subtitle)
                .font(Typography.caption)
                .foregroundStyle(palette.textSecondary)
        }
        .padding(Spacing.sm)
        .background(palette.surfaceBase, in: RoundedRectangle(cornerRadius: Radii.lg))
    }

    struct AssetEntry {
        let name: String
        let subtitle: String
        let icon: String
        let color: Color
    }

    static let nfts: [AssetEntry] = [
        .init(name: "Aethelred Founder", subtitle: "#42/256 · on-chain", icon: "star.fill", color: Color(red: 0.77, green: 0.12, blue: 0.12)),
        .init(name: "Early Operator Tier I", subtitle: "Non-transferable", icon: "crown.fill", color: Color(red: 0.89, green: 0.68, blue: 0.18)),
        .init(name: "ENS nickel.eth", subtitle: "expires 2028", icon: "globe", color: Color(red: 0.24, green: 0.56, blue: 0.88)),
        .init(name: "Ledger Proof", subtitle: "Attestation NFT", icon: "memorychip", color: Color(red: 0.24, green: 0.84, blue: 0.54))
    ]

    static let credentials: [AssetEntry] = [
        .init(name: "KYC tier 3", subtitle: "Aethelred Trust · expires 2027", icon: "person.badge.key", color: Color(red: 0.28, green: 0.65, blue: 0.4)),
        .init(name: "Accredited investor", subtitle: "SEC attested", icon: "building.columns.fill", color: Color(red: 0.38, green: 0.6, blue: 0.88))
    ]

    enum AssetTab: String, CaseIterable {
        case nfts, credentials
        var label: String {
            switch self {
            case .nfts: return "NFTs"
            case .credentials: return "Credentials"
            }
        }
    }
}
