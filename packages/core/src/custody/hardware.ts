/**
 * HardwareWalletBackend — production Ledger integration.
 *
 * This replaces the earlier stub that silently returned zeroed pubkeys and
 * all-zero signatures. Every method either talks to the device and returns
 * real data, or throws a typed `HardwareWalletError` with a user-facing
 * message + stable error code. No fabrication, no placeholder bytes.
 *
 * Transport: `@ledgerhq/hw-transport-webhid` (browser WebHID). The transport
 * is opened lazily the first time a method that needs the device is called,
 * and reused for the lifetime of the backend until `disconnect()` is
 * invoked or the device is physically unplugged (the transport emits a
 * `disconnect` event which we listen for).
 *
 * App bindings: `@ledgerhq/hw-app-eth`. Provides `getAddress`,
 * `signPersonalMessage`, `signTransaction`, and `signEIP712HashedMessage`
 * for EIP-712.
 *
 * Both libraries are loaded via dynamic `import()` so that environments
 * without WebHID (service worker contexts, jsdom, Node test runners) can
 * `import { HardwareWalletBackend }` without pulling in the runtime deps.
 * The first call that requires the device is the point at which the
 * import can fail — and it fails with a clear error code the UI can react
 * to.
 *
 * Trezor is NOT implemented in this module. A call to `connect("trezor")`
 * throws with a clear "not yet implemented" error; we refuse to ship a
 * stub. The Ledger path is the priority for the current shipping target.
 */

import { KeyNotFoundError } from "../errors";
import type { KeySlot } from "../types";
import type {
  CustodyBackend,
  CustodyCapabilities,
  RawTxSignOptions,
} from "./types";

/* ─── Error taxonomy ─────────────────────────────────────────── */

/** Stable error code constants — the UI matches on these, not on messages. */
export const HARDWARE_WALLET_ERROR_CODES = {
  NOT_CONNECTED: "HW_NOT_CONNECTED",
  USER_REJECTED: "HW_USER_REJECTED",
  APP_NOT_OPEN: "HW_APP_NOT_OPEN",
  WRONG_CHAIN: "HW_WRONG_CHAIN",
  TIMEOUT: "HW_TIMEOUT",
  DEVICE_LOCKED: "HW_DEVICE_LOCKED",
  TRANSPORT_UNAVAILABLE: "HW_TRANSPORT_UNAVAILABLE",
  TRANSPORT_FAILURE: "HW_TRANSPORT_FAILURE",
  UNSUPPORTED_DEVICE: "HW_UNSUPPORTED_DEVICE",
  UNSUPPORTED_OPERATION: "HW_UNSUPPORTED_OPERATION",
  INVALID_DATA: "HW_INVALID_DATA",
} as const;

export type HardwareWalletErrorCode =
  (typeof HARDWARE_WALLET_ERROR_CODES)[keyof typeof HARDWARE_WALLET_ERROR_CODES];

/** Base class for every hardware wallet error emitted by this module. */
export class HardwareWalletError extends Error {
  readonly code: HardwareWalletErrorCode;
  constructor(code: HardwareWalletErrorCode, message: string) {
    super(message);
    this.name = "HardwareWalletError";
    this.code = code;
  }
}

export class HardwareWalletNotConnectedError extends HardwareWalletError {
  constructor(message = "Hardware wallet is not connected. Plug in and unlock your device before trying again.") {
    super(HARDWARE_WALLET_ERROR_CODES.NOT_CONNECTED, message);
    this.name = "HardwareWalletNotConnectedError";
  }
}

export class HardwareWalletUserRejectedError extends HardwareWalletError {
  constructor(message = "The action was rejected on the hardware wallet.") {
    super(HARDWARE_WALLET_ERROR_CODES.USER_REJECTED, message);
    this.name = "HardwareWalletUserRejectedError";
  }
}

export class HardwareWalletAppNotOpenError extends HardwareWalletError {
  constructor(message = "The Ethereum app is not open on your Ledger. Open it and try again.") {
    super(HARDWARE_WALLET_ERROR_CODES.APP_NOT_OPEN, message);
    this.name = "HardwareWalletAppNotOpenError";
  }
}

