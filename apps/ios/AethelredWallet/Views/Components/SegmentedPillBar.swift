import SwiftUI

/// Tab-like segmented picker with a sliding underline.
///
/// Declarative — the caller owns the selection binding.
///
/// Example:
/// ```swift
/// SegmentedPillBar(selection: $tab, options: [.all, .incoming, .outgoing])
/// ```
public struct SegmentedPillBar<Option: Hashable & Identifiable>: View {

    @Environment(\.themePalette) private var palette
    @Binding private var selection: Option
    private let options: [Option]
    private let label: (Option) -> String

    public init(
        selection: Binding<Option>,
        options: [Option],
        label: @escaping (Option) -> String
    ) {
        self._selection = selection
        self.options = options
        self.label = label
    }

    public var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            let slot = width / CGFloat(max(1, options.count))
            let selectedIndex = options.firstIndex(of: selection) ?? 0
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(palette.surfaceRaised.opacity(0.6))

                Capsule()
                    .fill(palette.accent)
                    .frame(width: slot - 6, height: 32)
                    .offset(x: CGFloat(selectedIndex) * slot + 3, y: 0)
                    .animation(Motion.pressed, value: selection)

                HStack(spacing: 0) {
                    ForEach(options) { option in
                        Button {
                            selection = option
                            Haptics.selection()
                        } label: {
                            Text(label(option))
                                .font(Typography.label)
                                .foregroundStyle(option == selection ? palette.textOnAccent : palette.textSecondary)
                                .frame(maxWidth: .infinity)
                                .frame(height: 32)
                        }
                    }
                }
            }
        }
        .frame(height: 38)
    }
}
