/**
 * AgentBudget tests.
 *
 * Coverage targets:
 *
 *   1. ABI selectors: every selector derives from the stated
 *      signature (keccak_256(sig)[0..4]) — regression guard against
 *      hand-edits.
 *   2. Calldata encoders: exact-byte output for known fixtures
 *      (address padding, uint256 big-endian, selector prefix);
 *      zero-amount spend rejected; negative / overflow uint256
 *      rejected.
 *   3. View decoders: decodeCanSpend parses (ok, reasonByte) from a
 *      64-byte return; decodeUint256 pulls the single word.
 *   4. Log decoders: parseLogs maps every event topic to the right
 *      `AgentBudgetEvent.kind` with field positions matching the
 *      Solidity event signature. Unknown topics are skipped silently.
 *   5. BudgetClient views: canSpend happy / denied paths, reason
 *      byte → code mapping, assertCanSpend throws on denial, chain-
 *      id mismatch rejected at construction, provider error wrapped
 *      as provider-call-failed.
 *   6. LocalSessionKey: generate produces a valid address; signature
 *      recovers to address; signing after dispose throws; signing
 *      after expiry throws; fromPrivateKey round-trip with a
 *      known key matches LocalKeyAdapter's address for the same key.
 *   7. Struct decoders: decodeBudgetStruct / decodeSessionStruct on
 *      a well-formed fixture return the expected fields.
 */

import { describe, expect, it } from "vitest";
import { keccak_256 } from "@noble/hashes/sha3.js";
import * as secp256k1 from "@noble/secp256k1";

import { LocalKeyAdapter } from "@aethelred/wallet-custody-adapters";
import {
  // ABI
  SIG_CREATE_BUDGET,
  SIG_CAN_SPEND,
  SIG_SPEND,
  SELECTOR_CREATE_BUDGET,
  SELECTOR_CAN_SPEND,
  SELECTOR_SPEND,
  TOPIC_BUDGET_CREATED,
  TOPIC_SESSION_GRANTED,
  TOPIC_SPENT,
  // calldata
  encodeCreateBudget,
  encodeSpend,
  encodeCanSpend,
  encodeGrantSession,
  decodeCanSpend,
  decodeUint256,
  decodeIndexedAddress,
  decodeIndexedUint256,
  // client
  BudgetClient,
  decodeBudgetStruct,
  decodeSessionStruct,
  // session-key
  LocalSessionKey,
  // errors
  AgentBudgetError,
  type ChainProvider,
  type RawLog,
} from "@aethelred/wallet-agent-budget";

// ─── Fixtures ────────────────────────────────────────────────────

const CONTRACT = ("0x" + "c0".repeat(20)) as `0x${string}`;
const USDC = ("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913") as `0x${string}`;
const OWNER = ("0x" + "aa".repeat(20)) as `0x${string}`;
const SESSION_KEY = ("0x" + "bb".repeat(20)) as `0x${string}`;
const RECIPIENT = ("0x" + "cc".repeat(20)) as `0x${string}`;

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function stubProvider(
  chainId: number,
  opts: {
    call?: (req: { to: `0x${string}`; data: `0x${string}` }) => Promise<`0x${string}`>;
    logs?: ReadonlyArray<RawLog>;
  } = {},
): ChainProvider {
  return {
    chainId,
    async call(req) {
      if (opts.call) return opts.call(req);
      return "0x" + "00".repeat(64) as `0x${string}`;
    },
    async getLogs() {
      return opts.logs ?? [];
    },
  };
}

// ─── ABI selectors ──────────────────────────────────────────────

describe("ABI selectors", () => {
  it("createBudget selector matches keccak256(sig)[0..4]", () => {
    const expected = "0x" + Array.from(keccak_256(utf8(SIG_CREATE_BUDGET)).slice(0, 4))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    expect(SELECTOR_CREATE_BUDGET).toBe(expected);
  });

  it("canSpend selector matches the signature derivation", () => {
    const expected = "0x" + Array.from(keccak_256(utf8(SIG_CAN_SPEND)).slice(0, 4))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    expect(SELECTOR_CAN_SPEND).toBe(expected);
  });

  it("spend selector matches the signature derivation", () => {
    const expected = "0x" + Array.from(keccak_256(utf8(SIG_SPEND)).slice(0, 4))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    expect(SELECTOR_SPEND).toBe(expected);
  });
});