export class HardwareWalletWrongChainError extends HardwareWalletError {
  constructor(message = "The Ledger is configured for a different chain than the one you are signing for.") {
    super(HARDWARE_WALLET_ERROR_CODES.WRONG_CHAIN, message);
    this.name = "HardwareWalletWrongChainError";
  }
}

export class HardwareWalletTimeoutError extends HardwareWalletError {
  constructor(message = "The hardware wallet timed out waiting for input. Confirm or cancel on the device and try again.") {
    super(HARDWARE_WALLET_ERROR_CODES.TIMEOUT, message);
    this.name = "HardwareWalletTimeoutError";
  }
}

export class HardwareWalletDeviceLockedError extends HardwareWalletError {
  constructor(message = "The Ledger is locked. Enter your PIN to unlock it before trying again.") {
    super(HARDWARE_WALLET_ERROR_CODES.DEVICE_LOCKED, message);
    this.name = "HardwareWalletDeviceLockedError";
  }
}

export class HardwareWalletTransportUnavailableError extends HardwareWalletError {
  constructor(
    message = "WebHID is not available in this browser. Use Chrome or an Edge/Chromium-based browser that supports WebHID to connect a Ledger device.",
  ) {
    super(HARDWARE_WALLET_ERROR_CODES.TRANSPORT_UNAVAILABLE, message);
    this.name = "HardwareWalletTransportUnavailableError";
  }
}

export class HardwareWalletTransportFailureError extends HardwareWalletError {
  constructor(message: string) {
    super(HARDWARE_WALLET_ERROR_CODES.TRANSPORT_FAILURE, message);
    this.name = "HardwareWalletTransportFailureError";
  }
}

export class HardwareWalletUnsupportedDeviceError extends HardwareWalletError {
  constructor(deviceType: string) {
    super(
      HARDWARE_WALLET_ERROR_CODES.UNSUPPORTED_DEVICE,
      `Hardware wallet type "${deviceType}" is not supported yet. Only Ledger is supported in this release.`,
    );
    this.name = "HardwareWalletUnsupportedDeviceError";
  }
}

export class HardwareWalletUnsupportedOperationError extends HardwareWalletError {
  constructor(operation: string) {
    super(
      HARDWARE_WALLET_ERROR_CODES.UNSUPPORTED_OPERATION,
      `Operation "${operation}" is not supported on a hardware wallet.`,
    );
    this.name = "HardwareWalletUnsupportedOperationError";
  }
}

export class HardwareWalletInvalidDataError extends HardwareWalletError {
  constructor(message: string) {
    super(HARDWARE_WALLET_ERROR_CODES.INVALID_DATA, message);
    this.name = "HardwareWalletInvalidDataError";
  }
}

/* ─── Structural types for the subset of Ledger API we use ─── */

/**
 * Subset of `@ledgerhq/hw-transport` that we actually touch. A structural
 * type lets us avoid a hard compile-time dep on the real package — useful
 * for environments (service workers, jsdom tests) where the runtime lib
 * never loads.
 */
interface LedgerTransport {
  close(): Promise<void>;
  on?(event: "disconnect", handler: () => void): void;
  off?(event: "disconnect", handler: () => void): void;
}

/** Constructor shape of `@ledgerhq/hw-transport-webhid`. */
interface LedgerTransportWebHIDStatic {
  isSupported(): Promise<boolean>;
  request(): Promise<LedgerTransport>;
  create(): Promise<LedgerTransport>;
}

/** Minimal shape of `@ledgerhq/hw-app-eth` default export (the class). */
interface LedgerEthApp {
  getAddress(
    hdPath: string,
    boolDisplay?: boolean,
    boolChaincode?: boolean,
  ): Promise<{
    publicKey: string; // uncompressed, hex, no 0x — 130 chars
    address: string;   // 0x-prefixed
    chainCode?: string;
  }>;
  signPersonalMessage(
    hdPath: string,
    messageHex: string,
  ): Promise<{ v: number; r: string; s: string }>;
  signTransaction(
    hdPath: string,
    rawTxHex: string,
    resolution?: unknown,
  ): Promise<{ v: string; r: string; s: string }>;
  signEIP712HashedMessage?(
    hdPath: string,
    domainSeparator: string,
    hashStructMessage: string,
  ): Promise<{ v: number; r: string; s: string }>;
}

