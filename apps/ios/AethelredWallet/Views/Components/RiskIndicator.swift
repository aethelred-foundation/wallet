import SwiftUI

/// Risk classification pill surfaced on approvals + token approvals.
///
/// Example:
/// ```swift
/// RiskIndicator(level: .medium, caption: "Spender unknown")
/// ```
public struct RiskIndicator: View {

    public enum Level: Int, Sendable, Comparable {
        case low = 0, medium = 1, high = 2, critical = 3

        public static func < (lhs: Level, rhs: Level) -> Bool { lhs.rawValue < rhs.rawValue }
    }

    @Environment(\.themePalette) private var palette
    private let level: Level
    private let caption: String?

    public init(level: Level, caption: String? = nil) {
        self.level = level
        self.caption = caption
    }

    public var body: some View {
        HStack(spacing: Spacing.xs) {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 0) {
                Text(levelLabel)
                    .font(Typography.label)
                    .foregroundStyle(palette.textPrimary)
                if let caption {
                    Text(caption)
                        .font(Typography.caption)
                        .foregroundStyle(palette.textSecondary)
                }
            }
        }
        .padding(.horizontal, Spacing.xs)
        .padding(.vertical, 6)
        .background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: Radii.sm, style: .continuous))
    }

    private var color: Color {
        switch level {
        case .low: return palette.riskLow
        case .medium: return palette.riskMedium
        case .high, .critical: return palette.riskHigh
        }
    }

    private var levelLabel: String {
        switch level {
        case .low: return "Low risk"
        case .medium: return "Medium risk"
        case .high: return "High risk"
        case .critical: return "Critical"
        }
    }
}
