/**
 * Bitcoin chain package — public type surface.
 *
 * Every type here is wire-format or API-facing. Consumers of
 * `@aethelred/wallet-chain-btc` pin to these names; changes are
 * breaking-version moves. The wire-format choices (hex-prefixed strings,
 * `bigint` satoshi amounts) mirror the conventions already established
 * by the wallet's EVM packages so the chain-agnostic layers above us
 * can treat BTC and ETH symmetrically.
 */

/**
 * Human-readable identifier for each Bitcoin network we support.
 *
 * `mainnet`: production Bitcoin chain — `bc1…` bech32 addresses and
 * `1…`/`3…` legacy addresses. `testnet`: the long-running `tb1…` test
 * network (Testnet3 at time of writing). `regtest`: the local "regression
 * test" harness reachable only on a developer's node. `signet`: the
 * standardised BIP-325 test network — reuses the testnet prefixes
 * (`tb1…`, `m…`, `n…`) intentionally, per BIP-325 §"Address format".
 */
export type BitcoinNetwork = "mainnet" | "testnet" | "regtest" | "signet";

/**
 * Full set of per-network parameters needed for address encoding and
 * signing path selection.
 *
 * Values follow the BIP-173 (bech32) and BIP-0032 parameter tables. The
 * `bip44CoinType` field is `0` for mainnet and `1` for every test/dev
 * network per SLIP-0044 — signet and regtest share the `1` value because
 * SLIP-0044 does not allocate a distinct coin type for them.
 *
 * @example
 * ```ts
 * import { MAINNET } from "@aethelred/wallet-chain-btc";
 * console.log(MAINNET.hrp); // "bc"
 * ```
 */
export interface BitcoinNetworkParams {
  /** Human-readable network identifier. */
  readonly name: BitcoinNetwork;
  /** SLIP-0044 coin type for the network. `0` for mainnet; `1` for every test net. */
  readonly bip44CoinType: 0 | 1;
  /** Bech32 human-readable prefix (BIP-173). */
  readonly hrp: "bc" | "tb" | "bcrt";
  /** Base58Check version byte for P2PKH addresses. */
  readonly p2pkhPrefix: number;
  /** Base58Check version byte for P2SH addresses. */
  readonly p2shPrefix: number;
  /** WIF (Wallet Import Format) version byte for private keys. */
  readonly wifPrefix: number;
}

/**
 * Address type discriminator.
 *
 * - `p2pkh`: Pay-to-PubKey-Hash legacy address (`1…`/`m…`/`n…`).
 * - `p2wpkh`: Pay-to-Witness-PubKey-Hash native segwit v0 (`bc1q…`).
 * - `p2sh-p2wpkh`: Nested segwit v0 wrapped in P2SH (`3…`/`2…`).
 * - `p2tr`: Pay-to-Taproot segwit v1 (`bc1p…`), per BIP-341.
 */
export type AddressType = "p2pkh" | "p2wpkh" | "p2sh-p2wpkh" | "p2tr";

/**
 * Fully-qualified Bitcoin address.
 *
 * `scriptPubKey` is the exact byte sequence we will embed in any
 * transaction output paying to this address — pre-computing it lets
 * PSBT builders compose outputs without re-deriving the script.
 *
 * @example
 * ```ts
 * import { pubKeyToP2WPKH } from "@aethelred/wallet-chain-btc";
 * const addr = pubKeyToP2WPKH("0x0279be66...", "mainnet");
 * addr.address;       // "bc1qw508d..."
 * addr.type;          // "p2wpkh"
 * addr.scriptPubKey;  // "0x0014..."
 * ```
 */
export interface BitcoinAddress {
  /** Canonical textual encoding (base58 or bech32) of the address. */
  readonly address: string;
  /** Address type discriminator. */
  readonly type: AddressType;
  /** Network this address is valid on. */
  readonly network: BitcoinNetwork;
  /** Raw output script this address is shorthand for. */
  readonly scriptPubKey: `0x${string}`;
}

/**
 * A single PSBT input declaration.
 *
 * Corresponds to one `PSBT_IN_*` group in BIP-174. Either
 * `witnessUtxo` or `nonWitnessUtxo` MUST be present for a signer to
 * produce a valid signature; the wallet only signs segwit inputs today
 * so `witnessUtxo` is the common path.
 */
export interface PsbtInput {
  /** Referenced transaction id (big-endian hex, no `0x` prefix — matches explorers). */
  readonly txid: string;
  /** Index of the output being spent. */
  readonly vout: number;
  /** UTXO data for segwit inputs (`PSBT_IN_WITNESS_UTXO`). */
  readonly witnessUtxo?: { readonly value: bigint; readonly scriptPubKey: `0x${string}` };
  /** Full previous transaction for legacy inputs (`PSBT_IN_NON_WITNESS_UTXO`). */
  readonly nonWitnessUtxo?: `0x${string}`;
  /** BIP-143 sighash type flag. Defaults to `SIGHASH_ALL` (`0x01`). */
  readonly sighashType?: number;
}

/**
 * A single PSBT output declaration.
 *
 * Exactly one of `address` or `scriptPubKey` must be supplied by
 * consumers; encoders will resolve `address` to a concrete script.
 */
export interface PsbtOutput {
  /** Textual address of the recipient (bech32 or base58check). */
  readonly address?: string;
  /** Raw output script; takes precedence when both fields are set. */
  readonly scriptPubKey?: `0x${string}`;
  /** Output value in satoshis. `bigint` because 21 000 000 BTC exceeds Number.MAX_SAFE_INTEGER. */
  readonly value: bigint;
}

/**
 * Parsed PSBT — the in-memory form of a BIP-174 "partially signed
 * Bitcoin transaction". The serializer round-trips this exactly.
 */
export interface Psbt {
  /** PSBT version per BIP-174. Only version 0 is currently widely supported. */
  readonly version: number;
  /** Inputs to be signed. */
  readonly inputs: readonly PsbtInput[];
  /** Outputs of the final transaction. */
  readonly outputs: readonly PsbtOutput[];
  /**
   * Global fields not covered by the standard schema.
   *
   * Stored as a flat `key => value` map of hex strings so custom BIP-174
   * extensions can survive a parse/serialize round-trip.
   */
  readonly globalFields: Readonly<Record<string, `0x${string}`>>;
}

/**
 * Signature contribution produced by `signPsbtInput`.
 *
 * The wallet never mutates an input PSBT; consumers are expected to
 * merge `SignedPsbtInput[]` into their canonical PSBT artefact using
 * `finalizePsbt` or an external PSBT toolchain.
 */
export interface SignedPsbtInput {
  /** Index of the input this signature applies to. */
  readonly inputIndex: number;
  /** One entry per key that signed this input. */
  readonly signatures: ReadonlyArray<{
    /** Compressed or x-only public key matching the script. */
    readonly pubKey: `0x${string}`;
    /** DER-encoded signature (plus sighash byte) for ECDSA paths; 64-byte Schnorr signature for P2TR. */
    readonly signature: `0x${string}`;
    /** Sighash flag used when producing the signature. */
    readonly sighashType: number;
  }>;
}

/**
 * Error raised by address encoders / decoders.
 *
 * A distinct subclass rather than a plain `Error` so higher layers can
 * `instanceof` check without inspecting message strings.
 */
export class BitcoinAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BitcoinAddressError";
  }
}

/**
 * Error raised by the PSBT parser / signer / finalizer.
 */
export class PsbtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PsbtError";
  }
}
