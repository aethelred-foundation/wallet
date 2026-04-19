import Foundation
import LocalAuthentication

/// Ethereum EIP-1559 transaction.
///
/// Fields are stored as their canonical hex-string representations to
/// sidestep the lack of a built-in `BigInt` in Swift. The transaction
/// owns only its field data; signing is delegated to an injected
/// ``Secp256k1Signing`` so the type stays testable with a stub signer.
public struct EIP1559Transaction: Sendable, Equatable {

    /// Chain ID of the network this transaction will be broadcast on.
    public let chainId: UInt64
    /// Replay-protection nonce (use `eth_getTransactionCount(pending)`).
    public let nonce: UInt64
    /// Priority fee paid to the block producer, in wei, hex-encoded.
    public let maxPriorityFeePerGas: String
    /// Maximum total fee per gas, in wei, hex-encoded.
    public let maxFeePerGas: String
    /// Gas limit.
    public let gasLimit: UInt64
    /// Destination `to` address, hex-encoded with `0x` prefix. Empty for
    /// contract-creation transactions (not supported in phase 0).
    public let to: String
    /// Value to transfer, in wei, hex-encoded.
    public let value: String
    /// Calldata as hex (`"0x"` for a plain value transfer).
    public let data: String
    /// EIP-2930 access list; empty by default.
    public let accessList: [AccessListEntry]

    public init(
        chainId: UInt64,
        nonce: UInt64,
        maxPriorityFeePerGas: String,
        maxFeePerGas: String,
        gasLimit: UInt64,
        to: String,
        value: String,
        data: String = "0x",
        accessList: [AccessListEntry] = []
    ) {
        self.chainId = chainId
        self.nonce = nonce
        self.maxPriorityFeePerGas = maxPriorityFeePerGas
        self.maxFeePerGas = maxFeePerGas
        self.gasLimit = gasLimit
        self.to = to
        self.value = value
        self.data = data
        self.accessList = accessList
    }

    /// Signing hash as defined by EIP-1559:
    /// `keccak256(0x02 || rlp([chainId, nonce, maxPriorityFeePerGas,
    ///                          maxFeePerGas, gasLimit, to, value, data,
    ///                          accessList]))`
    public func signingHash() -> Data {
        var payload = Data([0x02])
        payload.append(rlpUnsignedBody())
        return Keccak256.hash(payload)
    }

    /// Full hex-encoded serialized transaction ready to pass to
    /// `eth_sendRawTransaction`. Requires a signature produced by
    /// ``Secp256k1Signing``.
    public func serialized(with signature: EthereumSignature) -> String {
        var payload = Data([0x02])
        payload.append(rlpSignedBody(with: signature))
        return "0x" + payload.map { String(format: "%02x", $0) }.joined()
    }

    // MARK: Encoding internals

    internal func rlpUnsignedBody() -> Data {
        let items: [Data] = [
            RLP.encode(integer: chainId),
            RLP.encode(integer: nonce),
            RLPBigInt.encode(hexNumber: maxPriorityFeePerGas),
            RLPBigInt.encode(hexNumber: maxFeePerGas),
            RLP.encode(integer: gasLimit),
            RLP.encode(bytes: Self.hexToBytes(to)),
            RLPBigInt.encode(hexNumber: value),
            RLP.encode(bytes: Self.hexToBytes(data)),
            encodeAccessList()
        ]
        return RLP.encode(list: items)
    }

    internal func rlpSignedBody(with signature: EthereumSignature) -> Data {
        let items: [Data] = [
            RLP.encode(integer: chainId),
            RLP.encode(integer: nonce),
            RLPBigInt.encode(hexNumber: maxPriorityFeePerGas),
            RLPBigInt.encode(hexNumber: maxFeePerGas),
            RLP.encode(integer: gasLimit),
            RLP.encode(bytes: Self.hexToBytes(to)),
            RLPBigInt.encode(hexNumber: value),
            RLP.encode(bytes: Self.hexToBytes(data)),
            encodeAccessList(),
            RLP.encode(integer: UInt64(signature.yParity)),
            RLP.encode(bytes: Self.trimLeadingZeros(signature.r)),
            RLP.encode(bytes: Self.trimLeadingZeros(signature.s))
        ]
        return RLP.encode(list: items)
    }

