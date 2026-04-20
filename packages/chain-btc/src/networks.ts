/**
 * Per-network Bitcoin parameter tables.
 *
 * Values cross-referenced against:
 *  - BIP-173 (§"Segwit address format") for the bech32 HRPs.
 *  - BIP-0032 / Bitcoin Core's `chainparams.cpp` for the base58 version
 *    bytes (P2PKH / P2SH / WIF).
 *  - SLIP-0044 for coin type allocations (0 = mainnet, 1 = every test net).
 *  - BIP-0325 for signet — signet intentionally reuses the testnet
 *    base58 and bech32 HRPs, so the values below are identical to
 *    `TESTNET_PARAMS` except for the network label.
 */

import { assertNever } from "@aethelred/wallet-observability";
import type { BitcoinNetworkParams } from "./types";

/**
 * Bitcoin mainnet parameters.
 *
 * @example
 * ```ts
 * import { MAINNET } from "@aethelred/wallet-chain-btc";
 * MAINNET.hrp;           // "bc"
 * MAINNET.p2pkhPrefix;   // 0x00
 * ```
 */
export const MAINNET: BitcoinNetworkParams = Object.freeze({
  name: "mainnet",
  bip44CoinType: 0,
  hrp: "bc",
  p2pkhPrefix: 0x00,
  p2shPrefix: 0x05,
  wifPrefix: 0x80,
}) as BitcoinNetworkParams;

/**
 * Bitcoin testnet parameters (Testnet3).
 *
 * @example
 * ```ts
 * import { TESTNET } from "@aethelred/wallet-chain-btc";
 * TESTNET.hrp;          // "tb"
 * TESTNET.p2pkhPrefix;  // 0x6f
 * ```
 */
export const TESTNET: BitcoinNetworkParams = Object.freeze({
  name: "testnet",
  bip44CoinType: 1,
  hrp: "tb",
  p2pkhPrefix: 0x6f,
  p2shPrefix: 0xc4,
  wifPrefix: 0xef,
}) as BitcoinNetworkParams;

/**
 * Bitcoin regtest parameters. Uses the `bcrt` HRP defined by Bitcoin Core.
 */
export const REGTEST: BitcoinNetworkParams = Object.freeze({
  name: "regtest",
  bip44CoinType: 1,
  hrp: "bcrt",
  p2pkhPrefix: 0x6f,
  p2shPrefix: 0xc4,
  wifPrefix: 0xef,
}) as BitcoinNetworkParams;

/**
 * Signet parameters. Per BIP-325 §"Address format", signet deliberately
 * reuses testnet prefixes so existing tooling just works; the network is
 * distinguished by the message-start magic bytes, not the address shape.
 */
export const SIGNET: BitcoinNetworkParams = Object.freeze({
  name: "signet",
  bip44CoinType: 1,
  hrp: "tb",
  p2pkhPrefix: 0x6f,
  p2shPrefix: 0xc4,
  wifPrefix: 0xef,
}) as BitcoinNetworkParams;

/**
 * Registry of every network the package knows about.
 *
 * The ordering is mainnet-first → test nets, matching how the EVM
 * registry orders mainnets above testnets.
 */
export const ALL_BITCOIN_NETWORKS: readonly BitcoinNetworkParams[] = Object.freeze([
  MAINNET,
  TESTNET,
  SIGNET,
  REGTEST,
]) as readonly BitcoinNetworkParams[];

/**
 * Look up the parameter set for a given network name.
 *
 * @example
 * ```ts
 * const params = getNetworkParams("mainnet");
 * ```
 */
export function getNetworkParams(network: import("./types").BitcoinNetwork): BitcoinNetworkParams {
  switch (network) {
    case "mainnet":
      return MAINNET;
    case "testnet":
      return TESTNET;
    case "signet":
      return SIGNET;
    case "regtest":
      return REGTEST;
    default:
      return assertNever(network, "chain-btc.getNetworkParams");
  }
}
