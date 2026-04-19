import SwiftUI

/// Custom bottom tab bar with an active pill underline.
///
/// Preferred over the system `TabView` when the app needs full control
/// over the visual treatment — scaling icons, animating the pill, and
/// respecting the custom design system colors.
///
/// Example:
/// ```swift
/// TabBar(
///     tabs: MainTab.allCases,
///     selection: $selectedTab,
///     icon: { tab in tab.iconName },
///     label: { tab in tab.label }
/// )
/// ```
public struct TabBar<Tab: Hashable & Identifiable>: View {

    @Environment(\.themePalette) private var palette
    @Binding private var selection: Tab
    private let tabs: [Tab]
    private let icon: (Tab) -> String
    private let label: (Tab) -> String

    public init(
        tabs: [Tab],
        selection: Binding<Tab>,
        icon: @escaping (Tab) -> String,
        label: @escaping (Tab) -> String
    ) {
        self.tabs = tabs
        self._selection = selection
        self.icon = icon
        self.label = label
    }

    public var body: some View {
        HStack(alignment: .center, spacing: 0) {
            ForEach(tabs) { tab in
                tabButton(for: tab)
            }
        }
        .padding(.horizontal, Spacing.xs)
        .padding(.top, Spacing.xs)
        .padding(.bottom, InsetScale.tabBarBottom)
        .background(
            palette.backgroundElevated
                .overlay(Rectangle().fill(palette.divider).frame(height: 0.5), alignment: .top)
                .ignoresSafeArea()
        )
    }

    private func tabButton(for tab: Tab) -> some View {
        let isActive = tab == selection
        return Button {
            selection = tab
            Haptics.selection()
        } label: {
            VStack(spacing: 2) {
                Image(systemName: icon(tab))
                    .font(.system(size: 20, weight: isActive ? .bold : .regular))
                    .foregroundStyle(isActive ? palette.accent : palette.textSecondary)
                    .frame(height: 22)
                Text(label(tab))
                    .font(.system(size: 10, weight: isActive ? .semibold : .regular))
                    .foregroundStyle(isActive ? palette.accent : palette.textSecondary)
                Capsule()
                    .fill(isActive ? palette.accent : Color.clear)
                    .frame(width: 18, height: 3)
                    .animation(Motion.pressed, value: isActive)
            }
            .frame(maxWidth: .infinity)
        }
        .accessibilityLabel(Text(label(tab)))
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }
}
