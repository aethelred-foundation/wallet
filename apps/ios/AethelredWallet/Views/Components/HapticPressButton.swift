import SwiftUI

/// `ButtonStyle` that scales slightly + fires a haptic when the button
/// is pressed. Ensures every primary CTA behaves consistently.
///
/// Example:
/// ```swift
/// Button("Send") { ... }.buttonStyle(HapticPressButtonStyle())
/// ```
public struct HapticPressButtonStyle: ButtonStyle {

    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        HapticPressContainer(configuration: configuration)
    }
}

private struct HapticPressContainer: View {
    let configuration: ButtonStyle.Configuration
    @State private var lastPressed: Bool = false

    var body: some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(Motion.pressed, value: configuration.isPressed)
            .onChange(of: configuration.isPressed) { _, newValue in
                guard newValue, newValue != lastPressed else {
                    lastPressed = newValue
                    return
                }
                lastPressed = newValue
                Haptics.click()
            }
    }
}
