import CoreImage.CIFilterBuiltins
import SwiftUI
import UIKit

/// QR + copy-to-clipboard affordance for the currently-selected account.
@MainActor
struct ReceiveView: View {

    @EnvironmentObject private var appState: AppState
    @Environment(\.colorScheme) private var colorScheme
    @State private var copiedAt: Date?

    var body: some View {
        let theme = ThemeColors.forScheme(colorScheme)
        NavigationStack {
            ScrollView {
                VStack(spacing: ThemeSpacing.lg) {
                    Text("Scan to receive")
                        .font(.headline)
                        .foregroundStyle(theme.ink)
                    qrImage(theme: theme)
                    addressCard(theme: theme)
                }
                .padding(ThemeSpacing.lg)
            }
            .background(theme.background.ignoresSafeArea())
            .navigationTitle("Receive")
        }
    }

    private func qrImage(theme: ThemeColors) -> some View {
        let address = appState.currentAccount?.address ?? ""
        return Group {
            if let cgImage = Self.generateQR(for: address) {
                Image(decorative: cgImage, scale: 1.0, orientation: .up)
                    .resizable()
                    .interpolation(.none)
                    .scaledToFit()
                    .frame(maxWidth: 260)
                    .padding(ThemeSpacing.lg)
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: ThemeRadius.hero))
            } else {
                RoundedRectangle(cornerRadius: ThemeRadius.hero)
                    .fill(theme.surfaceElevated)
                    .frame(width: 260, height: 260)
                    .overlay {
                        Text("No account")
                            .foregroundStyle(theme.inkSoft)
                    }
            }
        }
    }

    private func addressCard(theme: ThemeColors) -> some View {
        GlassCard {
            VStack(alignment: .leading, spacing: ThemeSpacing.sm) {
                Text("Your address")
                    .font(.caption)
                    .foregroundStyle(theme.inkSoft)
                Text(appState.currentAccount?.address ?? "—")
                    .font(.system(size: 14, design: .monospaced))
                    .foregroundStyle(theme.ink)
                    .textSelection(.enabled)
                Button {
                    if let address = appState.currentAccount?.address {
                        UIPasteboard.general.string = address
                        copiedAt = Date()
                    }
                } label: {
                    Label(copiedAt == nil ? "Copy address" : "Copied!",
                          systemImage: "doc.on.doc.fill")
                        .font(.subheadline)
                }
                .tint(theme.accent)
            }
        }
    }

    /// Generate a QR code CGImage from a plaintext string.
    internal static func generateQR(for string: String) -> CGImage? {
        guard !string.isEmpty else { return nil }
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 10, y: 10))
        let context = CIContext()
        return context.createCGImage(scaled, from: scaled.extent)
    }
}
