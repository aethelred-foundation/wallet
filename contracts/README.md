# Aethelred contracts — `AgentBudget`, `Notary`

Foundry project for the two on-chain contracts that anchor the moat
stack. Both target Solidity 0.8.24 / EVM Cancun, with deterministic
CREATE2 deployment across chains.

## Contracts

- **`AgentBudget.sol`** — per-agent rolling-window spend caps + scoped
  session keys. See
  [`packages/agent-budget/README.md`](../packages/agent-budget/README.md)
  for the TS client that targets this ABI.
- **`Notary.sol`** — tamper-evident anchor for off-chain audit Merkle
  roots. See [`packages/notarization/README.md`](../packages/notarization/README.md).

## Quick start

```bash
cd contracts

# Compile
forge build

# Run tests
forge test -vv

# Check gas usage
forge test --gas-report

# Deploy to Base Sepolia (needs BASE_SEPOLIA_RPC + DEPLOYER_PRIVATE_KEY env)
forge script script/Deploy.s.sol:Deploy \
  --rpc-url base_sepolia --broadcast --verify
```

## Deterministic addresses via CREATE2

The deploy script uses a hard-coded salt (`AETHELRED_V1`) so the same
address is produced on every chain. Addresses are published in
`deployments.json` after each mainnet broadcast.

## Gas targets

| Function | Target | Actual |
|----------|-------:|-------:|
| `AgentBudget.createBudget` | ≤ 120k | see `gas-report.txt` |
| `AgentBudget.spend` (warm) | ≤ 60k | |
| `AgentBudget.revokeSession` | ≤ 30k | |
| `Notary.anchor` | ≤ 70k | |

Run `forge test --gas-report > gas-report.txt` to regenerate.

## Security posture

- No admin, no pause, no upgrade — both contracts are immutable.
- No external calls except the ERC-20 `transferFrom` in
  `AgentBudget.spend` and the native-value transfer.
- Custom errors throughout; no `require` with string reasons.
- Storage layout pinned — slot indices documented in the TS ABI
  constants.

External audit scope + findings will land under `audits/` when
engaged.
