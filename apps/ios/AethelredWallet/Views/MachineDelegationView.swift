import SwiftUI

/// Machine delegation — manage autonomous agent sessions.
@MainActor
struct MachineDelegationView: View {

    @Environment(\.themePalette) private var palette
    @State private var sessions: [DelegationSession] = MachineDelegationView.sample

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Spacing.md) {
                    hero
                    ForEach(sessions) { session in
                        sessionCard(session)
                    }
                }
                .padding(Spacing.md)
            }
            .background(palette.backgroundPrimary.ignoresSafeArea())
            .navigationTitle("Machine delegation")
        }
    }

    private var hero: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                HStack {
                    Image(systemName: Icons.machine)
                        .font(.system(size: 24))
                        .foregroundStyle(palette.accent)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Agent sessions")
                            .font(Typography.label)
                            .foregroundStyle(palette.textPrimary)
                        Text("Grant scoped authority to non-human operators. Every action is logged to your audit chain.")
                            .font(Typography.caption)
                            .foregroundStyle(palette.textSecondary)
                    }
                }
            }
        }
    }

    private func sessionCard(_ session: DelegationSession) -> some View {
        GlassCard {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                HStack {
                    Text(session.operatorName)
                        .font(Typography.bodyCompact)
                        .foregroundStyle(palette.textPrimary)
                    Spacer()
                    StatusBadge(state: session.status)
                }
                Text(session.scopeSummary)
                    .font(Typography.caption)
                    .foregroundStyle(palette.textSecondary)
                HStack {
                    InlineAlert(
                        style: session.warnings.isEmpty ? .info : .warning,
                        title: session.warnings.isEmpty ? "Within policy" : "Near cap"
                    )
                    Spacer()
                    Button("Revoke") {}
                        .foregroundStyle(palette.danger)
                }
            }
        }
    }

    struct DelegationSession: Identifiable {
        let id: String
        let operatorName: String
        let scopeSummary: String
        let status: StatusBadge.State
        let warnings: [String]
    }

    static let sample: [DelegationSession] = [
        .init(id: "d-1", operatorName: "Treasury Rebalancer", scopeSummary: "Swap + stablecoin transfers · $100k/day cap", status: .verified, warnings: []),
        .init(id: "d-2", operatorName: "AI Research Analyst", scopeSummary: "Read-only access to Portfolio + Markets", status: .verified, warnings: [])
    ]
}
