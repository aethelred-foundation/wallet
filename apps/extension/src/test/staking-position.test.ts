/**
 * StakingPositionFetcher tests — the live staking reader behind the
 * portfolio's Staking tab (Cruzible W-2).
 *
 * The decode functions are pure, so most tests build ABI-encoded return
 * hex by hand (same convention as simulator-decoding.test.ts). The fetcher
 * itself is exercised against a stub RpcClient to pin the exact eth_call
 * shapes: vault discovery via stAETHEL.vault(), then a single batch for
 * balance/rate/APY/withdrawals.
 */

import { describe, it, expect } from "vitest";
import {
  StakingPositionFetcher,
  decodeWithdrawals,
  decodeUintReturn,
  decodeAddressReturn,
} from "@aethelred/wallet-chain";
import type { RpcClient } from "@aethelred/wallet-chain";

const word = (v: bigint | number) => BigInt(v).toString(16).padStart(64, "0");
const addrWord = (a: string) => a.slice(2).toLowerCase().padStart(64, "0");

const USER = "0x2ea3036f71755507d9276c7d94bfcf1d34f7e919";
const TOKEN = "0xfdeebc51e6d571a689eadb0df7b5a42989230be1";
const VAULT = "0x064b252636a8ee3c7d49256e67ea21a3f4ed1323";

/** ABI-encode a Withdrawal[] return: offset + length + 6 words per entry. */
function encodeWithdrawals(
  entries: Array<{
    id: bigint;
    shares: bigint;
    aethelAmount: bigint;
    requestTime: number;
    completionTime: number;
    claimed: boolean;
  }>,
): string {
  let hex = "0x" + word(32) + word(entries.length);
  for (const e of entries) {
    hex +=
      word(e.id) +
      word(e.shares) +
      word(e.aethelAmount) +
      word(e.requestTime) +
      word(e.completionTime) +
      word(e.claimed ? 1 : 0);
  }
  return hex;
}

describe("staking-position decoders", () => {
  it("decodes an empty withdrawal queue", () => {
    expect(decodeWithdrawals("0x" + word(32) + word(0), 1000)).toEqual([]);
    expect(decodeWithdrawals("0x", 1000)).toEqual([]);
    expect(decodeWithdrawals(undefined, 1000)).toEqual([]);
  });

  it("decodes withdrawals and derives claimability from completion time", () => {
    const now = 2_000_000;
    const hex = encodeWithdrawals([
      // matured, unclaimed → claimable
      { id: 1n, shares: 10n ** 18n, aethelAmount: 12n * 10n ** 17n, requestTime: now - 100, completionTime: now - 10, claimed: false },
      // still unbonding
      { id: 2n, shares: 10n ** 18n, aethelAmount: 10n ** 18n, requestTime: now - 5, completionTime: now + 3600, claimed: false },
      // already claimed → never claimable
      { id: 3n, shares: 10n ** 18n, aethelAmount: 10n ** 18n, requestTime: now - 500, completionTime: now - 400, claimed: true },
    ]);

    const out = decodeWithdrawals(hex, now);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ id: "1", aethelWei: (12n * 10n ** 17n).toString(), claimable: true, claimed: false });
    expect(out[1]).toMatchObject({ id: "2", claimable: false, claimed: false, completionTime: now + 3600 });
    expect(out[2]).toMatchObject({ id: "3", claimable: false, claimed: true });
  });

  it("decodes uint and address returns", () => {
    expect(decodeUintReturn("0x" + word(1500))).toBe(1500n);
    expect(decodeUintReturn("0x")).toBe(0n);
    expect(decodeAddressReturn("0x" + addrWord(VAULT))).toBe(VAULT);
    expect(decodeAddressReturn("0x")).toBeNull();
  });
});

describe("StakingPositionFetcher", () => {
  function stubRpc(handlers: {
    call: (method: string, params: unknown[]) => string;
    batch: (reqs: Array<{ method: string; params: unknown[] }>) => string[];
  }): RpcClient {
    return {
      call: async (method: string, params: unknown[] = []) => handlers.call(method, params),
      batch: async (reqs: Array<{ method: string; params: unknown[] }>) => handlers.batch(reqs),
    } as unknown as RpcClient;
  }

  it("discovers the vault from stAETHEL.vault() and reads the position", async () => {
    const batchCalls: Array<{ to: string; data: string }> = [];
    const rpc = stubRpc({
      call: (method, params) => {
        expect(method).toBe("eth_call");
        const tx = (params as Array<{ to: string; data: string }>)[0];
        expect(tx.to).toBe(TOKEN);
        expect(tx.data).toBe("0xfbfa77cf"); // vault()
        return "0x" + addrWord(VAULT);
      },
      batch: (reqs) => {
        for (const r of reqs) batchCalls.push((r.params as Array<{ to: string; data: string }>)[0]);
        return [
          "0x" + word(5n * 10n ** 18n), // balanceOf
          "0x" + word(10n ** 18n + 2_950_000_000_000n), // getExchangeRate
          "0x" + word(412), // effectiveAPY (bps)
          encodeWithdrawals([]), // getUserWithdrawals
        ];
      },
    });

    const position = await new StakingPositionFetcher(rpc).getPosition(USER, TOKEN);
    expect(position).toMatchObject({
      tokenAddress: TOKEN,
      vaultAddress: VAULT,
      stakedWei: (5n * 10n ** 18n).toString(),
      exchangeRateWei: (10n ** 18n + 2_950_000_000_000n).toString(),
      apyBps: 412,
      withdrawals: [],
    });

    // Balance + withdrawals target the right contracts with the user arg.
    expect(batchCalls[0]).toMatchObject({ to: TOKEN });
    expect(batchCalls[0].data.startsWith("0x70a08231")).toBe(true);
    expect(batchCalls[0].data.endsWith(USER.slice(2))).toBe(true);
    expect(batchCalls[1]).toMatchObject({ to: VAULT, data: "0xe6aa216c" });
    expect(batchCalls[2]).toMatchObject({ to: VAULT, data: "0x977ae810" });
    expect(batchCalls[3]).toMatchObject({ to: VAULT });
    expect(batchCalls[3].data.startsWith("0xe502eb68")).toBe(true);
  });

  it("returns null for tokens that do not expose vault()", async () => {
    const rpc = stubRpc({
      call: () => "0x",
      batch: () => {
        throw new Error("must not batch when vault discovery fails");
      },
    });
    expect(await new StakingPositionFetcher(rpc).getPosition(USER, TOKEN)).toBeNull();
  });
});
