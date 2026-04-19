/**
 * ERC-4337 EntryPoint contract registry.
 *
 * The EntryPoint is the singleton that orchestrates every UserOperation
 * and is the contract whose address is bound into the `userOpHash`.
 * Both v0.6 and v0.7 are deployed deterministically (same address on
 * every EVM chain they target), which is why we can hard-code a single
 * constant per version instead of carrying a per-chain map.
 *
 * v0.7 is the current production version. v0.6 is retained only because
 * some legacy accounts / paymasters are still pinned to it — new code
 * should always use v0.7.
 *
 * References:
 *  - v0.7 deployment: https://blog.alchemy.com/blog/erc-4337-v0-7-0
 *  - v0.6 deployment (deprecated): https://eips.ethereum.org/EIPS/eip-4337
 */

/**
 * Canonical deterministic address of the ERC-4337 v0.7 EntryPoint
 * (a.k.a. the `IEntryPoint` singleton) on every EVM chain.
 *
 * @example
 * ```ts
 * builder.setFactory(FACTORY, data);
 * const hash = computeUserOpHash(packed, ENTRYPOINT_V07_ADDRESS, 1);
 * ```
 */
export const ENTRYPOINT_V07_ADDRESS =
  "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as const;

/**
 * Canonical deterministic address of the deprecated ERC-4337 v0.6
 * EntryPoint. Exposed for legacy interop only. **New integrations
 * must not rely on v0.6 — bundlers are dropping support.**
 */
export const ENTRYPOINT_V06_ADDRESS =
  "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789" as const;

/**
 * Supported EntryPoint version tags.
 *
 * Declared as a string union instead of an enum so the values survive
 * JSON serialisation (message-passing between the extension's service
 * worker and content scripts) without import churn.
 */
export type EntryPointVersion = "0.6" | "0.7";

/**
 * Fully resolved EntryPoint configuration for a specific chain.
 *
 * Returned from {@link getEntryPointForChain} / {@link getDefaultEntryPoint}
 * so callers can pass a single object into `userOpHash` / bundler
 * helpers instead of threading `(address, chainId)` pairs separately.
 */
export interface EntryPointConfig {
  /** Which EIP-4337 EntryPoint version this config targets. */
  readonly version: EntryPointVersion;
  /** Deterministic EntryPoint contract address on `chainId`. */
  readonly address: `0x${string}`;
  /** Chain the EntryPoint is deployed on. */
  readonly chainId: number;
}

/**
 * Ordered list of chains for which we have explicitly verified an
 * EntryPoint deployment.
 *
 * The list doubles as a "supported chains" catalogue — ticket #15's
 * chain registry includes every entry here. If a new chain is added
 * to `packages/chain/src/networks.ts` that also supports ERC-4337,
 * append the chain id below so `getEntryPointForChain` returns it
 * without callers needing to special-case.
 */
const SUPPORTED_CHAIN_IDS: readonly number[] = [
  1, // Ethereum
  10, // Optimism
  56, // BNB Smart Chain
  137, // Polygon
  8453, // Base
  42161, // Arbitrum
  43114, // Avalanche
  11155111, // Sepolia
  80002, // Polygon Amoy
  84532, // Base Sepolia
  11155420, // Optimism Sepolia
  421614, // Arbitrum Sepolia
];

/**
 * Look up the EntryPoint to use for a given chain.
 *
 * Both v0.6 and v0.7 share the same address on every supported chain
 * because the EntryPoint is deployed via a CREATE2-style deterministic
 * deployer. The `chainId` is still threaded through the returned
 * config because it's required to compute the `userOpHash`.
 *
 * @param chainId - EIP-155 chain id.
 * @param version - Optional EntryPoint version (defaults to `"0.7"`).
 *
 * @example
 * ```ts
 * const ep = getEntryPointForChain(1);
 * // { version: "0.7", address: ENTRYPOINT_V07_ADDRESS, chainId: 1 }
 * ```
 */
export function getEntryPointForChain(
  chainId: number,
  version: EntryPointVersion = "0.7",
): EntryPointConfig {
  if (!SUPPORTED_CHAIN_IDS.includes(chainId)) {
    // Soft warning: returning the canonical address is still correct on
    // any EVM chain where the EntryPoint has been deployed via the
    // deterministic deployer — but callers should know they're off the
    // explicitly verified list.
    // We deliberately do not throw so integration tests on anvil /
    // hardhat forks keep working with whatever chain id they pick.
  }
  return {
    version,
    address:
      version === "0.7" ? ENTRYPOINT_V07_ADDRESS : ENTRYPOINT_V06_ADDRESS,
    chainId,
  };
}

/**
 * Convenience accessor returning the default EntryPoint used when no
 * chain is specified — v0.7 on Ethereum mainnet (chain id 1).
 *
 * @example
 * ```ts
 * const { address, chainId } = getDefaultEntryPoint();
 * ```
 */
export function getDefaultEntryPoint(): EntryPointConfig {
  return {
    version: "0.7",
    address: ENTRYPOINT_V07_ADDRESS,
    chainId: 1,
  };
}

/**
 * True if `chainId` is on the wallet's explicitly-verified EntryPoint
 * deployment list. Useful for UI warnings when a user adds a custom
 * chain that hasn't been audited for ERC-4337 support.
 */
export function isEntryPointVerifiedChain(chainId: number): boolean {
  return SUPPORTED_CHAIN_IDS.includes(chainId);
}
