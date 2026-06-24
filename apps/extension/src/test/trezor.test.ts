/**
 * Tests for the Trezor custody backend. A fake Trezor Connect client is
 * injected through the constructor seam (mirroring the Ledger test pattern),
 * so we exercise the real envelope handling, signature assembly, and typed
 * error mapping without a device or @trezor/connect-web installed.
 */

import { describe, it, expect, vi } from "vitest";
import {
  TrezorWalletBackend,
  HardwareWalletUserRejectedError,
  HardwareWalletTransportFailureError,
  HardwareWalletNotConnectedError,
  HardwareWalletUnsupportedOperationError,
  HardwareWalletInvalidDataError,
  KeyNotFoundError,
  bytesToHex,
  type TrezorConnectClient,
  type TrezorResponse,
} from "@aethelred/wallet-core";

const ADDRESS = "0xAbC0000000000000000000000000000000001234";
const SLOT_ID = ADDRESS.toLowerCase().replace(/^0x/, "").slice(0, 32);
const PUBKEY = "0x02" + "ab".repeat(32); // 33-byte compressed
const SIG65 = "0x" + "11".repeat(65);
const R = "0x" + "22".repeat(32);
const S = "0x" + "33".repeat(32);

type FakeOverrides = Partial<{
  getAddress: TrezorResponse<{ address: string }>;
  getPublicKey: TrezorResponse<{ publicKey: string }>;
  signMessage: TrezorResponse<{ address: string; signature: string }>;
  signTransaction: TrezorResponse<{ v: string; r: string; s: string }>;
}>;

function makeFake(overrides: FakeOverrides = {}) {
  // Typed defaults so the `success: true` discriminant isn't widened to
  // `boolean` (which would break assignment to the TrezorResponse union).
  const okAddr: TrezorResponse<{ address: string }> = { success: true, payload: { address: ADDRESS } };
  const okPub: TrezorResponse<{ publicKey: string }> = { success: true, payload: { publicKey: PUBKEY } };
  const okMsg: TrezorResponse<{ address: string; signature: string }> = { success: true, payload: { address: ADDRESS, signature: SIG65 } };
  const okTx: TrezorResponse<{ v: string; r: string; s: string }> = { success: true, payload: { v: "0x1b", r: R, s: S } };
  const init = vi.fn(async () => {});
  const client: TrezorConnectClient = {
    init,
    ethereumGetAddress: vi.fn(async () => overrides.getAddress ?? okAddr),
    getPublicKey: vi.fn(async () => overrides.getPublicKey ?? okPub),
    ethereumSignMessage: vi.fn(async () => overrides.signMessage ?? okMsg),
    ethereumSignTransaction: vi.fn(async () => overrides.signTransaction ?? okTx),
  };
  return { client, init };
}

function backendWith(overrides: FakeOverrides = {}) {
  const { client, init } = makeFake(overrides);
  return { backend: new TrezorWalletBackend({ client: async () => client }), client, init };
}

const TX = { to: "0x" + "ee".repeat(20), value: "0x0", gasLimit: "0x5208", nonce: "0x1", chainId: 1 };

describe("TrezorWalletBackend.connect", () => {
  it("initializes Connect and registers the default account", async () => {
    const { backend, client, init } = backendWith();
    const res = await backend.connect();
    expect(res).toEqual({ connected: true, deviceName: "Trezor" });
    expect(init).toHaveBeenCalledOnce();
    expect(client.ethereumGetAddress).toHaveBeenCalledWith({ path: "m/44'/60'/0'/0/0", showOnTrezor: false });
    expect(backend.getAddress(SLOT_ID)).toBe(ADDRESS);
    expect(await backend.getPublicKey(SLOT_ID)).toHaveLength(33);
  });

  it("rejects a non-compressed public key", async () => {
    const { backend } = backendWith({ getPublicKey: { success: true, payload: { publicKey: "0x04" + "ab".repeat(64) } } });
    await expect(backend.connect()).rejects.toBeInstanceOf(HardwareWalletInvalidDataError);
  });

  it("maps a cancelled address lookup to USER_REJECTED", async () => {
    const { backend } = backendWith({ getAddress: { success: false, payload: { error: "Action cancelled by user", code: "Method_Cancel" } } });
    await expect(backend.connect()).rejects.toBeInstanceOf(HardwareWalletUserRejectedError);
  });
});

describe("TrezorWalletBackend signing", () => {
  it("signs a personal message → 65 bytes, hex flag set for byte input", async () => {
    const { backend, client } = backendWith();
    await backend.connect();
    const sig = await backend.signMessage(SLOT_ID, new Uint8Array([1, 2, 3]));
    expect(sig).toHaveLength(65);
    expect(client.ethereumSignMessage).toHaveBeenCalledWith(
      expect.objectContaining({ message: bytesToHex(new Uint8Array([1, 2, 3])).slice(2), hex: true }),
    );
    // string input is passed through unflagged
    await backend.signMessage(SLOT_ID, "hello");
    expect(client.ethereumSignMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: "hello", hex: false }),
    );
  });

  it("assembles a transaction signature as r‖s‖v", async () => {
    const { backend } = backendWith();
    await backend.connect();
    const sig = await backend.signTransaction(SLOT_ID, TX);
    expect(sig).toHaveLength(65);
    expect(bytesToHex(sig.slice(0, 32))).toBe(R);
    expect(bytesToHex(sig.slice(32, 64))).toBe(S);
    expect(sig[64]).toBe(0x1b);
  });

  it("maps a generic signing failure to TRANSPORT_FAILURE", async () => {
    const { backend } = backendWith({ signMessage: { success: false, payload: { error: "device disconnected" } } });
    await backend.connect();
    await expect(backend.signMessage(SLOT_ID, "x")).rejects.toBeInstanceOf(HardwareWalletTransportFailureError);
  });

  it("rejects a wrong-length signature", async () => {
    const { backend } = backendWith({ signMessage: { success: true, payload: { address: ADDRESS, signature: "0x1234" } } });
    await backend.connect();
    await expect(backend.signMessage(SLOT_ID, "x")).rejects.toBeInstanceOf(HardwareWalletInvalidDataError);
  });
});

describe("TrezorWalletBackend guard rails", () => {
  it("refuses to blind-sign a digest and to handle key material", async () => {
    const { backend } = backendWith();
    await backend.connect();
    await expect(backend.sign()).rejects.toBeInstanceOf(HardwareWalletUnsupportedOperationError);
    await expect(backend.generateKeySlot()).rejects.toBeInstanceOf(HardwareWalletUnsupportedOperationError);
    await expect(backend.importFromSeed()).rejects.toBeInstanceOf(HardwareWalletUnsupportedOperationError);
    await expect(backend.importFromPrivateKey()).rejects.toBeInstanceOf(HardwareWalletUnsupportedOperationError);
  });

  it("throws NotConnected before connect and KeyNotFound for unknown slots", async () => {
    const { backend } = backendWith();
    await expect(backend.registerDevice("x")).rejects.toBeInstanceOf(HardwareWalletNotConnectedError);
    await backend.connect();
    await expect(backend.signMessage("deadbeef", "x")).rejects.toBeInstanceOf(KeyNotFoundError);
    expect(() => backend.getAddress("deadbeef")).toThrow(KeyNotFoundError);
  });

  it("clears state on disconnect", async () => {
    const { backend } = backendWith();
    await backend.connect();
    await backend.disconnect();
    expect(() => backend.getAddress(SLOT_ID)).toThrow(KeyNotFoundError);
  });
});
