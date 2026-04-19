import SwiftUI

/// Shimmer placeholder for loading content. Respects
/// `@Environment(\.accessibilityReduceMotion)` and disables the sweep
/// animation when the user prefers reduced motion.
///
/// Example:
/// ```swift
/// Skeleton().frame(height: 20)
/// ```
public struct Skeleton: View {

    @Environment(\.themePalette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase: CGFloat = -1.0
    private let cornerRadius: CGFloat

    public init(cornerRadius: CGFloat = Radii.sm) {
        self.cornerRadius = cornerRadius
    }

    public var body: some View {
        GeometryReader { proxy in
            ZStack {
                palette.skeletonBase
                LinearGradient(
                    gradient: Gradient(colors: [
                        .clear,
                        palette.skeletonHighlight,
                        .clear
                    ]),
                    startPoint: .leading,
                    endPoint: .trailing
                )
                .frame(width: proxy.size.width * 0.5)
                .offset(x: phase * proxy.size.width)
            }
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .onAppear {
                if reduceMotion { return }
                withAnimation(Animation.linear(duration: 1.2).repeatForever(autoreverses: false)) {
                    phase = 1.3
                }
            }
        }
        .accessibilityHidden(true)
    }
}
