import SwiftUI

/// Developer tools — debug panel, network switcher, feature flags.
@MainActor
struct DeveloperToolsView: View {

    @Environment(\.themePalette) private var palette
    @EnvironmentObject private var appState: AppState
    @State private var forceLockOnResume: Bool = true
    @State private var showDebugOverlay: Bool = false
    @State private var enableGasEstimatorDebug: Bool = false
    @State private var verboseLogs: Bool = false
    @State private var selectedEndpoint: String = "production"
    @State private var chainIdOverride: Int = 1

    var body: some View {
        NavigationStack {
            Form {
                Section("Feature flags") {
                    Toggle("Force lock on resume", isOn: $forceLockOnResume)
                    Toggle("Show debug overlay", isOn: $showDebugOverlay)
                    Toggle("Verbose logs", isOn: $verboseLogs)
                    Toggle("Gas estimator debug", isOn: $enableGasEstimatorDebug)
                }
                .listRowBackground(palette.surfaceBase)

                Section("Control plane endpoint") {
                    Picker("Endpoint", selection: $selectedEndpoint) {
                        Text("Production").tag("production")
                        Text("Staging").tag("staging")
                        Text("Local").tag("local")
                    }
                }
                .listRowBackground(palette.surfaceBase)

                Section("Chain override") {
                    Stepper(value: $chainIdOverride, in: 1...1_000_000) {
                        Text("chainId \(chainIdOverride)")
                    }
                    Text("Sets the chain used by the send view only. Restart to revert.")
                        .font(Typography.caption)
                        .foregroundStyle(palette.textSecondary)
                }
                .listRowBackground(palette.surfaceBase)

                Section("Diagnostics") {
                    Button("Dump audit chain") { }
                    Button("Force balance refresh") { }
                    Button("Simulate push — approval") { }
                    Button("Purge keychain (test only)", role: .destructive) { }
                }
                .listRowBackground(palette.surfaceBase)
            }
            .scrollContentBackground(.hidden)
            .background(palette.backgroundPrimary.ignoresSafeArea())
            .navigationTitle("Developer tools")
        }
    }
}
