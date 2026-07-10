/**
 * TrezorWalletBackend — production Trezor integration (Trezor Connect).
 *
 * Trezor uses a fundamentally different transport from Ledger: instead of a
 * WebHID byte channel + on-host app, Trezor Connect brokers calls through a
 * trusted popup / iframe to Trezor's signing firmware. So Trezor lives in its
 * own `CustodyBackend` rather than inside `HardwareWalletBackend` (which is
 * Ledger/WebHID-specific). It reuses the same typed `HardwareWalletError`
 * taxonomy so the UI can react identically.
 *
 * Like the Ledger backend, the real `@trezor/connect-web` module is loaded
 * lazily via a runtime-assembled dynamic import, and tests inject a fake
 * client through the constructor seam — no `vi.mock` acrobatics, no shipped
 * stub. Every method either returns real device data or throws a typed error.
 *
 * Security posture: Trezor never blind-signs. `sign(digest)` (a bare 32-byte
 * hash) is therefore unsupported — callers must route through
 * {@link TrezorWalletBackend.signMessage} (personal_sign) or
 * {@link TrezorWalletBackend.signTransaction} (structured tx the device can
 * display and the user can physically confirm).
 */

import { KeyNotFoundError } from "../errors";
import type { KeySlot } from "../types";
import { bytesToHex } from "../rlp";
import { hexToBytes } from "../transaction";
import {
  HardwareWalletError,
  HardwareWalletInvalidDataError,
  HardwareWalletNotConnectedError,
  HardwareWalletTransportFailureError,
  HardwareWalletTransportUnavailableError,
  HardwareWalletUnsupportedOperationError,
  HardwareWalletUserRejectedError,
} from "./hardware";
import type { CustodyBackend, CustodyCapabilities } from "./types";

const DEFAULT_ETH_PATH = "m/44'/60'/0'/0/0";

/* ─── Structural subset of the Trezor Connect API we touch ─── */

export interface TrezorManifest {
  email: string;
  appUrl: string;
}

/** Trezor Connect's uniform response envelope. */
export type TrezorResponse<T> =
  | { success: true; payload: T }
  | { success: false; payload: { error: string; code?: string } };

/** Structured Ethereum transaction fields Trezor signs (legacy or EIP-1559). */
export interface TrezorEthTransaction {
  to: string;
  value: string;
  gasLimit: string;
  nonce: string;
  chainId: number;
  data?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

export interface TrezorConnectClient {
  init(opts: { manifest: TrezorManifest; lazyLoad?: boolean }): Promise<void>;
  ethereumGetAddress(params: {
    path: string;
    showOnTrezor?: boolean;
  }): Promise<TrezorResponse<{ address: string; serializedPath?: string }>>;
  getPublicKey(params: {
    path: string;
    coin?: string;
  }): Promise<TrezorResponse<{ publicKey: string }>>;
  ethereumSignMessage(params: {
    path: string;
    message: string;
    hex?: boolean;
  }): Promise<TrezorResponse<{ address: string; signature: string }>>;
  ethereumSignTransaction(params: {
    path: string;
    transaction: TrezorEthTransaction;
  }): Promise<TrezorResponse<{ v: string; r: string; s: string }>>;
}

type TrezorClientResolver = () => Promise<TrezorConnectClient>;

/** Default resolver: dynamically import the real `@trezor/connect-web`. */
const defaultTrezorResolver: TrezorClientResolver = async () => {
  const specifier = ["@trezor", "connect-web"].join("/");
  try {
    const mod = (await import(/* @vite-ignore */ specifier)) as {
      default?: TrezorConnectClient;
    } & Partial<TrezorConnectClient>;
    const client = (mod.default ?? mod) as TrezorConnectClient;
    if (typeof client.ethereumGetAddress !== "function") {
      throw new Error("module did not expose the expected Trezor Connect API");
    }
    return client;
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    throw new HardwareWalletTransportUnavailableError(
      `Failed to load @trezor/connect-web: ${msg}. Ensure the package is installed.`,
    );
  }
};

/** Map a failed Trezor response envelope to a typed hardware error. */
function trezorFailure(
  payload: { error: string; code?: string },
  operation: string,
): HardwareWalletError {
  const text = `${payload.code ?? ""} ${payload.error}`.toLowerCase();
  if (/cancel|rejected|not granted|denied/.test(text)) {
    return new HardwareWalletUserRejectedError(
      `Trezor ${operation} was cancelled on the device.`,
    );
  }
  return new HardwareWalletTransportFailureError(
    `Trezor ${operation} failed: ${payload.error}`,
  );
}

/** Build a 65-byte `r ‖ s ‖ v` signature from Trezor's hex components. */
function assembleSig(r: string, s: string, v: string): Uint8Array {
  const rb = hexToBytes(r);
  const sb = hexToBytes(s);
  if (rb.length !== 32 || sb.length !== 32) {
    throw new HardwareWalletInvalidDataError(
      `Trezor returned r/s of unexpected length (${rb.length}/${sb.length})`,
    );
  }
  const vNum = v.startsWith("0x") ? parseInt(v, 16) : parseInt(v, 10);
  const out = new Uint8Array(65);
  out.set(rb, 0);
  out.set(sb, 32);
  out[64] = vNum & 0xff;
  return out;
}

export class TrezorWalletBackend implements CustodyBackend {
  readonly name = "trezor";
  readonly capabilities: CustodyCapabilities = {
    canGenerate: false,
    canImportSeed: false,
    canImportPrivateKey: false,
    canExportPublicKey: true,
    canSign: true,
  };