    private func encodeAccessList() -> Data {
        if accessList.isEmpty {
            return RLP.encode(list: [])
        }
        let encoded = accessList.map { entry -> Data in
            let storageKeys = entry.storageKeys.map { key in
                RLP.encode(bytes: Self.hexToBytes(key))
            }
            return RLP.encode(list: [
                RLP.encode(bytes: Self.hexToBytes(entry.address)),
                RLP.encode(list: storageKeys)
            ])
        }
        return RLP.encode(list: encoded)
    }

    // MARK: Hex helpers

    internal static func hexToBytes(_ hex: String) -> Data {
        var trimmed = hex.hasPrefix("0x") ? String(hex.dropFirst(2)) : hex
        if trimmed.isEmpty { return Data() }
        if trimmed.count % 2 != 0 { trimmed = "0" + trimmed }
        var bytes = Data()
        bytes.reserveCapacity(trimmed.count / 2)
        var index = trimmed.startIndex
        while index < trimmed.endIndex {
            let next = trimmed.index(index, offsetBy: 2)
            let pair = String(trimmed[index..<next])
            guard let byte = UInt8(pair, radix: 16) else { return Data() }
            bytes.append(byte)
            index = next
        }
        return bytes
    }

    internal static func trimLeadingZeros(_ data: Data) -> Data {
        var copy = data
        while copy.first == 0x00 && copy.count > 1 {
            copy.removeFirst()
        }
        if copy == Data([0x00]) { return Data() }
        return copy
    }
}

/// Signature suitable for an EIP-1559 transaction. `r` and `s` are raw
/// 32-byte big-endian integers; `yParity` is 0 or 1.
public struct EthereumSignature: Sendable, Equatable {
    public let r: Data
    public let s: Data
    public let yParity: Int

    public init(r: Data, s: Data, yParity: Int) {
        self.r = r
        self.s = s
        self.yParity = yParity
    }

    /// Split a raw 64-byte `(r || s)` signature into structured form.
    /// The caller provides `yParity` explicitly because the Secure
    /// Enclave signer returns a curve-specific `v` that the caller must
    /// derive separately.
    public init(rawRS: Data, yParity: Int) {
        let clamped = rawRS.prefix(64)
        self.r = clamped.prefix(32)
        self.s = clamped.suffix(32)
        self.yParity = yParity
    }
}

/// EIP-2930 access list entry used by the typed transaction format.
public struct AccessListEntry: Sendable, Equatable {
    public let address: String
    public let storageKeys: [String]

    public init(address: String, storageKeys: [String]) {
        self.address = address
        self.storageKeys = storageKeys
    }
}

/// Convenience: sign an `EIP1559Transaction` end-to-end through any
/// signer conforming to ``Secp256k1Signing``.
@MainActor
public enum EIP1559Signing {
    public static func sign(
        _ transaction: EIP1559Transaction,
        account: WalletAccount,
        signer: Secp256k1Signing,
        authentication: LAContext
    ) async throws -> String {
        let digest = transaction.signingHash()
        let raw = try await signer.sign(
            digest: digest,
            with: account,
            authentication: authentication
        )
        // yParity of 0 is a placeholder — swift-secp256k1 returns the
        // recovery ID directly; the Secure Enclave P-256 signer does not,
        // which is why real EVM signing requires the swift-secp256k1
        // follow-up tracked in README.md.
        let signature = EthereumSignature(rawRS: raw, yParity: 0)
        return transaction.serialized(with: signature)
    }
}
