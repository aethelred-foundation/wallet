import SwiftUI

/// Hub — dApp directory / launcher.
@MainActor
struct HubView: View {

    @Environment(\.themePalette) private var palette

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: columns, spacing: Spacing.sm) {
                    ForEach(entries, id: \.title) { entry in
                        hubTile(entry)
                    }
                }
                .padding(Spacing.md)
            }
            .background(palette.backgroundPrimary.ignoresSafeArea())
            .navigationTitle("Hub")
            .navigationBarTitleDisplayMode(.large)
        }
    }

    private let columns: [GridItem] = [
        GridItem(.flexible(), spacing: Spacing.sm),
        GridItem(.flexible(), spacing: Spacing.sm)
    ]

    private func hubTile(_ entry: HubEntry) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Image(systemName: entry.icon)
                .font(.system(size: 24))
                .foregroundStyle(palette.accent)
                .padding(8)
                .background(palette.accentSoft, in: RoundedRectangle(cornerRadius: Radii.sm))
            Text(entry.title)
                .font(Typography.bodyCompact)
                .foregroundStyle(palette.textPrimary)
            Text(entry.subtitle)
                .font(Typography.caption)
                .foregroundStyle(palette.textSecondary)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Spacing.md)
        .background(palette.surfaceBase, in: RoundedRectangle(cornerRadius: Radii.lg))
        .overlay(
            RoundedRectangle(cornerRadius: Radii.lg)
                .strokeBorder(palette.borderSubtle, lineWidth: 1)
        )
    }

    struct HubEntry {
        let icon: String
        let title: String
        let subtitle: String
    }

    private let entries: [HubEntry] = [
        .init(icon: "arrow.2.squarepath", title: "Swap", subtitle: "Execute on-chain trades through the best route."),
        .init(icon: "lock.fill", title: "Stake", subtitle: "Earn validator rewards by staking AETH."),
        .init(icon: "globe", title: "Explorer", subtitle: "Browse blocks, txs, and contracts."),
        .init(icon: "person.badge.key", title: "Identity", subtitle: "Manage credentials and presentations."),
        .init(icon: "building.columns.fill", title: "Treasury", subtitle: "Multi-sig spending controls."),
        .init(icon: "sparkles", title: "Delegations", subtitle: "Manage agentic delegation sessions.")
    ]
}
