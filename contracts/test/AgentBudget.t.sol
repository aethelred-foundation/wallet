// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentBudget, IERC20} from "../src/AgentBudget.sol";

/// @title MockERC20 — minimal ERC-20 for testing AgentBudget.spend().
contract MockERC20 is IERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "balance");
        require(allowance[from][msg.sender] >= amount, "allowance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @title AgentBudgetTest — comprehensive Foundry test coverage.
contract AgentBudgetTest is Test {
    AgentBudget internal budget;
    MockERC20 internal usdc;

    address internal constant OWNER = address(0x01);
    address internal constant SESSION_KEY = address(0x02);
    address internal constant RECIPIENT = address(0x03);
    address internal constant ATTACKER = address(0x04);

    uint64 internal constant WINDOW_SECONDS = 86_400;
    uint256 internal constant DAILY_CAP = 10_000_000; // $10
    uint256 internal constant PER_TX_CAP = 1_000_000; // $1

    function setUp() public {
        budget = new AgentBudget();
        usdc = new MockERC20();
        usdc.mint(OWNER, 1_000_000_000);
        vm.prank(OWNER);
        usdc.approve(address(budget), type(uint256).max);
    }

    // ─── createBudget ────────────────────────────────────

    function test_createBudget_happy_path() public {
        vm.prank(OWNER);
        uint256 id = budget.createBudget(address(usdc), DAILY_CAP, PER_TX_CAP, WINDOW_SECONDS);
        assertEq(id, 0);
        assertEq(budget.nextBudgetId(), 1);
    }

    function test_createBudget_rejects_zero_window() public {
        vm.prank(OWNER);
        vm.expectRevert(AgentBudget.InvalidWindow.selector);
        budget.createBudget(address(usdc), DAILY_CAP, PER_TX_CAP, 0);
    }

    function test_createBudget_emits_event() public {
        vm.expectEmit(true, true, true, true);
        emit AgentBudget.BudgetCreated(0, OWNER, address(usdc), DAILY_CAP, PER_TX_CAP, WINDOW_SECONDS);
        vm.prank(OWNER);
        budget.createBudget(address(usdc), DAILY_CAP, PER_TX_CAP, WINDOW_SECONDS);
    }

    // ─── updateCaps ─────────────────────────────────────

    function test_updateCaps_owner_can_update() public {
        uint256 id = _createBudget();
        vm.prank(OWNER);
        budget.updateCaps(id, DAILY_CAP * 2, PER_TX_CAP * 2);
    }

    function test_updateCaps_non_owner_rejected() public {
        uint256 id = _createBudget();
        vm.prank(ATTACKER);
        vm.expectRevert(AgentBudget.NotOwner.selector);
        budget.updateCaps(id, DAILY_CAP * 2, PER_TX_CAP * 2);
    }

    function test_updateCaps_nonexistent_budget_rejected() public {
        vm.prank(OWNER);
        vm.expectRevert(abi.encodeWithSelector(AgentBudget.BudgetNotFound.selector, 42));
        budget.updateCaps(42, DAILY_CAP, PER_TX_CAP);
    }

    // ─── revokeBudget + revokeSession ──────────────────

    function test_revokeBudget_blocks_further_spend() public {
        uint256 id = _createBudget();
        _grantSession(id, SESSION_KEY, uint64(block.timestamp + 3600), PER_TX_CAP);

        vm.prank(OWNER);
        budget.revokeBudget(id);

        vm.prank(SESSION_KEY);
        vm.expectRevert(AgentBudget.BudgetAlreadyRevoked.selector);
        budget.spend(SESSION_KEY, PER_TX_CAP, RECIPIENT);
    }

    function test_revokeSession_blocks_that_key() public {
        uint256 id = _createBudget();
        _grantSession(id, SESSION_KEY, uint64(block.timestamp + 3600), PER_TX_CAP);

        vm.prank(OWNER);
        budget.revokeSession(SESSION_KEY);

        vm.prank(SESSION_KEY);
        vm.expectRevert(
            abi.encodeWithSelector(AgentBudget.SessionRevokedError.selector, SESSION_KEY)
        );
        budget.spend(SESSION_KEY, PER_TX_CAP, RECIPIENT);
    }

    // ─── spend + canSpend ──────────────────────────────

    function test_spend_happy_path_transfers_usdc() public {
        uint256 id = _createBudget();
        _grantSession(id, SESSION_KEY, uint64(block.timestamp + 3600), PER_TX_CAP);

        vm.prank(SESSION_KEY);
        budget.spend(SESSION_KEY, PER_TX_CAP, RECIPIENT);

        assertEq(usdc.balanceOf(RECIPIENT), PER_TX_CAP);
    }

    function test_spend_respects_per_call_cap() public {
        uint256 id = _createBudget();
        _grantSession(id, SESSION_KEY, uint64(block.timestamp + 3600), PER_TX_CAP / 2);

        vm.prank(SESSION_KEY);
        vm.expectRevert(
            abi.encodeWithSelector(
                AgentBudget.PerCallCapExceeded.selector,
                PER_TX_CAP,
                PER_TX_CAP / 2
            )
        );
        budget.spend(SESSION_KEY, PER_TX_CAP, RECIPIENT);
    }

    function test_spend_respects_daily_cap() public {
        uint256 id = _createBudget();
        _grantSession(id, SESSION_KEY, uint64(block.timestamp + 3600), PER_TX_CAP);

        // Drain the daily cap
        vm.startPrank(SESSION_KEY);
        for (uint256 i = 0; i < 10; i++) {
            budget.spend(SESSION_KEY, PER_TX_CAP, RECIPIENT);
        }
        // Next spend should fail
        vm.expectRevert(
            abi.encodeWithSelector(AgentBudget.DailyCapExceeded.selector, PER_TX_CAP, 0)
        );
        budget.spend(SESSION_KEY, PER_TX_CAP, RECIPIENT);
        vm.stopPrank();
    }

    function test_spend_rolls_window_forward() public {
        uint256 id = _createBudget();
        _grantSession(id, SESSION_KEY, uint64(block.timestamp + 2 * WINDOW_SECONDS), PER_TX_CAP);

        vm.startPrank(SESSION_KEY);
        // Drain the window.
        for (uint256 i = 0; i < 10; i++) {
            budget.spend(SESSION_KEY, PER_TX_CAP, RECIPIENT);
        }
        vm.stopPrank();

        // Advance past the window.
        vm.warp(block.timestamp + WINDOW_SECONDS + 1);

        // Fresh window should now allow spend.
        vm.prank(SESSION_KEY);
        budget.spend(SESSION_KEY, PER_TX_CAP, RECIPIENT);
    }

    function test_spend_by_random_actor_rejected() public {
        uint256 id = _createBudget();
        _grantSession(id, SESSION_KEY, uint64(block.timestamp + 3600), PER_TX_CAP);

        vm.prank(ATTACKER);
        vm.expectRevert(AgentBudget.NotOwner.selector);
        budget.spend(SESSION_KEY, PER_TX_CAP, RECIPIENT);
    }

    function test_spend_after_expiry_rejected() public {
        uint256 id = _createBudget();
        _grantSession(id, SESSION_KEY, uint64(block.timestamp + 100), PER_TX_CAP);

        vm.warp(block.timestamp + 200);

        vm.prank(SESSION_KEY);
        vm.expectRevert(
            abi.encodeWithSelector(AgentBudget.SessionExpired.selector, SESSION_KEY)
        );
        budget.spend(SESSION_KEY, PER_TX_CAP, RECIPIENT);
    }

    function test_canSpend_reason_codes() public {
        uint256 id = _createBudget();
        _grantSession(id, SESSION_KEY, uint64(block.timestamp + 3600), PER_TX_CAP);

        // ok
        (bool ok0, uint8 r0) = budget.canSpend(SESSION_KEY, PER_TX_CAP);
        assertTrue(ok0);
        assertEq(r0, 0);

        // zero-amount
        (bool ok8, uint8 r8) = budget.canSpend(SESSION_KEY, 0);
        assertFalse(ok8);
        assertEq(r8, 8);

        // per-call-cap-exceeded
        (bool ok5, uint8 r5) = budget.canSpend(SESSION_KEY, PER_TX_CAP + 1);
        assertFalse(ok5);
        assertEq(r5, 5);

        // session-not-found
        (bool ok1, uint8 r1) = budget.canSpend(address(0xdead), 1);
        assertFalse(ok1);
        assertEq(r1, 1);
    }

    // ─── revocation race safety (the moat property) ──

    function test_revocation_race_atomic() public {
        // This is the canonical "revoke beats pre-signed user-op" test.
        // Owner revokes the session; even if SESSION_KEY already had
        // implicit authority, any subsequent spend() reads the struct
        // and reverts — so there's no race window.
        uint256 id = _createBudget();
        _grantSession(id, SESSION_KEY, uint64(block.timestamp + 3600), PER_TX_CAP);

        // Owner revokes
        vm.prank(OWNER);
        budget.revokeSession(SESSION_KEY);

        // Previously-"authorized" session key now rejected atomically.
        vm.prank(SESSION_KEY);
        vm.expectRevert(
            abi.encodeWithSelector(AgentBudget.SessionRevokedError.selector, SESSION_KEY)
        );
        budget.spend(SESSION_KEY, PER_TX_CAP, RECIPIENT);
    }

    // ─── Helpers ──────────────────────────────────────

    function _createBudget() internal returns (uint256) {
        vm.prank(OWNER);
        return budget.createBudget(address(usdc), DAILY_CAP, PER_TX_CAP, WINDOW_SECONDS);
    }

    function _grantSession(
        uint256 id,
        address sessionKey,
        uint64 expiresAt,
        uint256 perCallCap
    ) internal {
        vm.prank(OWNER);
        budget.grantSession(id, sessionKey, expiresAt, perCallCap);
    }
}
