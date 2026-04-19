import SwiftUI

/// List of every account on device. Selecting an account routes to the
/// ``AccountDetailView``; "Add account" triggers a fresh Secure Enclave
/// key-gen ceremony.
@MainActor
struct AccountsView: View {

    @EnvironmentObject private var appState: AppState
    @Environment(\.colorScheme) private var colorScheme
    @State private var isCreating = false

    var body: some View {
        let theme = ThemeColors.forScheme(colorScheme)
        NavigationStack {
            List {
                ForEach(Array(appState.accounts.enumerated()), id: \.element.id) { index, account in
                    NavigationLink(value: account) {
                        accountRow(account: account, isSelected: appState.selectedAccountIndex == index, theme: theme)
                    }
                    .listRowBackground(theme.surface)
                }
                Section {
                    Button {
                        isCreating = true
                    } label: {
                        Label("Add account", systemImage: "plus.circle.fill")
                            .foregroundStyle(theme.accent)
                    }
                    .listRowBackground(theme.surface)
                }
            }
            .scrollContentBackground(.hidden)
            .background(theme.background)
            .navigationTitle("Accounts")
            .navigationDestination(for: WalletAccount.self) { account in
                AccountDetailView(account: account)
            }
            .sheet(isPresented: $isCreating) {
                AddAccountSheet(isPresented: $isCreating)
            }
        }
    }

    private func accountRow(account: WalletAccount, isSelected: Bool, theme: ThemeColors) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text(account.label)
                    .foregroundStyle(theme.ink)
                Text(account.address)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(theme.inkSoft)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer()
            if isSelected {
                Image(systemName: "checkmark.seal.fill")
                    .foregroundStyle(theme.success)
            }
        }
        .padding(.vertical, ThemeSpacing.xs)
    }
}

/// Stub sheet for adding an account — in production it would drive the
/// ``SecureEnclaveKeyStoring/generateAccount(...)`` flow.
@MainActor
private struct AddAccountSheet: View {

    @Binding var isPresented: Bool
    @Environment(\.colorScheme) private var colorScheme
    @State private var label: String = "Main"

    var body: some View {
        let theme = ThemeColors.forScheme(colorScheme)
        NavigationStack {
            Form {
                Section("Account label") {
                    TextField("Label", text: $label)
                }
                Section("Security") {
                    Label("Secure Enclave protected", systemImage: "cpu.fill")
                        .foregroundStyle(theme.accent)
                    Label("Face ID required on every signature", systemImage: "faceid")
                        .foregroundStyle(theme.ink)
                }
                Section {
                    Button {
                        isPresented = false
                    } label: {
                        Text("Create account")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(theme.accent)
                }
            }
            .navigationTitle("New account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { isPresented = false }
                }
            }
        }
    }
}
