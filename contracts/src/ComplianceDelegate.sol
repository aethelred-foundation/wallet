// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

/**
 * @title ComplianceDelegate — on-chain finality for off-chain compliance.
 *
 * @notice The on-chain half of the EIP-7702 compliance moat. An enterprise EOA
 *         delegates its code to this contract (EIP-7702 "set code"). Once
 *         delegated, the EOA can only move funds through {execute}, which
 *         refuses any transaction that does not carry a fresh, authority-signed
 *         {ComplianceReceipt} bound to that exact call. So the enterprise keeps
 *         its native address, yet every transfer is gated by the wallet's full
 *         off-chain compliance pipeline (multi-vendor screening + anomaly +
 *         travel-rule + policy) — off-chain compliance, on-chain finality, no
 *         wallet migration.
 *
 * @notice The receipt is an EIP-712 typed-data structure signed by a trusted
 *         `complianceAuthority` (the wallet's compliance worker key). It binds
 *         to `keccak256(abi.encode(chainId, to, value, keccak256(data), nonce))`
 *         and carries a validity window, so a receipt cannot be replayed, cannot
 *         outlive its window, and authorises exactly one transaction.
 *
 *         The matching off-chain issuer/verifier is
 *         `packages/smart-account/src/compliance-receipt.ts`.
 */
contract ComplianceDelegate {
    /// @notice Key whose signature over a receipt authorises a transaction.
    address public immutable complianceAuthority;

    /// @notice Monotonic replay guard; bound into every receipt's intent hash.
    uint256 public nonce;

    struct Receipt {
        bytes32 intentHash;
        address subject;
        uint8 decision; // 0 = allow (only value that authorises), 1 = review, 2 = block
        uint64 issuedAt;
        uint64 expiry;
        bytes32 pipelineHash;
    }

    bytes32 private constant RECEIPT_TYPEHASH = keccak256(
        "ComplianceReceipt(bytes32 intentHash,address subject,uint8 decision,uint64 issuedAt,uint64 expiry,bytes32 pipelineHash)"
    );
    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );

    event ComplianceExecuted(address indexed to, uint256 value, uint256 indexed nonce, bytes32 intentHash);

    error ReceiptNotAllow(uint8 decision);
    error ReceiptNotYetValid();
    error ReceiptExpired();
    error IntentMismatch();
    error BadAuthority(address recovered);
    error BadSignatureLength();
    error CallFailed(bytes ret);

    constructor(address authority) {
        require(authority != address(0), "authority=0");
        complianceAuthority = authority;
    }

    /// @notice EIP-712 domain separator (chainId + this address).
    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes("AethelredCompliance")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    /// @notice The EIP-712 digest the authority signs for `receipt`.
    function hashReceipt(Receipt calldata receipt) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                RECEIPT_TYPEHASH,
                receipt.intentHash,
                receipt.subject,
                receipt.decision,
                receipt.issuedAt,
                receipt.expiry,
                receipt.pipelineHash
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    /// @notice Binds a receipt to one transaction; mirrors the off-chain module.
    function computeIntentHash(address to, uint256 value, bytes calldata data, uint256 n)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(block.chainid, to, value, keccak256(data), n));
    }

    /**
     * @notice Execute a call only if `receipt` is a valid, authority-signed,
     *         in-window "allow" bound to this exact call at the current nonce.
     *         Reverts (no state change, no value moved) otherwise.
     */
    function execute(
        address to,
        uint256 value,
        bytes calldata data,
        Receipt calldata receipt,
        bytes calldata signature
    ) external returns (bytes memory) {
        if (receipt.decision != 0) revert ReceiptNotAllow(receipt.decision);
        if (block.timestamp < receipt.issuedAt) revert ReceiptNotYetValid();
        if (block.timestamp > receipt.expiry) revert ReceiptExpired();
        if (receipt.intentHash != computeIntentHash(to, value, data, nonce)) revert IntentMismatch();

        address recovered = _recover(hashReceipt(receipt), signature);
        if (recovered != complianceAuthority) revert BadAuthority(recovered);

        uint256 used = nonce;
        unchecked {
            nonce = used + 1;
        }

        (bool ok, bytes memory ret) = to.call{value: value}(data);
        if (!ok) revert CallFailed(ret);

        emit ComplianceExecuted(to, value, used, receipt.intentHash);
        return ret;
    }

    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) revert BadSignatureLength();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        // Accept both raw recovery id (0/1) and Ethereum v (27/28).
        if (v < 27) v += 27;
        return ecrecover(digest, v, r, s);
    }

    /// @notice Accept native value (the delegated EOA holds funds here).
    receive() external payable {}
}
