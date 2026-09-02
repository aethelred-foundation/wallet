import { describe, expect, it, vi } from "vitest";

import { TxManager, type RpcClient } from "@aethelred/wallet-chain";

const ADDRESS = "0x1111111111111111111111111111111111111111";

function rpcWithPendingNonce(readNonce: () => number): RpcClient {
  return {
    call: vi.fn(async (method: string, params: unknown[]) => {
      expect(method).toBe("eth_getTransactionCount");
      expect(params[1]).toBe("pending");
      return `0x${readNonce().toString(16)}`;
    }),
  } as unknown as RpcClient;
}

describe("TxManager nonce allocation", () => {
  it("serializes concurrent allocations so every caller receives a unique nonce", async () => {
    const manager = new TxManager(rpcWithPendingNonce(() => 7));

    await expect(
      Promise.all([
        manager.getNonce(ADDRESS),
        manager.getNonce(ADDRESS),
        manager.getNonce(ADDRESS),
      ]),
    ).resolves.toEqual([7, 8, 9]);
  });

  it("reuses out-of-order pre-broadcast releases from lowest to highest", async () => {
    const manager = new TxManager(rpcWithPendingNonce(() => 10));
    const [first, second, third] = await Promise.all([
      manager.getNonce(ADDRESS),
      manager.getNonce(ADDRESS),
      manager.getNonce(ADDRESS),
    ]);

    manager.releaseNonce(ADDRESS, second);
    manager.releaseNonce(ADDRESS, first);

    await expect(
      Promise.all([
        manager.getNonce(ADDRESS),
        manager.getNonce(ADDRESS),
        manager.getNonce(ADDRESS),
      ]),
    ).resolves.toEqual([10, 11, 13]);
    expect(third).toBe(12);
  });

  it("treats duplicate releases as one reusable reservation", async () => {
    const manager = new TxManager(rpcWithPendingNonce(() => 3));
    const nonce = await manager.getNonce(ADDRESS);

    manager.releaseNonce(ADDRESS, nonce);
    manager.releaseNonce(ADDRESS, nonce);

    await expect(
      Promise.all([manager.getNonce(ADDRESS), manager.getNonce(ADDRESS)]),
    ).resolves.toEqual([3, 4]);
  });

  it("discards released nonces that are below the latest pending chain nonce", async () => {
    let pendingNonce = 5;
    const manager = new TxManager(rpcWithPendingNonce(() => pendingNonce));
    const released = await manager.getNonce(ADDRESS);
    manager.releaseNonce(ADDRESS, released);

    pendingNonce = 8;

    await expect(manager.getNonce(ADDRESS)).resolves.toBe(8);
    await expect(manager.getNonce(ADDRESS)).resolves.toBe(9);
  });

  it("shares nonce state across case variants of the same address", async () => {
    const manager = new TxManager(rpcWithPendingNonce(() => 1));
    const nonce = await manager.getNonce(ADDRESS.toUpperCase());
    manager.releaseNonce(ADDRESS.toLowerCase(), nonce);

    await expect(manager.getNonce(ADDRESS)).resolves.toBe(1);
  });

  it("ignores invalid or never-allocated nonce releases", async () => {
    const manager = new TxManager(rpcWithPendingNonce(() => 0));

    manager.releaseNonce(ADDRESS, -1);
    manager.releaseNonce(ADDRESS, 0);
    manager.releaseNonce(ADDRESS, Number.NaN);

    await expect(manager.getNonce(ADDRESS)).resolves.toBe(0);
    await expect(manager.getNonce(ADDRESS)).resolves.toBe(1);
  });

  it("keeps synchronous reservations on the high-water path until reuse is RPC-validated", async () => {
    const manager = new TxManager(rpcWithPendingNonce(() => 5));
    const released = await manager.getNonce(ADDRESS);
    manager.releaseNonce(ADDRESS, released);

    expect(manager.reserveNonce(ADDRESS)).toBe(6);
    await expect(manager.getNonce(ADDRESS)).resolves.toBe(5);
    await expect(manager.getNonce(ADDRESS)).resolves.toBe(7);
  });
});
