/**
 * Hardware wallet backend tests.
 *
 * These tests drive `HardwareWalletBackend` with a fake Ledger factory
 * instead of the real `@ledgerhq/*` libraries. Rationale: those libs pull
 * in node-hid / libusb shims that jsdom cannot satisfy, and the backend
 * already exposes a clean `{ factory }` seam in its constructor for
 * exactly this purpose.
 *
 * Every test exercises the same code path the production wiring does —
 * we construct a `HardwareWalletBackend`, inject a stub factory, and
 * assert on its observable behaviour (method calls, returned slots,
 * thrown error classes). No `vi.mock`, no module-level hacks.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  HardwareWalletBackend,
  HardwareWalletNotConnectedError,
  HardwareWalletUserRejectedError,
  HardwareWalletAppNotOpenError,
  HardwareWalletTransportUnavailableError,
  HardwareWalletUnsupportedDeviceError,
  HardwareWalletUnsupportedOperationError,
  HardwareWalletInvalidDataError,
  HARDWARE_WALLET_ERROR_CODES,
  type LedgerFactory,
} from "@aethelred/wallet-core";

/**
 * Fake uncompressed secp256k1 pubkey for the fake Ledger to return. It
 * is NOT a real point — we only need the length + 0x04 prefix to be
 * well-formed so `compressPublicKey` accepts it. 65 bytes total:
 *   1 byte 0x04 + 32 bytes of 0x11 (X) + 32 bytes of 0x22 (Y).
 * The low bit of Y (0x22) is 0, so compression should prefix with 0x02.
 */
const FAKE_X_HEX = "11".repeat(32);
const FAKE_Y_HEX = "22".repeat(32);
const FAKE_UNCOMPRESSED_PUBKEY_HEX = `04${FAKE_X_HEX}${FAKE_Y_HEX}`;
const FAKE_ADDRESS = "0x1234567890abcdef1234567890abcdef12345678";
const DEFAULT_HD_PATH = "m/44'/60'/0'/0/0";

interface FakeEthAppMocks {
  getAddress: ReturnType<typeof vi.fn>;
  signTransaction: ReturnType<typeof vi.fn>;
  signEIP712HashedMessage: ReturnType<typeof vi.fn>;
}

interface FakeTransportMocks {
  isSupported: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
}

/**
 * Construct a fresh set of mocks + the backend pre-wired with them.
 * Each test calls `makeBackend()` to get a clean state so test order
 * can't cause flakes.
 */
function makeBackend(): {
  backend: HardwareWalletBackend;
  transport: FakeTransportMocks;
  ethApp: FakeEthAppMocks;
  factory: () => Promise<LedgerFactory>;
} {
  const transport: FakeTransportMocks = {
    isSupported: vi.fn().mockResolvedValue(true),
    request: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
  };
  const transportHandle = {
    close: transport.close,
    on: transport.on,
    off: transport.off,
  };
  transport.request.mockResolvedValue(transportHandle);

  const ethApp: FakeEthAppMocks = {
    getAddress: vi.fn().mockResolvedValue({
      publicKey: FAKE_UNCOMPRESSED_PUBKEY_HEX,
      address: FAKE_ADDRESS,
    }),
    signTransaction: vi.fn().mockResolvedValue({
      r: "11".repeat(32),
      s: "22".repeat(32),
      v: "00",
    }),
    signEIP712HashedMessage: vi.fn().mockResolvedValue({
      r: "aa".repeat(32),
      s: "bb".repeat(32),
      v: 1,
    }),
  };

  // A fake ctor that returns the shared ethApp mock so assertions can
  // verify which methods were called.
  class FakeEthApp {
    constructor(_transport: unknown) {}
    getAddress = ethApp.getAddress;
    signTransaction = ethApp.signTransaction;
    signEIP712HashedMessage = ethApp.signEIP712HashedMessage;
  }

  const factory = vi.fn().mockResolvedValue({
    transport: {
      isSupported: transport.isSupported,
      request: transport.request,
      create: vi.fn().mockResolvedValue(transportHandle),
    },
    EthApp: FakeEthApp as unknown as LedgerFactory["EthApp"],
  });

  const backend = new HardwareWalletBackend({
    factory: factory as unknown as () => Promise<LedgerFactory>,
    // Short timeouts so hanging tests fail fast rather than timing
    // out the vitest harness.
    deviceTimeoutMs: 2_000,
    connectTimeoutMs: 2_000,
  });

  return {
    backend,
    transport,
    ethApp,
    factory: factory as unknown as () => Promise<LedgerFactory>,
  };
}

