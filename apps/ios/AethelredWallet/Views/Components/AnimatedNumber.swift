import SwiftUI

/// Count-up number. Animates from a previous value to the new one over
/// the given duration, respecting reduce-motion.
///
/// Example:
/// ```swift
/// AnimatedNumber(value: balance, prefix: "$", fractionDigits: 2)
/// ```
public struct AnimatedNumber: View {

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var displayed: Double = 0
    @State private var lastTarget: Double = 0

    private let value: Double
    private let prefix: String
    private let suffix: String
    private let fractionDigits: Int
    private let duration: Double

    public init(
        value: Double,
        prefix: String = "",
        suffix: String = "",
        fractionDigits: Int = 2,
        duration: Double = 0.6
    ) {
        self.value = value
        self.prefix = prefix
        self.suffix = suffix
        self.fractionDigits = fractionDigits
        self.duration = duration
    }

    public var body: some View {
        Text(format(displayed))
            .contentTransition(.numericText())
            .onAppear {
                if reduceMotion {
                    displayed = value
                } else {
                    animateTo(value)
                }
                lastTarget = value
            }
            .onChange(of: value) { _, newValue in
                if reduceMotion {
                    displayed = newValue
                } else {
                    animateTo(newValue)
                }
                lastTarget = newValue
            }
    }

    private func animateTo(_ target: Double) {
        withAnimation(.easeOut(duration: duration)) {
            displayed = target
        }
    }

    private func format(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        formatter.numberStyle = .decimal
        let formatted = formatter.string(from: NSNumber(value: value)) ?? "0"
        return "\(prefix)\(formatted)\(suffix)"
    }
}
