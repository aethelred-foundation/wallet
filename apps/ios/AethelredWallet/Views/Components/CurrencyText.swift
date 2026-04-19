import SwiftUI

/// Split-treatment currency renderer — port of the web extension's
/// `CurrencyText.tsx`.
///
/// The integer portion is rendered in SF Pro Display at the supplied
/// hero size, while the fractional tail is rendered smaller and with
/// reduced opacity so large balances remain glanceable without drawing
/// the eye to sub-dollar precision.
public struct CurrencyText: View {

    public let amount: Decimal
    public let currencyCode: String
    public let heroSize: CGFloat
    public let tailSize: CGFloat

    public init(
        amount: Decimal,
        currencyCode: String = "USD",
        heroSize: CGFloat = 48,
        tailSize: CGFloat = 24
    ) {
        self.amount = amount
        self.currencyCode = currencyCode
        self.heroSize = heroSize
        self.tailSize = tailSize
    }

    public var body: some View {
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
}
