import SwiftUI

/// Bottom sheet for picking a network.
///
/// Organized into segmented groups: EVM / Bitcoin / Solana / Cosmos.
@MainActor
struct NetworkSelectorSheet: View {

    @Environment(\.themePalette) private var palette
    @Binding var selectedChainId: Int
    @State private var segment: Segment = .evm

    enum Segment: String, CaseIterable { case evm, bitcoin, solana, cosmos }

    var body: some View {
        BottomSheet(detents: [.large]) {
            VStack(spacing: Spacing.md) {
                Text("Networks")
                    .font(Typography.title3)
                    .foregroundStyle(palette.textPrimary)
                Picker("Segment", selection: $segment) {
                    ForEach(Segment.allCases, id: \.self) { item in
                        Text(item.rawValue.capitalized).tag(item)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, Spacing.md)
                ScrollView {
                    LazyVGrid(columns: [
                        GridItem(.flexible(), spacing: Spacing.xs),
                        GridItem(.flexible(), spacing: Spacing.xs)
                    ], spacing: Spacing.xs) {
                        ForEach(networksInSegment) { network in
                            networkCard(network)
                        }
                    }
                    .padding(.horizontal, Spacing.md)
                }
            }
            .padding(.bottom, Spacing.md)
        }
    }

    private var networksInSegment: [NetworkDefinition] {
        switch segment {
        case .evm: return NetworkRegistry.mainnets.filter { $0.namespace == .eip155 }
        case .bitcoin: return NetworkRegistry.all.filter { $0.namespace == .bip122 }
        case .solana: return NetworkRegistry.all.filter { $0.namespace == .solana }
        case .cosmos: return []
        }
    }

    private func networkCard(_ network: NetworkDefinition) -> some View {
        Button {
            selectedChainId = network.chainId
            Haptics.selection()
        } label: {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                HStack {
                    Image(systemName: Icons.network)
                        .foregroundStyle(palette.accent)
                    Spacer()
                    if selectedChainId == network.chainId {
                        Image(systemName: "checkmark")
                            .foregroundStyle(palette.success)
                    }
                }
                Text(network.name)
                    .font(Typography.bodyCompact)
                    .foregroundStyle(palette.textPrimary)
                Text("\(network.shortName) · chainId \(network.chainId)")
                    .font(Typography.caption)
                    .foregroundStyle(palette.textSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Spacing.sm)
            .background(palette.surfaceBase, in: RoundedRectangle(cornerRadius: Radii.md))
            .overlay(
                RoundedRectangle(cornerRadius: Radii.md)
                    .strokeBorder(
                        selectedChainId == network.chainId ? palette.accent : palette.borderSubtle,
                        lineWidth: 1
                    )
            )
        }
        .buttonStyle(.plain)
    }
}
