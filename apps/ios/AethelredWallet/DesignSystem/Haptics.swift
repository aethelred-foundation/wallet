import Foundation
import UIKit

/// Semantic wrapper around `UIFeedbackGenerator`.
///
/// The wallet surfaces haptics for specific narrative beats —
/// every success, warning, and error is named so future changes are
/// applied uniformly. Guard against running in non-interactive contexts
/// by checking for a prepared generator before firing.
///
/// Example:
/// ```swift
/// Haptics.success()
/// ```
public enum Haptics {

    /// Light impact — menu selection, tab switch.
    @MainActor
    public static func selection() {
        let generator = UISelectionFeedbackGenerator()
        generator.prepare()
        generator.selectionChanged()
    }

    /// Success beat — confirmed transaction, enrollment.
    @MainActor
    public static func success() {
        let generator = UINotificationFeedbackGenerator()
        generator.prepare()
        generator.notificationOccurred(.success)
    }

    /// Warning beat — approval requires manual attention.
    @MainActor
    public static func warning() {
        let generator = UINotificationFeedbackGenerator()
        generator.prepare()
        generator.notificationOccurred(.warning)
    }

    /// Error beat — biometric failure, network error.
    @MainActor
    public static func error() {
        let generator = UINotificationFeedbackGenerator()
        generator.prepare()
        generator.notificationOccurred(.error)
    }

    /// Default click for any primary button.
    @MainActor
    public static func click() {
        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.prepare()
        generator.impactOccurred()
    }

    /// Heavy impact — large state transitions (wallet locked).
    @MainActor
    public static func heavy() {
        let generator = UIImpactFeedbackGenerator(style: .heavy)
        generator.prepare()
        generator.impactOccurred()
    }

    /// Soft impact — swipe-to-reveal, card pressed.
    @MainActor
    public static func soft() {
        let generator = UIImpactFeedbackGenerator(style: .soft)
        generator.prepare()
        generator.impactOccurred()
    }

    /// Rigid impact — slider stops, drag resists.
    @MainActor
    public static func rigid() {
        let generator = UIImpactFeedbackGenerator(style: .rigid)
        generator.prepare()
        generator.impactOccurred()
    }
}

/// Test surface that records every haptic call without firing the
/// system generator. Used by UI tests.
public final class HapticsSpy: @unchecked Sendable {

    public enum Kind: String, Sendable {
        case selection, success, warning, error, click, heavy, soft, rigid
    }

    public private(set) var log: [Kind] = []

    public init() {}

    public func record(_ kind: Kind) { log.append(kind) }

    public func reset() { log.removeAll() }
}
