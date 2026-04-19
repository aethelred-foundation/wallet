import SwiftUI
import WidgetKit

/// Balance widget view. Small / medium variants share the same
/// hierarchy; the medium variant adds the sparkline.
public struct BalanceWidgetView: View {

    public let entry: BalanceWidgetEntry
    @Environment(\.widgetFamily) private var family

    public init(entry: BalanceWidgetEntry) {
        self.entry = entry
    }

    public var body: some View {
        switch family {
        case .systemSmall:
            small
        case .systemMedium:
            medium
        default:
            small
        }
    }

    private var small: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(entry.accountLabel.uppercased())
                .font(.system(size: 10, weight: .semibold))
                .tracking(1)
                .foregroundStyle(.white.opacity(0.6))
            Text(formatUsd(entry.totalUsd))
                .font(.system(size: 24, weight: .bold))
                .foregroundStyle(.white)
            deltaPill
            Spacer()
            Text("Tap for details")
                .font(.system(size: 10))
                .foregroundStyle(.white.opacity(0.4))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    private var medium: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(entry.accountLabel.uppercased())
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(1)
                    .foregroundStyle(.white.opacity(0.6))
                Text(formatUsd(entry.totalUsd))
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(.white)
                deltaPill
                Spacer()
                Text(entry.date.formatted(.dateTime.hour().minute()))
                    .font(.system(size: 10))
                    .foregroundStyle(.white.opacity(0.4))
            }
            Spacer()
            SmallSparkline(values: sparklineValues)
                .frame(width: 100, height: 44)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    private var sparklineValues: [Double] {
        // Fake sparkline placeholder — real widget reads historical USD
        // totals from the shared App Group cache.
        [100, 101, 99, 102, 104, 103, 106]
    }

    private var deltaPill: some View {
        let positive = entry.deltaPct24h >= 0
        let color: Color = positive ? Color(red: 0.20, green: 0.76, blue: 0.35) : Color(red: 0.96, green: 0.26, blue: 0.21)
        return Text("\(positive ? "+" : "")\(String(format: "%.2f", entry.deltaPct24h * 100))%")
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(color)
    }

    private func formatUsd(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = "USD"
        formatter.maximumFractionDigits = 2
        return formatter.string(from: NSNumber(value: value)) ?? "$\(value)"
    }
}

/// Tiny sparkline path for the widget. Intentionally self-contained so
/// the widget bundle does not depend on the app target.
private struct SmallSparkline: View {
    let values: [Double]

    var body: some View {
        GeometryReader { proxy in
            Path { path in
                guard values.count >= 2, let minVal = values.min(), let maxVal = values.max(), maxVal > minVal else { return }
                let stepX = proxy.size.width / CGFloat(values.count - 1)
                for index in values.indices {
                    let normalized = (values[index] - minVal) / (maxVal - minVal)
                    let point = CGPoint(
                        x: CGFloat(index) * stepX,
                        y: proxy.size.height - CGFloat(normalized) * proxy.size.height
                    )
                    if index == 0 {
                        path.move(to: point)
                    } else {
                        path.addLine(to: point)
                    }
                }
            }
            .stroke(Color.white, style: StrokeStyle(lineWidth: 1.4, lineCap: .round))
        }
    }
}