describe("HardwareWalletBackend — connect / disconnect", () => {
  let ctx: ReturnType<typeof makeBackend>;

  beforeEach(() => {
    ctx = makeBackend();
  });

  it("connect('ledger') opens WebHID via request() and reports connected", async () => {
    expect(ctx.backend.isConnected()).toBe(false);
    const result = await ctx.backend.connect("ledger");

    expect(result.connected).toBe(true);
    expect(result.deviceName).toBe("Ledger");
    expect(ctx.transport.isSupported).toHaveBeenCalledTimes(1);
    expect(ctx.transport.request).toHaveBeenCalledTimes(1);
    expect(ctx.backend.isConnected()).toBe(true);
  });

  it("connect('trezor') refuses with HardwareWalletUnsupportedDeviceError", async () => {
    await expect(ctx.backend.connect("trezor")).rejects.toBeInstanceOf(
      HardwareWalletUnsupportedDeviceError,
    );
    expect(ctx.backend.isConnected()).toBe(false);
    // Factory must not be called when the device type is refused.
    expect(ctx.transport.request).not.toHaveBeenCalled();
  });

  it("connect throws HardwareWalletTransportUnavailableError when WebHID not supported", async () => {
    ctx.transport.isSupported.mockResolvedValueOnce(false);
    await expect(ctx.backend.connect("ledger")).rejects.toBeInstanceOf(
      HardwareWalletTransportUnavailableError,
    );
    expect(ctx.backend.isConnected()).toBe(false);
    expect(ctx.transport.request).not.toHaveBeenCalled();
  });

  it("disconnect() closes the transport and clears state", async () => {
    await ctx.backend.connect("ledger");
    expect(ctx.backend.isConnected()).toBe(true);

    await ctx.backend.disconnect();
    expect(ctx.backend.isConnected()).toBe(false);
    expect(ctx.transport.close).toHaveBeenCalledTimes(1);
  });
});

describe("HardwareWalletBackend — registerDevice", () => {
  it("returns a real KeySlot populated from eth.getAddress()", async () => {
    const ctx = makeBackend();
    await ctx.backend.connect("ledger");

    const slot = await ctx.backend.registerDevice("My Ledger");

    expect(ctx.ethApp.getAddress).toHaveBeenCalledWith(DEFAULT_HD_PATH, false, false);
    expect(slot.label).toBe("My Ledger");
    expect(slot.curve).toBe("secp256k1");
    expect(slot.origin).toBe("derived");
    expect(slot.address).toBe(FAKE_ADDRESS);
    expect(slot.hdPath).toBe(DEFAULT_HD_PATH);
    // Compressed pubkey is 33 bytes starting with 0x02 or 0x03.
    expect(slot.publicKey).toBeInstanceOf(Uint8Array);
    expect(slot.publicKey.length).toBe(33);
    expect(slot.publicKey[0] === 0x02 || slot.publicKey[0] === 0x03).toBe(true);
    // No bytes are all-zero (the old stub returned 33 zero bytes).
    expect(slot.publicKey.some((b) => b !== 0)).toBe(true);
  });

  it("registerDevice propagates HardwareWalletNotConnectedError when not connected", async () => {
    const ctx = makeBackend();
    await expect(ctx.backend.registerDevice("Unplugged")).rejects.toBeInstanceOf(
      HardwareWalletNotConnectedError,
    );
    expect(ctx.ethApp.getAddress).not.toHaveBeenCalled();
  });
});

describe("HardwareWalletBackend — signTransactionBytes", () => {
  it("routes raw tx bytes through Ledger's signTransaction API", async () => {
    const ctx = makeBackend();
    await ctx.backend.connect("ledger");
    const slot = await ctx.backend.registerDevice("Main");

    const rawTx = Uint8Array.from([0x02, 0xf8, 0x6a, 0x80, 0x80, 0x84]);
    const sig = await ctx.backend.signTransactionBytes(slot.id, rawTx, {
      kind: "eip1559",
      chainId: 1n,
    });

    expect(ctx.ethApp.signTransaction).toHaveBeenCalledTimes(1);
    const [hdPath, rawHex] = ctx.ethApp.signTransaction.mock.calls[0];
    expect(hdPath).toBe(DEFAULT_HD_PATH);
    // The raw bytes should be forwarded to the device as hex.
    expect(rawHex).toBe("02f86a808084");

    expect(sig.length).toBe(65);
    // r = 0x11..11, s = 0x22..22 per the fake
    expect(sig[0]).toBe(0x11);
    expect(sig[31]).toBe(0x11);
    expect(sig[32]).toBe(0x22);
    expect(sig[63]).toBe(0x22);
  });

  it("rejects invalid (zero-length or non-Uint8Array) raw tx", async () => {
    const ctx = makeBackend();
    await ctx.backend.connect("ledger");
    const slot = await ctx.backend.registerDevice("Main");

    await expect(
      ctx.backend.signTransactionBytes(slot.id, new Uint8Array(0), {
        kind: "eip1559",
        chainId: 1n,
      }),
    ).rejects.toBeInstanceOf(HardwareWalletInvalidDataError);
  });

  it("translates 0x6985 (user rejected) to HardwareWalletUserRejectedError", async () => {
    const ctx = makeBackend();
    await ctx.backend.connect("ledger");
    const slot = await ctx.backend.registerDevice("Main");

    const rejectError = new Error("Transaction rejected");
    // Attach statusCode to mimic TransportStatusError from @ledgerhq/errors.
    (rejectError as unknown as { statusCode: number }).statusCode = 0x6985;
    ctx.ethApp.signTransaction.mockRejectedValueOnce(rejectError);

    await expect(
      ctx.backend.signTransactionBytes(slot.id, Uint8Array.from([0x02, 0x01]), {
        kind: "eip1559",
        chainId: 1n,
      }),
    ).rejects.toBeInstanceOf(HardwareWalletUserRejectedError);
  });

  it("translates 0x6b0c (app not open) to HardwareWalletAppNotOpenError", async () => {
    const ctx = makeBackend();
    await ctx.backend.connect("ledger");
    const slot = await ctx.backend.registerDevice("Main");

    const appError = new Error("Please open the Ethereum app");
    (appError as unknown as { statusCode: number }).statusCode = 0x6b0c;
    ctx.ethApp.signTransaction.mockRejectedValueOnce(appError);

    await expect(
      ctx.backend.signTransactionBytes(slot.id, Uint8Array.from([0x02, 0x01]), {
        kind: "eip1559",
        chainId: 1n,
      }),
    ).rejects.toBeInstanceOf(HardwareWalletAppNotOpenError);
  });
});

