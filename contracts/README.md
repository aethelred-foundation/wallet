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

## Gas budgets + snapshots + aspirational targets

**Three levels** of gas defence, each catching a different failure mode:

1. **Regression-prevention budgets** ([`gas-budgets.json`](./gas-budgets.json)).
   CI fails if any function's Max gas exceeds its absolute ceiling.
   Catches: "feature added 50k gas past the budget."
2. **Gas snapshot** ([`.gas-snapshot`](./.gas-snapshot)). CI fails if any
   test's gas differs from the committed snapshot — even if still under
   budget. Catches: "refactor silently added 5k gas that stayed under
   budget." Run `forge snapshot` before every commit that touches
   contracts.
3. **Aspirational targets** (tracked in the table below, not enforced).
   Goals for future optimisation work.

| Function | Current Max | Budget | Aspirational target |
|----------|------------:|-------:|--------------------:|
| `AgentBudget.createBudget` | 165790 | 182000 | ≤ 120k |
| `AgentBudget.spend` (cold-window) | 127575 | 140500 | ≤ 60k warm |
| `AgentBudget.revokeSession` | 51508 | 56700 | ≤ 30k |
| `AgentBudget.grantSession` | 78047 | 86000 | — |
| `Notary.anchor` | 91375 | 100600 | ≤ 70k |
| `Notary.deployment` | 250164 | 265000 | — |

### Regenerating

```bash
# Budgets — absolute ceilings:
forge test --gas-report > gas-report.txt      # produce the report
npm run gas:check                             # verify against budget
npm run gas:measure                           # dump current Max values

# Snapshot — per-test drift detection:
npm run gas:snapshot                          # regenerate .gas-snapshot
npm run gas:snapshot:check                    # verify committed snapshot matches current
```

### Developer workflow

**Every commit that touches `src/**` or `test/**` regenerates `.gas-snapshot`:**

```bash
# In a contracts-changing PR:
forge test                                    # must pass
forge snapshot                                # regenerate .gas-snapshot
git add .gas-snapshot                         # commit alongside your change
# If budget also needs to bump:
npm run gas:measure | ...                     # inspect new max values
# Update gas-budgets.json in the same commit.
```

If you skip the snapshot regeneration, CI fails with `forge snapshot --check` and the error clearly indicates which test's gas drifted.

### When to bump a budget

**Downward** (easy case): an optimisation commit lowers `currentMax` for
a function. Regenerate `gas-budgets.json` + `.gas-snapshot` in the same
commit to capture the improvement.

**Upward** (hard case): a feature commit adds gas to a function. Bump
the budget + regenerate the snapshot IN THE SAME COMMIT. Never
retroactively — each PR that adds gas must justify it in the commit
message.

## Security posture

- No admin, no pause, no upgrade — both contracts are immutable.
- No external calls except the ERC-20 `transferFrom` in
  `AgentBudget.spend` and the native-value transfer.
- Custom errors throughout; no `require` with string reasons.
- Storage layout pinned — slot indices documented in the TS ABI
  constants.

External audit scope + findings will land under `audits/` when
engaged.