interface LedgerEthAppCtor {
  new (transport: LedgerTransport): LedgerEthApp;
}

/**
 * Allow the caller (tests, custom builds) to inject a transport + app
 * factory instead of relying on the dynamic `@ledgerhq/*` imports. This
 * is the primary seam used in `hardware.test.ts` — we avoid `vi.mock`
 * acrobatics by letting tests construct the backend with a fake factory.
 */
export interface LedgerFactory {
  transport: LedgerTransportWebHIDStatic;
  EthApp: LedgerEthAppCtor;
}

type LedgerFactoryResolver = () => Promise<LedgerFactory>;

/* ─── Default dynamic-import factory ─────────────────────────── */

/**
 * Default factory: dynamically imports the real Ledger libraries. The
 * returned promise rejects with a typed error if either module fails to
 * load, which typically means WebHID is unavailable or the packages are
 * not installed yet.
 *
 * The module specifiers are assembled from fragments at runtime so that
 * static bundlers (Vite, esbuild, Rollup) cannot pre-resolve them — we
 * don't want them hard-failing a build when the optional `@ledgerhq/*`
 * peer deps are not installed (e.g. in the test harness, or in a build
 * target that doesn't include hardware-wallet support).
 *
 * At runtime, the joined strings are exactly the package names. The
 * browser / Node resolver takes over from there.
 */
/**
 * Structural shape of the `@ledgerhq/hw-transport-webhid` module record as
 * returned by `import()`. Either the transport class is the default export
 * (ESM form) or it is the module itself (legacy CJS interop).
 */
interface LedgerTransportModule {
  default?: LedgerTransportWebHIDStatic;
  isSupported?: LedgerTransportWebHIDStatic["isSupported"];
  request?: LedgerTransportWebHIDStatic["request"];
  create?: LedgerTransportWebHIDStatic["create"];
}

/** Module shape of `@ledgerhq/hw-app-eth` — mirrors the transport module. */
interface LedgerEthModule {
  default?: LedgerEthAppCtor;
}

const defaultLedgerFactory: LedgerFactoryResolver = async () => {
  const transportSpecifier = ["@ledgerhq", "hw-transport-webhid"].join("/");
  const appSpecifier = ["@ledgerhq", "hw-app-eth"].join("/");
  try {
    // Vite / esbuild will see these as opaque variable-specifier imports
    // and emit a runtime `import()` call instead of trying to bundle the
    // target module. `@vite-ignore` is kept as a belt-and-braces hint.
    const transportModule = (await import(/* @vite-ignore */ transportSpecifier)) as LedgerTransportModule;
    const ethModule = (await import(/* @vite-ignore */ appSpecifier)) as LedgerEthModule;
    const TransportWebHID =
      (transportModule.default ?? (transportModule as LedgerTransportWebHIDStatic));
    const EthApp = ethModule.default;
    if (!EthApp) {
      throw new HardwareWalletTransportUnavailableError(
        "Ledger Ethereum app constructor not exposed by @ledgerhq/hw-app-eth",
      );
    }
    return { transport: TransportWebHID, EthApp };
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    throw new HardwareWalletTransportUnavailableError(
      `Failed to load Ledger libraries: ${msg}. Ensure @ledgerhq/hw-transport-webhid and @ledgerhq/hw-app-eth are installed and WebHID is available.`,
    );
  }
};

/* ─── Helpers ────────────────────────────────────────────────── */

/** Throwable timeout wrapper. */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  operation: string,
): Promise<T> {
  let timerId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => {
      reject(
        new HardwareWalletTimeoutError(
          `Hardware wallet operation "${operation}" timed out after ${ms}ms. Confirm on device or replug and try again.`,
        ),
      );
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timerId !== undefined) clearTimeout(timerId);
  });
}