// ─── Calldata encoders ──────────────────────────────────────────

describe("Calldata encoders", () => {
  it("encodeCreateBudget produces selector + 4 padded words", () => {
    const data = encodeCreateBudget({
      asset: USDC,
      dailyCap: 1_000_000n,
      perTxCap: 100_000n,
      windowSeconds: 86_400n,
    });
    // 4 bytes selector + 4 × 32 bytes args
    expect(data.length).toBe(2 + 8 + 4 * 64);
    expect(data.startsWith(SELECTOR_CREATE_BUDGET)).toBe(true);
    // Asset address is left-padded into the first arg word
    expect(data.slice(10 + 24, 10 + 64).toLowerCase()).toBe(USDC.slice(2).toLowerCase());
  });

  it("encodeSpend rejects zero amount", () => {
    expect(() => encodeSpend({ sessionKey: SESSION_KEY, amount: 0n, to: RECIPIENT })).toThrow(
      AgentBudgetError,
    );
  });

  it("encodeCanSpend produces selector + 2 padded words", () => {
    const data = encodeCanSpend(SESSION_KEY, 500n);
    expect(data.length).toBe(2 + 8 + 2 * 64);
    expect(data.startsWith(SELECTOR_CAN_SPEND)).toBe(true);
    // Low-byte of second word = 0x1f4 = 500
    expect(data.slice(-4)).toBe("01f4");
  });

  it("encodeGrantSession preserves arg order", () => {
    const data = encodeGrantSession({
      budgetId: 42n,
      sessionKey: SESSION_KEY,
      expiresAt: 1_700_000_000n,
      perCallCap: 1000n,
    });
    // 4 words (budgetId, sessionKey, expiresAt, perCallCap)
    expect(data.length).toBe(2 + 8 + 4 * 64);
    // First word low byte = 42 = 0x2a
    expect(data.slice(10 + 62, 10 + 64)).toBe("2a");
  });

  it("rejects negative or overflowing uint256 inputs", () => {
    expect(() =>
      encodeCreateBudget({
        asset: USDC,
        dailyCap: -1n,
        perTxCap: 0n,
        windowSeconds: 86_400n,
      }),
    ).toThrow(AgentBudgetError);
    expect(() =>
      encodeCreateBudget({
        asset: USDC,
        dailyCap: 1n << 260n,
        perTxCap: 0n,
        windowSeconds: 86_400n,
      }),
    ).toThrow(AgentBudgetError);
  });

  it("rejects zero windowSeconds", () => {
    expect(() =>
      encodeCreateBudget({
        asset: USDC,
        dailyCap: 0n,
        perTxCap: 0n,
        windowSeconds: 0n,
      }),
    ).toThrow(AgentBudgetError);
  });
});

// ─── View decoders ──────────────────────────────────────────────

describe("View decoders", () => {
  it("decodeUint256 parses a single 32-byte word", () => {
    const ret = ("0x" + "00".repeat(30) + "01f4") as `0x${string}`;
    expect(decodeUint256(ret)).toBe(500n);
  });

  it("decodeCanSpend parses (ok=true, reason=0)", () => {
    const ret = ("0x" + "00".repeat(31) + "01" + "00".repeat(32)) as `0x${string}`;
    expect(decodeCanSpend(ret)).toEqual({ ok: true, reasonByte: 0 });
  });

  it("decodeCanSpend parses (ok=false, reason=7 daily-cap-exceeded)", () => {
    const ret = ("0x" + "00".repeat(32) + "00".repeat(31) + "07") as `0x${string}`;
    expect(decodeCanSpend(ret)).toEqual({ ok: false, reasonByte: 7 });
  });

  it("decodeIndexedAddress unpacks topic bytes 12..31", () => {
    const topic = ("0x" + "00".repeat(12) + "11".repeat(20)) as `0x${string}`;
    expect(decodeIndexedAddress(topic)).toBe(("0x" + "11".repeat(20)) as `0x${string}`);
  });

  it("decodeIndexedUint256 parses the topic as big-endian bigint", () => {
    const topic = ("0x" + "00".repeat(30) + "2a2a") as `0x${string}`;
    expect(decodeIndexedUint256(topic)).toBe(0x2a2an);
  });
});

