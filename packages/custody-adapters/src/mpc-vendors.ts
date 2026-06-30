/**
 * Reference MPC-TSS vendor adapters — Silence Labs and ZenGo.
 *
 * Both implement the same {@link ThresholdSigner} interface that
 * {@link MpcTssAdapter} consumes, so an enterprise switches its underlying MPC
 * provider with a constructor/config change while keeping the exact same
 * VARA/TRISA/screening compliance pipeline above it — neutralising the biggest
 * lock-in competitors rely on.
 *
 * The two vendors expose *different* SDK shapes (Silence Labs:
 * `sign(keyId, digest) → {r,s,recovery}` over DKLS; ZenGo:
 * `generateSignature({vaultId, messageHash}) → {signature:{r,s,recid}}` over
 * GG20). Each adapter normalises its vendor's output to one canonical
 * {@link ThresholdSignature}. The real vendor SDK is injected behind the client
 * interface (mirroring the Fireblocks/Trezor seam), so these are integration-
 * ready: wire the SDK, keep the pipeline.
 */

import type { ThresholdSigner, ThresholdSignature } from "./mpc-tss-adapter";

function to0x32(hex: string): `0x${string}` {
  const h = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]*$/.test(h) || h.length > 64) {
    throw new Error(`mpc-vendors: invalid 32-byte hex component "${hex}"`);
  }
  return `0x${h.padStart(64, "0").toLowerCase()}` as `0x${string}`;
}

function toRecovery(recid: number): 0 | 1 {
  const v = recid >= 27 ? recid - 27 : recid;
  if (v !== 0 && v !== 1) throw new Error(`mpc-vendors: invalid recovery id ${recid}`);
  return v;
}

/* ─── Silence Labs (DKLS23 threshold ECDSA) ─────────────────────── */

export interface SilenceLabsSignature {
  readonly r: string;
  readonly s: string;
  readonly recovery: number;
}
export interface SilenceLabsClient {
  /** Cooperatively sign a 32-byte digest for a distributed key. */
  sign(keyId: string, digest: Uint8Array): Promise<SilenceLabsSignature>;
}
export interface SilenceLabsConfig {
  readonly client: SilenceLabsClient;
  readonly keyId: string;
  readonly threshold: number;
  readonly parties: number;
}

export class SilenceLabsThresholdSigner implements ThresholdSigner {
  readonly label = "silence-labs";
  readonly threshold: number;
  readonly parties: number;
  private readonly client: SilenceLabsClient;
  private readonly keyId: string;

  constructor(config: SilenceLabsConfig) {
    this.client = config.client;
    this.keyId = config.keyId;
    this.threshold = config.threshold;
    this.parties = config.parties;
  }

  async signDigest(digest: Uint8Array): Promise<ThresholdSignature> {
    const sig = await this.client.sign(this.keyId, digest);
    return { r: to0x32(sig.r), s: to0x32(sig.s), recovery: toRecovery(sig.recovery) };
  }
}

/* ─── ZenGo (GG20 threshold ECDSA) ──────────────────────────────── */

export interface ZenGoSignatureResponse {
  readonly signature: { readonly r: string; readonly s: string; readonly recid: number };
}
export interface ZenGoClient {
  generateSignature(params: { vaultId: string; messageHash: Uint8Array }): Promise<ZenGoSignatureResponse>;
}
export interface ZenGoConfig {
  readonly client: ZenGoClient;
  readonly vaultId: string;
  readonly threshold: number;
  readonly parties: number;
}

export class ZenGoThresholdSigner implements ThresholdSigner {
  readonly label = "zengo";
  readonly threshold: number;
  readonly parties: number;
  private readonly client: ZenGoClient;
  private readonly vaultId: string;

  constructor(config: ZenGoConfig) {
    this.client = config.client;
    this.vaultId = config.vaultId;
    this.threshold = config.threshold;
    this.parties = config.parties;
  }

  async signDigest(digest: Uint8Array): Promise<ThresholdSignature> {
    const { signature } = await this.client.generateSignature({ vaultId: this.vaultId, messageHash: digest });
    return { r: to0x32(signature.r), s: to0x32(signature.s), recovery: toRecovery(signature.recid) };
  }
}
