import Foundation
import SwiftData

/// Persisted transaction record surfaced by the Activity view.
@Model
public final class StoredTransaction {

    @Attribute(.unique) public var hash: String
    public var chainId: Int
    public var fromAddress: String
    public var toAddress: String
    public var valueHex: String
    public var nonce: Int
    public var gasLimitHex: String
    public var gasUsedHex: String?
    public var maxFeePerGasHex: String?
    public var maxPriorityFeePerGasHex: String?
    public var statusRaw: String
    public var blockNumber: Int64?
    public var submittedAt: Int64
    public var minedAt: Int64?
    public var auditEventId: String?

    public init(
        hash: String,
        chainId: Int,
        fromAddress: String,
        toAddress: String,
        valueHex: String,
        nonce: Int,
        gasLimitHex: String,
        gasUsedHex: String? = nil,
        maxFeePerGasHex: String? = nil,
        maxPriorityFeePerGasHex: String? = nil,
        statusRaw: String,
        blockNumber: Int64? = nil,
        submittedAt: Int64,
        minedAt: Int64? = nil,
        auditEventId: String? = nil
    ) {
        self.hash = hash
        self.chainId = chainId
        self.fromAddress = fromAddress
        self.toAddress = toAddress
        self.valueHex = valueHex
        self.nonce = nonce
        self.gasLimitHex = gasLimitHex
        self.gasUsedHex = gasUsedHex
        self.maxFeePerGasHex = maxFeePerGasHex
        self.maxPriorityFeePerGasHex = maxPriorityFeePerGasHex
        self.statusRaw = statusRaw
        self.blockNumber = blockNumber
        self.submittedAt = submittedAt
        self.minedAt = minedAt
        self.auditEventId = auditEventId
    }
}

public enum StoredTransactionStatus: String, Sendable, Codable, CaseIterable {
    case pending, confirmed, failed, dropped, replaced
}
