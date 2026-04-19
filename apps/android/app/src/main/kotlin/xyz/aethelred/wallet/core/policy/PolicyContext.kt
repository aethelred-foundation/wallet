package xyz.aethelred.wallet.core.policy

/**
 * Evaluation context fed into [PolicyEngine.evaluate].
 *
 * Kept immutable so multiple policy evaluators can receive the same
 * context without the first one's side-effects (e.g. velocity counter
 * increments) leaking into the second.
 *
 * @property originator Connected-app identifier or "local" for user-initiated flows.
 * @property intent Wallet-connect JSON-RPC method name (e.g. `eth_sendTransaction`).
 * @property amountUsd Approximate USD value of the transaction, if known.
 * @property chainId Chain identifier the transaction targets.
 * @property timestampMs Millisecond clock at evaluation time.
 */
public data class PolicyContext(
    public val originator: String,
    public val intent: String,
    public val amountUsd: Double?,
    public val chainId: Long,
    public val timestampMs: Long,
)
