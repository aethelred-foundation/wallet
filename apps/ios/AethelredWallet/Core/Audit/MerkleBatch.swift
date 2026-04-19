import CryptoKit
import Foundation

/// Port of `packages/audit/src/merkle-batch.ts`.
///
/// Responsible for taking hash-chained audit events and reducing them
/// to a single Merkle root per batch, so the root can be published to
/// the Aethelred L1. Uses the same canonical construction as the
/// reference implementation — `sha256(left || right)`, duplicate-last on
/// odd leaf counts — so roots computed on device are byte-identical to
/// roots computed by the TypeScript reference.
public struct MerkleProof: Codable, Sendable, Equatable {
    public let leaf: String
    public let siblings: [String]
    public let directions: [Int]
    public let root: String
    public let leafIndex: Int

    public init(
        leaf: String,
        siblings: [String],
        directions: [Int],
        root: String,
        leafIndex: Int
    ) {
        self.leaf = leaf
        self.siblings = siblings
        self.directions = directions
        self.root = root
        self.leafIndex = leafIndex
    }
}

/// Immutable record of a finalized Merkle batch. Matches the TypeScript
/// shape exactly so bundles can round-trip between platforms.
public struct FinalizedBatch: Codable, Sendable, Equatable {
    public let batchId: String
    public let root: String
    public let leafCount: Int
    public let firstSequenceNumber: Int
    public let lastSequenceNumber: Int
    public let finalizedAt: Int64
    public let proofs: [String: MerkleProof]
}

/// Errors thrown by ``MerkleBatch``.
public enum MerkleBatchError: LocalizedError, Sendable {
    case invalidEventHash(String)
    case duplicateEventHash(String)
    case adapterMissing

    public var errorDescription: String? {
        switch self {
        case .invalidEventHash(let hash):
            return "event.eventHash must be a 64-char lowercase hex string, got \(hash)."
        case .duplicateEventHash(let hash):
            return "duplicate eventHash in open batch: \(hash)."
        case .adapterMissing:
            return "notarization adapter not configured."
        }
    }
}

/// Verify a standalone proof. Returns `true` iff the rolling hash of
/// `leaf` + `siblings` matches the stated `root`.
public func verifyMerkleProof(_ proof: MerkleProof) -> Bool {
    guard proof.leaf.count == 64 else { return false }
    guard proof.root.count == 64 else { return false }
    guard proof.siblings.count == proof.directions.count else { return false }
    for sibling in proof.siblings where sibling.count != 64 { return false }
    for direction in proof.directions where direction != 0 && direction != 1 {
        return false
    }
    if proof.siblings.isEmpty {
        return proof.leaf == proof.root
    }
    var current = proof.leaf
    for index in proof.siblings.indices {
        let sibling = proof.siblings[index]
        let direction = proof.directions[index]
        let left = direction == 1 ? sibling : current
        let right = direction == 1 ? current : sibling
        current = MerkleBatch.hashPair(left: left, right: right)
    }
    return current == proof.root
}

