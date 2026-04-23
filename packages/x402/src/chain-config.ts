/**
 * Chain-config table — maps a `PaymentNetwork` to its numeric
 * chainId and the canonical USDC contract address on that network.
 *
 * Adding a new network is a three-step edit:
 *
 *   1. Add the slug to `PaymentNetwork` in `./types.ts`.
 *   2. Add the row below.
 *   3. Add a test vector in `./test/chain-config.test.ts`.
 *
 * The TypeScript exhaustiveness checker catches step (2) as a
 * compile error if you skip it: `chainIdForNetwork` returns
 * `never` for an unhandled case. That is the feature; adding a
 * network without a chainId mapping is always an error at
 * compile time rather than a hard-to-diagnose runtime failure
 * inside the facilitator.
 */

import type { Address, PaymentNetwork } from "./types";
import { X402Error } from "./errors";

interface NetworkConfig {
  readonly chainId: number;
  /**
   * Canonical USDC (or native stable) contract for this network.
   * The asset field on a PaymentRequirement MUST match this for
   * vanilla USDC payments; receivers can override for other
   * EIP-3009 tokens (EURC, PYUSD) by setting `requirement.asset`
   * explicitly, which short-circuits the default below.
   */
  readonly usdc: Address;
  /** Human-readable label, shown in audit events + UI. */
  readonly label: string;
}

/**
 * Source of truth for chainId + canonical USDC address.
 *
 * Values pinned from Circle's official deployment list on
 * 2026-04-22. Verify against https://www.circle.com/en/usdc/developers
 * before shipping new networks to mainnet.
 */
const NETWORK_CONFIG: Readonly<Record<PaymentNetwork, NetworkConfig>> = {
  "base-mainnet": {
    chainId: 8453,
    usdc: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    label: "Base",
  },
  "base-sepolia": {
    chainId: 84532,
    usdc: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
    label: "Base Sepolia",
  },
  "polygon-mainnet": {
    chainId: 137,
    usdc: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
    label: "Polygon PoS",
  },
  "polygon-amoy": {
    chainId: 80002,
    usdc: "0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582",
    label: "Polygon Amoy",
  },
  "arbitrum-mainnet": {
    chainId: 42161,
    usdc: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
    label: "Arbitrum One",
  },
  "arbitrum-sepolia": {
    chainId: 421614,
    usdc: "0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d",
    label: "Arbitrum Sepolia",
  },
  "optimism-mainnet": {
    chainId: 10,
    usdc: "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
    label: "Optimism",
  },
  "optimism-sepolia": {
    chainId: 11155420,
    usdc: "0x5fd84259d66cd46123540766be93dfe6d43130d7",
    label: "Optimism Sepolia",
  },
  "ethereum-mainnet": {
    chainId: 1,
    usdc: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    label: "Ethereum",
  },
  "ethereum-sepolia": {
    chainId: 11155111,
    usdc: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
    label: "Ethereum Sepolia",
  },
};

/**
 * Return the numeric chainId for a network slug.
 *
 * @throws {@link X402Error} with code `unsupported-network` if
 *   the slug has no registered chainId. This SHOULD be impossible
 *   under the narrow `PaymentNetwork` union, but runtime input
 *   (JSON from the wire) can smuggle invalid values past the
 *   type-checker.
 */
export function chainIdForNetwork(network: PaymentNetwork): number {
  const cfg = NETWORK_CONFIG[network];
  if (!cfg) {
    throw new X402Error("unsupported-network", `No chainId registered for network "${network}"`);
  }
  return cfg.chainId;
}

/** Canonical USDC address for the network, if any. */
export function usdcAddressForNetwork(network: PaymentNetwork): Address {
  const cfg = NETWORK_CONFIG[network];
  if (!cfg) {
    throw new X402Error("unsupported-network", `No USDC address registered for network "${network}"`);
  }
  return cfg.usdc;
}

/** Human label — safe for UI + audit logs. */
export function labelForNetwork(network: PaymentNetwork): string {
  const cfg = NETWORK_CONFIG[network];
  return cfg ? cfg.label : network;
}

/**
 * Parse an arbitrary string (from the wire) into a `PaymentNetwork`.
 * Returns `null` on mismatch — the caller decides whether to throw.
 */
export function parsePaymentNetwork(raw: unknown): PaymentNetwork | null {
  if (typeof raw !== "string") return null;
  return raw in NETWORK_CONFIG ? (raw as PaymentNetwork) : null;
}
