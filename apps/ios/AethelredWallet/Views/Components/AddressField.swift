import SwiftUI
import UIKit

/// Address input field with clipboard paste detection and ENS
/// placeholder resolution.
///
/// Emits a resolved address through a binding so callers don't need to
/// care about ENS name expansion at the call site.
///
/// Example:
/// ```swift
/// AddressField(
///     address: $address,
///     onResolve: { name in await ens.resolve(name) }
/// )
/// ```
public struct AddressField: View {

    @Environment(\.themePalette) private var palette
    @Binding private var address: String
    @State private var showPasteSuggestion = false
    @State private var clipboardPreview: String = ""
    private let placeholder: String
    private let onResolve: (@Sendable (String) async -> String?)?

    public init(
        address: Binding<String>,
        placeholder: String = "Paste address or name.eth",
        onResolve: (@Sendable (String) async -> String?)? = nil
    ) {
        self._address = address
        self.placeholder = placeholder
        self.onResolve = onResolve
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(spacing: Spacing.xs) {
                TextField(placeholder, text: $address)
                    .textInputAutocapitalization(.never)
                    .disableAutocorrection(true)
                    .font(Typography.monoCompact)
                    .foregroundStyle(palette.textPrimary)
                if !address.isEmpty {
                    Button {
                        address = ""
                        Haptics.selection()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(palette.textMuted)
                    }
                    .accessibilityLabel("Clear address")
                }
            }
            .padding(Spacing.sm)
            .background(palette.surfaceRaised, in: RoundedRectangle(cornerRadius: Radii.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Radii.md, style: .continuous)
                    .strokeBorder(palette.borderSubtle, lineWidth: 1)
            )

            if showPasteSuggestion, !clipboardPreview.isEmpty {
                pasteSuggestion
            }
        }
        .task { await detectClipboard() }
        .onChange(of: address) { _, newValue in
            guard newValue.hasSuffix(".eth"), let resolve = onResolve else { return }
            Task {
                if let resolved = await resolve(newValue) {
                    await MainActor.run { address = resolved }
                }
            }
        }
    }

    private var pasteSuggestion: some View {
        Button {
            address = clipboardPreview
            showPasteSuggestion = false
            Haptics.selection()
        } label: {
            HStack(spacing: Spacing.xs) {
                Image(systemName: Icons.copy).foregroundStyle(palette.accent)
                Text("Paste")
                    .font(Typography.label)
                    .foregroundStyle(palette.accent)
                Text(formatPreview(clipboardPreview))
                    .font(Typography.monoCaption)
                    .foregroundStyle(palette.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            .padding(.horizontal, Spacing.sm)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(palette.accentSoft, in: Capsule(style: .continuous))
        }
    }

    private func formatPreview(_ raw: String) -> String {
        guard raw.count > 16 else { return raw }
        let prefix = raw.prefix(6)
        let suffix = raw.suffix(4)
        return "\(prefix)…\(suffix)"
    }

    private func detectClipboard() async {
        guard UIPasteboard.general.hasStrings, let candidate = UIPasteboard.general.string else {
            return
        }
        let trimmed = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
        let looksLikeAddress = trimmed.hasPrefix("0x") && trimmed.count == 42
        let looksLikeEns = trimmed.hasSuffix(".eth")
        if looksLikeAddress || looksLikeEns {
            clipboardPreview = trimmed
            showPasteSuggestion = true
        }
    }
}
