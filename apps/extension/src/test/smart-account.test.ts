/**
 * Tests for the ERC-4337 v0.7 smart-account primitives.
 *
 * The expected hex vectors in this file were produced by running the
 * canonical abi.encode / keccak sequence by hand (see the package's
 * user-operation.ts JSDoc for the spec). Any drift in the packing
 * logic will surface here before it breaks a real smart-account
 * signature flow.
 */

import { describe, it, expect, vi } from "vitest";
import {
  BundlerClient,
  BundlerError,
  ENTRYPOINT_V06_ADDRESS,
  ENTRYPOINT_V07_ADDRESS,
  UserOperationBuilder,
  computeSimpleAccountAddress,
  computeUserOpHash,
  encodeSimpleAccountExecute,
  encodeSimpleAccountExecuteBatch,
  encodeSimpleAccountFactoryData,
  getEntryPointForChain,
  packUserOperation,
  serializeUserOperation,
  SIMPLE_ACCOUNT_FACTORY_ADDRESS,
  type UserOperation,
} from "@aethelred/wallet-smart-account";

const SENDER = "0x1111111111111111111111111111111111111111" as const;
const OWNER = "0x2222222222222222222222222222222222222222" as const;
const RECIPIENT = "0x3333333333333333333333333333333333333333" as const;

/** Build a fully-populated UserOperation matching the hand-computed vector. */
function makeReferenceOp(overrides: Partial<UserOperation> = {}): UserOperation {
  return {
    sender: SENDER,
    nonce: 7n,
    callData: "0xdeadbeef",
    callGasLimit: 100_000n,
    verificationGasLimit: 200_000n,
    preVerificationGas: 21_000n,
    maxFeePerGas: 2_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    signature: "0x",
    ...overrides,
  };
}

describe("UserOperationBuilder", () => {
  it("builds a UserOperation with the expected shape", () => {
    const op = new UserOperationBuilder({
      chainId: 1,
      entryPointAddress: ENTRYPOINT_V07_ADDRESS,
      sender: SENDER,
    })
      .setNonce(7n)
      .setCallData("0xdeadbeef")
      .setGas({
        callGasLimit: 100_000n,
        verificationGasLimit: 200_000n,
        preVerificationGas: 21_000n,
        maxFeePerGas: 2_000_000_000n,
        maxPriorityFeePerGas: 1_000_000_000n,
      })
      .build();

    expect(op).toMatchObject({
      sender: SENDER,
      nonce: 7n,
      callData: "0xdeadbeef",
      callGasLimit: 100_000n,
      verificationGasLimit: 200_000n,
      preVerificationGas: 21_000n,
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      signature: "0x",
    });
    expect(op.factory).toBeUndefined();
    expect(op.paymaster).toBeUndefined();
  });

  it("throws when required fields are missing", () => {
    const b = new UserOperationBuilder({
      chainId: 1,
      entryPointAddress: ENTRYPOINT_V07_ADDRESS,
      sender: SENDER,
    });
    expect(() => b.build()).toThrowError(/callData/);
  });
});

describe("packUserOperation", () => {
  it("packs accountGasLimits as verificationGasLimit << 128 | callGasLimit", () => {
    const op = makeReferenceOp();
    const packed = packUserOperation(op);
    // verificationGasLimit = 200_000 = 0x30d40 -> high 16 bytes
    // callGasLimit         = 100_000 = 0x186a0 -> low  16 bytes
    expect(packed.accountGasLimits).toBe(
      "0x00000000000000000000000000030d40000000000000000000000000000186a0",
    );
  });

  it("packs gasFees as maxPriorityFeePerGas << 128 | maxFeePerGas", () => {
    const op = makeReferenceOp();
    const packed = packUserOperation(op);
    // priority = 1_000_000_000 = 0x3b9aca00
    // max      = 2_000_000_000 = 0x77359400
    expect(packed.gasFees).toBe(
      "0x0000000000000000000000003b9aca0000000000000000000000000077359400",
    );
  });

  it("packs paymasterAndData only when a paymaster is set", () => {
    const bare = packUserOperation(makeReferenceOp());
    expect(bare.paymasterAndData).toBe("0x");

    const sponsored = packUserOperation(
      makeReferenceOp({
        paymaster: "0x4444444444444444444444444444444444444444",
        paymasterVerificationGasLimit: 0x1111n,
        paymasterPostOpGasLimit: 0x2222n,
        paymasterData: "0xbeef",
      }),
    );
    // 20 bytes paymaster + 16 bytes verify + 16 bytes postOp + data
    expect(sponsored.paymasterAndData).toBe(
      "0x4444444444444444444444444444444444444444000000000000000000000000000011110000000000000000000000000000" +
        "2222beef",
    );
  });
});

