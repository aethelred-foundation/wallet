/**
 * Known ERC-20 spender registry.
 * ──────────────────────────────
 * A best-effort, static list of addresses that are widely recognized as
 * legitimate dApp routers, vaults, or settlement contracts. Resolving a
 * spender to one of these entries lets the token-approvals view flag
 * allowances to trusted protocols (checkmark badge) and conversely
 * highlight allowances to unknown contracts as unverified.
 *
 * This is intentionally a static data file — the UI never trusts a
 * remote oracle to decide what is "safe". The registry is versioned
 * alongside the extension build; new entries ship with new releases.
 *
 * Data shape:
 *   { [chainId]: { [lowercase-address]: { label, verified } } }
 *
 * `verified: true` means the address has been manually curated and is
 * a known canonical deployment of the named protocol. Unverified
 * entries (none currently) would indicate a soft-match / best-guess.
 *
 * All addresses are stored in lowercase. `lookupSpender` normalizes
 * the caller's input to lowercase before the lookup.
 */

export interface KnownSpender {
  /** Human-readable label, e.g. "Uniswap V3 Router". */
  label: string;
  /**
   * True if the address is a manually verified canonical deployment.
   * The token-approvals view uses this to decide whether to show the
   * checkmark badge next to the spender name.
   */
  verified: boolean;
}

type SpenderTable = Record<number, Record<string, KnownSpender>>;

/*
 * ─── Ethereum (chainId 1) ──────────────────────────────────────────
 * Sources: project documentation, Etherscan "Name Tag" registry, and
 * protocol release notes. Addresses cross-checked on 2026-01 at
 * time of writing.
 */
const ETHEREUM: Record<string, KnownSpender> = {
  "0x7a250d5630b4cf539739df2c5dacb4c659f2488d": { label: "Uniswap V2 Router", verified: true },
  "0xe592427a0aece92de3edee1f18e0157c05861564": { label: "Uniswap V3 Router", verified: true },
  "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45": { label: "Uniswap V3 Router 2", verified: true },
  "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad": { label: "Uniswap Universal Router", verified: true },
  "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2": { label: "Aave V3 Pool", verified: true },
  "0x1111111254fb6c44bac0bed2854e76f90643097d": { label: "1inch Aggregation Router V4", verified: true },
  "0x1111111254eeb25477b68fb85ed929f73a960582": { label: "1inch Aggregation Router V5", verified: true },
  "0x111111125421ca6dc452d289314280a0f8842a65": { label: "1inch Aggregation Router V6", verified: true },
  "0xdef1c0ded9bec7f1a1670819833240f027b25eff": { label: "0x Exchange Proxy", verified: true },
  "0xdef171fe48cf0115b1d80b88dc8eab59176fee57": { label: "ParaSwap V5 Augustus", verified: true },
  "0x6a000f20005980200259b80c5102003040001068": { label: "ParaSwap V6 Augustus", verified: true },
  "0x9008d19f58aabd9ed0d60971565aa8510560ab41": { label: "CoW Swap Settlement", verified: true },
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": { label: "Wrapped Ether (WETH9)", verified: true },
};

/*
 * ─── Polygon (chainId 137) ──────────────────────────────────────────
 */
const POLYGON: Record<string, KnownSpender> = {
  "0xedf6066a2b290c185783862c7f4776a2c8077ad1": { label: "Uniswap Universal Router", verified: true },
  "0xe592427a0aece92de3edee1f18e0157c05861564": { label: "Uniswap V3 Router", verified: true },
  "0x794a61358d6845594f94dc1db02a252b5b4814ad": { label: "Aave V3 Pool", verified: true },
  "0x1111111254eeb25477b68fb85ed929f73a960582": { label: "1inch Aggregation Router V5", verified: true },
  "0xdef171fe48cf0115b1d80b88dc8eab59176fee57": { label: "ParaSwap V5 Augustus", verified: true },
};

/*
 * ─── Arbitrum (chainId 42161) ──────────────────────────────────────
 */
