import SwiftUI

/// Donut chart used by the Portfolio view to render allocation by
/// category.
///
/// Segments are normalized to their total — the caller doesn't need to
/// normalize ahead of time.
///
/// Example:
/// ```swift
/// AllocationRing(slices: [
///     .init(label: "ETH", value: 45, color: .orange),
///     .init(label: "USDC", value: 30, color: .green)
/// ])
/// ```
public struct AllocationRing: View {

    public struct Slice: Sendable, Identifiable, Hashable {
        public let id: UUID
        public let label: String
        public let value: Double
        public let color: Color

        public init(id: UUID = UUID(), label: String, value: Double, color: Color) {
            self.id = id
            self.label = label
            self.value = value
            self.color = color
        }
    }

    @Environment(\.themePalette) private var palette
    private let slices: [Slice]
    private let thickness: CGFloat
    private let centerText: String?

    public init(slices: [Slice], thickness: CGFloat = 22, centerText: String? = nil) {
        self.slices = slices
        self.thickness = thickness
        self.centerText = centerText
    }

    public var body: some View {
        let total = slices.reduce(0) { $0 + max(0, $1.value) }
        return ZStack {
            if total == 0 {
                Circle()
                    .stroke(palette.surfaceRaised, style: StrokeStyle(lineWidth: thickness, lineCap: .round))
            } else {
                arcs(total: total)
            }
            if let text = centerText {
                VStack {
                    Text(text)
                        .font(Typography.title2)
                        .foregroundStyle(palette.textPrimary)
                    Text("allocation")
                        .font(Typography.caption)
                        .foregroundStyle(palette.textSecondary)
                }
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text("Portfolio allocation ring"))
    }

    private func arcs(total: Double) -> some View {
        var running: Double = 0
        return ZStack {
            ForEach(slices) { slice in
                let start = running / total
                running += max(0, slice.value)
                let end = running / total
                AllocationArc(start: start, end: end)
                    .stroke(slice.color, style: StrokeStyle(lineWidth: thickness, lineCap: .butt))
            }
        }
    }
}

/// Arc shape used by ``AllocationRing`` — start/end expressed as
/// fractions of the full circle.
public struct AllocationArc: Shape {
    public let start: Double
    public let end: Double

    public init(start: Double, end: Double) {
        self.start = start
        self.end = end
    }

    public func path(in rect: CGRect) -> Path {
        var path = Path()
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let radius = min(rect.width, rect.height) / 2 - 2
        let startAngle = Angle(degrees: 360 * start - 90)
        let endAngle = Angle(degrees: 360 * end - 90)
        path.addArc(center: center, radius: radius, startAngle: startAngle, endAngle: endAngle, clockwise: false)
        return path
    }
}