describe("computeUserOpHash", () => {
  it("matches the expected hash for a known packed UserOperation", () => {
    const packed = packUserOperation(makeReferenceOp());
    const hash = computeUserOpHash(packed, ENTRYPOINT_V07_ADDRESS, 1);
    // Vector hand-computed with the canonical abi.encode + keccak256
    // sequence described in the EIP-4337 v0.7 EntryPoint.
    expect(hash).toBe(
      "0x58f6a6c7c74247489bb9258eb378f77850df9b184540c6e8ef6c7aae36ec27b7",
    );
  });

  it("differs when chainId changes", () => {
    const packed = packUserOperation(makeReferenceOp());
    const mainnet = computeUserOpHash(packed, ENTRYPOINT_V07_ADDRESS, 1);
    const polygon = computeUserOpHash(packed, ENTRYPOINT_V07_ADDRESS, 137);
    expect(mainnet).not.toBe(polygon);
  });
});

describe("SimpleAccount encoders", () => {
  it("encodeSimpleAccountFactoryData uses the 0x5fbfb9cf selector and ABI-encodes (owner, salt)", () => {
    const data = encodeSimpleAccountFactoryData(OWNER, 0n);
    expect(data).toBe(
      "0x5fbfb9cf" +
        // address padded to 32 bytes
        "0000000000000000000000002222222222222222222222222222222222222222" +
        // uint256 salt = 0
        "0000000000000000000000000000000000000000000000000000000000000000",
    );
  });

  it("encodeSimpleAccountExecute with zero data produces the expected call payload", () => {
    const data = encodeSimpleAccountExecute(
      RECIPIENT,
      1_000_000_000_000_000_000n, // 1 ETH
      "0x",
    );
    expect(data).toBe(
      "0xb61d27f6" +
        // to (padded)
        "0000000000000000000000003333333333333333333333333333333333333333" +
        // value = 1e18 = 0xde0b6b3a7640000
        "0000000000000000000000000000000000000000000000000de0b6b3a7640000" +
        // offset = 0x60 (96) — start of bytes tail
        "0000000000000000000000000000000000000000000000000000000000000060" +
        // length = 0
        "0000000000000000000000000000000000000000000000000000000000000000",
    );
  });

  it("encodeSimpleAccountExecuteBatch encodes three calls with the 0x47e1da2a selector", () => {
    const batch = encodeSimpleAccountExecuteBatch([
      { to: RECIPIENT, value: 0n, data: "0x" },
      { to: RECIPIENT, value: 5n, data: "0xaa" },
      { to: RECIPIENT, value: 0n, data: "0xbb" },
    ]);
    // Selector + 3 top-level offsets (0x60, 0xc0, 0x120) — and the
    // payload should start with the address[] header word (n = 3).
    expect(batch.startsWith("0x47e1da2a")).toBe(true);
    // Three top-level offsets: 0x60, 0xc0, 0x120 (tail grows because
    // address[] tail is 32+3*32=128 bytes and uint256[] tail is
    // another 128 bytes → bytes[] tail starts at 0x60+128+128=0x160).
    const stripped = batch.slice(2 + 8); // strip 0x + selector
    const offsetTo = stripped.slice(0, 64);
    const offsetValue = stripped.slice(64, 128);
    const offsetData = stripped.slice(128, 192);
    expect(BigInt("0x" + offsetTo)).toBe(0x60n);
    expect(BigInt("0x" + offsetValue)).toBe(0xe0n); // 0x60 + 128 bytes
    expect(BigInt("0x" + offsetData)).toBe(0x160n); // 0xe0 + 128 bytes
  });
});