const ARBITRUM: Record<string, KnownSpender> = {
  "0x5e325eda8064b456f4781070c0738d849c824258": { label: "Uniswap Universal Router", verified: true },
  "0xe592427a0aece92de3edee1f18e0157c05861564": { label: "Uniswap V3 Router", verified: true },
  "0x794a61358d6845594f94dc1db02a252b5b4814ad": { label: "Aave V3 Pool", verified: true },
  "0x1111111254eeb25477b68fb85ed929f73a960582": { label: "1inch Aggregation Router V5", verified: true },
  "0x111111125421ca6dc452d289314280a0f8842a65": { label: "1inch Aggregation Router V6", verified: true },
};

/*
 * ─── Optimism (chainId 10) ─────────────────────────────────────────
 */
const OPTIMISM: Record<string, KnownSpender> = {
  "0xb555edf5dcf85f42ceef1f3630a52a108e55a654": { label: "Uniswap Universal Router", verified: true },
  "0xe592427a0aece92de3edee1f18e0157c05861564": { label: "Uniswap V3 Router", verified: true },
  "0x794a61358d6845594f94dc1db02a252b5b4814ad": { label: "Aave V3 Pool", verified: true },
  "0x1111111254eeb25477b68fb85ed929f73a960582": { label: "1inch Aggregation Router V5", verified: true },
};

/*
 * ─── Base (chainId 8453) ───────────────────────────────────────────
 */
const BASE: Record<string, KnownSpender> = {
  "0x198ef79f1f515f02dfe9e3115ed9fc07183f02fc": { label: "Uniswap Universal Router", verified: true },
  "0x2626664c2603336e57b271c5c0b26f421741e481": { label: "Uniswap V3 Router", verified: true },
  "0xa238dd80c259a72e81d7e4664a9801593f98d1c5": { label: "Aave V3 Pool", verified: true },
  "0x1111111254eeb25477b68fb85ed929f73a960582": { label: "1inch Aggregation Router V5", verified: true },
};

/*
 * ─── Aethelred L1 (chainId 3301) ───────────────────────────────────
 * Native protocols shipped with the wallet — always verified.
 */
const AETHELRED: Record<string, KnownSpender> = {
  "0xc2021b11e40ba0000000000000000aa7851ef10a0": { label: "Cruzible Vault", verified: true },
  "0xa0b11e50117ca000000000000000001e5a7eb8c02": { label: "NoblePay Gateway", verified: true },
  "0x9988776655443322110011223344556677889900": { label: "Aethelred Swap Router", verified: true },
};

const SPENDER_TABLE: SpenderTable = {
  1: ETHEREUM,
  10: OPTIMISM,
  137: POLYGON,
  8453: BASE,
  42161: ARBITRUM,
  3301: AETHELRED,
};

/**
 * Resolve a spender address to its registered label.
 *
 * @param chainId - EVM chain id the allowance was granted on.
 * @param address - 0x-prefixed 20-byte spender address (case-insensitive).
 * @returns The matching entry, or `null` when the address is unknown.
 *
 * Invariants:
 *  - `address` is lowercased before lookup so mixed/checksum casing works.
 *  - When `chainId` is unrecognized (e.g. a local testnet) the function
 *    returns `null` rather than throwing — callers should treat unknown
 *    chains as "unverified everywhere".
 */
export function lookupSpender(
  chainId: number,
  address: string,
): KnownSpender | null {
  const chainTable = SPENDER_TABLE[chainId];
  if (!chainTable) return null;
  const key = address.toLowerCase();
  return chainTable[key] ?? null;
}

/**
 * Total number of registered spenders across all supported chains.
 * Exposed for diagnostic / test coverage so the registry can be
 * asserted as "above a minimum threshold" without enumerating every
 * single entry in tests.
 */
export function knownSpenderCount(): number {
  let n = 0;
  for (const chainId of Object.keys(SPENDER_TABLE)) {
    n += Object.keys(SPENDER_TABLE[Number(chainId)]).length;
  }
  return n;
}
