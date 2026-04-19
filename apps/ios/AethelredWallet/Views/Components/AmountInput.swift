import SwiftUI

/// Numeric amount input with MAX button and USD toggle.
///
/// Primary amount stays in the native asset unit; the USD toggle simply
/// swaps which side of the pair is presented as the hero value. The
/// caller is responsible for the actual FX rate.
///
/// Example:
/// ```swift
/// AmountInput(
///     amount: $amount,
///     symbol: "ETH",
///     usdRate: 1850.0,
///     maxAmount: 0.42
/// )
/// ```
public struct AmountInput: View {

    public enum DisplayMode: Sendable, Equatable {
        case native, fiat
    }

    @Environment(\.themePalette) private var palette
    @Binding private var amount: Decimal
    @State private var mode: DisplayMode = .native
    private let symbol: String
    private let usdRate: Decimal
    private let maxAmount: Decimal?
    private let onMaxTap: (@MainActor () -> Void)?

    public init(
        amount: Binding<Decimal>,
        symbol: String,
        usdRate: Decimal,
        maxAmount: Decimal? = nil,
        onMaxTap: (@MainActor () -> Void)? = nil
    ) {
        self._amount = amount
        self.symbol = symbol
        self.usdRate = usdRate
        self.maxAmount = maxAmount
        self.onMaxTap = onMaxTap
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Spacing.sm) {
            HStack(alignment: .firstTextBaseline, spacing: Spacing.xs) {
                TextField("0.0", value: $amount, format: .number.precision(.fractionLength(0...8)))
                    .keyboardType(.decimalPad)
                    .font(Typography.hero)
                    .foregroundStyle(palette.textPrimary)
                Text(mode == .native ? symbol : "USD")
                    .font(Typography.title3)
                    .foregroundStyle(palette.textSecondary)
            }
            HStack(spacing: Spacing.xs) {
                fxShadow
                Spacer()
                if maxAmount != nil {
                    Button {
                        onMaxTap?()
                        if let maxAmount { amount = maxAmount }
                        Haptics.selection()
                    } label: {
                        Text("MAX")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(palette.accent)
                            .padding(.horizontal, Spacing.xs)
                            .padding(.vertical, 4)
                            .background(palette.accentSoft, in: Capsule(style: .continuous))
                    }
                    .accessibilityLabel("Send maximum")
                }
                Button {
                    mode = mode == .native ? .fiat : .native
                    Haptics.selection()
                } label: {
                    Label(mode == .native ? "Switch to USD" : "Switch to \(symbol)", systemImage: "arrow.2.squarepath")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(palette.textLink)
                }
                .accessibilityLabel("Toggle display currency")
            }
        }
        .padding(Spacing.md)
        .background(palette.surfaceBase, in: RoundedRectangle(cornerRadius: Radii.lg, style: .continuous))
    }

    private var fxShadow: some View {
        let usd = amount * usdRate
        let display: String = {
            if mode == .native {
                return String(format: "≈ $%.2f USD", NSDecimalNumber(decimal: usd).doubleValue)
            } else {
                let inv = amount / max(usdRate, Decimal(1))
                return String(format: "≈ %.6f \(symbol)", NSDecimalNumber(decimal: inv).doubleValue)
            }
        }()
        return Text(display)
            .font(Typography.caption)
            .foregroundStyle(palette.textSecondary)
    }
}