describe("computeSimpleAccountAddress", () => {
  it("is deterministic for the same inputs", () => {
    const a = computeSimpleAccountAddress(
      SIMPLE_ACCOUNT_FACTORY_ADDRESS,
      OWNER,
      42n,
    );
    const b = computeSimpleAccountAddress(
      SIMPLE_ACCOUNT_FACTORY_ADDRESS,
      OWNER,
      42n,
    );
    expect(a).toBe(b);
    expect(a).toBe("0xbdb23d991aaef028933e96beac602065d5904e66");
  });

  it("differs for different salts", () => {
    const a = computeSimpleAccountAddress(
      SIMPLE_ACCOUNT_FACTORY_ADDRESS,
      OWNER,
      42n,
    );
    const b = computeSimpleAccountAddress(
      SIMPLE_ACCOUNT_FACTORY_ADDRESS,
      OWNER,
      43n,
    );
    expect(a).not.toBe(b);
  });
});

describe("getEntryPointForChain", () => {
  it("returns v0.7 EntryPoint by default", () => {
    const ep = getEntryPointForChain(1);
    expect(ep.version).toBe("0.7");
    expect(ep.address).toBe(ENTRYPOINT_V07_ADDRESS);
    expect(ep.chainId).toBe(1);
  });

  it("returns the deprecated v0.6 EntryPoint when requested", () => {
    const ep = getEntryPointForChain(1, "0.6");
    expect(ep.version).toBe("0.6");
    expect(ep.address).toBe(ENTRYPOINT_V06_ADDRESS);
  });
});

describe("BundlerClient", () => {
  function mockFetch(response: unknown): typeof fetch {
    return vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        json: async () => response,
      }) as unknown as Response,
    ) as unknown as typeof fetch;
  }

  it("serializes bigint fields as 0x-prefixed hex in the RPC payload", async () => {
    const captured: Array<{ body: unknown }> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      captured.push({ body: JSON.parse(init!.body as string) });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          result: "0xabc",
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const client = new BundlerClient({
      url: "https://bundler.test",
      chainId: 1,
      fetchImpl,
    });
    const op = makeReferenceOp();
    const hash = await client.sendUserOperation(op, ENTRYPOINT_V07_ADDRESS);
    expect(hash).toBe("0xabc");

    const body = captured[0].body as { method: string; params: unknown[] };
    expect(body.method).toBe("eth_sendUserOperation");
    const serializedOp = body.params[0] as Record<string, string>;
    // nonce 7 -> "0x7", callGasLimit 100_000 -> "0x186a0", etc.
    expect(serializedOp.nonce).toBe("0x7");
    expect(serializedOp.callGasLimit).toBe("0x186a0");
    expect(serializedOp.verificationGasLimit).toBe("0x30d40");
    expect(serializedOp.maxFeePerGas).toBe("0x77359400");
    expect(serializedOp.maxPriorityFeePerGas).toBe("0x3b9aca00");
    // EntryPoint address is the second param, unaltered.
    expect(body.params[1]).toBe(ENTRYPOINT_V07_ADDRESS);
  });

  it("raises BundlerError carrying the JSON-RPC error code + message", async () => {
    const fetchImpl = mockFetch({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32500,
        message: "rejected by EntryPoint",
        data: { revertReason: "AA21 didn't pay prefund" },
      },
    });
    const client = new BundlerClient({
      url: "https://bundler.test",
      chainId: 1,
      fetchImpl,
    });
    const op = makeReferenceOp();
    await expect(
      client.sendUserOperation(op, ENTRYPOINT_V07_ADDRESS),
    ).rejects.toMatchObject({
      name: "BundlerError",
      code: -32500,
      message: "rejected by EntryPoint",
    });

    const err = await client
      .sendUserOperation(op, ENTRYPOINT_V07_ADDRESS)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BundlerError);
    expect((err as BundlerError).data).toEqual({
      revertReason: "AA21 didn't pay prefund",
    });
  });
});

describe("serializeUserOperation", () => {
  it("omits optional fields that are undefined", () => {
    const out = serializeUserOperation(makeReferenceOp());
    expect(out.factory).toBeUndefined();
    expect(out.paymaster).toBeUndefined();
  });
});
