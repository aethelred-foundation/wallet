import SwiftUI

/// Row describing a token (logo, symbol, name, balance, price, delta).
///
/// Used by ``HomeView``, ``PortfolioView``, ``MarketsView``, and
/// ``TokenSearchSheet``. The layout is agnostic of source so each view
/// can compute its own numbers.
///
/// Example:
/// ```swift
/// TokenRow(token: .init(symbol: "ETH", name: "Ether", balance: "0.4281", usdValue: "$1,284.62", delta24h: 0.0182))
/// ```
public struct TokenRow: View {

    public struct Model: Sendable, Hashable {
        public let symbol: String
        public let name: String
        public let balance: String
        public let usdValue: String
        /// Signed decimal change over 24h (0.025 == +2.5%).
        public let delta24h: Double?
        public let iconName: String?

        public init(
            symbol: String,
            name: String,
            balance: String,
            usdValue: String,
            delta24h: Double? = nil,
            iconName: String? = nil
        ) {
            self.symbol = symbol
            self.name = name
            self.balance = balance
            self.usdValue = usdValue
            self.delta24h = delta24h
            self.iconName = iconName
        }
    }

    @Environment(\.themePalette) private var palette
    private let token: Model

    public init(token: Model) { self.token = token }

    public var body: some View {
        HStack(spacing: Spacing.sm) {
            logo
            VStack(alignment: .leading, spacing: 2) {
                Text(token.symbol)
                    .font(Typography.bodyCompact)
                    .foregroundStyle(palette.textPrimary)
                Text(token.name)
                    .font(Typography.caption)
                    .foregroundStyle(palette.textSecondary)
            }
            Spacer(minLength: Spacing.xs)
            VStack(alignment: .trailing, spacing: 2) {
                Text(token.balance)
                    .font(Typography.bodyCompact)
                    .foregroundStyle(palette.textPrimary)
                HStack(spacing: Spacing.xxs) {
                    Text(token.usdValue)
                        .font(Typography.caption)
                        .foregroundStyle(palette.textSecondary)
                    if let delta = token.delta24h {
                        deltaPill(delta)
                    }
                }
            }
        }
        .padding(.vertical, Spacing.xs)
    }

    private var logo: some View {
        ZStack {
            Circle().fill(palette.surfaceRaised)
            if let iconName = token.iconName {
                Image(systemName: iconName)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(palette.accent)
            } else {
                Text(token.symbol.prefix(1))
                    .font(Typography.caption)
                    .foregroundStyle(palette.textPrimary)
            }
        }
        .frame(width: 36, height: 36)
    }

    private func deltaPill(_ delta: Double) -> some View {
        let positive = delta >= 0
        let color = positive ? palette.success : palette.danger
        let sign = positive ? "+" : "-"
        let magnitude = abs(delta) * 100
        return Text("\(sign)\(String(format: "%.2f", magnitude))%")
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.12), in: Capsule(style: .continuous))
    }
}
