import SwiftUI

/// Security settings — passkey list, session policies, auto-lock
/// timeout, hardware wallet pairing.
@MainActor
struct SecurityView: View {

    @Environment(\.themePalette) private var palette
    @State private var autoLockSeconds: Double = 60
    @State private var requireFaceIdOnEverySig = true
    @State private var passkeys: [PasskeyCredentialRecord] = []
    @State private var isShowingPair: Bool = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Session policy") {
                    Stepper(value: $autoLockSeconds, in: 15...600, step: 15) {
                        Text("Auto-lock after \(Int(autoLockSeconds))s")
                    }
                    Toggle("Face ID on every signature", isOn: $requireFaceIdOnEverySig)
                    Toggle("Lock when backgrounded", isOn: .constant(true))
                        .disabled(true)
                }
                .listRowBackground(palette.surfaceBase)

                Section("Passkeys") {
                    if passkeys.isEmpty {
                        Text("No passkeys enrolled. Add one to unlock hardware-grade biometric auth.")
                            .font(Typography.caption)
                            .foregroundStyle(palette.textSecondary)
                    } else {
                        ForEach(passkeys, id: \.id) { credential in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(credential.userDisplayName)
                                    .font(Typography.bodyCompact)
                                    .foregroundStyle(palette.textPrimary)
                                Text("Registered \(Date(timeIntervalSince1970: TimeInterval(credential.createdAt) / 1000).formatted(.relative(presentation: .named)))")
                                    .font(Typography.caption)
                                    .foregroundStyle(palette.textSecondary)
                            }
                        }
                        .onDelete { offsets in
                            passkeys.remove(atOffsets: offsets)
                        }
                    }
                    Button {
                        isShowingPair = true
                    } label: {
                        Label("Add passkey", systemImage: Icons.passkey)
                    }
                }
                .listRowBackground(palette.surfaceBase)

                Section("Hardware wallets") {
                    NavigationLink {
                        EmptyState(icon: Icons.hardwareWallet, title: "No hardware wallets", message: "Pair a Ledger or Trezor via Bluetooth.")
                    } label: {
                        Label("Paired devices", systemImage: Icons.hardwareWallet)
                    }
                }
                .listRowBackground(palette.surfaceBase)

                Section("Recovery") {
                    NavigationLink {
                        RecoveryBackupView()
                    } label: {
                        Label("View recovery phrase", systemImage: "doc.text.magnifyingglass")
                    }
                    NavigationLink {
                        EmptyState(icon: "square.and.arrow.up.on.square", title: "Import another wallet", message: "Use a seed phrase or private key to add another account.")
                    } label: {
                        Label("Import wallet", systemImage: "square.and.arrow.down")
                    }
                }
                .listRowBackground(palette.surfaceBase)
            }
            .scrollContentBackground(.hidden)
            .background(palette.backgroundPrimary.ignoresSafeArea())
            .navigationTitle("Security")
        }
    }
}
