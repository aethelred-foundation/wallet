import SwiftUI

/// Swap (exchange) flow screen.
///
/// Mirrors the extension's `swap.tsx` view — two token selectors with a
/// rate preview, slippage control, price-impact warning and a simulate
/// button. The underlying swap is delegated to a placeholder router
/// service; the UI is production-shaped.
@MainActor
struct SwapView: View {

    @Environment(\.themePalette) private var palette
    @Environment(\.dismiss) private var dismiss
    @State private var sellSymbol: String = "ETH"
    @State private var buySymbol: String = "USDC"
    @State private var sellAmount: Decimal = 0.0
    @State private var estimatedBuy: Decimal = 0.0
    @State private var slippageBps: Int = 50
    @State private var priceImpactPct: Double = 0.12
    @State private var showTokenPicker: TokenPickerKind?
    @State private var simulationSucceeded: Bool = true
    @State private var simulationResult: String?
    @State private var isSimulating: Bool = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Spacing.md) {
                    pair
                    slippageCard
                    rateCard
                    simulationCard
                    primaryButton
                }
                .padding(Spacing.md)
            }
            .background(palette.backgroundPrimary.ignoresSafeArea())
            .navigationTitle("Swap")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Close") { dismiss() }
                }
            }
            .sheet(item: $showTokenPicker) { kind in
                TokenPickerSheet(kind: kind, onSelect: handleTokenSelection)
            }
        }
    }

    // MARK: Pair
    private var pair: some View {
        VStack(spacing: Spacing.xs) {
            tokenCard(title: "Sell", symbol: sellSymbol, amount: $sellAmount, kind: .sell)
            ZStack {
                Circle()
                    .fill(palette.surfaceRaised)
                    .frame(width: 40, height: 40)
                Button {
                    swapSides()
                    Haptics.selection()
                } label: {
                    Image(systemName: Icons.swap)
                        .foregroundStyle(palette.accent)
                }
                .accessibilityLabel("Swap direction")
            }
            tokenCard(title: "Buy", symbol: buySymbol, amount: .constant(estimatedBuy), kind: .buy, readOnly: true)
        }
    }

    private func tokenCard(
        title: String,
        symbol: String,
        amount: Binding<Decimal>,
        kind: TokenPickerKind,
        readOnly: Bool = false
    ) -> some View {
        GlassCard {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                HStack {
                    Text(title)
                        .font(Typography.caption)
                        .foregroundStyle(palette.textSecondary)
                    Spacer()
                    Button {
                        showTokenPicker = kind
                        Haptics.selection()
                    } label: {
                        HStack(spacing: 4) {
                            Text(symbol)
                                .font(Typography.title3)
                                .foregroundStyle(palette.textPrimary)
                            Image(systemName: Icons.chevronDown)
                                .foregroundStyle(palette.textSecondary)
                        }
                    }
                }
                if readOnly {
                    Text(NSDecimalNumber(decimal: amount.wrappedValue).stringValue)
                        .font(Typography.hero)
                        .foregroundStyle(palette.textPrimary)
                } else {
                    TextField("0.0", value: amount, format: .number)
                        .keyboardType(.decimalPad)
                        .font(Typography.hero)
                        .foregroundStyle(palette.textPrimary)
                        .onChange(of: sellAmount) { _, newValue in
                            estimatedBuy = newValue * 1800  // placeholder conversion
                        }
                }
            }
        }
    }

    // MARK: Slippage
    private var slippageCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                HStack {
                    Text("Slippage tolerance")
                        .font(Typography.label)
                        .foregroundStyle(palette.textPrimary)
                    Spacer()
                    Text("\(Double(slippageBps) / 100, specifier: "%.2f")%")
                        .font(Typography.label)
                        .foregroundStyle(palette.textLink)
                }
                HStack(spacing: Spacing.xs) {
                    ForEach([10, 50, 100, 300], id: \.self) { bps in
                        Button {
                            slippageBps = bps
                            Haptics.selection()
                        } label: {
                            Text("\(Double(bps) / 100, specifier: "%.1f")%")
                                .font(Typography.label)
                                .foregroundStyle(slippageBps == bps ? palette.textOnAccent : palette.textPrimary)
                                .padding(.horizontal, Spacing.xs)
                                .padding(.vertical, 6)
                                .background(slippageBps == bps ? palette.accent : palette.surfaceRaised, in: Capsule())
                        }
                    }
                    TextField("Custom", value: Binding(
                        get: { slippageBps },
                        set: { slippageBps = max(1, $0) }
                    ), format: .number)
                        .textFieldStyle(.roundedBorder)
                        .keyboardType(.numberPad)
                        .frame(width: 72)
                }
            }
        }
    }

    // MARK: Rate
    private var rateCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                row("Rate", "1 \(sellSymbol) ≈ 1,800 \(buySymbol)")
                row("Route", "Uniswap V3 → Curve")
                row("Price impact", "\(priceImpactPct, specifier: "%.2f")%")
                if priceImpactPct > 1 {
                    InlineAlert(
                        style: .warning,
                        title: "High price impact",
                        message: "Consider breaking this swap into smaller pieces."
                    )
                }
            }
        }
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
                .font(Typography.caption)
                .foregroundStyle(palette.textSecondary)
            Spacer()
            Text(value)
                .font(Typography.label)
                .foregroundStyle(palette.textPrimary)
        }
    }

    // MARK: Simulation
    private var simulationCard: some View {
        GlassCard {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text("Simulation")
                    .font(Typography.label)
                    .foregroundStyle(palette.textPrimary)
                if let result = simulationResult {
                    StatusBadge(state: simulationSucceeded ? .success : .failed)
                    Text(result)
                        .font(Typography.caption)
                        .foregroundStyle(palette.textSecondary)
                } else {
                    Text("Run a simulation before broadcasting — estimates return data without spending gas.")
                        .font(Typography.caption)
                        .foregroundStyle(palette.textSecondary)
                }
            }
        }
    }

    private var primaryButton: some View {
        Button {
            Task { await runSimulation() }
        } label: {
            HStack {
                if isSimulating { ProgressView().tint(palette.textOnAccent) }
                Text(simulationResult == nil ? "Simulate swap" : "Execute swap")
                    .font(Typography.button)
            }
            .foregroundStyle(palette.textOnAccent)
            .frame(maxWidth: .infinity)
            .padding(.vertical, Spacing.sm)
            .background(palette.accent, in: RoundedRectangle(cornerRadius: Radii.md))
        }
        .disabled(isSimulating)
        .accessibilityIdentifier("swap.primary-button")
    }

    // MARK: Handlers

    private func swapSides() {
        let oldSell = sellSymbol
        sellSymbol = buySymbol
        buySymbol = oldSell
        estimatedBuy = 0
    }

    private func handleTokenSelection(kind: TokenPickerKind, symbol: String) {
        switch kind {
        case .sell: sellSymbol = symbol
        case .buy: buySymbol = symbol
        }
        showTokenPicker = nil
    }

    private func runSimulation() async {
        isSimulating = true
        defer { isSimulating = false }
        try? await Task.sleep(nanoseconds: 400_000_000)
        simulationSucceeded = priceImpactPct < 5
        simulationResult = simulationSucceeded
            ? "Simulation passed — estimated gas 212,104 units."
            : "Simulation failed — insufficient liquidity at this slippage."
    }
}

