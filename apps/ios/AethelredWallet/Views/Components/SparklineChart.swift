import SwiftUI

/// Inline sparkline (single-series line chart with optional gradient
/// fill). Uses `Path` + `GeometryReader` so we don't require Swift
/// Charts — keeps compatibility on iOS 17 while remaining lightweight.
///
/// Example:
/// ```swift
/// SparklineChart(values: [100, 101, 99, 102, 104, 103, 106], gain: true)
///     .frame(width: 60, height: 24)
/// ```
public struct SparklineChart: View {

    @Environment(\.themePalette) private var palette
    private let values: [Double]
    private let gain: Bool
    private let lineWidth: CGFloat

    public init(values: [Double], gain: Bool? = nil, lineWidth: CGFloat = 1.4) {
        self.values = values
        if let gain {
            self.gain = gain
        } else if values.count >= 2, let first = values.first, let last = values.last {
            self.gain = last >= first
        } else {
            self.gain = true
        }
        self.lineWidth = lineWidth
    }

    public var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            let normalized = normalize(values)
            let line = pathFor(points: normalized, in: size)
            let area = areaFor(points: normalized, in: size)
            let color = gain ? palette.success : palette.danger
            ZStack {
                area.fill(
                    LinearGradient(
                        colors: [color.opacity(0.28), color.opacity(0.0)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                line.stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round, lineJoin: .round))
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text(gain ? "Price trending up" : "Price trending down"))
    }

    // MARK: Path builders

    private func normalize(_ input: [Double]) -> [Double] {
        guard let min = input.min(), let max = input.max(), max > min else {
            return input.map { _ in 0.5 }
        }
        return input.map { ($0 - min) / (max - min) }
    }

    private func pathFor(points: [Double], in size: CGSize) -> Path {
        guard !points.isEmpty else { return Path() }
        let stepX = size.width / CGFloat(max(1, points.count - 1))
        var path = Path()
        for index in points.indices {
            let x = CGFloat(index) * stepX
            let y = size.height - (CGFloat(points[index]) * size.height)
            if index == 0 {
                path.move(to: CGPoint(x: x, y: y))
            } else {
                path.addLine(to: CGPoint(x: x, y: y))
            }
        }
        return path
    }

    private func areaFor(points: [Double], in size: CGSize) -> Path {
        guard !points.isEmpty else { return Path() }
        let stepX = size.width / CGFloat(max(1, points.count - 1))
        var path = Path()
        path.move(to: CGPoint(x: 0, y: size.height))
        for index in points.indices {
            let x = CGFloat(index) * stepX
            let y = size.height - (CGFloat(points[index]) * size.height)
            path.addLine(to: CGPoint(x: x, y: y))
        }
        path.addLine(to: CGPoint(x: size.width, y: size.height))
        path.closeSubpath()
        return path
    }
}
