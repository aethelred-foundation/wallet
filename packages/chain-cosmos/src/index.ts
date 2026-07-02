/**
 * @aethelred/wallet-chain-cosmos — Aethelred native (Cosmos SDK) primitives.
 *
 * Phase B of the Aethelred-first wallet program: the native transaction
 * path. Gives the wallet the chain's canonical `aethel1…` identity and
 * SIGN_MODE_DIRECT signing for the sovereign feature set (bank sends,
 * staking, reward claims, governance) — the same secp256k1 key the EVM
 * face already uses, rendered and signed the way the L1 natively verifies.
 */

// MUST run before any secp256k1.sign call (see crypto-bootstrap.ts).
import "./crypto-bootstrap";

export { cryptoBootstrapped } from "./crypto-bootstrap";
export {
  AETHELRED_HRP,
  AETHELRED_VALOPER_HRP,
  CosmosAddressError,
  addressBytesFromPubkey,
  bech32ToEthHex,
  ethHexToBech32,
  fromBech32,
  fromHexAddress,
  toBech32,
  toEip55Hex,
  type SignatureAlgo,
} from "./address";
export {
  CosmosLcdClient,
  CosmosLcdError,
  toBase64,
  type AccountInfo,
  type BroadcastResult,
  type LcdClientOptions,
  type TxResult,
} from "./client";
export {
  VoteOption,
  encodeCoin,
  msgBeginRedelegate,
  msgDelegate,
  msgSend,
  msgUndelegate,
  msgVote,
  msgWithdrawDelegatorReward,
  type AnyMsg,
  type Coin,
} from "./messages";
export { ProtoEncodeError, ProtoWriter } from "./proto";
export {
  ETHSECP256K1_PUBKEY_TYPE_URL,
  SECP256K1_PUBKEY_TYPE_URL,
  CosmosTxError,
  compressedPubkey,
  encodeAny,
  encodeAuthInfo,
  encodeFee,
  encodePubkeyAny,
  encodeSignDoc,
  encodeTxBody,
  encodeTxRaw,
  nobleDigestSigner,
  signDirect,
  signDocDigest,
  txHash,
  type DigestSigner,
  type Fee,
  type SignDirectParams,
  type SignedTx,
} from "./tx";
export { AETHELRED_NATIVE, type CosmosChainParams } from "./networks";
