import SwiftUI

/// Settings surface — security controls, chain selection, about info.
@MainActor
struct SettingsView: View {

    @EnvironmentObject private var appState: AppState
    @EnvironmentObject private var lockCoordinator: AppLockCoordinator
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let theme = ThemeColors.forScheme(colorScheme)
        NavigationStack {
            Form {
                Section("Security") {
                    devicePolicyRow(theme: theme)
                    HStack {
                        Label("Inactivity lock", systemImage: "clock.arrow.circlepath")
                        Spacer()
                        Text("\(Int(lockCoordinator.inactivityGraceSeconds)) s")
                            .foregroundStyle(theme.inkSoft)
                    }
                    Button {
                        Task { await appState.lock(reason: .explicit) }
                    } label: {
                        Label("Lock now", systemImage: "lock.fill")
                    }
                }

                Section("Network") {
                    NavigationLink {
                        NetworkPickerView()
                    } label: {
                        Label("Active chain", systemImage: "network")
                            .badge(NetworkRegistry.network(for: appState.selectedChainId)?.name ?? "—")
                    }
                }

                Section("Audit") {
                    Button {
                    } label: {
                        Label("Export evidence pack", systemImage: "square.and.arrow.up")
                    }
                    Button {
                    } label: {
                        Label("Verify chain integrity", systemImage: "checkmark.shield")
                    }
                }

                Section("About") {
                    HStack {
                        Text("Version")
                        Spacer()
                        Text("0.1.0 (alpha)")
                            .foregroundStyle(theme.inkSoft)
                    }
                    HStack {
                        Text("Control plane")
                        Spacer()
                        Text("aethelred.network")
                            .foregroundStyle(theme.inkSoft)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(theme.background.ignoresSafeArea())
            .navigationTitle("Settings")
        }
    }

    private func devicePolicyRow(theme: ThemeColors) -> some View {
        // The device policy surfaces through WalletAccount.devicePolicy
        // when an account is present; before the first account exists
        // we fall back to the `softwareOnly` tier so the row is still
        // informative.
        let policy = appState.currentAccount?.devicePolicy ?? .softwareOnly
        return HStack {
            Label("Key storage", systemImage: "cpu.fill")
            Spacer()
            Text(policy.displayName)
                .foregroundStyle(theme.accent)
        }
    }
}

@MainActor
private struct NetworkPickerView: View {

    @EnvironmentObject private var appState: AppState
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let theme = ThemeColors.forScheme(colorScheme)
        List {
            Section("Mainnets") {
                ForEach(NetworkRegistry.mainnets) { network in
                    networkRow(network: network, theme: theme)
                }
            }
            Section("Testnets") {
                ForEach(NetworkRegistry.testnets) { network in
                    networkRow(network: network, theme: theme)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(theme.background.ignoresSafeArea())
        .navigationTitle("Choose chain")
    }

    private func networkRow(network: NetworkDefinition, theme: ThemeColors) -> some View {
        Button {
            appState.setChain(network.chainId)
        } label: {
            HStack {
                VStack(alignment: .leading) {
                    Text(network.name)
                        .foregroundStyle(theme.ink)
                    Text("chainId \(network.chainId)")
                        .font(.footnote)
                        .foregroundStyle(theme.inkSoft)
                }
                Spacer()
                if appState.selectedChainId == network.chainId {
                    Image(systemName: "checkmark")
                        .foregroundStyle(theme.accent)
                }
            }
        }
    }
}
