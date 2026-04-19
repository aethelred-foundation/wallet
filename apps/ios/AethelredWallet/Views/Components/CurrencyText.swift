import SwiftUI

/// Split-treatment currency renderer — port of the web extension's
/// `CurrencyText.tsx`.
///
/// The integer portion is rendered in SF Pro Display at the supplied
/// hero size, while the fractional tail is rendered smaller and with
/// reduced opacity so large balances remain glanceable without drawing
/// the eye to sub-dollar precision.
///
/// ### Compact mode
/// Set ``compact`` to collapse very large balances into short forms
/// like `$18.4M` / `$1.2B`. The fractional tail is suppressed in
/// compact mode since the suffix already conveys precision.
public struct CurrencyText: View {

    public let amount: Decimal
    public let currencyCode: String
    public let heroSize: CGFloat
    public let tailSize: CGFloat
    public let compact: Bool

    public init(
        amount: Decimal,
        currencyCode: String = "USD",
        heroSize: CGFloat = 48,
        tailSize: CGFloat = 24,
        compact: Bool = false
    ) {
        self.amount = amount
        self.currencyCode = currencyCode
        self.heroSize = heroSize
        self.tailSize = tailSize
        self.compact = compact
    }

    public var body: some View {
        if compact {
            Text(Self.compact(amount: amount, currencyCode: currencyCode))
                .font(.system(size: heroSize, weight: .bold, design: .default))
        } else {
            let (whole, fractional) = Self.split(amount: amount, currencyCode: currencyCode)
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                Text(whole)
                    .font(.system(size: heroSize, weight: .bold, design: .default))
                Text(fractional)
                    .font(.system(size: tailSize, weight: .medium, design: .default))
                    .opacity(0.7)
                    .baselineOffset(4)
            }
        }
    }

    /// Split a decimal into a localized integer prefix (with currency
    /// symbol) and a fractional tail starting with the decimal
    /// separator.
    internal static func split(
        amount: Decimal,
        currencyCode: String,
        locale: Locale = .current
    ) -> (whole: String, fractional: String) {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .currency
        formatter.currencyCode = currencyCode
        formatter.maximumFractionDigits = 2
        formatter.minimumFractionDigits = 2
        let ns = amount as NSDecimalNumber
        let formatted = formatter.string(from: ns) ?? "\(ns)"
        let separator = locale.decimalSeparator ?? "."
        guard let separatorRange = formatted.range(of: separator) else {
            return (formatted, "")
        }
        let whole = String(formatted[..<separatorRange.lowerBound])
        let tail = String(formatted[separatorRange.lowerBound...])
        return (whole, tail)
    }

    /// Produce a compact currency string like `$18.4M` or `$1.2B`.
    /// The value keeps a single fractional digit for values >= 1K and
    /// respects the supplied currency symbol (first character of the
    /// localized currency format).
    internal static func compact(
        amount: Decimal,
        currencyCode: String,
        locale: Locale = .current
    ) -> String {
        let number = NSDecimalNumber(decimal: amount).doubleValue
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .currency
        formatter.currencyCode = currencyCode
        let symbol = formatter.currencySymbol ?? "$"

        let abs = Swift.abs(number)
        let sign = number < 0 ? "-" : ""
        switch abs {
        case 1_000_000_000...:
            return "\(sign)\(symbol)\(format(abs / 1_000_000_000))B"
        case 1_000_000...:
            return "\(sign)\(symbol)\(format(abs / 1_000_000))M"
        case 10_000...:
            return "\(sign)\(symbol)\(format(abs / 1_000))K"
        default:
            formatter.maximumFractionDigits = 2
            formatter.minimumFractionDigits = 2
            return formatter.string(from: NSNumber(value: number)) ?? "\(sign)\(symbol)\(number)"
        }
    }

    private static func format(_ value: Double) -> String {
        if value >= 100 {
            return String(format: "%.0f", value)
        }
        return String(format: "%.1f", value)
    }
}
