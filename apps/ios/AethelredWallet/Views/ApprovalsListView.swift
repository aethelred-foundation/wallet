import SwiftUI

/// Approvals list view — surfaces pending multi-sig approvals.
@MainActor
struct ApprovalsListView: View {

    @Environment(\.themePalette) private var palette
    @State private var approvals: [ApprovalRow] = ApprovalsListView.sample

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Spacing.sm) {
                    if approvals.isEmpty {
                        EmptyState(
                            icon: "checkmark.shield",
                            title: "Queue is clear",
                            message: "Nothing needs your approval right now."
                        )
                    } else {
                        ForEach(approvals) { approval in
                            approvalCard(approval)
                        }
                    }
                }
                .padding(Spacing.md)
            }
            .background(palette.backgroundPrimary.ignoresSafeArea())
            .navigationTitle("Approvals")
            .navigationBarTitleDisplayMode(.large)
        }
    }

    private func approvalCard(_ approval: ApprovalRow) -> some View {
        GlassCard {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                HStack {
                    Text(approval.title)
                        .font(Typography.label)
                        .foregroundStyle(palette.textPrimary)
                    Spacer()
                    StatusBadge(state: approval.status)
                }
                Text(approval.summary)
                    .font(Typography.caption)
                    .foregroundStyle(palette.textSecondary)
                    .lineLimit(3)

                HStack {
                    RiskIndicator(level: approval.risk, caption: approval.riskCaption)
                    Spacer()
                    Text("\(approval.quorumApproved)/\(approval.quorumRequired) approvals")
                        .font(Typography.caption)
                        .foregroundStyle(palette.textSecondary)
                }

                HStack(spacing: Spacing.xs) {
                    ForEach(approval.signers, id: \.self) { initials in
                        Text(initials)
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(palette.textPrimary)
                            .frame(width: 24, height: 24)
                            .background(palette.surfaceRaised, in: Circle())
                    }
                    Spacer()
                    Button("Review") { }
                        .buttonStyle(.borderedProminent)
                        .tint(palette.accent)
                }
            }
        }
    }

    struct ApprovalRow: Identifiable {
        let id: String
        let title: String
        let summary: String
        let status: StatusBadge.State
        let risk: RiskIndicator.Level
        let riskCaption: String
        let quorumApproved: Int
        let quorumRequired: Int
        let signers: [String]
    }

    static let sample: [ApprovalRow] = [
        .init(
            id: "w-1",
            title: "Payout · 500 USDC → Contractor",
            summary: "Recurring invoice · April runway",
            status: .pending,
            risk: .low,
            riskCaption: "Known recipient",
            quorumApproved: 1,
            quorumRequired: 2,
            signers: ["RT", "AJ"]
        ),
        .init(
            id: "w-2",
            title: "Contract call · staking.aethelred.eth",
            summary: "claimRewards() — 42 AETH estimated",
            status: .awaitingQuorum,
            risk: .medium,
            riskCaption: "Contract upgraded yesterday",
            quorumApproved: 2,
            quorumRequired: 3,
            signers: ["RT", "AJ", "MK"]
        )
    ]
}

private extension StatusBadge.State {
    static var awaitingQuorum: StatusBadge.State {
        .custom(label: "Awaiting quorum", tint: Color(red: 1.0, green: 0.72, blue: 0.14))
    }
}
