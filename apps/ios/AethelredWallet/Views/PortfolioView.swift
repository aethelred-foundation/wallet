import SwiftUI

/// Portfolio overview — allocation ring, staking positions, DeFi
/// positions.
@MainActor
struct PortfolioView: View {

    @Environment(\.themePalette) private var palette
    @EnvironmentObject private var appState: AppState
    @State private var totalUsd: Double = 18_432.12
    @State private var delta24h: Double = 0.0182

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Spacing.md) {
                    hero
                    allocationRing
                    stakingCard
                    defiCard
                }
                .padding(Spacing.md)
            }
            .background(palette.backgroundPrimary.ignoresSafeArea())
            .navigationTitle("Portfolio")
            .navigationBarTitleDisplayMode(.large)
        }
    }

    private var hero: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text("Total value")
                    .font(Typography.caption)
                    .foregroundStyle(palette.textSecondary)
                HStack(alignment: .firstTextBaseline) {
                    AnimatedNumber(value: totalUsd, prefix: "$", fractionDigits: 2)
                        .font(Typography.hero)
                        .foregroundStyle(palette.textPrimary)
                    deltaChip(delta24h)
                }
                SparklineChart(values: [17820, 18120, 17950, 18220, 18000, 18430, 18432])
                    .frame(height: 40)
            }
        }
    }

    private func deltaChip(_ delta: Double) -> some View {
        let positive = delta >= 0
        return Text("\(positive ? "+" : "")\(String(format: "%.2f", delta * 100))% today")
            .font(Typography.caption)
            .foregroundStyle(positive ? palette.success : palette.danger)
    }

    private var allocationRing: some View {
        GlassCard {
            HStack(spacing: Spacing.md) {
                AllocationRing(slices: [
                    .init(label: "ETH", value: 45, color: palette.accent),
                    .init(label: "USDC", value: 22, color: palette.info),
                    .init(label: "BTC", value: 20, color: palette.warning),
                    .init(label: "Other", value: 13, color: palette.textMuted)
                ], centerText: "100%")
                    .frame(width: 140, height: 140)
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    Text("Allocation")
                        .font(Typography.label)
                        .foregroundStyle(palette.textPrimary)
                    legendRow(symbol: "ETH", percent: 45, color: palette.accent)
                    legendRow(symbol: "USDC", percent: 22, color: palette.info)
                    legendRow(symbol: "BTC", percent: 20, color: palette.warning)
                    legendRow(symbol: "Other", percent: 13, color: palette.textMuted)
                }
            }
        }
    }

    private func legendRow(symbol: String, percent: Double, color: Color) -> some View {
        HStack(spacing: Spacing.xs) {
            Circle().fill(color).frame(width: 10, height: 10)
            Text(symbol).font(Typography.caption).foregroundStyle(palette.textPrimary)
            Spacer(minLength: 0)
            Text("\(Int(percent))%").font(Typography.caption).foregroundStyle(palette.textSecondary)
        }
    }

    private var stakingCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                HStack {
                    Text("Staking")
                        .font(Typography.label)
                        .foregroundStyle(palette.textPrimary)
                    Spacer()
                    Text("APR 4.18%")
                        .font(Typography.caption)
                        .foregroundStyle(palette.success)
                }
                positionRow(name: "Lido ETH", amount: "1.24 stETH", value: "$3,724.15")
                positionRow(name: "Aethelred Validator", amount: "200 AETH", value: "$8.00")
            }
        }
    }

    private var defiCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                HStack {
                    Text("DeFi positions")
                        .font(Typography.label)
                        .foregroundStyle(palette.textPrimary)
                    Spacer()
                    StatusBadge(state: .verified)
                }
                positionRow(name: "Aave USDC supply", amount: "2,140 USDC", value: "$2,140.32")
                positionRow(name: "Uniswap V3 LP", amount: "0.48 ETH/USDC", value: "$742.10")
            }
        }
    }

    private func positionRow(name: String, amount: String, value: String) -> some View {
        HStack {
            VStack(alignment: .leading) {
                Text(name)
                    .font(Typography.bodyCompact)
                    .foregroundStyle(palette.textPrimary)
                Text(amount)
                    .font(Typography.caption)
                    .foregroundStyle(palette.textSecondary)
            }
            Spacer()
            Text(value)
                .font(Typography.bodyCompact)
                .foregroundStyle(palette.textPrimary)
        }
    }
}
