import SwiftUI

/// Regulatory passport — list of verifiable credentials + KYC status.
@MainActor
struct RegulatoryPassportView: View {

    @Environment(\.themePalette) private var palette
    @State private var credentials: [CredentialEntry] = RegulatoryPassportView.sample

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Spacing.md) {
                    hero
                    ForEach(credentials) { credential in
                        credentialCard(credential)
                    }
                }
                .padding(Spacing.md)
            }
            .background(palette.backgroundPrimary.ignoresSafeArea())
            .navigationTitle("Regulatory passport")
        }
    }

    private var hero: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                HStack {
                    Text("KYC level")
                        .font(Typography.label)
                        .foregroundStyle(palette.textSecondary)
                    Spacer()
                    StatusBadge(state: .verified)
                }
                Text("Tier 3 · Institutional")
                    .font(Typography.title2)
                    .foregroundStyle(palette.textPrimary)
                Text("UAE VARA compliant · MiCA attestable · Attestor: Aethelred Trust FZ-LLC")
                    .font(Typography.caption)
                    .foregroundStyle(palette.textSecondary)
            }
        }
    }

    private func credentialCard(_ credential: CredentialEntry) -> some View {
        GlassCard {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                HStack {
                    Text(credential.schema.uppercased())
                        .font(.system(size: 10, weight: .semibold))
                        .tracking(1)
                        .foregroundStyle(palette.textSecondary)
                    Spacer()
                    StatusBadge(state: credential.status)
                }
                Text(credential.title)
                    .font(Typography.bodyCompact)
                    .foregroundStyle(palette.textPrimary)
                Text("Issued by \(credential.issuer) · expires \(credential.expires)")
                    .font(Typography.caption)
                    .foregroundStyle(palette.textSecondary)
                HStack {
                    Button("Present") { }
                        .buttonStyle(.borderedProminent)
                        .tint(palette.accent)
                    Button("Revoke") { }
                        .foregroundStyle(palette.danger)
                }
            }
        }
    }

    struct CredentialEntry: Identifiable, Equatable {
        let id: String
        let schema: String
        let title: String
        let issuer: String
        let expires: String
        let status: StatusBadge.State
    }

    static let sample: [CredentialEntry] = [
        .init(id: "c-1", schema: "KYC", title: "Proof of personhood · full KYC", issuer: "Aethelred Trust", expires: "2027-01-01", status: .verified),
        .init(id: "c-2", schema: "ACCREDITATION", title: "Accredited investor", issuer: "SEC-registered verifier", expires: "2025-06-30", status: .verified),
        .init(id: "c-3", schema: "AML", title: "AML screening", issuer: "Chainalysis", expires: "2025-07-20", status: .pending)
    ]
}
