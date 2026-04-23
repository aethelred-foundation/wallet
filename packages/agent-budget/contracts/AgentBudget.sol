// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/**
 * @title AgentBudget — per-agent rolling-window spend caps + scoped session keys.
 *
 * @notice On-chain trust boundary between a parent agent (EOA or ERC-4337
 *         smart account) and the short-lived session keys it delegates to.
 *         Three entities, three roles:
 *
 *           1. Budget — the pool and caps (dailyCap, perTxCap), owned by
 *              the parent. Exists forever unless revoked.
 *           2. Session — a scoped, expiring, revocable grant of spending
 *              rights on one budget to one session key.
 *           3. Spend — the gated action that debits the current window.
 *              Callable only by the session key or the parent owner.
 *
 * @notice Separating Session from Spend is deliberate. Collapsing them
 *         (as most naive \"spending limits\" do) makes revocation a race:
 *         a session key that has pre-signed N spend transactions can
 *         still execute them after revocation if the only gating is at
 *         tx-submission time. In this contract, every spend() reads the
 *         Session struct and reverts on revoked / expired — so once the
 *         owner calls revokeSession(), no queued user-op can get
 *         through.
 *
 * @notice NOT DEPLOYED FROM THIS REPO. This file is the canonical
 *         reference the TS client targets. Actual deployment + audit
 *         happens out-of-band in the contracts repo. The TS package
 *         hard-codes the function selectors so any deployment that
 *         matches the ABI works — the spec is the interface, not the
 *         bytecode.
 *
 * @dev Rolling-window semantics: a budget has a `windowSeconds` duration
 *      (typically 86400 = 1 day). `windowStart` anchors the current
 *      window. On every spend, if `block.timestamp >= windowStart +
 *      windowSeconds`, we reset `spentInWindow` to 0 and set
 *      `windowStart = block.timestamp` before checking the cap. This
 *      gives a tumbling-window with the first-spend-of-the-day resetting
 *      the anchor — simpler than a sliding window and cheap to compute.
 */
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract AgentBudget {
    // ─── Storage ────────────────────────────────────────────────

    struct Budget {
        address owner;              // parent agent — only entity that can
                                    // update caps, grant sessions, revoke.
        address asset;              // ERC-20 being metered, or address(0)
                                    // for native-value (ETH) metering.
        uint256 dailyCap;           // spend cap per window (smallest unit).
        uint256 perTxCap;           // hard cap on any single spend().
        uint64  windowSeconds;      // duration of the rolling window.
        uint64  windowStart;        // unix timestamp anchor.
        uint256 spentInWindow;      // running spend in [windowStart, windowStart + windowSeconds).
        uint256 lifetimeSpent;      // all-time total, audit-only.
        bool    revoked;            // true after owner calls revokeBudget().
    }

    struct Session {
        uint256 budgetId;           // which budget this session draws from.
        address sessionKey;         // the scoped signer this session grants.
        uint64  expiresAt;          // unix timestamp after which the session
                                    // is void without any on-chain tx.
        uint256 perCallCap;         // per-call cap (<= budget.perTxCap).
        bool    revoked;            // true after owner calls revokeSession().
    }

    mapping(uint256 => Budget) public budgets;
    mapping(address => Session) public sessions; // sessionKey → Session
    uint256 public nextBudgetId;

    // ─── Events ─────────────────────────────────────────────────

    event BudgetCreated(uint256 indexed budgetId, address indexed owner, address indexed asset, uint256 dailyCap, uint256 perTxCap, uint64 windowSeconds);
    event BudgetCapsUpdated(uint256 indexed budgetId, uint256 dailyCap, uint256 perTxCap);
    event BudgetRevoked(uint256 indexed budgetId);
    event SessionGranted(uint256 indexed budgetId, address indexed sessionKey, uint64 expiresAt, uint256 perCallCap);
    event SessionRevoked(address indexed sessionKey);
    event Spent(uint256 indexed budgetId, address indexed sessionKey, address indexed to, uint256 amount);

    // ─── Errors ─────────────────────────────────────────────────

    error NotOwner();
    error BudgetNotFound(uint256 budgetId);
    error BudgetAlreadyRevoked();
    error SessionNotFound(address sessionKey);
    error SessionAlreadyExists(address sessionKey);
    error SessionExpired(address sessionKey);
    error SessionRevokedError(address sessionKey);
    error PerCallCapExceeded(uint256 requested, uint256 cap);
    error PerTxCapExceeded(uint256 requested, uint256 cap);
    error DailyCapExceeded(uint256 requested, uint256 available);
    error ZeroAmount();
    error InvalidWindow();

    // ─── Budget lifecycle ───────────────────────────────────────

    function createBudget(address asset, uint256 dailyCap, uint256 perTxCap, uint64 windowSeconds) external returns (uint256 id) {
        if (windowSeconds == 0) revert InvalidWindow();
        id = nextBudgetId++;
        budgets[id] = Budget({
            owner: msg.sender,
            asset: asset,
            dailyCap: dailyCap,
            perTxCap: perTxCap,
            windowSeconds: windowSeconds,
            windowStart: uint64(block.timestamp),
            spentInWindow: 0,
            lifetimeSpent: 0,
            revoked: false
        });
        emit BudgetCreated(id, msg.sender, asset, dailyCap, perTxCap, windowSeconds);
    }

    function updateCaps(uint256 budgetId, uint256 dailyCap, uint256 perTxCap) external {
        Budget storage b = budgets[budgetId];
        if (b.owner == address(0)) revert BudgetNotFound(budgetId);
        if (b.owner != msg.sender) revert NotOwner();
        if (b.revoked) revert BudgetAlreadyRevoked();
        b.dailyCap = dailyCap;
        b.perTxCap = perTxCap;
        emit BudgetCapsUpdated(budgetId, dailyCap, perTxCap);
    }

    function revokeBudget(uint256 budgetId) external {
        Budget storage b = budgets[budgetId];
        if (b.owner == address(0)) revert BudgetNotFound(budgetId);
        if (b.owner != msg.sender) revert NotOwner();
        if (b.revoked) revert BudgetAlreadyRevoked();
        b.revoked = true;
        emit BudgetRevoked(budgetId);
    }

    // ─── Session lifecycle ──────────────────────────────────────

    function grantSession(uint256 budgetId, address sessionKey, uint64 expiresAt, uint256 perCallCap) external {
        Budget storage b = budgets[budgetId];
        if (b.owner == address(0)) revert BudgetNotFound(budgetId);
        if (b.owner != msg.sender) revert NotOwner();
        if (b.revoked) revert BudgetAlreadyRevoked();
        if (sessions[sessionKey].sessionKey != address(0)) revert SessionAlreadyExists(sessionKey);
        sessions[sessionKey] = Session({
            budgetId: budgetId,
            sessionKey: sessionKey,
            expiresAt: expiresAt,
            perCallCap: perCallCap,
            revoked: false
        });
        emit SessionGranted(budgetId, sessionKey, expiresAt, perCallCap);
    }

    function revokeSession(address sessionKey) external {
        Session storage s = sessions[sessionKey];
        if (s.sessionKey == address(0)) revert SessionNotFound(sessionKey);
        Budget storage b = budgets[s.budgetId];
        if (b.owner != msg.sender) revert NotOwner();
        if (s.revoked) revert SessionRevokedError(sessionKey);
        s.revoked = true;
        emit SessionRevoked(sessionKey);
    }

    // ─── Spend ──────────────────────────────────────────────────

    /**
     * @notice Debit the budget by `amount` and forward to `to`.
     *
     * @dev Callable by:
     *        - the session key (`msg.sender == sessionKey`).
     *        - the budget owner directly (owner-initiated spend).
     *
     * @dev ERC-20 semantics assume this contract has been approved to
     *      transferFrom the owner. Native-value flows funnel the
     *      `msg.value` separately.
     */
    function spend(address sessionKey, uint256 amount, address to) external {
        if (amount == 0) revert ZeroAmount();
        Session storage s = sessions[sessionKey];
        if (s.sessionKey == address(0)) revert SessionNotFound(sessionKey);
        if (s.revoked) revert SessionRevokedError(sessionKey);
        if (block.timestamp >= s.expiresAt) revert SessionExpired(sessionKey);

        Budget storage b = budgets[s.budgetId];
        if (b.revoked) revert BudgetAlreadyRevoked();

        // msg.sender must be the session key itself OR the budget owner.
        if (msg.sender != sessionKey && msg.sender != b.owner) revert NotOwner();

        if (amount > s.perCallCap) revert PerCallCapExceeded(amount, s.perCallCap);
        if (amount > b.perTxCap) revert PerTxCapExceeded(amount, b.perTxCap);

        // Roll the window forward if we're past it.
        if (block.timestamp >= uint256(b.windowStart) + uint256(b.windowSeconds)) {
            b.windowStart = uint64(block.timestamp);
            b.spentInWindow = 0;
        }

        uint256 remaining = b.dailyCap - b.spentInWindow;
        if (amount > remaining) revert DailyCapExceeded(amount, remaining);

        b.spentInWindow += amount;
        b.lifetimeSpent += amount;

        if (b.asset == address(0)) {
            // Native: owner funds this contract out-of-band, spend
            // forwards the native value. Callers use the owner-initiated
            // path with msg.value wiring — the session-key path does not
            // support native-ETH spend (no way to attach value from an
            // arbitrary session key without delegatecall tricks).
            (bool ok,) = payable(to).call{value: amount}("");
            require(ok, "native transfer failed");
        } else {
            require(IERC20(b.asset).transferFrom(b.owner, to, amount), "erc20 transferFrom failed");
        }

        emit Spent(s.budgetId, sessionKey, to, amount);
    }

    // ─── Views ──────────────────────────────────────────────────

    function remainingInWindow(uint256 budgetId) external view returns (uint256) {
        Budget storage b = budgets[budgetId];
        if (b.owner == address(0)) return 0;
        if (b.revoked) return 0;
        if (block.timestamp >= uint256(b.windowStart) + uint256(b.windowSeconds)) {
            return b.dailyCap;
        }
        if (b.spentInWindow >= b.dailyCap) return 0;
        return b.dailyCap - b.spentInWindow;
    }

    /**
     * @notice Pure-view predicate — useful for paymaster / intent-router
     *         dry-run before submitting a UserOp that will debit the
     *         budget. Returns `(ok, reasonCode)` where `reasonCode` is
     *         one of: 0 = ok, 1 = session-not-found, 2 = session-revoked,
     *         3 = session-expired, 4 = budget-revoked,
     *         5 = per-call-cap-exceeded, 6 = per-tx-cap-exceeded,
     *         7 = daily-cap-exceeded, 8 = zero-amount.
     */
    function canSpend(address sessionKey, uint256 amount) external view returns (bool, uint8) {
        if (amount == 0) return (false, 8);
        Session storage s = sessions[sessionKey];
        if (s.sessionKey == address(0)) return (false, 1);
        if (s.revoked) return (false, 2);
        if (block.timestamp >= s.expiresAt) return (false, 3);
        Budget storage b = budgets[s.budgetId];
        if (b.revoked) return (false, 4);
        if (amount > s.perCallCap) return (false, 5);
        if (amount > b.perTxCap) return (false, 6);
        uint256 remaining = (block.timestamp >= uint256(b.windowStart) + uint256(b.windowSeconds))
            ? b.dailyCap
            : (b.dailyCap > b.spentInWindow ? b.dailyCap - b.spentInWindow : 0);
        if (amount > remaining) return (false, 7);
        return (true, 0);
    }
}
