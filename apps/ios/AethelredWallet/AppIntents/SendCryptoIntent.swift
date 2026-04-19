import AppIntents
import Foundation

/// App Intent that allows Siri and Shortcuts to dispatch a crypto send.
///
/// The intent's role is to assemble the parameters and hand off to the
/// in-app send flow. Actual signing requires Face ID so the intent
/// intentionally returns `.needsToContinueInForeground` for execution —
/// the user always confirms in the app.
public struct SendCryptoIntent: AppIntent {

    public static let title: LocalizedStringResource = "Send crypto"
    public static let description: IntentDescription = IntentDescription(
        "Prepare a crypto send — Aethelred will open to confirm with Face ID."
    )

    public static let openAppWhenRun: Bool = true

    @Parameter(title: "Amount", description: "Amount in the native asset (e.g. 0.1)")
    public var amount: Double

    @Parameter(title: "Symbol", description: "Asset symbol (e.g. ETH, USDC)")
    public var symbol: String

    @Parameter(title: "Recipient", description: "An address or ENS name.")
    public var recipient: String

    @Parameter(title: "Chain ID", description: "Chain ID (defaults to 1 = Ethereum Mainnet)", default: 1)
    public var chainId: Int

    public static var parameterSummary: some ParameterSummary {
        Summary("Send \(\.$amount) \(\.$symbol) to \(\.$recipient) on chain \(\.$chainId)")
    }

    public init() {}

    public init(amount: Double, symbol: String, recipient: String, chainId: Int = 1) {
        self.amount = amount
        self.symbol = symbol
        self.recipient = recipient
        self.chainId = chainId
    }

    @MainActor
    public func perform() async throws -> some IntentResult & ReturnsValue<String> {
        // PRODUCTION FOLLOW-UP: write the intent into a deep link that
        // SceneDelegate routes to the send flow with values pre-filled.
        return .result(value: "Pending confirmation in Aethelred.")
    }
}