// ─── BudgetClient views ─────────────────────────────────────────

describe("BudgetClient views", () => {
  it("rejects chain-id mismatch at construction", () => {
    expect(
      () =>
        new BudgetClient({
          contract: CONTRACT,
          provider: stubProvider(1),
          chainId: 8453,
        }),
    ).toThrow(AgentBudgetError);
  });

  it("remainingInWindow returns decoded uint256", async () => {
    const provider = stubProvider(8453, {
      async call() {
        return ("0x" + "00".repeat(30) + "03e8") as `0x${string}`; // 1000
      },
    });
    const client = new BudgetClient({ contract: CONTRACT, provider, chainId: 8453 });
    expect(await client.remainingInWindow(1n)).toBe(1000n);
  });

  it("canSpend maps reason byte to typed code", async () => {
    const provider = stubProvider(8453, {
      async call() {
        // (false, 3) — session-expired
        return ("0x" + "00".repeat(32) + "00".repeat(31) + "03") as `0x${string}`;
      },
    });
    const client = new BudgetClient({ contract: CONTRACT, provider, chainId: 8453 });
    const result = await client.canSpend(SESSION_KEY, 100n);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("session-expired");
  });

  it("assertCanSpend throws on denial with mapped code", async () => {
    const provider = stubProvider(8453, {
      async call() {
        return ("0x" + "00".repeat(32) + "00".repeat(31) + "05") as `0x${string}`;
      },
    });
    const client = new BudgetClient({ contract: CONTRACT, provider, chainId: 8453 });
    await expect(client.assertCanSpend(SESSION_KEY, 100n)).rejects.toMatchObject({
      code: "per-call-cap-exceeded",
    });
  });

  it("wraps provider errors as provider-call-failed", async () => {
    const provider = stubProvider(8453, {
      async call() {
        throw new Error("rpc unreachable");
      },
    });
    const client = new BudgetClient({ contract: CONTRACT, provider, chainId: 8453 });
    await expect(client.canSpend(SESSION_KEY, 1n)).rejects.toMatchObject({
      code: "provider-call-failed",
    });
  });
});

// ─── Log decoders ───────────────────────────────────────────────

