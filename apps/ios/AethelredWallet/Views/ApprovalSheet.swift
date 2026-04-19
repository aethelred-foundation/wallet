import SwiftUI

/// Modal presented when a dApp (or the local wallet UI) raises an
/// intent that requires a user decision. Evaluates the policy engine on
/// appear and surfaces both the computed outcome and the user's manual
/// approve/deny controls.
@MainActor
struct ApprovalSheet: View {

    @StateObject private var viewModel: ApprovalViewModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme

    init(viewModel: ApprovalViewModel) {
        _viewModel = StateObject(wrappedValue: viewModel)
    }

    var body: some View {
        let theme = ThemeColors.forScheme(colorScheme)
        NavigationStack {
            ScrollView {
                VStack(spacing: ThemeSpacing.lg) {
                    summaryCard(theme: theme)
                    evaluationCard(theme: theme)
                    actions(theme: theme)
                }
                .padding(ThemeSpacing.lg)
            }
            .background(theme.background.ignoresSafeArea())
            .navigationTitle(viewModel.summary.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .task { await viewModel.bootstrap() }
    }

    private func summaryCard(theme: ThemeColors) -> some View {
        GlassCard {
            VStack(alignment: .leading, spacing: ThemeSpacing.sm) {
                Text(viewModel.summary.subtitle)
                    .foregroundStyle(theme.ink)
                    .font(.subheadline)
                if let destination = viewModel.summary.destination {
                    row(label: "Destination", value: destination, theme: theme)
                }
                if let amount = viewModel.summary.amount {
                    row(label: "Amount", value: "\(amount) \(viewModel.summary.assetSymbol ?? "")", theme: theme)
                }
            }
        }
    }

    private func evaluationCard(theme: ThemeColors) -> some View {
        GlassCard {
            VStack(alignment: .leading, spacing: ThemeSpacing.sm) {
                Text("Policy evaluation")
                    .font(.headline)
                    .foregroundStyle(theme.ink)
                if let evaluation = viewModel.evaluation {
                    row(label: "Outcome", value: evaluation.outcome.rawValue, theme: theme)
                    row(label: "Rules matched", value: String(evaluation.matchedRules.count), theme: theme)
                    ForEach(evaluation.warnings, id: \.self) { warning in
                        Text(warning)
                            .font(.footnote)
                            .foregroundStyle(theme.warning)
                    }
                } else {
                    ProgressView().tint(theme.accent)
                }
            }
        }
    }

    private func actions(theme: ThemeColors) -> some View {
        HStack(spacing: ThemeSpacing.md) {
            Button(role: .destructive) {
                Task {
                    await viewModel.deny(reason: "user-declined")
                    dismiss()
                }
            } label: {
                Text("Deny")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, ThemeSpacing.sm)
            }
            .buttonStyle(.bordered)
            .tint(theme.danger)

            Button {
                Task {
                    await viewModel.approve()
                    dismiss()
                }
            } label: {
                Text("Approve")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, ThemeSpacing.sm)
            }
            .buttonStyle(.borderedProminent)
            .tint(theme.accent)
        }
    }

    private func row(label: String, value: String, theme: ThemeColors) -> some View {
        HStack(alignment: .top) {
            Text(label)
                .foregroundStyle(theme.inkSoft)
                .frame(width: 120, alignment: .leading)
            Text(value)
                .foregroundStyle(theme.ink)
                .font(.system(size: 14, design: .monospaced))
                .lineLimit(3)
        }
    }
}
