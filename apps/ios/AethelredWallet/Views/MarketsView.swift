import SwiftUI

/// Markets screen — token list with search, sort, sparklines.
@MainActor
struct MarketsView: View {

    @Environment(\.themePalette) private var palette
    @State private var query: String = ""
    @State private var sort: SortOption = .marketCap

    var body: some View {
        NavigationStack {
            List {
                sortSection
                    .listRowBackground(palette.surfaceBase)
                ForEach(filtered, id: \.symbol) { entry in
                    marketRow(entry)
                        .listRowBackground(palette.surfaceBase)
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(palette.backgroundPrimary.ignoresSafeArea())
            .navigationTitle("Markets")
            .navigationBarTitleDisplayMode(.large)
            .searchable(text: $query, placement: .navigationBarDrawer)
        }
    }

    private var sortSection: some View {
        Picker("Sort", selection: $sort) {
            ForEach(SortOption.allCases, id: \.self) { option in
                Text(option.label).tag(option)
            }
        }
        .pickerStyle(.segmented)
    }

    private var filtered: [MarketEntry] {
        let all = sample.sorted { left, right in
            switch sort {
            case .marketCap: return left.marketCapUsd > right.marketCapUsd
            case .priceChange: return left.changePct > right.changePct
            case .alphabetical: return left.symbol < right.symbol
            }
        }
        guard !query.isEmpty else { return all }
        return all.filter { entry in
            entry.symbol.localizedCaseInsensitiveContains(query)
                || entry.name.localizedCaseInsensitiveContains(query)
        }
    }

    private func marketRow(_ entry: MarketEntry) -> some View {
        HStack(spacing: Spacing.sm) {
            Circle()
                .fill(palette.surfaceRaised)
                .overlay(Text(entry.symbol.prefix(1)).font(Typography.caption).foregroundStyle(palette.textPrimary))
                .frame(width: 32, height: 32)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.symbol)
                    .font(Typography.bodyCompact)
                    .foregroundStyle(palette.textPrimary)
                Text(entry.name)
                    .font(Typography.caption)
                    .foregroundStyle(palette.textSecondary)
            }
            Spacer(minLength: Spacing.xs)
            SparklineChart(values: entry.sparkline)
                .frame(width: 56, height: 24)
            VStack(alignment: .trailing, spacing: 2) {
                Text("$\(entry.priceUsd, specifier: entry.priceUsd < 1 ? "%.4f" : "%.2f")")
                    .font(Typography.bodyCompact)
                    .foregroundStyle(palette.textPrimary)
                Text("\(entry.changePct >= 0 ? "+" : "")\(String(format: "%.2f", entry.changePct))%")
                    .font(Typography.caption)
                    .foregroundStyle(entry.changePct >= 0 ? palette.success : palette.danger)
            }
        }
        .padding(.vertical, Spacing.xxs)
    }

    private let sample: [MarketEntry] = [
        .init(symbol: "ETH", name: "Ethereum", priceUsd: 2_854.22, changePct: 2.15, marketCapUsd: 343_123_000_000, sparkline: [2800, 2810, 2802, 2840, 2830, 2855, 2854]),
        .init(symbol: "BTC", name: "Bitcoin", priceUsd: 62_430.12, changePct: 1.82, marketCapUsd: 1_220_000_000_000, sparkline: [61900, 62100, 62050, 62250, 62500, 62310, 62430]),
        .init(symbol: "SOL", name: "Solana", priceUsd: 162.30, changePct: -0.42, marketCapUsd: 75_000_000_000, sparkline: [162, 161, 163, 162, 164, 163, 162]),
        .init(symbol: "USDC", name: "USD Coin", priceUsd: 1.00, changePct: 0.01, marketCapUsd: 34_000_000_000, sparkline: [1, 1, 1, 1, 1, 1, 1]),
        .init(symbol: "AAVE", name: "Aave", priceUsd: 94.72, changePct: 3.41, marketCapUsd: 1_320_000_000, sparkline: [92, 93, 91, 92, 93, 94, 94]),
        .init(symbol: "LINK", name: "Chainlink", priceUsd: 14.22, changePct: -1.2, marketCapUsd: 8_300_000_000, sparkline: [14.5, 14.4, 14.3, 14.2, 14.1, 14.2, 14.22])
    ]
}

struct MarketEntry: Sendable, Hashable {
    let symbol: String
    let name: String
    let priceUsd: Double
    let changePct: Double
    let marketCapUsd: Double
    let sparkline: [Double]
}

enum SortOption: String, CaseIterable {
    case marketCap, priceChange, alphabetical

    var label: String {
        switch self {
        case .marketCap: return "Cap"
        case .priceChange: return "Change"
        case .alphabetical: return "A–Z"
        }
    }
}
