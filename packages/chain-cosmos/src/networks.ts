/**
 * Native (Cosmos-side) network registry.
 *
 * The EVM face of Aethelred lives in `@aethelred/wallet-chain`'s
 * `networks.ts` (eip155 / chain-id 7332). This module carries the metadata
 * the NATIVE side needs — bech32 HRP, bank denom, signature algorithm, and
 * LCD/CometBFT endpoints — which the EVM registry deliberately does not
 * model.
 */

import type { SignatureAlgo } from "./address";

/** Everything the native tx path needs to know about one Cosmos chain. */
export interface CosmosChainParams {
  /** Cosmos chain id string (goes into the SignDoc; MUST match the node). */
  readonly chainId: string;
  /** bech32 account prefix (`aethel` → `aethel1…`). */
  readonly hrp: string;
  /** bech32 validator-operator prefix (`aethelvaloper1…`). */
  readonly valoperHrp: string;
  /** Bank denom used for fees and native transfers. */
  readonly denom: string;
  /** Human ticker for UI display. */
  readonly displayDenom: string;
  /** Decimals of `denom` relative to `displayDenom`. */
  readonly decimals: number;
  /** SLIP-44 coin type of the account HD path. */
  readonly coinType: number;
  /** Key/signature algorithm — drives address derivation + SignDoc digest. */
  readonly signatureAlgo: SignatureAlgo;
  /** LCD (gRPC-gateway REST) endpoints, preferred first. */
  readonly lcdEndpoints: readonly string[];
  /** CometBFT RPC endpoints (block/status queries), preferred first. */
  readonly cometRpcEndpoints: readonly string[];
  /** EIP-155 id of the chain's EVM face, when it has one. */
  readonly evmChainId?: number;
}

/**
 * Aethelred native side.
 *
 * - Accounts are `eth_secp256k1` (cosmos/evm): coin-type **60**, keccak
 *   address derivation, keccak SignDoc digest — the SAME key the wallet
 *   already derives for the EVM face (`m/44'/60'/0'/0/x`), so one seed
 *   phrase yields one account with an `aethel1…` and a `0x…` rendering.
 * - `chainId` follows `scripts/testnet.sh` in the chain repo
 *   (`aethelred-testnet-1`). Deployments with a different cosmos chain-id
 *   must override it (spread this object) — the SignDoc binds to it, so a
 *   mismatch fails signature verification, never silently.
 * - Endpoints point at the public testnet validators (live since
 *   2026-07-07), with the local node kept last as the development
 *   fallback; replace with DNS-based endpoints once provisioned.
 */
export const AETHELRED_NATIVE: CosmosChainParams = {
  chainId: "aethelred-testnet-1",
  hrp: "aethel",
  valoperHrp: "aethelvaloper",
  denom: "uaethel",
  displayDenom: "AETHEL",
  decimals: 6,
  coinType: 60,
  signatureAlgo: "eth_secp256k1",
  lcdEndpoints: [
    "http://54.165.44.130:1317",
    "http://35.255.95.138:1317",
    "http://35.253.47.12:1317",
    "http://127.0.0.1:1317",
  ],
  cometRpcEndpoints: [
    "http://54.165.44.130:26657",
    "http://35.255.95.138:26657",
    "http://35.253.47.12:26657",
    "http://127.0.0.1:26657",
  ],
  evmChainId: 7332,
};
