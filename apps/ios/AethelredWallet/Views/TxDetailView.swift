import SwiftUI

/// Transaction detail screen — surfaces everything we have about a tx.
@MainActor
struct TxDetailView: View {

    @Environment(\.themePalette) private var palette
    let transaction: TxDetailDescriptor

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.md) {
                hero
                GlassCard {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        row("Hash", transaction.hash, mono: true)
                        row("Block", transaction.blockNumber.map(String.init) ?? "Pending")
                        row("Confirmations", String(transaction.confirmations))
                        row("Timestamp", transaction.timestamp)
                    }
                }
                GlassCard {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text("Gas")
                            .font(Typography.label)
                            .foregroundStyle(palette.textPrimary)
                        row("Gas limit", transaction.gasLimit)
                        row("Gas used", transaction.gasUsed)
                        row("Base fee", transaction.baseFee)
                        row("Priority fee", transaction.priorityFee)
                        row("Total fee", transaction.totalFee)
                    }
                }
                if !transaction.calldata.isEmpty {
                    GlassCard {
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            Text("Calldata")
                                .font(Typography.label)
                                .foregroundStyle(palette.textPrimary)
                            Text(transaction.calldata)
                                .font(Typography.monoCaption)
                                .foregroundStyle(palette.textSecondary)
                                .textSelection(.enabled)
                                .lineLimit(8)
                        }
                    }
                }
                Link(destination: URL(string: transaction.explorerUrl) ?? URL(fileURLWithPath: "/")) {
                    HStack {
                        Image(systemName: Icons.explorer)
                        Text("View on explorer")
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, Spacing.sm)
                    .background(palette.accent, in: RoundedRectangle(cornerRadius: Radii.md))
                    .foregroundStyle(palette.textOnAccent)
                }
            }
            .padding(Spacing.md)
        }
        .background(palette.backgroundPrimary.ignoresSafeArea())
        .navigationTitle("Transaction")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var hero: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                HStack {
                    Image(systemName: directionIcon)
                        .font(.system(size: 28))
                        .foregroundStyle(directionColor)
                    VStack(alignment: .leading) {
                        Text(transaction.amountDisplay)
                            .font(Typography.title)
                            .foregroundStyle(palette.textPrimary)
                        Text(transaction.fiatValue)
                            .font(Typography.label)
                            .foregroundStyle(palette.textSecondary)
                    }
                    Spacer()
                    StatusBadge(state: transaction.status)
                }
                row("From", transaction.from, mono: true)
                row("To", transaction.to, mono: true)
            }
        }
    }

    private var directionIcon: String {
        switch transaction.direction {
        case .incoming: return Icons.incoming
        case .outgoing: return Icons.outgoing
        case .contract: return Icons.contract
        }
    }

    private var directionColor: Color {
        switch transaction.direction {
        case .incoming: return palette.success
        case .outgoing: return palette.danger
        case .contract: return palette.info
        }
    }

    private func row(_ label: String, _ value: String, mono: Bool = false) -> some View {
        HStack(alignment: .top) {
            Text(label)
                .font(Typography.caption)
                .foregroundStyle(palette.textSecondary)
                .frame(width: 90, alignment: .leading)
            Text(value)
                .font(mono ? Typography.monoCaption : Typography.label)
                .foregroundStyle(palette.textPrimary)
                .lineLimit(3)
                .truncationMode(.middle)
        }
    }
}

/// Descriptor used by the detail view (pure data so previews are easy).
public struct TxDetailDescriptor: Sendable, Equatable {
    public let hash: String
    public let direction: TransactionRow.Direction
    public let status: StatusBadge.State
    public let from: String
    public let to: String
    public let amountDisplay: String
    public let fiatValue: String
    public let blockNumber: Int64?
    public let confirmations: Int
    public let timestamp: String
    public let gasLimit: String
    public let gasUsed: String
    public let baseFee: String
    public let priorityFee: String
    public let totalFee: String
    public let calldata: String
    public let explorerUrl: String

    public init(
        hash: String,
        direction: TransactionRow.Direction,
        status: StatusBadge.State,
        from: String,
        to: String,
        amountDisplay: String,
        fiatValue: String,
        blockNumber: Int64?,
        confirmations: Int,
        timestamp: String,
        gasLimit: String,
        gasUsed: String,
        baseFee: String,
        priorityFee: String,
        totalFee: String,
        calldata: String,
        explorerUrl: String
    ) {
        self.hash = hash
        self.direction = direction
        self.status = status
        self.from = from
        self.to = to
        self.amountDisplay = amountDisplay
        self.fiatValue = fiatValue
        self.blockNumber = blockNumber
        self.confirmations = confirmations
        self.timestamp = timestamp
        self.gasLimit = gasLimit
        self.gasUsed = gasUsed
        self.baseFee = baseFee
        self.priorityFee = priorityFee
        self.totalFee = totalFee
        self.calldata = calldata
        self.explorerUrl = explorerUrl
    }
}