/// Which side of the pair is being picked.
enum TokenPickerKind: String, Identifiable {
    case sell, buy
    var id: String { rawValue }
}

@MainActor
private struct TokenPickerSheet: View {
    @Environment(\.themePalette) private var palette
    let kind: TokenPickerKind
    let onSelect: (TokenPickerKind, String) -> Void
    @State private var query: String = ""

    var body: some View {
        BottomSheet {
            VStack(spacing: Spacing.sm) {
                Text(kind == .sell ? "Sell" : "Buy")
                    .font(Typography.title3)
                    .foregroundStyle(palette.textPrimary)
                TextField("Search", text: $query)
                    .textFieldStyle(.roundedBorder)
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(tokens, id: \.symbol) { token in
                            Button {
                                onSelect(kind, token.symbol)
                                Haptics.selection()
                            } label: {
                                TokenRow(token: token)
                                    .padding(.horizontal, Spacing.md)
                                    .padding(.vertical, Spacing.xs)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding(.horizontal, Spacing.md)
        }
    }

    private var tokens: [TokenRow.Model] {
        let base: [TokenRow.Model] = [
            .init(symbol: "ETH", name: "Ether", balance: "0.42", usdValue: "$1,284.62"),
            .init(symbol: "USDC", name: "USD Coin", balance: "2,145.21", usdValue: "$2,145.21"),
            .init(symbol: "WBTC", name: "Wrapped BTC", balance: "0.0142", usdValue: "$892.90"),
            .init(symbol: "DAI", name: "Dai", balance: "120.50", usdValue: "$120.45"),
            .init(symbol: "LINK", name: "Chainlink", balance: "42.8", usdValue: "$612.00"),
            .init(symbol: "UNI", name: "Uniswap", balance: "8.20", usdValue: "$76.30")
        ]
        guard !query.isEmpty else { return base }
        return base.filter {
            $0.symbol.localizedCaseInsensitiveContains(query)
                || $0.name.localizedCaseInsensitiveContains(query)
        }
    }
}