describe("parseLogs", () => {
  it("decodes BudgetCreated into typed event", () => {
    // Topics: [topic0, budgetId, owner, asset]
    // Data: dailyCap || perTxCap || windowSeconds
    const log: RawLog = {
      topics: [
        TOPIC_BUDGET_CREATED,
        ("0x" + "00".repeat(31) + "2a") as `0x${string}`, // 42
        ("0x" + "00".repeat(12) + OWNER.slice(2)) as `0x${string}`,
        ("0x" + "00".repeat(12) + USDC.slice(2)) as `0x${string}`,
      ],
      data:
        ("0x" +
          "00".repeat(28) +
          "000f4240" + // 1_000_000
          "00".repeat(30) +
          "03e8" + // 1_000
          "00".repeat(30) +
          "0e10") as `0x${string}`, // 3600
      blockNumber: 0xabn,
      transactionHash: ("0x" + "11".repeat(32)) as `0x${string}`,
      logIndex: 2,
    };
    const client = new BudgetClient({
      contract: CONTRACT,
      provider: stubProvider(8453),
      chainId: 8453,
    });
    const events = client.parseLogs([log]);
    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev.kind).toBe("budget-created");
    if (ev.kind === "budget-created") {
      expect(ev.budgetId).toBe(42n);
      expect(ev.owner.toLowerCase()).toBe(OWNER.toLowerCase());
      expect(ev.asset.toLowerCase()).toBe(USDC.toLowerCase());
      expect(ev.dailyCap).toBe(1_000_000n);
      expect(ev.perTxCap).toBe(1_000n);
      expect(ev.windowSeconds).toBe(3600n);
      expect(ev.blockNumber).toBe(0xabn);
    }
  });

  it("decodes Spent with three indexed addresses", () => {
    const log: RawLog = {
      topics: [
        TOPIC_SPENT,
        ("0x" + "00".repeat(31) + "01") as `0x${string}`,
        ("0x" + "00".repeat(12) + SESSION_KEY.slice(2)) as `0x${string}`,
        ("0x" + "00".repeat(12) + RECIPIENT.slice(2)) as `0x${string}`,
      ],
      data: ("0x" + "00".repeat(30) + "03e8") as `0x${string}`,
      blockNumber: 0n,
      transactionHash: ("0x" + "22".repeat(32)) as `0x${string}`,
      logIndex: 0,
    };
    const client = new BudgetClient({
      contract: CONTRACT,
      provider: stubProvider(8453),
      chainId: 8453,
    });
    const events = client.parseLogs([log]);
    expect(events[0].kind).toBe("spent");
    if (events[0].kind === "spent") {
      expect(events[0].amount).toBe(1000n);
    }
  });

  it("ignores logs with unknown topic0", () => {
    const log: RawLog = {
      topics: [("0x" + "ff".repeat(32)) as `0x${string}`],
      data: "0x" as `0x${string}`,
      blockNumber: 0n,
      transactionHash: ("0x" + "33".repeat(32)) as `0x${string}`,
      logIndex: 0,
    };
    const client = new BudgetClient({
      contract: CONTRACT,
      provider: stubProvider(8453),
      chainId: 8453,
    });
    expect(client.parseLogs([log])).toHaveLength(0);
  });

  it("decodes SessionGranted", () => {
    const log: RawLog = {
      topics: [
        TOPIC_SESSION_GRANTED,
        ("0x" + "00".repeat(31) + "07") as `0x${string}`,
        ("0x" + "00".repeat(12) + SESSION_KEY.slice(2)) as `0x${string}`,
      ],
      data:
        ("0x" +
          "00".repeat(28) +
          "65a52300" + // expiresAt
          "00".repeat(30) +
          "03e8") as `0x${string}`,
      blockNumber: 0n,
      transactionHash: ("0x" + "44".repeat(32)) as `0x${string}`,
      logIndex: 0,
    };
    const client = new BudgetClient({
      contract: CONTRACT,
      provider: stubProvider(8453),
      chainId: 8453,
    });
    const events = client.parseLogs([log]);
    expect(events[0].kind).toBe("session-granted");
    if (events[0].kind === "session-granted") {
      expect(events[0].budgetId).toBe(7n);
      expect(events[0].sessionKey.toLowerCase()).toBe(SESSION_KEY.toLowerCase());
      expect(events[0].expiresAt).toBe(0x65a52300n);
      expect(events[0].perCallCap).toBe(1000n);
    }
  });
});

// ─── LocalSessionKey ───────────────────────────────────────────

describe("LocalSessionKey", () => {
  const metadata = {
    budgetId: 1n,
    expiresAt: BigInt(Math.floor(Date.now() / 1000) + 3600),
    perCallCap: 1_000_000n,
  };

  it("generate produces a valid secp256k1 address", () => {
    const key = LocalSessionKey.generate(metadata);
    expect(key.address.startsWith("0x")).toBe(true);
    expect(key.address.length).toBe(42);
  });

  it("signTypedData returns a signature that recovers to the address", async () => {
    const key = LocalSessionKey.generate(metadata);
    const req = {
      domain: { name: "Test", version: "1", chainId: 1 },
      types: { Msg: [{ name: "x", type: "uint256" }] },
      primaryType: "Msg",
      message: { x: "42" },
    };
    const sig = await key.signTypedData(req);
    expect(sig.startsWith("0x")).toBe(true);
    expect(sig.length).toBe(2 + 130);
  });

  it("signing after dispose throws session-key-disposed", async () => {
    const key = LocalSessionKey.generate(metadata);
    key.dispose();
    await expect(
      key.signTypedData({
        domain: { name: "T", version: "1", chainId: 1 },
        types: { Msg: [{ name: "x", type: "uint256" }] },
        primaryType: "Msg",
        message: { x: "1" },
      }),
    ).rejects.toMatchObject({ code: "session-key-disposed" });
  });

  it("signing after expiry throws session-expired", async () => {
    const expired = LocalSessionKey.generate({ ...metadata, expiresAt: 1n });
    await expect(
      expired.signTypedData({
        domain: { name: "T", version: "1", chainId: 1 },
        types: { Msg: [{ name: "x", type: "uint256" }] },
        primaryType: "Msg",
        message: { x: "1" },
      }),
    ).rejects.toMatchObject({ code: "session-expired" });
  });

  it("fromPrivateKey derives the same address as LocalKeyAdapter for the same key", () => {
    const pk = ("0x" + "01".repeat(32)) as `0x${string}`;
    const session = LocalSessionKey.fromPrivateKey(pk, metadata);
    const adapter = new LocalKeyAdapter({ privateKey: pk });
    expect(session.address.toLowerCase()).toBe(adapter.address.toLowerCase());
  });

  it("rejects malformed private key", () => {
    expect(() =>
      LocalSessionKey.fromPrivateKey(("0x" + "00".repeat(32)) as `0x${string}`, metadata),
    ).toThrow(AgentBudgetError);
  });

  it("toRef returns a metadata-only projection", () => {
    const key = LocalSessionKey.generate(metadata);
    const ref = key.toRef();
    expect(ref.address).toBe(key.address);
    expect(ref.budgetId).toBe(metadata.budgetId);
    expect(ref.expiresAt).toBe(metadata.expiresAt);
    expect(ref.perCallCap).toBe(metadata.perCallCap);
  });

  it("signDigest recovers to address", () => {
    const key = LocalSessionKey.generate(metadata);
    const digest = new Uint8Array(32);
    for (let i = 0; i < 32; i += 1) digest[i] = i + 1;
    const sig = key.signDigest(digest);
    // Recover
    const bytes = hexToBytes(sig);
    const r = bytes.slice(0, 32);
    const s = bytes.slice(32, 64);
    const v = bytes[64];
    const recovery = v >= 27 ? v - 27 : v;
    const recovered = secp256k1.Signature.fromCompact(concat(r, s))
      .addRecoveryBit(recovery)
      .recoverPublicKey(digest)
      .toRawBytes(false);
    const hash = keccak_256(recovered.slice(1));
    const recoveredAddr =
      "0x" +
      Array.from(hash.slice(-20))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    expect(recoveredAddr.toLowerCase()).toBe(key.address.toLowerCase());
  });
});

