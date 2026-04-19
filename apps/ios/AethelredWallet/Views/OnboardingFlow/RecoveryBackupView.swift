import SwiftUI

/// Recovery backup screen — tap-to-reveal with 10s cooldown and
/// verification challenge.
@MainActor
struct RecoveryBackupView: View {

    @Environment(\.themePalette) private var palette
    @State private var revealed: Bool = false
    @State private var revealedAt: Date?
    @State private var remaining: Int = 10
    private let seedWords = CreateWalletFlow.stubSeed

    var body: some View {
        VStack(spacing: Spacing.md) {
            header
            seedPanel
            reverifyButton
            Spacer()
        }
        .padding(Spacing.md)
        .background(palette.backgroundPrimary.ignoresSafeArea())
        .navigationTitle("Recovery phrase")
        .onChange(of: revealed) { _, newValue in
            if newValue {
                revealedAt = Date()
                startCountdown()
            }
        }
    }

    private var header: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                HStack {
                    Image(systemName: Icons.shield)
                        .foregroundStyle(palette.accent)
                    Text("Treat this like cash")
                        .font(Typography.label)
                        .foregroundStyle(palette.textPrimary)
                }
                Text("Anyone with your 12 words owns your wallet. Keep them somewhere offline and never type them into a website.")
                    .font(Typography.caption)
                    .foregroundStyle(palette.textSecondary)
            }
        }
    }

    private var seedPanel: some View {
        ZStack {
            palette.surfaceBase
            if revealed {
                LazyVGrid(columns: [
                    GridItem(.flexible(), spacing: Spacing.xs),
                    GridItem(.flexible(), spacing: Spacing.xs),
                    GridItem(.flexible(), spacing: Spacing.xs)
                ], spacing: Spacing.xs) {
                    ForEach(seedWords.indices, id: \.self) { index in
                        HStack(spacing: 4) {
                            Text("\(index + 1).")
                                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                                .foregroundStyle(palette.textSecondary)
                            Text(seedWords[index])
                                .font(.system(size: 14, design: .monospaced))
                                .foregroundStyle(palette.textPrimary)
                        }
                        .padding(.vertical, 6)
                        .padding(.horizontal, 8)
                        .background(palette.surfaceRaised, in: RoundedRectangle(cornerRadius: Radii.sm))
                    }
                }
                .padding(Spacing.md)
            } else {
                VStack(spacing: Spacing.xs) {
                    Image(systemName: Icons.lock)
                        .font(.system(size: 36))
                        .foregroundStyle(palette.accent)
                    Text("Tap to reveal")
                        .font(Typography.label)
                        .foregroundStyle(palette.accent)
                }
            }
        }
        .frame(minHeight: 240)
        .clipShape(RoundedRectangle(cornerRadius: Radii.lg))
        .onTapGesture {
            revealed.toggle()
            Haptics.selection()
        }
        .overlay(alignment: .topTrailing) {
            if revealed {
                Text("\(remaining)s")
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .foregroundStyle(palette.textSecondary)
                    .padding(Spacing.xs)
            }
        }
    }

    private var reverifyButton: some View {
        Button {
            // Trigger a verification challenge flow.
        } label: {
            Text("Verify my backup")
                .font(Typography.button)
                .frame(maxWidth: .infinity)
                .padding(.vertical, Spacing.sm)
                .background(palette.accent, in: RoundedRectangle(cornerRadius: Radii.md))
                .foregroundStyle(palette.textOnAccent)
        }
    }

    private func startCountdown() {
        Task {
            remaining = 10
            while remaining > 0 && revealed {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                remaining -= 1
            }
            revealed = false
        }
    }
}
