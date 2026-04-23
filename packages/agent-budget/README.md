# `@aethelred/wallet-agent-budget`

On-chain per-agent rolling-window spend caps + scoped session keys.

The **trust boundary** between a parent agent (EOA / smart account
/ Nitro-rooted treasury) and the short-lived session keys it delegates
to. Parent sets the caps; session keys spend within them; the contract
enforces both sides.

## Why this package exists

MoltPe's spending model is "the wallet has a balance; debit freely."
That's fine until an agent goes rogue at 3am. Three failure modes
nobody wants to field in production:

1. **Runaway loops** — an agent with a bug spends the whole balance
   on retries.
2. **Scope creep** — a short-lived session key signs months later
   because nothing rotates it.
3. **Revocation races** — the owner hits "revoke" but pre-signed
   user-ops already in the mempool still execute.

`AgentBudget` addresses all three on-chain: rolling window caps bound
runaway spend, expiresAt bounds scope creep, and every `spend()`
reads the Session struct so revocation kicks in instantly — even for
pre-signed transactions.

## Three entities, three concerns

```
       ┌─────────┐        ┌────────┐      ┌────────┐
owner ─┤ Budget  │◄───────┤ Session├──────┤ Spend  │
       │ caps +  │ grants │ scoped │debits│ gated  │
       │ window  │        │ key    │      │ action │
       └─────────┘        └────────┘      └────────┘
```

- **Budget** — the pool and caps (dailyCap, perTxCap, windowSeconds),
  owned by the parent. Exists forever unless revoked.
- **Session** — a scoped, expiring, revocable grant of spending
  rights on one budget to one session key.
- **Spend** — the gated action. Reads Session every call so
  revocation takes effect atomically.

Collapsing Session into Spend (as naive "limits" do) makes revocation
a race. Our contract keeps them separate.

## Quick start

```ts
import {
  BudgetClient,
  LocalSessionKey,
} from "@aethelred/wallet-agent-budget";

// 1. Parent agent prepares a budget-creation calldata to submit
//    via its EOA / smart-account / relayer.
const client = new BudgetClient({
  contract: "0x...",
  provider: myChainProvider,  // viem / ethers / custom RPC
  chainId: 8453,
});
const { to, data } = client.prepareCreateBudget({
  asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",   // USDC
  dailyCap: 100_000_000n,     // $100 per day
  perTxCap: 10_000_000n,      // max $10 per call
  windowSeconds: 86_400n,     // 24h rolling window
});
// submit { to, data } via your wallet-core / bundler.

// 2. Parent generates a session key and grants it on-chain.
const session = LocalSessionKey.generate({
  budgetId: 0n,
  expiresAt: BigInt(Math.floor(Date.now() / 1000) + 3600),  // 1h
  perCallCap: 1_000_000n,
});
const grant = client.prepareGrantSession({
  budgetId: 0n,
  sessionKey: session.address,
  expiresAt: session.metadata.expiresAt,
  perCallCap: session.metadata.perCallCap,
});

// 3. The session key now signs x402 payments, intents, etc. —
//    anywhere a `TypedDataSigner` is expected.
const signer = session;   // LocalSessionKey implements TypedDataSigner

// 4. Pre-flight: does the budget still permit this spend?
const check = await client.canSpend(session.address, 500_000n);
if (!check.ok) {
  console.log("budget rejects:", check.reason);
  // session-expired / daily-cap-exceeded / per-call-cap-exceeded / ...
}

// 5. When you're done, revoke + zeroize.
const revoke = client.prepareRevokeSession({ sessionKey: session.address });
session.dispose();   // zero the in-memory private key
```

## What this package DOES

- Ships the canonical `AgentBudget.sol` contract source under
  `contracts/` as the reference the TS client targets.
- Derives all function selectors from signature strings at module
  load — no hand-edited hex to drift against the contract.
- Encodes calldata for every write function with strict argument
  validation (zero amounts rejected, uint256 overflow guarded,
  addresses length-checked).
- Decodes `canSpend`, `remainingInWindow`, and every event topic
  into typed results.
- Implements `LocalSessionKey` — an in-memory secp256k1 keypair
  that satisfies `TypedDataSigner` so x402, intent-router, and MCP
  tools consume session keys unchanged.
- Zeroizes session-key bytes on `dispose()`.

## What this package DOES NOT do

- Submit transactions. Callers feed `PreparedCall` into their own
  signer / bundler / wallet-core. Keeping the signing out means
  the same client works under EOA flows, ERC-4337 user-ops, and
  paymaster-sponsored flows.
- Deploy `AgentBudget.sol` itself. The Solidity source is reference-
  only — actual deployment + audit happens in the contracts repo.
  The TS selectors pin to the ABI, not to any specific bytecode.
- Take a viem / ethers dep. A minimal `ChainProvider` interface is
  consumed. Production code wires viem / ethers / custom JSON-RPC
  behind that interface.

## Error codes

All errors throw `AgentBudgetError` with a stable `code`. The codes
mirror the on-chain custom errors + client-side validation paths.
Consumers branch on `code`, never on `message`:

| Category          | Codes |
| ----------------- | ----- |
| Lifecycle         | `budget-not-found`, `budget-revoked`, `session-not-found`, `session-already-exists`, `session-expired`, `session-revoked`, `not-owner`, `invalid-window`, `zero-amount` |
| Caps              | `per-call-cap-exceeded`, `per-tx-cap-exceeded`, `daily-cap-exceeded` |
| Client-side       | `calldata-encode-failed`, `provider-call-failed`, `chain-id-mismatch`, `session-key-invalid`, `session-key-disposed` |

## Integration with the rest of the stack

- **x402 client** — `session.asTypedDataSigner()` plugs directly
  into `x402Fetch`. Every payment signed by the session key is
  gated on `canSpend` before the user-op is submitted.
- **Intent router** — the router's optional `paymentGate` can be
  composed with `client.canSpend(...)` so `spend-policy-violation`
  surfaces in the router's `IntentExecutionResult.outcome`.
- **MCP server** — tools that spend (e.g. `send_payment`) wrap
  `client.assertCanSpend` in their pre-call policy gate. Rejected
  calls never reach the handler.
- **Custody adapters** — parent agents sign the `grantSession` /
  `revokeSession` calls with any adapter (Nitro, Ledger, Shamir).
  The session key itself is a LocalKey — cheap, disposable, revocable.

## Testing

```bash
npx vitest run agent-budget
```

33 tests cover: ABI-selector derivation (regression guard),
calldata encoder output + reject zero/negative/overflow, view
decoders for uint256 and `(bool, uint8)`, indexed-address /
indexed-uint256 topic unpacking, `BudgetClient` chain-id mismatch
at construction + `canSpend`/`assertCanSpend`/provider-error
wrapping, log parsing for BudgetCreated / Spent / SessionGranted
plus unknown-topic graceful skip, `LocalSessionKey`
generate/sign/dispose/expiry lifecycle + fromPrivateKey parity with
`LocalKeyAdapter`, struct decoders for Budget + Session.
