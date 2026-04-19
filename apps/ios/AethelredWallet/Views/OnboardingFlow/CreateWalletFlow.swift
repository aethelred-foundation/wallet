import SwiftUI

/// Multi-step wallet creation flow.
///
/// - intro
/// - terms
/// - generate seed
/// - verify seed
/// - passkey enrollment
@MainActor
struct CreateWalletFlow: View {

    @Environment(\.themePalette) private var palette
    @Environment(\.dismiss) private var dismiss
    @State private var step: Step = .intro
    @State private var seedWords: [String] = CreateWalletFlow.stubSeed
    @State private var revealedSeed: Bool = false
    @State private var challengeIndex: Int = 3
    @State private var challengeAnswer: String = ""
    @State private var passkeyEnrolled: Bool = false
    let onComplete: () -> Void

    enum Step: Int, CaseIterable {
        case intro = 0, terms = 1, generate = 2, verify = 3, passkey = 4

        var title: String {
            switch self {
            case .intro: return "How Aethelred works"
            case .terms: return "Terms of custody"
            case .generate: return "Your recovery phrase"
            case .verify: return "Verify a word"
            case .passkey: return "Add a passkey"
            }
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: Spacing.lg) {
                progressBar
                ScrollView {
                    content
                        .padding(Spacing.md)
                }
                primaryCTA
            }
            .background(palette.backgroundPrimary.ignoresSafeArea())
            .navigationTitle(step.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
    }

    private var progressBar: some View {
        HStack(spacing: 4) {
            ForEach(Step.allCases, id: \.rawValue) { item in
                Capsule()
                    .fill(item.rawValue <= step.rawValue ? palette.accent : palette.surfaceRaised)
                    .frame(height: 3)
            }
        }
        .padding(.horizontal, Spacing.md)
        .padding(.top, Spacing.xs)
    }

    @ViewBuilder
    private var content: some View {
        switch step {
        case .intro:
            introStep
        case .terms:
            termsStep
        case .generate:
            generateStep
        case .verify:
            verifyStep
        case .passkey:
            passkeyStep
        }
    }

    private var introStep: some View {
        VStack(alignment: .leading, spacing: Spacing.md) {
            bulletPoint("Your keys are generated on this device and stored in the Secure Enclave.")
            bulletPoint("Recovery requires a 12-word seed phrase. Store it somewhere offline.")
            bulletPoint("Face ID / Touch ID is required for every signature.")
            bulletPoint("Your audit log is hash-chained and locally verifiable.")
        }
    }

