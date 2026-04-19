import SwiftUI

/// Activity (transaction history) screen. Supports filtering by type
/// and pull-to-refresh.
@MainActor
struct ActivityView: View {

    @Environment(\.themePalette) private var palette
    @EnvironmentObject private var appState: AppState
    @State private var filter: ActivityFilter = .all
    @State private var transactions: [TransactionRow.Model] = ActivityView.sampleTransactions
    @State private var isLoading: Bool = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                filterBar
                    .padding(Spacing.md)
                contentArea
            }
            .background(palette.backgroundPrimary.ignoresSafeArea())
            .navigationTitle("Activity")
            .navigationBarTitleDisplayMode(.large)
            .refreshable { await reload() }
        }
    }

    private var filterBar: some View {
        SegmentedPillBar(
            selection: $filter,
            options: ActivityFilter.allCases,
            label: { $0.label }
        )
    }

    @ViewBuilder
    private var contentArea: some View {
        if isLoading {
            VStack(spacing: Spacing.sm) {
                ForEach(0..<6, id: \.self) { _ in
                    Skeleton().frame(height: 56)
                }
            }
            .padding(Spacing.md)
        } else if filtered.isEmpty {
            EmptyState(
                icon: "tray",
                title: "No activity yet",
                message: "Your transactions will appear here after your first send or receive."
            )
            Spacer()
        } else {
            List(filtered.indices, id: \.self) { index in
                TransactionRow(model: filtered[index])
                    .listRowBackground(palette.backgroundPrimary)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
        }
    }

    private var filtered: [TransactionRow.Model] {
        switch filter {
        case .all:
            return transactions
        case .incoming:
            return transactions.filter { $0.direction == .incoming }
        case .outgoing:
            return transactions.filter { $0.direction == .outgoing }
        case .pending:
            return transactions.filter { $0.status == .pending }
        case .failed:
            return transactions.filter { $0.status == .failed }
        }
    }

    private func reload() async {
        isLoading = true
        defer { isLoading = false }
        try? await Task.sleep(nanoseconds: 600_000_000)
        transactions = Self.sampleTransactions
    }

    private static let sampleTransactions: [TransactionRow.Model] = [
        .init(direction: .outgoing, amount: "-0.4500 ETH", counterparty: "0x3A…89b7", fiatValue: "$1,353.14", timestamp: "2 min", status: .pending),
        .init(direction: .incoming, amount: "+125.00 USDC", counterparty: "0x7c…4df2", fiatValue: "$125.00", timestamp: "1 h", status: .success),
        .init(direction: .contract, amount: "—", counterparty: "Uniswap V3 Router", fiatValue: "$0.08 gas", timestamp: "3 h", status: .success),
        .init(direction: .outgoing, amount: "-0.015 ETH", counterparty: "0xa1…12ff", fiatValue: "$45.10", timestamp: "yesterday", status: .failed)
    ]
}

enum ActivityFilter: String, CaseIterable, Identifiable {
    case all, incoming, outgoing, pending, failed

    var id: String { rawValue }
    var label: String {
        switch self {
        case .all: return "All"
        case .incoming: return "In"
        case .outgoing: return "Out"
        case .pending: return "Pending"
        case .failed: return "Failed"
        }
    }
}
