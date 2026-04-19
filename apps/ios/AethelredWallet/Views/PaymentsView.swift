import SwiftUI

/// Payments dashboard — monthly spend hero (Apple Card-grade overview),
/// treasury allocation and quick actions.
@MainActor
struct PaymentsView: View {

    @Environment(\.themePalette) private var palette

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Spacing.md) {
                    hero
                    quickActions
                    categoryBreakdown
                    upcomingPayouts
                }
                .padding(Spacing.md)
            }
            .background(palette.backgroundPrimary.ignoresSafeArea())
            .navigationTitle("Payments")
            .navigationBarTitleDisplayMode(.large)
        }
    }

    private var hero: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text("APRIL SPEND")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(palette.textSecondary)
                    .tracking(1.4)
                AnimatedNumber(value: 4_821.38, prefix: "$", fractionDigits: 2)
                    .font(Typography.hero)
                    .foregroundStyle(palette.textPrimary)
                ProgressView(value: 0.62)
                    .progressViewStyle(.linear)
                    .tint(palette.accent)
                HStack {
                    Text("$4,821 of $7,800 monthly budget")
                        .font(Typography.caption)
                        .foregroundStyle(palette.textSecondary)
                    Spacer()
                    Text("38% left")
                        .font(Typography.caption)
                        .foregroundStyle(palette.accent)
                }
            }
        }
        .overlay(alignment: .topTrailing) {
            Image(systemName: Icons.payments)
                .font(.system(size: 28))
                .foregroundStyle(palette.accent.opacity(0.3))
                .padding(Spacing.md)
        }
    }

    private var quickActions: some View {
        HStack(spacing: Spacing.xs) {
            ActionTile(icon: Icons.send, label: "Pay") { }
            ActionTile(icon: Icons.receive, label: "Request") { }
            ActionTile(icon: Icons.settle, label: "Settle") { }
            ActionTile(icon: Icons.gas, label: "Top up") { }
        }
    }

    private var categoryBreakdown: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text("Categories")
                    .font(Typography.label)
                    .foregroundStyle(palette.textPrimary)
                categoryRow(icon: "cart.fill", label: "Marketplace", amount: "$1,820.15", share: 0.38)
                categoryRow(icon: "fuelpump.fill", label: "Network gas", amount: "$312.21", share: 0.06)
                categoryRow(icon: "building.2.fill", label: "Payroll", amount: "$2,200.00", share: 0.46)
                categoryRow(icon: "wand.and.stars", label: "DeFi yield", amount: "$489.02", share: 0.10)
            }
        }
    }

    private func categoryRow(icon: String, label: String, amount: String, share: Double) -> some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: icon)
                .foregroundStyle(palette.accent)
                .frame(width: 28, height: 28)
                .background(palette.accentSoft, in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(Typography.bodyCompact)
                    .foregroundStyle(palette.textPrimary)
                ProgressView(value: share)
                    .progressViewStyle(.linear)
                    .tint(palette.accent)
            }
            Spacer()
            Text(amount)
                .font(Typography.label)
                .foregroundStyle(palette.textPrimary)
        }
    }

    private var upcomingPayouts: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text("Upcoming payouts")
                    .font(Typography.label)
                    .foregroundStyle(palette.textPrimary)
                TransactionRow(model: .init(
                    direction: .outgoing,
                    amount: "-500.00 USDC",
                    counterparty: "Payroll · Apr 30",
                    fiatValue: "$500.00",
                    timestamp: "in 11 days",
                    status: .pending
                ))
                TransactionRow(model: .init(
                    direction: .outgoing,
                    amount: "-0.2 ETH",
                    counterparty: "Vendor · SaaS",
                    fiatValue: "$567.00",
                    timestamp: "in 3 days",
                    status: .pending
                ))
            }
        }
    }
}
