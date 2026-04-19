import SwiftUI

/// ERC-20 token approvals — surfaces open allowances with a revoke
/// affordance.
@MainActor
struct TokenApprovalsView: View {

    @Environment(\.themePalette) private var palette
    @State private var allowances: [Allowance] = TokenApprovalsView.sample

    var body: some View {
        NavigationStack {
            List {
                if allowances.isEmpty {
                    Section {
                        EmptyState(
                            icon: "checkmark.shield",
                            title: "No open allowances",
                            message: "You haven't granted any token approvals recently."
                        )
                    }
                } else {
                    ForEach(allowances) { allowance in
                        allowanceRow(allowance)
                            .listRowBackground(palette.surfaceBase)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(palette.backgroundPrimary.ignoresSafeArea())
            .navigationTitle("Token approvals")
            .navigationBarTitleDisplayMode(.large)
        }
    }

    private func allowanceRow(_ allowance: Allowance) -> some View {
        HStack(spacing: Spacing.sm) {
            Image(systemName: Icons.approve)
                .foregroundStyle(palette.accent)
                .frame(width: 36, height: 36)
                .background(palette.accentSoft, in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(allowance.spender)
                    .font(Typography.bodyCompact)
                    .foregroundStyle(palette.textPrimary)
                Text("\(allowance.token) · \(allowance.allowanceDisplay)")
                    .font(Typography.caption)
                    .foregroundStyle(palette.textSecondary)
                RiskIndicator(level: allowance.risk, caption: allowance.riskCaption)
            }
            Spacer()
            Button {
                if let idx = allowances.firstIndex(of: allowance) {
                    allowances.remove(at: idx)
                }
                Haptics.warning()
            } label: {
                Text("Revoke")
                    .font(Typography.caption)
                    .foregroundStyle(palette.danger)
                    .padding(.horizontal, Spacing.xs)
                    .padding(.vertical, 4)
                    .background(palette.dangerSoft, in: Capsule())
            }
            .accessibilityLabel("Revoke allowance for \(allowance.spender)")
        }
        .padding(.vertical, Spacing.xxs)
    }

    struct Allowance: Identifiable, Equatable {
        let id: String
        let token: String
        let spender: String
        let allowanceDisplay: String
        let risk: RiskIndicator.Level
        let riskCaption: String
    }

    static let sample: [Allowance] = [
        .init(id: "1", token: "USDC", spender: "Uniswap V3 Router", allowanceDisplay: "Unlimited", risk: .medium, riskCaption: "Unlimited approval"),
        .init(id: "2", token: "DAI", spender: "Aave Pool", allowanceDisplay: "5,000", risk: .low, riskCaption: "Bounded"),
        .init(id: "3", token: "WETH", spender: "Unknown 0x01…ab", allowanceDisplay: "Unlimited", risk: .high, riskCaption: "Unverified contract")
    ]
}