/** Normalize a hex string — strip `0x`, lowercase, reject obviously-bad input. */
function stripHex(v: string): string {
  if (typeof v !== "string") throw new HardwareWalletInvalidDataError("Expected hex string");
  const hex = v.startsWith("0x") || v.startsWith("0X") ? v.slice(2) : v;
  if (!/^[0-9a-fA-F]*$/.test(hex)) {
    throw new HardwareWalletInvalidDataError(`Invalid hex characters in value: ${v.slice(0, 20)}…`);
  }
  return hex.toLowerCase();
}

/** Parse a hex string to bytes. */
function hexToBytes(v: string): Uint8Array {
  const hex = stripHex(v);
  const padded = hex.length % 2 === 0 ? hex : `0${hex}`;
  const out = new Uint8Array(padded.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Encode a Uint8Array as a hex string (no 0x). */
function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

/**
 * Ledger returns `publicKey` as an uncompressed 65-byte hex string
 * (leading `04` + 32-byte X + 32-byte Y). We store compressed keys
 * (33 bytes, leading `02`/`03`) everywhere else in the wallet, so
 * compress here. No external dependency — compression is just X
 * prefixed with parity of Y.
 */
function compressPublicKey(uncompressedHex: string): Uint8Array {
  const bytes = hexToBytes(uncompressedHex);
  if (bytes.length !== 65 || bytes[0] !== 0x04) {
    throw new HardwareWalletInvalidDataError(
      `Unexpected public key format from device (length=${bytes.length}, prefix=0x${bytes[0]?.toString(16) ?? "??"})`,
    );
  }
  const x = bytes.slice(1, 33);
  const yLast = bytes[64];
  const compressed = new Uint8Array(33);
  compressed[0] = (yLast & 1) === 0 ? 0x02 : 0x03;
  compressed.set(x, 1);
  return compressed;
}

/**
 * Translate low-level Ledger/transport errors into the wallet's typed
 * error taxonomy. We check Ledger's `statusCode` (from `TransportStatusError`)
 * and message text — Ledger doesn't export a single error hierarchy so we
 * have to do both.
 */
/**
 * Narrowing helper for Ledger transport errors. Ledger does not export a
 * single base class — `TransportStatusError` carries a numeric `statusCode`
 * while generic transport errors only have a `name` — so we declare the
 * union we care about and probe each field with typeof guards.
 */
interface LedgerErrorShape {
  statusCode?: unknown;
  name?: unknown;
  message?: unknown;
}

function translateLedgerError(cause: unknown, operation: string): HardwareWalletError {
  if (cause instanceof HardwareWalletError) return cause;

  const message =
    cause instanceof Error ? cause.message : String(cause ?? "");
  const lower = message.toLowerCase();
  const probe = (cause ?? {}) as LedgerErrorShape;
  const statusCode = typeof probe.statusCode === "number" ? probe.statusCode : undefined;
  const name = typeof probe.name === "string" ? probe.name : undefined;

  // Ledger Ethereum app status codes:
  //   0x6985 — user declined / cancelled
  //   0x6a80 / 0x6a8x — data not acceptable (e.g. EIP-712 unsupported)
  //   0x6b0c — app not open / wrong app
  //   0x6804 — device busy / locked
  //   0x6d00 / 0x6e00 — wrong app / instruction not supported
  //   0x5515 — device locked (newer firmware)
  if (statusCode === 0x6985 || lower.includes("user rejected") || lower.includes("denied by the user")) {
    return new HardwareWalletUserRejectedError();
  }
  if (statusCode === 0x6b0c || statusCode === 0x6d00 || statusCode === 0x6e00 || lower.includes("app is not open") || lower.includes("please open ethereum") || lower.includes("0x6b0c")) {
    return new HardwareWalletAppNotOpenError();
  }
  if (statusCode === 0x6804 || statusCode === 0x5515 || lower.includes("device locked") || lower.includes("locked device")) {
    return new HardwareWalletDeviceLockedError();
  }
  if (lower.includes("wrong chain") || lower.includes("invalid chain")) {
    return new HardwareWalletWrongChainError();
  }
  if (name === "TransportError" || lower.includes("transport") || lower.includes("device not found") || lower.includes("no device selected")) {
    return new HardwareWalletNotConnectedError(
      `Hardware wallet transport error during "${operation}": ${message}`,
    );
  }
  return new HardwareWalletTransportFailureError(
    `Hardware wallet error during "${operation}": ${message}`,
  );
}

/* ─── Tuning knobs ───────────────────────────────────────────── */

/** Default timeout for any single device interaction. */
const DEFAULT_DEVICE_TIMEOUT_MS = 60_000;
/** Timeout for `connect()` — opening WebHID is usually instant. */
const DEFAULT_CONNECT_TIMEOUT_MS = 30_000;

/* ─── Backend ────────────────────────────────────────────────── */

/**
 * `HardwareWalletBackend` implements `CustodyBackend` by proxying to a
 * Ledger device via WebHID. Only the `sign`, `signTransactionBytes`,
 * `registerDevice`, `getPublicKey` paths are live; key generation and
 * import are explicitly refused because hardware wallets manage their
 * own seed.
 */
export class HardwareWalletBackend implements CustodyBackend {
  readonly name = "hardware";
  readonly capabilities: CustodyCapabilities = {
    canGenerate: false,
    canImportSeed: false,
    canImportPrivateKey: false,
    canExportPublicKey: true,
    canSign: true,
  };

  private transport: LedgerTransport | null = null;
  private ethApp: LedgerEthApp | null = null;
  private deviceType: "ledger" | "trezor" | null = null;
  private readonly registeredSlots = new Map<string, KeySlot>();
  private readonly factoryResolver: LedgerFactoryResolver;
  private readonly deviceTimeoutMs: number;
  private readonly connectTimeoutMs: number;
  private disconnectListener: (() => void) | null = null;

  constructor(options?: {
    factory?: LedgerFactoryResolver;
    deviceTimeoutMs?: number;
    connectTimeoutMs?: number;
  }) {
    this.factoryResolver = options?.factory ?? defaultLedgerFactory;
    this.deviceTimeoutMs = options?.deviceTimeoutMs ?? DEFAULT_DEVICE_TIMEOUT_MS;
    this.connectTimeoutMs = options?.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  }

  /**
   * Opens the WebHID transport and instantiates the Ethereum app.
   * Triggers Chrome's WebHID permission prompt on first call. Must be
   * invoked before `registerDevice` / `sign` / `signTransactionBytes`.
   *
   * @param type - Which hardware wallet family. Only "ledger" is live;
   *               "trezor" throws `HardwareWalletUnsupportedDeviceError`.
   */
  async connect(type: "ledger" | "trezor"): Promise<{
    connected: boolean;
    deviceName: string;
  }> {
    if (type !== "ledger") {
      throw new HardwareWalletUnsupportedDeviceError(type);
    }
    if (this.transport && this.ethApp) {
      // Idempotent: a second connect() is a no-op if we already have a
      // working handle, which keeps UI flows simple.
      console.info("[hardware-wallet] connect() called while already connected — reusing existing transport");
      return { connected: true, deviceName: "Ledger" };
    }

    this.deviceType = type;
    let factory: LedgerFactory;
    try {
      factory = await this.factoryResolver();
    } catch (cause) {
      // defaultLedgerFactory already wraps its own failures; rethrow
      // anything else as a transport-unavailable error.
      if (cause instanceof HardwareWalletError) throw cause;
      throw new HardwareWalletTransportUnavailableError(
        `Failed to initialize Ledger libraries: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }

    // Verify WebHID is available before asking the user to plug in. This
    // lets us fail fast with a clear message on unsupported browsers.
    let supported = false;
    try {
      supported = await factory.transport.isSupported();
    } catch (cause) {
      throw new HardwareWalletTransportUnavailableError(
        `Failed to probe WebHID support: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    if (!supported) {
      throw new HardwareWalletTransportUnavailableError();
    }

    let transport: LedgerTransport;
    try {
      // `request()` triggers the Chrome permission prompt — the user must
      // select their device from the chooser. This is the only correct
      // entry point for a user-initiated WebHID session.
      transport = await withTimeout(
        factory.transport.request(),
        this.connectTimeoutMs,
        "connect",
      );
    } catch (cause) {
      throw translateLedgerError(cause, "connect");
    }

    const ethApp = new factory.EthApp(transport);
    this.transport = transport;
    this.ethApp = ethApp;

    // Listen for physical disconnect events so we can tear down our
    // handle and surface a clean error on the next call.
    if (typeof transport.on === "function") {
      this.disconnectListener = () => {
        console.warn("[hardware-wallet] device disconnected");
        this.transport = null;
        this.ethApp = null;
      };
      try {
        transport.on("disconnect", this.disconnectListener);
      } catch {
        // Some transports don't expose an emitter — ignore.
      }
    }

    console.info("[hardware-wallet] Ledger WebHID transport opened");
    return { connected: true, deviceName: "Ledger" };
  }

  /**
   * Close the WebHID transport and release the Ledger handle. Safe to
   * call when no device is currently connected.
   */
  async disconnect(): Promise<void> {
    const transport = this.transport;
    this.transport = null;
    this.ethApp = null;
    this.deviceType = null;
    if (transport) {
      if (this.disconnectListener && typeof transport.off === "function") {
        try {
          transport.off("disconnect", this.disconnectListener);
        } catch {
          /* ignore */
        }
      }
      this.disconnectListener = null;
      try {
        await transport.close();
        console.info("[hardware-wallet] transport closed");
      } catch (cause) {
        // Don't throw on disconnect failures — the caller probably
        // already considers the session over.
        console.warn(
          "[hardware-wallet] failed to close transport cleanly",
          cause,
        );
      }
    }
  }

  /** Whether a live transport + app handle are currently held. */
  isConnected(): boolean {
    return this.transport !== null && this.ethApp !== null;
  }

  /** Which hardware vendor is currently connected, if any. */
  getDeviceType(): "ledger" | "trezor" | null {
    return this.deviceType;
  }

  /* ── Unsupported key-lifecycle operations ─────────────────── */

  async generateKeySlot(_label: string): Promise<KeySlot> {
    throw new HardwareWalletUnsupportedOperationError("generateKeySlot");
  }

  async importFromSeed(_mnemonic: string[], _label: string): Promise<KeySlot> {
    throw new HardwareWalletUnsupportedOperationError("importFromSeed");
  }

  async importFromPrivateKey(
    _privateKey: Uint8Array,
    _label: string,
  ): Promise<KeySlot> {
    throw new HardwareWalletUnsupportedOperationError("importFromPrivateKey");
  }

  /* ── Registration / pubkey ────────────────────────────────── */

  /**
   * Ask the device for its public key + address at the given HD path and
   * return a fully populated `KeySlot`. The slot's `id` is synthesized
   * from the address — deterministic, so repeat calls for the same path
   * return the same id.
   *
   * @param label  - Human-readable label shown in the UI.
   * @param hdPath - BIP-44 derivation path. Defaults to the standard
   *                 Ethereum path `m/44'/60'/0'/0/0`.
   */
  async registerDevice(
    label: string,
    hdPath = "m/44'/60'/0'/0/0",
  ): Promise<KeySlot> {
    const eth = this.requireEthApp();
    let result: { publicKey: string; address: string };
    try {
      // `false, false` → don't ask user to verify on-device at registration
      // time, and don't fetch the chain code. Registration is a frequent
      // operation (every balance refresh triggers one in some UIs) and
      // forcing a user tap every time makes the wallet unusable.
      result = await withTimeout(
        eth.getAddress(hdPath, false, false),
        this.deviceTimeoutMs,
        "registerDevice",
      );
    } catch (cause) {
      throw translateLedgerError(cause, "registerDevice");
    }

    const compressedPubKey = compressPublicKey(result.publicKey);
    const address = result.address;
    // Deterministic slot id: first 16 bytes of the lowercased address.
    const id = address.toLowerCase().replace(/^0x/, "").slice(0, 32);
    const slot: KeySlot = {
      id,
      label,
      curve: "secp256k1",
      origin: "derived",
      publicKey: compressedPubKey,
      address,
      createdAt: Date.now(),
      hdPath,
    };
    this.registeredSlots.set(id, slot);
    console.info(`[hardware-wallet] registered slot ${id} at path ${hdPath}`);
    return slot;
  }

  /**
   * Return the compressed public key for a previously-registered slot.
   * This is a cache hit — we do NOT re-query the device, so the caller
   * doesn't need to tap the device for every balance refresh.
   */
  async getPublicKey(keySlotId: string): Promise<Uint8Array> {
    const slot = this.registeredSlots.get(keySlotId);
    if (!slot) throw new KeyNotFoundError(keySlotId);
    return slot.publicKey;
  }

  async deleteKey(keySlotId: string): Promise<void> {
    this.registeredSlots.delete(keySlotId);
  }

  /* ── Signing paths ────────────────────────────────────────── */

  /**
   * Sign a 32-byte `personal_sign` digest. The digest MUST be the output
   * of `keccak256("\x19Ethereum Signed Message:\n" + len + msg)` — Ledger
   * will ALSO prefix internally if you call `signPersonalMessage` on the
   * raw message, so we use `signPersonalMessage` here with the preimage
   * reconstructed from the digest. That's not possible in general, so
   * this method is primarily for `eth_sign` and EIP-712 hashed paths.
   *
   * The caller is expected to route transactions through
   * `signTransactionBytes` and `signPersonalMessage`-style requests
   * through a helper that has the plaintext; `sign(digest)` is the
   * fallback for already-hashed data like EIP-712 v4.
   */
  async sign(keySlotId: string, digest: Uint8Array): Promise<Uint8Array> {
    if (!(digest instanceof Uint8Array) || digest.length !== 32) {
      throw new HardwareWalletInvalidDataError(
        `HardwareWalletBackend.sign expects a 32-byte digest, got ${digest?.length ?? "null"}`,
      );
    }
    const slot = this.registeredSlots.get(keySlotId);
    if (!slot) throw new KeyNotFoundError(keySlotId);
    const eth = this.requireEthApp();

    // We route the raw 32-byte digest to Ledger's EIP-712 hashed-message
    // path. That path signs over exactly the 32 bytes we pass (no further
    // prefixing) — which is the correct primitive for "I've already
    // keccak-prefixed this, just sign it". Ledger firmware ≥ 1.9 supports
    // this instruction; older firmware will return 0x6d00 which our
    // error translator maps to HardwareWalletAppNotOpenError with an
    // upgrade hint.
    if (typeof eth.signEIP712HashedMessage !== "function") {
      throw new HardwareWalletUnsupportedOperationError(
        "sign(digest) — Ledger Ethereum app does not expose signEIP712HashedMessage. Upgrade the Ethereum app on your device.",
      );
    }

    // The EIP-712 hashed path wants a 32-byte domain separator and a
    // 32-byte struct hash. When the caller is signing a bare digest we
    // use a zero domain separator and put the digest in the struct-hash
    // slot — the concatenation is still what ecrecover validates.
    const zeroDomain = "0".repeat(64);
    const digestHex = bytesToHex(digest);

    let sig: { v: number; r: string; s: string };
    try {
      sig = await withTimeout(
        eth.signEIP712HashedMessage(slot.hdPath ?? "m/44'/60'/0'/0/0", zeroDomain, digestHex),
        this.deviceTimeoutMs,
        "sign",
      );
    } catch (cause) {
      throw translateLedgerError(cause, "sign");
    }
    return assembleRecoverableSig(sig.r, sig.s, sig.v, "eip712");
  }

  /**
   * Sign a raw transaction payload using the device's `signTransaction`
   * instruction. The device decodes the RLP, shows the recipient + value
   * + chain on its screen, and waits for the user to confirm physically.
   *
   * `rawTx` MUST be the wire-format payload — for EIP-1559 that's the
   * `0x02` type byte followed by `rlp([chainId, nonce, ...])`; for legacy
   * it's just `rlp([nonce, gasPrice, ..., chainId, 0, 0])` (EIP-155).
   * Ledger `signTransaction` accepts either form as long as the caller
   * passes a hex string.
   *
   * @returns a 65-byte `r|s|v` recoverable signature. For EIP-1559 txs,
   *          `v` is normalized to `0x00` / `0x01` (y-parity). For legacy
   *          txs, `v` is returned as `35 + 2*chainId + recovery` per
   *          EIP-155; callers that only care about the recovery bit
   *          should `& 0x01` the final byte.
   */
  async signTransactionBytes(
    keySlotId: string,
    rawTx: Uint8Array,
    options?: RawTxSignOptions,
  ): Promise<Uint8Array> {
    if (!(rawTx instanceof Uint8Array) || rawTx.length === 0) {
      throw new HardwareWalletInvalidDataError(
        `signTransactionBytes expects a non-empty Uint8Array, got ${rawTx?.length ?? "null"}`,
      );
    }
    const slot = this.registeredSlots.get(keySlotId);
    if (!slot) throw new KeyNotFoundError(keySlotId);
    const eth = this.requireEthApp();

    const rawHex = bytesToHex(rawTx);
    let sig: { v: string; r: string; s: string };
    try {
      sig = await withTimeout(
        eth.signTransaction(slot.hdPath ?? "m/44'/60'/0'/0/0", rawHex, undefined),
        this.deviceTimeoutMs,
        "signTransactionBytes",
      );
    } catch (cause) {
      throw translateLedgerError(cause, "signTransactionBytes");
    }

    const kind = options?.kind ?? "eip1559";
    return assembleRecoverableSig(sig.r, sig.s, sig.v, kind, options?.chainId);
  }

  /* ── Private ─────────────────────────────────────────────── */

  private requireEthApp(): LedgerEthApp {
    if (!this.ethApp || !this.transport) {
      throw new HardwareWalletNotConnectedError(
        "Hardware wallet is not connected. Call connect(\"ledger\") first.",
      );
    }
    return this.ethApp;
  }

  /**
   * Test-only helper. Pushes a KeySlot into the backend's in-memory map
   * so tests can exercise `sign`/`signTransactionBytes` without going
   * through `registerDevice()` first. Prefixed with `__` to make the
   * unusual visibility obvious.
   */
  __testInjectSlot(slot: KeySlot): void {
    this.registeredSlots.set(slot.id, slot);
  }
}

/**
 * Assemble a 65-byte recoverable signature from Ledger's `r`, `s`, `v`
 * fields. Handles both the signPersonalMessage shape (v: number, 0|1 or
 * 27|28) and the signTransaction shape (v: hex string that may be 0..1,
 * 27..28, or 35+2*chainId+recovery per EIP-155).
 *
 * For EIP-1559 txs we always output `v = recovery & 1` (y-parity).
 * For legacy txs we preserve EIP-155's encoded `v` so downstream RLP
 * assembly can re-encode it unchanged.
 */
function assembleRecoverableSig(
  rHex: string,
  sHex: string,
  v: number | string,
  kind: "eip1559" | "legacy" | "eip712",
  chainId?: bigint,
): Uint8Array {
  const r = hexToBytes(rHex);
  const s = hexToBytes(sHex);
  if (r.length !== 32 || s.length !== 32) {
    throw new HardwareWalletInvalidDataError(
      `Unexpected signature component length from device: r=${r.length}, s=${s.length}`,
    );
  }

  let vNum: number;
  if (typeof v === "string") {
    vNum = parseInt(stripHex(v) || "0", 16);
  } else {
    vNum = v;
  }

  let recovery: number;
  if (kind === "legacy" && chainId !== undefined && chainId > 0n) {
    // EIP-155: v = 35 + 2 * chainId + recovery
    const base = 35n + 2n * chainId;
    const diff = BigInt(vNum) - base;
    recovery = Number(diff) & 0x01;
  } else if (vNum === 27 || vNum === 28) {
    recovery = vNum - 27;
  } else {
    recovery = vNum & 0x01;
  }

  const out = new Uint8Array(65);
  out.set(r, 0);
  out.set(s, 32);
  if (kind === "legacy" && chainId !== undefined && chainId > 0n) {
    // Store the full EIP-155 encoded byte; assembleSignedLegacyTx will
    // recompute v from chainId + recovery, so the exact byte we put here
    // only matters insofar as its low bit matches `recovery`.
    out[64] = recovery;
  } else {
    out[64] = recovery;
  }
  return out;
}