describe("HardwareWalletBackend — sign (digest path via EIP-712 hashed)", () => {
  it("routes a 32-byte digest through signEIP712HashedMessage", async () => {
    const ctx = makeBackend();
    await ctx.backend.connect("ledger");
    const slot = await ctx.backend.registerDevice("Main");

    const digest = new Uint8Array(32).fill(0x77);
    const sig = await ctx.backend.sign(slot.id, digest);

    expect(ctx.ethApp.signEIP712HashedMessage).toHaveBeenCalledTimes(1);
    const [hdPath, domainHex, digestHex] =
      ctx.ethApp.signEIP712HashedMessage.mock.calls[0];
    expect(hdPath).toBe(DEFAULT_HD_PATH);
    expect(domainHex).toBe("0".repeat(64));
    expect(digestHex).toBe("77".repeat(32));

    expect(sig.length).toBe(65);
    // r = 0xaa.., s = 0xbb.., v = recovery from fake (1)
    expect(sig[0]).toBe(0xaa);
    expect(sig[32]).toBe(0xbb);
    expect(sig[64]).toBe(1);
  });

  it("rejects non-32-byte digests before touching the device", async () => {
    const ctx = makeBackend();
    await ctx.backend.connect("ledger");
    const slot = await ctx.backend.registerDevice("Main");

    await expect(ctx.backend.sign(slot.id, new Uint8Array(10))).rejects.toBeInstanceOf(
      HardwareWalletInvalidDataError,
    );
    expect(ctx.ethApp.signEIP712HashedMessage).not.toHaveBeenCalled();
  });
});

describe("HardwareWalletBackend — key lifecycle refusals", () => {
  it("generateKeySlot / importFromSeed / importFromPrivateKey all throw Unsupported", async () => {
    const ctx = makeBackend();
    await expect(ctx.backend.generateKeySlot("x")).rejects.toBeInstanceOf(
      HardwareWalletUnsupportedOperationError,
    );
    await expect(ctx.backend.importFromSeed([], "x")).rejects.toBeInstanceOf(
      HardwareWalletUnsupportedOperationError,
    );
    await expect(
      ctx.backend.importFromPrivateKey(new Uint8Array(32), "x"),
    ).rejects.toBeInstanceOf(HardwareWalletUnsupportedOperationError);
  });
});

describe("HardwareWalletBackend — error codes", () => {
  it("exposes stable string error codes for UI matching", () => {
    expect(HARDWARE_WALLET_ERROR_CODES.USER_REJECTED).toBe("HW_USER_REJECTED");
    expect(HARDWARE_WALLET_ERROR_CODES.APP_NOT_OPEN).toBe("HW_APP_NOT_OPEN");
    expect(HARDWARE_WALLET_ERROR_CODES.NOT_CONNECTED).toBe("HW_NOT_CONNECTED");
    expect(HARDWARE_WALLET_ERROR_CODES.TRANSPORT_UNAVAILABLE).toBe(
      "HW_TRANSPORT_UNAVAILABLE",
    );

    // Every thrown error carries its code so the UI can switch on it.
    const err = new HardwareWalletUserRejectedError();
    expect(err.code).toBe(HARDWARE_WALLET_ERROR_CODES.USER_REJECTED);
  });
});
