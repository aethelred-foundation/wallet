# `@aethelred/wallet-transfer-solver`

Second production-shape solver implementation for the intent-router's
marketplace. Accepts `TransferIntent`, builds ERC-20 (or native-value)
calldata, submits via a pluggable chain provider, and polls the
receipt into an intent-router `Fill`.

## Why this package exists

The x402-solver (`@aethelred/wallet-x402-solver`) proved the `Solver`
pattern works for one intent kind. This package proves the pattern
**composes across intent kinds** — same contract, same shape,
different backend:

| Package | Intent kind | Backend |
|---------|-------------|---------|
| `x402-solver` | `payment` | HTTP facilitator (`x402Fetch`) |
| `transfer-solver` | `transfer` | Raw chain tx (`AnchorChainProvider`) |

Two concrete solvers, same interface. That's the proof that swap
solvers (Uniswap / CoW / 1inch), bespoke liquidity venues, and
enterprise payment rails can all slot in without the intent-router
needing to change.

## Quick start

```ts
import {
  InMemorySolverRegistry,
  IntentRouter,
  createSignedIntent,
} from "@aethelred/wallet-intent-router";
import { RpcAnchorChainProvider } from "@aethelred/wallet-rpc-adapters";
import { LocalKeyAdapter } from "@aethelred/wallet-custody-adapters";
import { TransferSolver } from "@aethelred/wallet-transfer-solver";

// 1. A chain provider. RpcAnchorChainProvider works out-of-the-box;
//    any `{ chainId, sendTransaction, getTransactionReceipt }` does.
const provider = new RpcAnchorChainProvider({
  chainId: 8453,
  rpc: { url: process.env.RPC_URL! },
  signAndEncodeTx: /* your custody signer (Nitro / Ledger / LocalKey) */,
});

// 2. Instantiate the solver.
const custody = new LocalKeyAdapter({ privateKey: process.env.PK! });
const solver = new TransferSolver({
  id: "transfer:base-mainnet",
  name: "Aethelred Transfer Solver (Base mainnet)",
  from: custody.address,              // must match intent.creator
  provider,
  allowedAssets: [                    // optional allow-list
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC
    "0x0000000000000000000000000000000000000000", // native ETH
  ],
});

// 3. Register with the router.
const router = new IntentRouter({
  registry: new InMemorySolverRegistry([solver]),
});

// 4. Submit a transfer intent.
const intent = await createSignedIntent({
  body: {
    kind: "transfer",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC
    amount: "1000000",                                   // 1 USDC
    recipient: "0xRecipientAddress…",
  },
  creator: custody.address,
  chainId: 8453,
  deadlineMs: Date.now() + 5 * 60_000,
  signer: custody.asTypedDataSigner(),
});

const result = await router.execute(intent);
if (result.outcome.kind === "fulfilled") {
  console.log("Tx hash:", result.outcome.fill.settlementRef);
  console.log("Block:", result.outcome.fill.metadata?.receipt.blockNumber);
}
```

## Design

### Commitment = exact amount (strict equality)

Transfer intents are "move exactly N" semantics. The intent-router's
`verifyFillAgainstQuote` enforces:

| Intent kind | Rule |
|-------------|------|
| `payment` | `actualAmount <= commitment` (under-spending is fine) |
| `transfer` | `actualAmount === commitment` (strict equality) |
| `swap` | `actualAmount >= commitment` (buyAmount floor) |

So this solver's `quote.commitment = intent.body.amount`, verbatim.
No optimism, no slippage, no ceiling semantics. The `settle()` path
returns `actualAmount = amount` exactly or throws.

### Native vs ERC-20 — one sentinel, two code paths

`asset === 0x0000000000000000000000000000000000000000` is the native
sentinel (ETH on mainnet, native gas token on any EVM chain). The
solver auto-detects:

| Asset | tx.to | tx.data | tx.value |
|-------|-------|---------|----------|
| ERC-20 (e.g. USDC) | token contract | `0xa9059cbb` + padded args | (none) |
| Native sentinel | recipient | `0x` (empty) | `amount` (wei) |

Same `AnchorChainProvider`, two transaction shapes.

### Declines-as-null / failures-as-throw

Follows the intent-router's `Solver` contract:

| Condition | Return |
|-----------|--------|
| Non-transfer intent | `quote → null` |
| Creator ≠ configured `from` | `quote → null` |
| `provider.chainId ≠ intent.chainId` | `quote → null` + `settle → throws chain-id-mismatch` |
| Intent past deadline | `quote → null` |
| Invalid asset / recipient hex | `quote → null` / `settle → throws` |
| Asset outside `allowedAssets` | `quote → null` |
| Zero / negative amount | `quote → null` / `settle → throws invalid-amount` |
| `sendTransaction` throws | `settle → throws chain-submit-failed` |
| Receipt `status === "reverted"` | `settle → throws chain-tx-reverted` |
| Receipt never appears | `settle → throws chain-confirmation-timeout` |

`null` declines let the router try another solver; throws route
through `settlement-failed`.

### Receipt polling

Same wall-clock loop pattern as `anchor-client`:

```
sendTransaction → txHash
      │
      ▼
  loop:
    getTransactionReceipt(txHash)
      ├─ receipt → break
      └─ null   → if now() < deadline: sleep(pollIntervalMs); continue
                 else: throw chain-confirmation-timeout
```