/// Actor-isolated Merkle batching layer. Mirrors the TypeScript
/// implementation including the default batch size (256) and age window
/// (60 seconds).
public actor MerkleBatch {

    private let maxBatchSize: Int
    private let maxBatchAgeMs: Int

    private var pending: [AuditEvent] = []
    private var pendingHashes: Set<String> = []
    private var batchOpenedAt: Int64?
    private var finalizedBatches: [FinalizedBatch] = []
    private var proofIndex: [String: FinalizedBatch] = [:]
    private var notarized: Set<String> = []

    public init(maxBatchSize: Int = 256, maxBatchAgeMs: Int = 60_000) {
        precondition(maxBatchSize > 0, "maxBatchSize must be positive")
        precondition(maxBatchAgeMs > 0, "maxBatchAgeMs must be positive")
        self.maxBatchSize = maxBatchSize
        self.maxBatchAgeMs = maxBatchAgeMs
    }

    /// Add an event to the open batch. Triggers auto-finalization when
    /// size or age thresholds are crossed.
    @discardableResult
    public func add(_ event: AuditEvent) throws -> FinalizedBatch? {
        try validate(event.eventHash)

        let currentTime = nowMillis()

        if let opened = batchOpenedAt,
           currentTime - opened >= Int64(maxBatchAgeMs),
           !pending.isEmpty {
            _ = finalizeOpen()
        }

        if pendingHashes.contains(event.eventHash) {
            throw MerkleBatchError.duplicateEventHash(event.eventHash)
        }

        if pending.isEmpty {
            batchOpenedAt = currentTime
        }
        pending.append(event)
        pendingHashes.insert(event.eventHash)

        if pending.count >= maxBatchSize {
            return finalizeOpen()
        }
        return nil
    }

    public func currentBatchSize() -> Int {
        pending.count
    }

    /// Force-finalize the open batch, returning the resulting record.
    @discardableResult
    public func finalize() -> FinalizedBatch? {
        finalizeOpen()
    }

    public func proof(for eventHash: String) -> MerkleProof? {
        guard let owner = proofIndex[eventHash] else { return nil }
        return owner.proofs[eventHash]
    }

    public func allBatches() -> [FinalizedBatch] {
        finalizedBatches
    }

    // MARK: Internals

    private func validate(_ hash: String) throws {
        let isHex = hash.count == 64 && hash.allSatisfy { character in
            character.isHexDigit && !character.isUppercase
        }
        if !isHex {
            throw MerkleBatchError.invalidEventHash(hash)
        }
    }

    private func finalizeOpen() -> FinalizedBatch? {
        guard !pending.isEmpty else { return nil }

        let events = pending
        let leaves = events.map(\.eventHash)
        let levels = Self.buildLevels(leaves: leaves)
        let root = levels.last?.first ?? leaves[0]
        let proofs = Self.buildProofs(levels: levels, root: root)
        var proofMap: [String: MerkleProof] = [:]
        for index in events.indices {
            proofMap[events[index].eventHash] = proofs[index]
        }

        let sequences = events.map(\.sequenceNumber)
        let finalized = FinalizedBatch(
            batchId: "batch-\(Self.randomHex(bytes: 8))",
            root: root,
            leafCount: events.count,
            firstSequenceNumber: sequences.min() ?? 0,
            lastSequenceNumber: sequences.max() ?? 0,
            finalizedAt: nowMillis(),
            proofs: proofMap
        )

        finalizedBatches.append(finalized)
        for event in events {
            proofIndex[event.eventHash] = finalized
        }
        pending.removeAll()
        pendingHashes.removeAll()
        batchOpenedAt = nil
        return finalized
    }

    private func nowMillis() -> Int64 {
        Int64(Date().timeIntervalSince1970 * 1000)
    }

    internal static func hashPair(left: String, right: String) -> String {
        let leftBytes = hexToBytes(left)
        let rightBytes = hexToBytes(right)
        var combined = Data()
        combined.append(leftBytes)
        combined.append(rightBytes)
        let digest = SHA256.hash(data: combined)
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    internal static func buildLevels(leaves: [String]) -> [[String]] {
        var levels: [[String]] = [leaves]
        var current = leaves
        while current.count > 1 {
            var next: [String] = []
            var index = 0
            while index < current.count {
                let left = current[index]
                let right = index + 1 < current.count ? current[index + 1] : left
                next.append(hashPair(left: left, right: right))
                index += 2
            }
            levels.append(next)
            current = next
        }
        return levels
    }

    internal static func buildProofs(levels: [[String]], root: String) -> [MerkleProof] {
        let leaves = levels.first ?? []
        var proofs: [MerkleProof] = []
        for leafIndex in leaves.indices {
            var siblings: [String] = []
            var directions: [Int] = []
            var index = leafIndex
            for level in 0..<(levels.count - 1) {
                let nodes = levels[level]
                let isRight = index % 2 == 1
                let siblingIndex = isRight ? index - 1 : index + 1
                let sibling = siblingIndex < nodes.count ? nodes[siblingIndex] : nodes[index]
                siblings.append(sibling)
                directions.append(isRight ? 1 : 0)
                index /= 2
            }
            proofs.append(MerkleProof(
                leaf: leaves[leafIndex],
                siblings: siblings,
                directions: directions,
                root: root,
                leafIndex: leafIndex
            ))
        }
        return proofs
    }

    internal static func hexToBytes(_ hex: String) -> Data {
        var bytes = Data()
        bytes.reserveCapacity(hex.count / 2)
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2)
            let pair = String(hex[index..<next])
            if let byte = UInt8(pair, radix: 16) {
                bytes.append(byte)
            }
            index = next
        }
        return bytes
    }

    internal static func randomHex(bytes: Int) -> String {
        var random = [UInt8](repeating: 0, count: bytes)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes, &random)
        return random.map { String(format: "%02x", $0) }.joined()
    }
}
