// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Notary} from "../src/Notary.sol";

/// @title NotaryTest — Foundry test suite for the Notary contract.
/// @notice Covers happy-path anchoring, zero-root / zero-count
///         rejection, sequential batch-id assignment, and event
///         emission shape.
contract NotaryTest is Test {
    Notary internal notary;

    address internal constant ALICE = address(0xAA);
    address internal constant BOB = address(0xBB);

    function setUp() public {
        notary = new Notary();
    }

    function test_anchor_happy_path() public {
        bytes32 root = keccak256("batch-1");
        vm.prank(ALICE);
        uint256 batchId = notary.anchor(root, 10);

        assertEq(batchId, 0, "first batch id should be 0");

        Notary.Batch memory batch = notary.getBatch(batchId);
        assertEq(batch.submitter, ALICE);
        assertEq(batch.merkleRoot, root);
        assertEq(batch.eventCount, 10);
        assertEq(batch.timestamp, uint64(block.timestamp));
    }

    function test_anchor_assigns_sequential_batch_ids() public {
        bytes32 r1 = keccak256("b1");
        bytes32 r2 = keccak256("b2");

        vm.prank(ALICE);
        uint256 id1 = notary.anchor(r1, 1);
        vm.prank(BOB);
        uint256 id2 = notary.anchor(r2, 2);

        assertEq(id1, 0);
        assertEq(id2, 1);
        assertEq(notary.nextBatchId(), 2);
    }

    function test_anchor_emits_BatchAnchored() public {
        bytes32 root = keccak256("payload");

        vm.expectEmit(true, true, true, true);
        emit Notary.BatchAnchored(
            0,
            ALICE,
            root,
            uint64(block.timestamp),
            42
        );

        vm.prank(ALICE);
        notary.anchor(root, 42);
    }

    function test_anchor_rejects_zero_root() public {
        vm.prank(ALICE);
        vm.expectRevert(Notary.ZeroRoot.selector);
        notary.anchor(bytes32(0), 1);
    }

    function test_anchor_rejects_zero_event_count() public {
        vm.prank(ALICE);
        vm.expectRevert(Notary.ZeroEventCount.selector);
        notary.anchor(keccak256("x"), 0);
    }

    function test_getBatch_returns_empty_for_unknown_id() public view {
        Notary.Batch memory b = notary.getBatch(999);
        assertEq(b.submitter, address(0));
        assertEq(b.merkleRoot, bytes32(0));
        assertEq(b.eventCount, 0);
    }

    function testFuzz_anchor_preserves_root_and_count(
        bytes32 root,
        uint32 count
    ) public {
        vm.assume(root != bytes32(0));
        vm.assume(count != 0);

        vm.prank(ALICE);
        uint256 id = notary.anchor(root, count);
        Notary.Batch memory b = notary.getBatch(id);
        assertEq(b.merkleRoot, root);
        assertEq(b.eventCount, count);
    }
}
