# `@aethelred/wallet-rpc-adapters`

JSON-RPC-backed implementations of the chain-provider interfaces
consumed by the `agent-budget` and `notarization` packages.

**Zero external dependencies.** Hand-rolled `fetch`-based transport
plus two thin adapter classes — ~180 LOC total. Production consumers
can still swap viem / ethers behind the same interfaces if they
prefer, without touching any upstream package.

## Why this package exists

Every moat package that talks to a chain defines its own minimal
`*Provider` interface (`AnchorChainProvider`, `ChainProvider`). The
integration package ships simulator implementations that behave
byte-identically to the real thing so the demo runs in `vitest`.

This package ships the **production** implementations — backed by a
real JSON-RPC endpoint. Pick the simulator for tests + pitches; pick
the RPC adapter for live deployments.

## Quick start

```ts
import {
  FetchJsonRpcTransport,
  RpcAnchorChainProvider,
  RpcBudgetChainProvider,
  DETERMINISTIC_ADDRESSES,
} from "@aethelred/wallet-rpc-adapters";
import { OnChainAnchorAdapter } from "@aethelred/wallet-notarization";
import { BudgetClient } from "@aethelred/wallet-agent-budget";

const transport = new FetchJsonRpcTransport({
  url: process.env.BASE_RPC!,   // https://mainnet.base.org
  headers: { Authorization: `Bearer ${process.env.API_KEY}` },
});

// Wire the notarization stack to a real chain.
const anchorProvider = new RpcAnchorChainProvider({
  transport,
  chainId: 8453,
  signAndEncodeTx: async (req) => mySigner.signTx(req),
});
const anchorAdapter = new OnChainAnchorAdapter({
  provider: anchorProvider,
  contract: DETERMINISTIC_ADDRESSES.Notary,
  chainId: 8453,
});

// Wire the budget stack.
const budgetProvider = new RpcBudgetChainProvider({
  transport,
  chainId: 8453,
});
const budgetClient = new BudgetClient({
  contract: DETERMINISTIC_ADDRESSES.AgentBudget,
  provider: budgetProvider,
  chainId: 8453,
});

// Same-shape: `await budgetClient.canSpend(sessionKey, amount)` etc.
// Drop-in replacement for the simulator.
```

## What ships

### `FetchJsonRpcTransport`

Minimal JSON-RPC 2.0 client over `fetch`. Rejects with a typed
`JsonRpcError` on non-2xx HTTP, RPC-level errors, or malformed
responses. No batching, no subscriptions — swap viem for those.

### `RpcAnchorChainProvider`

Implements `AnchorChainProvider` (from `@aethelred/wallet-notarization`)
via `eth_sendRawTransaction` + `eth_getTransactionReceipt`. Signing
is pluggable via a `signAndEncodeTx` callback — the provider stays
unopinionated about the custody backend.

### `RpcBudgetChainProvider`

Implements `ChainProvider` (from `@aethelred/wallet-agent-budget`)
via `eth_call` + `eth_getLogs`. Pure read + log-scan — write paths
flow through the caller's own signer.

### `DETERMINISTIC_ADDRESSES`

Pinned contract addresses produced by the Foundry CREATE2 deploy
script. Same addresses on every chain that hosts the canonical
CREATE2 deployer:

```
AgentBudget: 0x801D88B922f6B1BDD047EEfa0eE8e41dCDb694bC
Notary:      0xaf9923CD404d3124C092E50A94327B2e56343370
Salt:        0xae2afe54a4e176bd4e65767beb247b7f61d320e637ab6231233853cef800373a
```

Cross-check against `contracts/deployments.json`.

## Error codes

`JsonRpcError` surfaces four stable codes:

| Code | When |
|------|------|
| `transport-failed` | `fetch` rejected (DNS / connection / abort) |
| `http-status` | HTTP response was non-2xx |
| `malformed-response` | Response body was not JSON |
| `rpc-error` | Server returned a JSON-RPC-level error (`.data` / `.rpcCode` carried through) |

## Testing

```bash
npx vitest run rpc-adapters
```

15 tests cover: JSON-RPC wire-format + id correlation + error
taxonomy (4 codes), anchor-provider send + receipt-normalise +
status mapping + null-on-unmined, budget-provider call/getLogs
block-tag serialisation + log normalisation, pinned-address
consistency with the Foundry deploy output.

## Composability

Every interface in this package is a tiny contract already owned by
the upstream package. You can:

- Use `FetchJsonRpcTransport` standalone for any JSON-RPC call.
- Inject a viem-backed `JsonRpcTransport` impl if your deployment
  already runs viem elsewhere.
- Swap `RpcAnchorChainProvider` for a Cloudflare Worker + GraphQL
  resolver that your infra team wraps around the same contract.

The goal is **shape compatibility** across every transport option —
chain packages never know which RPC backend is plumbed behind them.
