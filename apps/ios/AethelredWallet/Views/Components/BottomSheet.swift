import SwiftUI

/// SwiftUI native sheet with pre-configured detents, drag handle, and
/// rounded chrome. Wrap any view with ``BottomSheet`` to present it in
/// the idiomatic wallet style.
///
/// Example:
/// ```swift
/// .sheet(isPresented: $showDetails) {
///     BottomSheet { DetailsView() }
/// }
/// ```
public struct BottomSheet<Content: View>: View {

    @Environment(\.themePalette) private var palette
    @Environment(\.dismiss) private var dismiss
    private let detents: Set<PresentationDetent>
    private let content: Content

    public init(
        detents: Set<PresentationDetent> = [.medium, .large],
        @ViewBuilder content: () -> Content
    ) {
        self.detents = detents
        self.content = content()
    }

    public var body: some View {
        VStack(spacing: 0) {
            handle
            content
        }
        .background(palette.backgroundElevated)
        .clipShape(
            .rect(
                topLeadingRadius: Radii.xxl,
                topTrailingRadius: Radii.xxl
            )
        )
        .presentationDetents(detents)
        .presentationDragIndicator(.hidden)
    }

    private var handle: some View {
        RoundedRectangle(cornerRadius: 3)
            .fill(palette.textMuted.opacity(0.5))
            .frame(width: 36, height: 5)
            .padding(.top, 8)
            .padding(.bottom, Spacing.xs)
    }
}
