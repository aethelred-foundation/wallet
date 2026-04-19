import Combine
import Foundation
import LocalAuthentication
import SwiftUI

/// Drives the three-step send flow — recipient, amount, confirm.
///
/// Holds transient form state rather than persisting anywhere; a real
/// send attempt hands everything off to ``submit(with:)`` which
/// constructs an ``EIP1559Transaction``, triggers biometric auth through
/// ``BiometricUnlocking``, signs via ``Secp256k1Signing``, and finally
/// broadcasts via ``RpcClient``.
@MainActor
public final class SendViewModel: ObservableObject {

    public enum Step: Int, Equatable, Sendable {
        case recipient = 0
        case amount = 1
        case confirm = 2
    }

    @Published public var recipient: String = ""
    @Published public var amount: Decimal = 0
    @Published public var step: Step = .recipient
    @Published public private(set) var isSubmitting: Bool = false
    @Published public private(set) var lastError: String?
    @Published public private(set) var broadcastHash: String?

    private let signer: Secp256k1Signing
    private let biometrics: BiometricUnlocking
    private let audit: AuditCapturing
    private let network: NetworkDefinition
    private let rpcClient: RpcClient

    public init(
        network: NetworkDefinition,
        signer: Secp256k1Signing,
        biometrics: BiometricUnlocking,
        audit: AuditCapturing
    ) {
        self.network = network
        self.signer = signer
        self.biometrics = biometrics
        self.audit = audit
        self.rpcClient = RpcClient(network: network)
    }

    public func advance() {
        let next = min(step.rawValue + 1, Step.confirm.rawValue)
        if let resolved = Step(rawValue: next) {
            step = resolved
        }
    }

    public func goBack() {
        let prior = max(step.rawValue - 1, Step.recipient.rawValue)
        if let resolved = Step(rawValue: prior) {
            step = resolved
        }
    }

    /// Kick off the full submission pipeline. Safe to invoke multiple
    /// times — concurrent calls are short-circuited by ``isSubmitting``.
    public func submit(account: WalletAccount) async {
        guard !isSubmitting else { return }
        isSubmitting = true
        defer { isSubmitting = false }

        do {
            let context = try await biometrics.requestAuthentication(
                reason: "Authorize send to \(recipient)"
            )
            let nonceHex = try await rpcClient.getNonce(address: account.address)
            let maxPriorityFee = try await rpcClient.maxPriorityFeePerGas()
            let maxFeePerGas = try await rpcClient.gasPrice()
            let nonce = UInt64(nonceHex.dropFirst(2), radix: 16) ?? 0
            let weiHex = Self.hexWei(from: amount, decimals: network.nativeCurrency.decimals)

            let transaction = EIP1559Transaction(
                chainId: UInt64(network.chainId),
                nonce: nonce,
                maxPriorityFeePerGas: maxPriorityFee,
                maxFeePerGas: maxFeePerGas,
                gasLimit: 21_000,
                to: recipient,
                value: weiHex
            )
            let serialized = try await EIP1559Signing.sign(
                transaction,
                account: account,
                signer: signer,
                authentication: context
            )
            let hash = try await rpcClient.sendRawTransaction(serialized)
            broadcastHash = hash
            await audit.record(
                kind: .signingExecuted,
                subjectId: account.subjectId,
                workspaceId: "workspace-personal",
                detail: ["txHash": hash, "chainId": String(network.chainId)]
            )
        } catch {
            lastError = error.localizedDescription
            await audit.record(
                kind: .signingExecuted,
                subjectId: account.subjectId,
                workspaceId: "workspace-personal",
                detail: ["error": error.localizedDescription]
            )
        }
    }

    /// Convert a user-entered decimal amount into hex-encoded wei.
    internal static func hexWei(from amount: Decimal, decimals: Int) -> String {
        let scaled = amount * pow(Decimal(10), decimals)
        var rounded = Decimal()
        var input = scaled
        NSDecimalRound(&rounded, &input, 0, .plain)
        let asString = NSDecimalNumber(decimal: rounded).stringValue
        guard let integer = UInt64(asString) else {
            return "0x0"
        }
        return "0x" + String(integer, radix: 16)
    }
}
