import SwiftUI

/// Generic confirmation sheet with fee breakdown + primary CTA.
@MainActor
struct ConfirmationSheet: View {

    @Environment(\.themePalette) private var palette

    let title: String
    let subtitle: String
    let rows: [ConfirmationRow]
    let feeBreakdown: FeeBreakdown?
    let primaryTitle: String
    let onPrimary: () -> Void
    let onCancel: () -> Void

    var body: some View {
        BottomSheet(detents: [.medium, .large]) {
            VStack(spacing: Spacing.md) {
                VStack(spacing: 4) {
                    Text(title)
                        .font(Typography.title3)
                        .foregroundStyle(palette.textPrimary)
                    Text(subtitle)
                        .font(Typography.caption)
                        .foregroundStyle(palette.textSecondary)
                }
                GlassCard {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        ForEach(rows) { row in
                            HStack(alignment: .top) {
                                Text(row.label)
                                    .font(Typography.caption)
                                    .foregroundStyle(palette.textSecondary)
                                    .frame(width: 110, alignment: .leading)
                                Text(row.value)
                                    .font(Typography.label)
                                    .foregroundStyle(palette.textPrimary)
                                    .lineLimit(2)
                                    .truncationMode(.middle)
                            }
                        }
                    }
                }
                if let fee = feeBreakdown {
                    GlassCard {
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            feeRow(label: "Base fee", value: fee.baseFee)
                            feeRow(label: "Priority fee", value: fee.priorityFee)
                            feeRow(label: "Estimated total", value: fee.totalFee, emphasized: true)
                        }
                    }
                }
                HStack(spacing: Spacing.xs) {
                    Button(role: .cancel) {
                        onCancel()
                    } label: {
                        Text("Cancel")
                            .font(Typography.button)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, Spacing.sm)
                            .background(palette.surfaceBase, in: RoundedRectangle(cornerRadius: Radii.md))
                            .foregroundStyle(palette.textPrimary)
                    }
                    Button {
                        Haptics.success()
                        onPrimary()
                    } label: {
                        Text(primaryTitle)
                            .font(Typography.button)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, Spacing.sm)
                            .background(palette.accent, in: RoundedRectangle(cornerRadius: Radii.md))
                            .foregroundStyle(palette.textOnAccent)
                    }
                }
                .padding(.horizontal, Spacing.md)
            }
            .padding(.horizontal, Spacing.md)
            .padding(.bottom, Spacing.md)
        }
    }

    private func feeRow(label: String, value: String, emphasized: Bool = false) -> some View {
        HStack {
            Text(label)
                .font(Typography.caption)
                .foregroundStyle(palette.textSecondary)
            Spacer()
            Text(value)
                .font(emphasized ? Typography.label : Typography.caption)
                .foregroundStyle(emphasized ? palette.textPrimary : palette.textSecondary)
        }
    }
}

public struct ConfirmationRow: Identifiable, Sendable, Equatable {
    public let id: UUID = UUID()
    public let label: String
    public let value: String

    public init(label: String, value: String) {
        self.label = label
        self.value = value
    }
}

public struct FeeBreakdown: Sendable, Equatable {
    public let baseFee: String
    public let priorityFee: String
    public let totalFee: String

    public init(baseFee: String, priorityFee: String, totalFee: String) {
        self.baseFee = baseFee
        self.priorityFee = priorityFee
        self.totalFee = totalFee
    }
}
