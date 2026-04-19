/**
 * Public barrel for `@aethelred/wallet-chain-solana`.
 */

export {
  SolanaAddressError,
  SolanaTransactionError,
  type SolanaCluster,
  type SolanaInstruction,
  type SolanaMessage,
  type SolanaTransaction,
} from "./types";

export {
  isValidSolanaAddress,
  pubKeyToSolanaAddress,
  solanaAddressToPubKey,
} from "./address";

export {
  computeSigningPreimage,
  serializeMessage,
  serializeSignedTransaction,
  signTransaction,
} from "./transaction";
