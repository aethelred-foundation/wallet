// Bootstrap crypto first — wires HMAC-SHA256 into @noble/secp256k1 v2
// so `sign()` actually works. This must run before any sign call.
import "./crypto-bootstrap";

export * from "./types";
export * from "./errors";
export { MasterKey } from "./master-key";
export { EncryptedStorage, ChromeStorageAdapter, MemoryStorageAdapter } from "./secure-storage";
export { KeyManager } from "./key-manager";
export { Signer, type PolicyDecisionToken } from "./signer";
export { LocalCustodyBackend } from "./custody/local";
export {
  HardwareWalletBackend,
  HardwareWalletError,
  HardwareWalletNotConnectedError,
  HardwareWalletUserRejectedError,
  HardwareWalletAppNotOpenError,
  HardwareWalletWrongChainError,
  HardwareWalletTimeoutError,
  HardwareWalletDeviceLockedError,
  HardwareWalletTransportUnavailableError,
  HardwareWalletTransportFailureError,
  HardwareWalletUnsupportedDeviceError,
  HardwareWalletUnsupportedOperationError,
  HardwareWalletInvalidDataError,
  HARDWARE_WALLET_ERROR_CODES,
  type HardwareWalletErrorCode,
  type LedgerFactory,
} from "./custody/hardware";
export type {
  CustodyBackend,
  CustodyCapabilities,
  RawTxKind,
  RawTxSignOptions,
} from "./custody/types";
export { rlpEncode, encodeSignedTx, encodeLegacySignedTx, bytesToHex } from "./rlp";

// EIP-712 typed-data hashing
export {
  encodeType,
  typeHash,
  encodeData,
  structHash,
  domainSeparator,
  hashTypedDataV4,
  hashTypedDataV4Json,
  type TypedDataField,
  type TypedDataTypes,
  type TypedDataV4,
} from "./eip712";

// EIP-1559 / legacy transaction builder + signer + assembler
export {
  buildUnsignedEip1559Tx,
  buildUnsignedEip1559TxBytes,
  buildUnsignedLegacyTx,
  buildUnsignedLegacyTxBytes,
  assembleSignedEip1559Tx,
  assembleSignedLegacyTx,
  buildAndSignEip1559Tx,
  buildAndSignLegacyTx,
  splitSignature,
  recoverSignerAddress,
  hexToBigInt,
  hexToBytes,
  addressToBytes,
  type UnsignedEip1559Tx,
  type UnsignedLegacyTx,
  type SignedTxOutput,
} from "./transaction";

// Gas-fee-bump / speed-up / cancel primitives for replacing pending txs
export {
  computeReplacementGas,
  buildSpeedUpTransaction,
  buildCancelTransaction,
  GasReplacementError,
  type OriginalTransaction,
  type ReplacementGasSuggestion,
} from "./tx-replacement";