  private client: TrezorConnectClient | null = null;
  private readonly clientResolver: TrezorClientResolver;
  private readonly manifest: TrezorManifest;
  private readonly slots = new Map<string, KeySlot>();

  constructor(options?: { client?: TrezorClientResolver; manifest?: TrezorManifest }) {
    this.clientResolver = options?.client ?? defaultTrezorResolver;
    this.manifest = options?.manifest ?? {
      email: "support@aethelred.foundation",
      appUrl: "https://aethelred.foundation",
    };
  }

  /** Initialize Trezor Connect and register the default Ethereum account. */
  async connect(): Promise<{ connected: boolean; deviceName: string }> {
    if (!this.client) {
      const client = await this.clientResolver();
      await client.init({ manifest: this.manifest, lazyLoad: true });
      this.client = client;
    }
    await this.registerDevice("Trezor", DEFAULT_ETH_PATH);
    return { connected: true, deviceName: "Trezor" };
  }

  async disconnect(): Promise<void> {
    this.client = null;
    this.slots.clear();
  }

  private requireClient(): TrezorConnectClient {
    if (!this.client) {
      throw new HardwareWalletNotConnectedError(
        "Trezor is not connected. Call connect() first.",
      );
    }
    return this.client;
  }

  /** Query an address + public key for an HD path and register a slot. */
  async registerDevice(label: string, hdPath = DEFAULT_ETH_PATH): Promise<KeySlot> {
    const client = this.requireClient();

    const addrRes = await client.ethereumGetAddress({ path: hdPath, showOnTrezor: false });
    if (!addrRes.success) throw trezorFailure(addrRes.payload, "address lookup");

    const pubRes = await client.getPublicKey({ path: hdPath, coin: "eth" });
    if (!pubRes.success) throw trezorFailure(pubRes.payload, "public-key lookup");

    const publicKey = hexToBytes(pubRes.payload.publicKey);
    if (publicKey.length !== 33) {
      throw new HardwareWalletInvalidDataError(
        `Trezor returned a ${publicKey.length}-byte public key; expected 33 (compressed)`,
      );
    }

    const address = addrRes.payload.address;
    const id = address.toLowerCase().replace(/^0x/, "").slice(0, 32);
    const slot: KeySlot = {
      id,
      label,
      curve: "secp256k1",
      origin: "derived",
      publicKey,
      address,
      createdAt: Date.now(),
      hdPath,
    };
    this.slots.set(id, slot);
    return slot;
  }

  async getPublicKey(keySlotId: string): Promise<Uint8Array> {
    const slot = this.slots.get(keySlotId);
    if (!slot) throw new KeyNotFoundError(keySlotId);
    return slot.publicKey;
  }

  getAddress(keySlotId: string): string {
    const slot = this.slots.get(keySlotId);
    if (!slot) throw new KeyNotFoundError(keySlotId);
    return slot.address;
  }

  async deleteKey(keySlotId: string): Promise<void> {
    this.slots.delete(keySlotId);
  }

  /** Sign an `eth_personal_sign` message. `message` may be bytes or a string. */
  async signMessage(keySlotId: string, message: Uint8Array | string): Promise<Uint8Array> {
    const slot = this.slots.get(keySlotId);
    if (!slot) throw new KeyNotFoundError(keySlotId);
    const client = this.requireClient();
    const isBytes = message instanceof Uint8Array;
    const res = await client.ethereumSignMessage({
      path: slot.hdPath ?? DEFAULT_ETH_PATH,
      message: isBytes ? bytesToHex(message).slice(2) : message,
      hex: isBytes,
    });
    if (!res.success) throw trezorFailure(res.payload, "message signing");
    const sig = hexToBytes(res.payload.signature);
    if (sig.length !== 65) {
      throw new HardwareWalletInvalidDataError(
        `Trezor returned a ${sig.length}-byte signature; expected 65`,
      );
    }
    return sig;
  }

  /** Sign a structured Ethereum transaction; returns 65-byte `r ‖ s ‖ v`. */
  async signTransaction(keySlotId: string, tx: TrezorEthTransaction): Promise<Uint8Array> {
    const slot = this.slots.get(keySlotId);
    if (!slot) throw new KeyNotFoundError(keySlotId);
    const client = this.requireClient();
    const res = await client.ethereumSignTransaction({
      path: slot.hdPath ?? DEFAULT_ETH_PATH,
      transaction: tx,
    });
    if (!res.success) throw trezorFailure(res.payload, "transaction signing");
    return assembleSig(res.payload.r, res.payload.s, res.payload.v);
  }

  /* ── CustodyBackend contract: unsupported on hardware ──────────── */

  async sign(): Promise<Uint8Array> {
    throw new HardwareWalletUnsupportedOperationError(
      "sign(digest) — Trezor will not blind-sign a bare hash. Use signMessage() or signTransaction().",
    );
  }

  async generateKeySlot(): Promise<KeySlot> {
    throw new HardwareWalletUnsupportedOperationError("generateKeySlot — keys never leave a Trezor.");
  }

  async importFromSeed(): Promise<KeySlot> {
    throw new HardwareWalletUnsupportedOperationError("importFromSeed — keys never leave a Trezor.");
  }

  async importFromPrivateKey(): Promise<KeySlot> {
    throw new HardwareWalletUnsupportedOperationError("importFromPrivateKey — keys never leave a Trezor.");
  }
}
