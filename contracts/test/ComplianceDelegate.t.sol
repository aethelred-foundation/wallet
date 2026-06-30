// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ComplianceDelegate} from "../src/ComplianceDelegate.sol";

contract Target {
    uint256 public last;

    function ping(uint256 x) external payable returns (uint256) {
        last = x;
        return x * 2;
    }
}

contract ComplianceDelegateTest is Test {
    ComplianceDelegate internal delegate;
    Target internal target;

    uint256 internal constant AUTH_PK = 0xA11CE;
    uint256 internal constant OTHER_PK = 0xB0B;
    address internal authority;

    function setUp() public {
        authority = vm.addr(AUTH_PK);
        delegate = new ComplianceDelegate(authority);
        target = new Target();
        vm.deal(address(delegate), 10 ether);
    }

    function _sign(
        address to,
        uint256 value,
        bytes memory data,
        uint8 decision,
        uint64 issuedAt,
        uint64 expiry,
        uint256 pk
    ) internal view returns (ComplianceDelegate.Receipt memory r, bytes memory sig) {
        r = ComplianceDelegate.Receipt({
            intentHash: delegate.computeIntentHash(to, value, data, delegate.nonce()),
            subject: address(this),
            decision: decision,
            issuedAt: issuedAt,
            expiry: expiry,
            pipelineHash: bytes32(uint256(0xABCD))
        });
        (uint8 v, bytes32 rr, bytes32 ss) = vm.sign(pk, delegate.hashReceipt(r));
        sig = abi.encodePacked(rr, ss, v);
    }

    function _data() internal pure returns (bytes memory) {
        return abi.encodeWithSelector(Target.ping.selector, uint256(42));
    }

    function test_execute_succeedsWithValidReceipt() public {
        bytes memory data = _data();
        (ComplianceDelegate.Receipt memory r, bytes memory sig) =
            _sign(address(target), 1 ether, data, 0, uint64(block.timestamp - 1), uint64(block.timestamp + 300), AUTH_PK);

        bytes memory ret = delegate.execute(address(target), 1 ether, data, r, sig);

        assertEq(target.last(), 42);
        assertEq(abi.decode(ret, (uint256)), 84);
        assertEq(delegate.nonce(), 1);
        assertEq(address(target).balance, 1 ether);
    }

    function test_revert_wrongAuthority() public {
        bytes memory data = _data();
        (ComplianceDelegate.Receipt memory r, bytes memory sig) =
            _sign(address(target), 0, data, 0, uint64(block.timestamp - 1), uint64(block.timestamp + 300), OTHER_PK);
        vm.expectRevert(abi.encodeWithSelector(ComplianceDelegate.BadAuthority.selector, vm.addr(OTHER_PK)));
        delegate.execute(address(target), 0, data, r, sig);
    }

    function test_revert_nonAllowDecision() public {
        bytes memory data = _data();
        (ComplianceDelegate.Receipt memory r, bytes memory sig) =
            _sign(address(target), 0, data, 1, uint64(block.timestamp - 1), uint64(block.timestamp + 300), AUTH_PK);
        vm.expectRevert(abi.encodeWithSelector(ComplianceDelegate.ReceiptNotAllow.selector, uint8(1)));
        delegate.execute(address(target), 0, data, r, sig);
    }

    function test_revert_expired() public {
        bytes memory data = _data();
        vm.warp(1000);
        (ComplianceDelegate.Receipt memory r, bytes memory sig) =
            _sign(address(target), 0, data, 0, uint64(1), uint64(999), AUTH_PK);
        vm.expectRevert(ComplianceDelegate.ReceiptExpired.selector);
        delegate.execute(address(target), 0, data, r, sig);
    }

    function test_revert_intentMismatch() public {
        bytes memory data = _data();
        // Sign a receipt for value 0, then try to execute with value 1 ether.
        (ComplianceDelegate.Receipt memory r, bytes memory sig) =
            _sign(address(target), 0, data, 0, uint64(block.timestamp - 1), uint64(block.timestamp + 300), AUTH_PK);
        vm.expectRevert(ComplianceDelegate.IntentMismatch.selector);
        delegate.execute(address(target), 1 ether, data, r, sig);
    }

    function test_revert_replay() public {
        bytes memory data = _data();
        (ComplianceDelegate.Receipt memory r, bytes memory sig) =
            _sign(address(target), 0, data, 0, uint64(block.timestamp - 1), uint64(block.timestamp + 300), AUTH_PK);
        delegate.execute(address(target), 0, data, r, sig); // nonce 0 → 1
        // Same receipt again: nonce advanced, so the bound intentHash no longer matches.
        vm.expectRevert(ComplianceDelegate.IntentMismatch.selector);
        delegate.execute(address(target), 0, data, r, sig);
    }
}
