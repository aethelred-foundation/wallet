/**
 * Public barrel for `@aethelred/wallet-chain-btc`.
 *
 * Everything importable from this package passes through here — adding
 * a new public symbol means updating this file. Internal helpers
 * (hex utilities, byte writers, etc.) stay un-exported.
 */

export {
  BitcoinAddressError,
  PsbtError,
  type AddressType,
  type BitcoinAddress,
  type BitcoinNetwork,
  type BitcoinNetworkParams,
  type Psbt,
  type PsbtInput,
  type PsbtOutput,
  type SignedPsbtInput,
} from "./types";

export {
  ALL_BITCOIN_NETWORKS,
  MAINNET,
  REGTEST,
  SIGNET,
  TESTNET,
  getNetworkParams,
} from "./networks";

export {
  decodeAddress,
  decodeBech32,
  encodeBech32,
  pubKeyToP2PKH,
  pubKeyToP2TR,
  pubKeyToP2WPKH,
} from "./address";

export {
  computeTxid,
  finalizePsbt,
  parsePsbt,
  serializePsbt,
  signPsbtInput,
} from "./psbt";
