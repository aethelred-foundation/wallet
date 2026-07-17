import { keccak_256 } from "@noble/hashes/sha3.js";
import { KeyNotFoundError, SigningDeniedError } from "./errors";
import type { CustodyBackend, RawTxSignOptions } from "./custody/types";
import type { MasterKey } from "./master-key";
import type { SigningRequest, SigningResult } from "./types";

// `KeyNotFoundError` is re-exported for backwards compatibility with
// callers that imported it from this module transitively.
export { KeyNotFoundError };

/** Policy decision token required before any signing operation. */
export interface PolicyDecisionToken {
  intentId: string;
  outcome: "allow" | "warn";
  timestamp: number;
}

/**
 * Signer is the narrow signing API at the trust boundary.
 * Only the background service worker should instantiate this.
 * Every signing operation requires:
 *   1. The wallet to be unlocked (MasterKey)
 *   2. A valid PolicyDecisionToken with outcome "allow" or "warn"
 *
 * The signer is `CustodyBackend`-typed rather than concrete on
 * `LocalCustodyBackend` so the same signing pipeline can route through
 * a hardware wallet (Ledger) when the backend exposes
 * `signTransactionBytes`. Hardware wallets cannot sign arbitrary
 * pre-computed digests — they must see the raw transaction so the
 * on-device display can show the recipient + value to the user.
 */
export class Signer {
  constructor(
    private readonly masterKey: MasterKey,
    private readonly custody: CustodyBackend
  ) {}

  async signMessage(
    request: SigningRequest,
    policyToken: PolicyDecisionToken
  ): Promise<SigningResult> {
    const vaultEpoch = this.assertReady(policyToken);

    const prefixed = this.createEthSignedMessage(request.data);
    const hash = keccak_256(prefixed);
    let signature: Uint8Array | null = null;
    try {
      signature = await this.custody.sign(request.keySlotId, hash);
      this.masterKey.assertUnlockedAtEpoch(vaultEpoch);

      // EIP-191 personal_sign signatures carry v = 27/28, but custody returns the
      // raw recovery id (0/1) as the final byte. Without this normalization,
      // dApp libraries (viem/ethers) fail to recover the signer — recoverPublicKey
      // rejects v < 27 — which silently breaks every message-signature login/
      // registration flow. Transaction signing computes its own v elsewhere and
      // is unaffected.
      if (signature.length === 65 && signature[64] < 27) {
        signature[64] += 27;
      }

      this.masterKey.assertUnlockedAtEpoch(vaultEpoch);
      return { signature };
    } catch (error) {
      signature?.fill(0);
      throw error;
    } finally {
      prefixed.fill(0);
      hash.fill(0);
    }
  }

  /**
   * Sign an unsigned transaction digest.
   *
   * IMPORTANT: `request.data` is the 32-byte keccak256 digest of the
   * wire-format unsigned transaction. This path is used by software
   * wallets that can sign arbitrary digests. Hardware wallets MUST go
   * through `signTransactionRaw` instead — they cannot sign blind
   * digests because the device display would have nothing to show.
   *
   * `buildAndSignEip1559Tx` automatically picks the right path based
   * on whether the underlying custody backend exposes
   * `signTransactionBytes`.
   */
  async signTransaction(
    request: SigningRequest,
    policyToken: PolicyDecisionToken
  ): Promise<SigningResult> {
    const vaultEpoch = this.assertReady(policyToken);

    const hash = keccak_256(request.data);
    let signature: Uint8Array | null = null;
    try {
      signature = await this.custody.sign(request.keySlotId, hash);
      this.masterKey.assertUnlockedAtEpoch(vaultEpoch);
      return { signature };
    } catch (error) {
      signature?.fill(0);
      throw error;
    } finally {
      hash.fill(0);
    }
  }

  /**
   * Sign a raw (unhashed) transaction payload.
   *
   * If the underlying custody backend exposes `signTransactionBytes`
   * (hardware wallets and `LocalCustodyBackend` both do), the raw bytes
   * are passed straight through so a Ledger can decode + display them
   * on-device. Otherwise, the signer falls back to hashing locally and
   * calling `custody.sign(hash)` — the software path.
   *
   * `request.data` MUST be the wire-format payload:
   *   - EIP-1559: `0x02` type byte + `rlp([chainId, nonce, ...])`
   *   - Legacy:   `rlp([nonce, gasPrice, ..., chainId, 0, 0])`
   */
  async signTransactionRaw(
    request: SigningRequest,
    policyToken: PolicyDecisionToken,
    options?: RawTxSignOptions,
  ): Promise<SigningResult> {
    const vaultEpoch = this.assertReady(policyToken);

    if (typeof this.custody.signTransactionBytes === "function") {
      let signature: Uint8Array | null = null;
      try {
        signature = await this.custody.signTransactionBytes(
          request.keySlotId,
          request.data,
          options,
        );
        this.masterKey.assertUnlockedAtEpoch(vaultEpoch);
        return { signature };
      } catch (error) {
        signature?.fill(0);
        throw error;
      }
    }

    // Backend does not implement the raw path — hash locally and
    // delegate to the regular digest signer. This preserves behaviour
    // for any future custody backends that forget to implement
    // `signTransactionBytes`.
    const hash = keccak_256(request.data);
    let signature: Uint8Array | null = null;
    try {
      signature = await this.custody.sign(request.keySlotId, hash);
      this.masterKey.assertUnlockedAtEpoch(vaultEpoch);
      return { signature };
    } catch (error) {
      signature?.fill(0);
      throw error;
    } finally {
      hash.fill(0);
    }
  }

  /**
   * Returns true if the underlying custody backend can accept raw
   * transaction bytes (i.e. is a hardware wallet or has implemented the
   * raw path). `buildAndSignEip1559Tx` uses this to decide whether to
   * route through `signTransactionRaw` or `signTransaction`.
   */
  supportsRawTransactionSigning(): boolean {
    return typeof this.custody.signTransactionBytes === "function";
  }

  async signTypedData(
    request: SigningRequest,
    policyToken: PolicyDecisionToken
  ): Promise<SigningResult> {
    const vaultEpoch = this.assertReady(policyToken);

    // EIP-712: data should already be the hash of the typed data struct
    let signature: Uint8Array | null = null;
    try {
      signature = await this.custody.sign(request.keySlotId, request.data);
      this.masterKey.assertUnlockedAtEpoch(vaultEpoch);
      return { signature };
    } catch (error) {
      signature?.fill(0);
      throw error;
    }
  }

  private assertReady(token: PolicyDecisionToken): number {
    const vaultEpoch = this.masterKey.captureUnlockedEpoch();

    if (token.outcome !== "allow" && token.outcome !== "warn") {
      throw new SigningDeniedError(
        `Policy decision "${token.outcome}" does not permit signing`
      );
    }

    // Token must be recent (within 5 minutes)
    const age = Date.now() - token.timestamp;
    if (age > 5 * 60 * 1000) {
      throw new SigningDeniedError("Policy decision token has expired");
    }

    return vaultEpoch;
  }

  private createEthSignedMessage(message: Uint8Array): Uint8Array {
    const prefix = new TextEncoder().encode(
      `\x19Ethereum Signed Message:\n${message.length}`
    );
    const result = new Uint8Array(prefix.length + message.length);
    result.set(prefix);
    result.set(message, prefix.length);
    return result;
  }
}