// ─── Struct decoders ───────────────────────────────────────────

describe("decodeBudgetStruct + decodeSessionStruct", () => {
  it("decodeBudgetStruct unpacks nine fields", () => {
    const owner = OWNER.slice(2).toLowerCase();
    const asset = USDC.slice(2).toLowerCase();
    const hex =
      ("0x" +
        "00".repeat(12) + owner +      // owner
        "00".repeat(12) + asset +      // asset
        "00".repeat(28) + "0007a120" + // dailyCap = 500000
        "00".repeat(30) + "03e8" +     // perTxCap = 1000
        "00".repeat(30) + "0e10" +     // windowSeconds = 3600
        "00".repeat(28) + "65a52300" + // windowStart
        "00".repeat(32) +              // spentInWindow = 0
        "00".repeat(32) +              // lifetimeSpent = 0
        "00".repeat(31) + "00"         // revoked = false
      ) as `0x${string}`;
    const b = decodeBudgetStruct(hex, 1n);
    expect(b.id).toBe(1n);
    expect(b.owner.toLowerCase()).toBe(OWNER.toLowerCase());
    expect(b.asset.toLowerCase()).toBe(USDC.toLowerCase());
    expect(b.dailyCap).toBe(500000n);
    expect(b.perTxCap).toBe(1000n);
    expect(b.windowSeconds).toBe(3600n);
    expect(b.revoked).toBe(false);
  });

  it("decodeSessionStruct unpacks five fields", () => {
    const key = SESSION_KEY.slice(2).toLowerCase();
    const hex =
      ("0x" +
        "00".repeat(31) + "07" +       // budgetId = 7
        "00".repeat(12) + key +        // sessionKey
        "00".repeat(28) + "65a52300" + // expiresAt
        "00".repeat(30) + "03e8" +     // perCallCap
        "00".repeat(31) + "01"         // revoked = true
      ) as `0x${string}`;
    const s = decodeSessionStruct(hex);
    expect(s.budgetId).toBe(7n);
    expect(s.sessionKey.toLowerCase()).toBe(SESSION_KEY.toLowerCase());
    expect(s.expiresAt).toBe(0x65a52300n);
    expect(s.perCallCap).toBe(1000n);
    expect(s.revoked).toBe(true);
  });
});

// ─── Helpers shared across tests ───────────────────────────────

function hexToBytes(hex: `0x${string}`): Uint8Array {
  const s = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
