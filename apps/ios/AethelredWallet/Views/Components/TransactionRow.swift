import SwiftUI

/// Unified transaction row used by Activity, Home recent-activity, and
/// the dApp connection drawer.
///
/// Example:
/// ```swift
/// TransactionRow(
///     model: .init(
///         direction: .outgoing,
///         amount: "-0.125 ETH",
///         counterparty: "0xAB3c…91B",
///         fiatValue: "$312.50",
///         timestamp: "2 min ago",
///         status: .pending
///     )
/// )
/// ```
public struct TransactionRow: View {

    public enum Direction: Sendable, Equatable {
        case incoming, outgoing, contract
    }

    public struct Model: Sendable, Hashable {
        public let direction: Direction
        public let amount: String
        public let counterparty: String
        public let fiatValue: String
        public let timestamp: String
        public let status: StatusBadge.State

        public init(
            direction: Direction,
            amount: String,
            counterparty: String,
            fiatValue: String,
            timestamp: String,
            status: StatusBadge.State
        ) {
            self.direction = direction
            self.amount = amount
            self.counterparty = counterparty
            self.fiatValue = fiatValue
            self.timestamp = timestamp
            self.status = status
        }
    }

    @Environment(\.themePalette) private var palette
    private let model: Model

    public init(model: Model) { self.model = model }

    public var body: some View {
        HStack(spacing: Spacing.sm) {
            directionIcon
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: Spacing.xs) {
                    Text(titleText)
                        .font(Typography.bodyCompact)
                        .foregroundStyle(palette.textPrimary)
                    StatusBadge(state: model.status)
                }
                Text(model.counterparty)
                    .font(Typography.monoCaption)
                    .foregroundStyle(palette.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer(minLength: Spacing.xs)
            VStack(alignment: .trailing, spacing: 2) {
                Text(model.amount)
                    .font(Typography.bodyCompact)
                    .foregroundStyle(palette.textPrimary)
                Text("\(model.fiatValue) • \(model.timestamp)")
                    .font(Typography.caption)
                    .foregroundStyle(palette.textSecondary)
            }
        }
        .padding(.vertical, Spacing.xs)
        .accessibilityElement(children: .combine)
    }

    private var titleText: String {
        switch model.direction {
        case .incoming: return "Received"
        case .outgoing: return "Sent"
        case .contract: return "Contract call"
        }
    }

    private var directionIcon: some View {
        let iconName: String
        let color: Color
        switch model.direction {
        case .incoming:
            iconName = Icons.incoming
            color = palette.success
        case .outgoing:
            iconName = Icons.outgoing
            color = palette.danger
        case .contract:
            iconName = Icons.contract
            color = palette.info
        }
        return Image(systemName: iconName)
            .font(.system(size: 24))
            .foregroundStyle(color)
            .frame(width: 36, height: 36)
            .background(color.opacity(0.12), in: Circle())
    }
}
