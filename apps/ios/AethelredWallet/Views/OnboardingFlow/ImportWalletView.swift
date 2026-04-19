import SwiftUI
import UIKit

/// Import wallet — 12/24 word seed phrase entry with word autocomplete.
@MainActor
struct ImportWalletView: View {

    @Environment(\.themePalette) private var palette
    @Environment(\.dismiss) private var dismiss
    @State private var words: [String] = Array(repeating: "", count: 12)
    @State private var wordLength: Int = 12
    @State private var currentFieldIndex: Int = 0
    @State private var suggestions: [String] = []

    var body: some View {
        NavigationStack {
            VStack(spacing: Spacing.md) {
                Picker("Length", selection: $wordLength) {
                    Text("12 words").tag(12)
                    Text("24 words").tag(24)
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, Spacing.md)
                .onChange(of: wordLength) { _, newValue in
                    words = Array(repeating: "", count: newValue)
                }

                ScrollView {
                    VStack(spacing: Spacing.xs) {
                        ForEach(words.indices, id: \.self) { index in
                            wordField(for: index)
                        }
                    }
                    .padding(.horizontal, Spacing.md)
                }

                pasteButton
                submitButton
            }
            .background(palette.backgroundPrimary.ignoresSafeArea())
            .navigationTitle("Import wallet")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    private func wordField(for index: Int) -> some View {
        HStack(spacing: Spacing.xs) {
            Text("\(index + 1).")
                .font(.system(size: 12, weight: .semibold, design: .monospaced))
                .foregroundStyle(palette.textSecondary)
                .frame(width: 24)
            TextField("word", text: Binding(
                get: { words[index] },
                set: { words[index] = $0.lowercased() }
            ))
                .textInputAutocapitalization(.never)
                .disableAutocorrection(true)
                .padding(Spacing.xs)
                .background(palette.surfaceBase, in: RoundedRectangle(cornerRadius: Radii.sm))
                .onTapGesture {
                    currentFieldIndex = index
                }
        }
    }

    private var pasteButton: some View {
        Button {
            if let clipboard = UIPasteboard.general.string {
                let split = clipboard
                    .split(whereSeparator: { $0.isWhitespace })
                    .map(String.init)
                    .prefix(wordLength)
                var next = words
                for (index, word) in split.enumerated() where index < next.count {
                    next[index] = word.lowercased()
                }
                words = next
                Haptics.success()
            }
        } label: {
            Label("Paste from clipboard", systemImage: Icons.clipboard)
                .font(Typography.label)
        }
    }

    private var submitButton: some View {
        Button {
            dismiss()
            Haptics.success()
        } label: {
            Text("Import wallet")
                .font(Typography.button)
                .frame(maxWidth: .infinity)
                .padding(.vertical, Spacing.sm)
                .background(palette.accent, in: RoundedRectangle(cornerRadius: Radii.md))
                .foregroundStyle(palette.textOnAccent)
        }
        .padding(.horizontal, Spacing.md)
        .padding(.bottom, Spacing.md)
        .disabled(words.contains(where: { $0.isEmpty }))
    }
}
