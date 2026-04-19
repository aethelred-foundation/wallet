import SwiftUI

/// Motion tokens for timing and easing.
///
/// Kept semantic — screens call `.animation(Motion.standard, value: x)`
/// rather than hand-rolling `.easeInOut(duration: 0.18)` each time.
///
/// Example:
/// ```swift
/// .animation(Motion.pressed, value: isPressed)
/// ```
public enum Motion {
    // MARK: Durations (seconds)

    /// 75ms — nearly instant, used for press states.
    public static let microDuration: Double = 0.075
    /// 150ms — default duration for small UI transitions.
    public static let standardDuration: Double = 0.150
    /// 250ms — used for modals, sheets, hero transitions.
    public static let emphasizedDuration: Double = 0.250
    /// 400ms — long transitions (tab switching with context).
    public static let slowDuration: Double = 0.400

    // MARK: Animations

    /// Default fast ease — buttons, micro states.
    public static let micro: Animation = .easeInOut(duration: microDuration)

    /// Standard ease for transitions that need to feel intentional.
    public static let standard: Animation = .easeInOut(duration: standardDuration)

    /// Press-state spring — snappy, purposeful bounce.
    public static let pressed: Animation = .interactiveSpring(response: 0.25, dampingFraction: 0.85, blendDuration: 0)

    /// Emphasized slide/fade for modals and sheets.
    public static let emphasized: Animation = .spring(response: 0.4, dampingFraction: 0.8)

    /// Bouncy reveal for success / achievement states.
    public static let bouncy: Animation = .spring(response: 0.45, dampingFraction: 0.65)

    /// Slow ease for full-screen transitions.
    public static let slow: Animation = .easeInOut(duration: slowDuration)
}

/// Namespaced transition presets that pair well with ``Motion``.
public enum Transitions {
    /// Gentle slide up from the bottom combined with opacity.
    public static let sheet: AnyTransition = AnyTransition.move(edge: .bottom).combined(with: .opacity)

    /// Cross-fade with slight scale — use for hero → detail navigation.
    public static let hero: AnyTransition = AnyTransition.scale(scale: 0.98).combined(with: .opacity)

    /// Simple opacity.
    public static let fade: AnyTransition = .opacity

    /// Push from trailing edge.
    public static let push: AnyTransition = .move(edge: .trailing)

    /// Skeleton-to-content flip (first appearance).
    public static let loaded: AnyTransition = .opacity.combined(with: .scale(scale: 0.97))
}