Wall-clock tracking (`this.now() >= deadline`) — not attempt-count —
so deterministic-time test doubles (`sleep: async () => {}` +
scripted `now: () => tick++`) exercise the timeout branch without
real wall time.

Defaults:
- `pollIntervalMs`: 2000 (2s)
- `pollTimeoutMs`: 120000 (2 min) — comfortable single-confirm on L2
- `quoteValidityMs`: 60000 (1 min)
- `estimatedFillTimeMs`: 15000 (15s)

### Chain provider is pluggable

The `TransferChainProvider` alias is a semantic re-export of
`@aethelred/wallet-notarization`'s `AnchorChainProvider`. Any of
these drop in:

- `RpcAnchorChainProvider` from `@aethelred/wallet-rpc-adapters`
- A viem / ethers wrapper you write
- A custom JSON-RPC adapter
- An in-memory test double (see `apps/extension/src/test/transfer-solver.test.ts`)

### Fill metadata carries the full receipt

`Fill.metadata` is typed as `TransferSolverFillMetadata`:

```ts
{
  solverClass: "transfer";
  chainId: number;
  receipt: TxReceipt;   // transactionHash, blockNumber, status, logs
}
```

Consumers wanting block number / logs for reconciliation read
`fill.metadata.receipt.blockNumber` — no second RPC call needed.

### Signer enforcement

`quote()` and `settle()` both check
`intent.envelope.creator == config.from`. Quote returns null (fast
decline); settle throws `signer-mismatch`. The double-check is
belt-and-braces — the intent-router already validates the EIP-712
signature before reaching here, but a misconfigured `from` is a
deploy mistake we catch at runtime anyway.

The solver **does not sign** — that's the chain provider's job.
`RpcAnchorChainProvider` has its own `signAndEncodeTx` slot that
typically wires into a `CustodyAdapter` (Nitro / Ledger / LocalKey).
This decouples "which intent is being served" (solver) from "who
holds the key" (custody).

## Errors

All failures throw `TransferSolverError` with a stable `code`:

| Code | When |
|------|------|
| `unsupported-intent-kind` | `settle()` called with non-transfer intent |
| `invalid-asset-address` | Asset isn't 20-byte hex |
| `invalid-recipient-address` | Recipient isn't 20-byte hex |
| `invalid-amount` | Amount 0, negative, unparseable, or uint256 overflow |
| `chain-submit-failed` | `provider.sendTransaction` or `.getTransactionReceipt` threw |
| `chain-confirmation-timeout` | Receipt never appeared within `pollTimeoutMs` |
| `chain-tx-reverted` | Receipt returned with `status === "reverted"` |
| `chain-id-mismatch` | `intent.chainId ≠ provider.chainId` at settle time |
| `solver-disposed` | Solver used after `dispose()` |
| `signer-mismatch` | Intent creator ≠ configured `from` |

Consumers branch on `code`, never on `message`.

## Testing

```bash
npx vitest run transfer-solver
```

24 tests covering: identity (2), quote declines (7 conditions),
quote happy path + native metadata, settle declines (4 conditions),
settle happy path — ERC-20 calldata shape + Fill (1) and polling
across multiple null receipts (1) and native value transfer (1),
settle failure modes (4: submit-throw / reverted / timeout /
receipt-rpc-flake), dispose semantics + error class export.

## What this package DOES NOT do

- **Sign transactions.** Signing lives in the chain provider's
  `signAndEncodeTx` slot (typically a `CustodyAdapter`). This solver
  only assembles calldata and submits. Enforces separation of
  "selecting intent → moving value" from "controlling the key."
- **Implement non-transfer intent kinds.** Payment intents route to
  `x402-solver`; swap intents need a DEX-backed solver (Uniswap /
  CoW / 1inch). Each is a separate package implementing the same
  `Solver` contract.
- **Handle retries.** If `sendTransaction` throws or the receipt
  reverts, the solver throws — the intent-router's `settlement-failed`
  path is the recovery vector. Solver-level retries would hide
  signal from the router's observability.
- **Enforce per-intent spend caps.** Use
  `@aethelred/wallet-agent-budget` via `AgentBudgetGate` for on-chain
  budget enforcement before the router dispatches to this solver.

## Composition with the rest of the stack

- **Custody adapters** sign the raw tx inside the chain provider
  (Nitro / Ledger / Shamir / LocalKey).
- **rpc-adapters** provides `RpcAnchorChainProvider`, the reference
  chain-provider implementation.
- **Intent-router** hosts the solver in its `SolverRegistry`.
- **Reputation bridge** (via `ReputationTransferGate`, when added)
  evaluates VC gates before the router calls this solver.
- **Agent-budget** (via `AgentBudgetGate`) enforces on-chain spend
  caps before the router calls this solver.
- **Paymaster-sponsor** covers gas separately via a 4337 paymaster;
  this solver doesn't interact with it directly.
- **Notarization** picks up the audit trail downstream; the full
  receipt embedded in `Fill.metadata.receipt` is the anchor for
  reconciliation.

The fact that this solver — with a completely different backend
mechanic (chain tx) from x402-solver (HTTP facilitator) — composes
cleanly with all of the above through the same `Solver` interface
is the proof that the moat's composability story is real, not
aspirational.
