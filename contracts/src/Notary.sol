// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @title Notary — tamper-evident anchor for off-chain audit Merkle roots.
 *
 * @notice Operators anchor the Merkle root of a batch of off-chain audit
 *         events every cadence tick (typically 15 minutes). The contract
 *         stores nothing except `(submitter, timestamp, root, eventCount)`
 *         — the value lives in the immutable on-chain timestamp + the
 *         fact that anyone can replay the proof against the root.
 *
 * @notice Not deployed from this repo. Reference source the TS client
 *         targets. Actual deployment + audit happens in the contracts
 *         repo. The TS ABI layer hard-codes selectors derived from
 *         signatures; any deployment matching this ABI works.
 *
 * @dev The contract is intentionally minimal: no pause, no admin, no
 *      upgradability. Any authorized submitter can anchor any root; the
 *      off-chain audit framework decides which submitters are trusted
 *      via the `submitter` field on `Batch`. Regulators cross-reference
 *      the submitter against the operator's registered signing address.
 *
 * @dev We DO NOT verify inclusion proofs on-chain here. On-chain
 *      inclusion-proof verification is gas-expensive and rarely
 *      useful — verifiers that need it implement their own
 *      keccak-sorted-pair MerkleProof library (OZ-style) over the
 *      stored root. This contract is pure storage.
 */
contract Notary {
    struct Batch {
        address submitter;
        uint64  timestamp;   // block.timestamp at anchoring time
        uint32  eventCount;  // number of leaves in the Merkle tree
        bytes32 merkleRoot;  // off-chain-computed Merkle root (opaque)
    }

    mapping(uint256 => Batch) public batches;
    uint256 public nextBatchId;

    event BatchAnchored(
        uint256 indexed batchId,
        address indexed submitter,
        bytes32 indexed merkleRoot,
        uint64 timestamp,
        uint32 eventCount
    );

    error ZeroRoot();
    error ZeroEventCount();

    /**
     * @notice Anchor a Merkle root produced off-chain.
     *
     * @dev The contract does not validate that `merkleRoot` corresponds
     *      to any particular off-chain state — that's the verifier's job.
     *      We simply record the submitter, the timestamp, and the root.
     *
     * @param merkleRoot  32-byte Merkle root of the batch.
     * @param eventCount  Number of audit events included in the batch.
     * @return batchId    Sequentially assigned identifier for this batch.
     */
    function anchor(bytes32 merkleRoot, uint32 eventCount) external returns (uint256 batchId) {
        if (merkleRoot == bytes32(0)) revert ZeroRoot();
        if (eventCount == 0) revert ZeroEventCount();
        batchId = nextBatchId++;
        batches[batchId] = Batch({
            submitter: msg.sender,
            timestamp: uint64(block.timestamp),
            eventCount: eventCount,
            merkleRoot: merkleRoot
        });
        emit BatchAnchored(batchId, msg.sender, merkleRoot, uint64(block.timestamp), eventCount);
    }

    /// @notice Convenience getter returning the full struct.
    function getBatch(uint256 batchId) external view returns (Batch memory) {
        return batches[batchId];
    }
}