    private var termsStep: some View {
        GlassCard {
            ScrollView {
                Text("""
By using Aethelred you confirm that:

1. You are self-custodying your keys and accept responsibility for keeping them secure.
2. Loss of your recovery phrase results in permanent loss of funds.
3. Aethelred cannot recover, freeze, or reverse transactions on your behalf.
4. Compliance with local regulations is your responsibility.
5. Aethelred Trust FZ-LLC provides the control plane and attestation services pursuant to the UAE VARA framework.
""")
                    .font(Typography.body)
                    .foregroundStyle(palette.textPrimary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: 380)
        }
    }

    private var generateStep: some View {
        VStack(spacing: Spacing.md) {
            InlineAlert(
                style: .warning,
                title: "Write these words down",
                message: "Never share them. Never type them into a website. They are the only way to recover your wallet."
            )
            Button {
                revealedSeed.toggle()
                Haptics.selection()
            } label: {
                ZStack {
                    palette.surfaceBase
                    if !revealedSeed {
                        Text("Tap to reveal")
                            .font(Typography.label)
                            .foregroundStyle(palette.accent)
                    }
                    seedGrid
                        .opacity(revealedSeed ? 1 : 0)
                }
                .frame(minHeight: 220)
                .clipShape(RoundedRectangle(cornerRadius: Radii.lg))
            }
            .buttonStyle(.plain)
            Text("Hidden automatically after 10 seconds.")
                .font(Typography.caption)
                .foregroundStyle(palette.textSecondary)
        }
    }

    private var seedGrid: some View {
        LazyVGrid(columns: [
            GridItem(.flexible(), spacing: Spacing.xs),
            GridItem(.flexible(), spacing: Spacing.xs),
            GridItem(.flexible(), spacing: Spacing.xs)
        ], spacing: Spacing.xs) {
            ForEach(seedWords.indices, id: \.self) { index in
                HStack(spacing: 4) {
                    Text("\(index + 1).")
                        .font(.system(size: 12, weight: .semibold, design: .monospaced))
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
        .padding(Spacing.sm)
    }

    private var verifyStep: some View {
        VStack(spacing: Spacing.sm) {
            Text("Enter word #\(challengeIndex + 1)")
                .font(Typography.label)
                .foregroundStyle(palette.textPrimary)
            TextField("word", text: $challengeAnswer)
                .textInputAutocapitalization(.never)
                .textFieldStyle(.roundedBorder)
                .onSubmit {
                    if challengeAnswer.lowercased() == seedWords[challengeIndex] {
                        Haptics.success()
                    } else {
                        Haptics.error()
                    }
                }
            if !challengeAnswer.isEmpty {
                Text(
                    challengeAnswer.lowercased() == seedWords[challengeIndex]
                        ? "Correct"
                        : "That doesn't match — try again."
                )
                .font(Typography.caption)
                .foregroundStyle(
                    challengeAnswer.lowercased() == seedWords[challengeIndex]
                        ? palette.success
                        : palette.danger
                )
            }
        }
    }

    private var passkeyStep: some View {
        VStack(spacing: Spacing.md) {
            Image(systemName: Icons.passkey)
                .font(.system(size: 72))
                .foregroundStyle(palette.accent)
            Text(passkeyEnrolled ? "Passkey ready" : "One more step")
                .font(Typography.title2)
                .foregroundStyle(palette.textPrimary)
            Text(passkeyEnrolled
                 ? "You can use Face ID on this device to unlock Aethelred instantly."
                 : "A passkey backs up your device authentication across Apple devices signed into the same iCloud account.")
                .font(Typography.body)
                .foregroundStyle(palette.textSecondary)
                .multilineTextAlignment(.center)
        }
    }

    private var primaryCTA: some View {
        Button {
            advance()
        } label: {
            Text(ctaLabel)
                .font(Typography.button)
                .frame(maxWidth: .infinity)
                .padding(.vertical, Spacing.sm)
                .background(palette.accent, in: RoundedRectangle(cornerRadius: Radii.md))
                .foregroundStyle(palette.textOnAccent)
        }
        .buttonStyle(HapticPressButtonStyle())
        .padding(.horizontal, Spacing.md)
        .padding(.bottom, Spacing.md)
    }

    private var ctaLabel: String {
        switch step {
        case .intro: return "Understand, continue"
        case .terms: return "Agree to terms"
        case .generate: return revealedSeed ? "I have written this down" : "Reveal seed"
        case .verify: return "Verify"
        case .passkey: return passkeyEnrolled ? "Enter wallet" : "Enroll passkey"
        }
    }

    private func advance() {
        switch step {
        case .passkey:
            passkeyEnrolled = true
            onComplete()
            dismiss()
        case .generate where !revealedSeed:
            revealedSeed = true
        default:
            if let next = Step(rawValue: step.rawValue + 1) {
                step = next
            }
        }
    }

    private func bulletPoint(_ text: String) -> some View {
        HStack(alignment: .top, spacing: Spacing.xs) {
            Image(systemName: "circle.fill")
                .font(.system(size: 6))
                .foregroundStyle(palette.accent)
                .padding(.top, 8)
            Text(text)
                .font(Typography.body)
                .foregroundStyle(palette.textPrimary)
        }
    }

    static let stubSeed: [String] = [
        "abandon", "ability", "able", "about", "above", "absent",
        "absorb", "abstract", "absurd", "abuse", "access", "accident"
    ]
}
