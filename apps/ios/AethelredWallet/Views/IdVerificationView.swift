import SwiftUI

/// KYC step ladder — clearly communicates progress through the
/// institutional onboarding flow.
@MainActor
struct IdVerificationView: View {

    @Environment(\.themePalette) private var palette
    @State private var currentStep: IdStep = .selfie

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Spacing.md) {
                    hero
                    ForEach(IdStep.allCases, id: \.self) { step in
                        stepRow(step)
                    }
                    ctaButton
                }
                .padding(Spacing.md)
            }
            .background(palette.backgroundPrimary.ignoresSafeArea())
            .navigationTitle("Identity verification")
        }
    }

    private var hero: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text("\(IdStep.allCases.filter { $0.rawValue < currentStep.rawValue }.count) of \(IdStep.allCases.count) steps complete")
                    .font(Typography.label)
                    .foregroundStyle(palette.textPrimary)
                ProgressView(value: progress)
                    .progressViewStyle(.linear)
                    .tint(palette.accent)
                Text("Upload ID, verify liveness, and enroll attestation credentials. Takes about 2 minutes.")
                    .font(Typography.caption)
                    .foregroundStyle(palette.textSecondary)
            }
        }
    }

    private var progress: Double {
        Double(IdStep.allCases.filter { $0.rawValue < currentStep.rawValue }.count) / Double(IdStep.allCases.count)
    }

    private func stepRow(_ step: IdStep) -> some View {
        HStack(spacing: Spacing.sm) {
            Circle()
                .fill(step.rawValue < currentStep.rawValue ? palette.success : (step == currentStep ? palette.accent : palette.surfaceRaised))
                .overlay {
                    if step.rawValue < currentStep.rawValue {
                        Image(systemName: "checkmark")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(palette.textOnAccent)
                    } else {
                        Text("\(step.rawValue + 1)")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(palette.textOnAccent)
                    }
                }
                .frame(width: 24, height: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text(step.title)
                    .font(Typography.bodyCompact)
                    .foregroundStyle(palette.textPrimary)
                Text(step.subtitle)
                    .font(Typography.caption)
                    .foregroundStyle(palette.textSecondary)
            }
            Spacer()
            if step == currentStep {
                Image(systemName: Icons.chevronRight)
                    .foregroundStyle(palette.textSecondary)
            }
        }
        .padding(Spacing.sm)
        .background(palette.surfaceBase, in: RoundedRectangle(cornerRadius: Radii.md))
    }

    private var ctaButton: some View {
        Button {
            advance()
        } label: {
            Text(currentStep.ctaLabel)
                .font(Typography.button)
                .frame(maxWidth: .infinity)
                .padding(.vertical, Spacing.sm)
                .background(palette.accent, in: RoundedRectangle(cornerRadius: Radii.md))
                .foregroundStyle(palette.textOnAccent)
        }
    }

    private func advance() {
        if let next = IdStep(rawValue: currentStep.rawValue + 1) {
            currentStep = next
        }
        Haptics.success()
    }

    enum IdStep: Int, CaseIterable {
        case idCapture = 0, liveness = 1, selfie = 2, enrollment = 3

        var title: String {
            switch self {
            case .idCapture: return "Government ID"
            case .liveness: return "Liveness check"
            case .selfie: return "Selfie"
            case .enrollment: return "Credential enrollment"
            }
        }

        var subtitle: String {
            switch self {
            case .idCapture: return "Capture the front + back of your passport or national ID."
            case .liveness: return "Follow the on-screen prompts — takes 15 seconds."
            case .selfie: return "Match your face against the ID photo."
            case .enrollment: return "Issuer signs your credentials and writes them to the passport."
            }
        }

        var ctaLabel: String {
            switch self {
            case .idCapture: return "Capture ID"
            case .liveness: return "Start liveness"
            case .selfie: return "Take selfie"
            case .enrollment: return "Finish"
            }
        }
    }
}
