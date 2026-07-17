/**
 * @aethelred/wallet-chain-cosmos — native (Cosmos SDK) tx path tests.
 *
 * Covers the full Phase-B surface: protobuf writer golden vectors,
 * `aethel1…` ⇄ `0x…` address bridging, SIGN_MODE_DIRECT building/signing
 * (keccak digest, 64-byte r‖s), message encoders, and the LCD client with
 * a hermetic fetch stub.
 *
 * The chain-side counterpart lives in the aethelred repo: a Go test decodes
 * the exact `TxRaw` produced by `signDirect` here (same fixed key + fields,
 * see the "golden transaction" block) with the node's own codec and
 * verifies the signature via `ethsecp256k1.PubKey.VerifySignature` —
 * ante-handler parity for a wallet-built native transaction.
 */

import { bech32 as scureBech32 } from "@scure/base";
import { describe, expect, it, vi } from "vitest";

import {
  AETHELRED_HRP,
  AETHELRED_NATIVE,
  CosmosAddressError,
  CosmosLcdClient,
  CosmosLcdError,
  CosmosTxError,
  ETHSECP256K1_PUBKEY_TYPE_URL,
  ProtoEncodeError,
  ProtoWriter,
  SECP256K1_PUBKEY_TYPE_URL,
  VoteOption,
  addressBytesFromPubkey,
  bech32ToEthHex,
  compressedPubkey,
  cryptoBootstrapped,
  encodeAny,
  encodeAuthInfo,
  encodeCoin,
  encodeFee,
  encodePubkeyAny,
  encodeSignDoc,
  encodeTxBody,
  encodeTxRaw,
  ethHexToBech32,
  fromBech32,
  fromHexAddress,
  msgBeginRedelegate,
  msgDelegate,
  msgIbcTransfer,
  msgSend,
  msgUndelegate,
  msgVote,
  msgWithdrawDelegatorReward,
  nobleDigestSigner,
  signDirect,
  signDocDigest,
  toBase64,
  toBech32,
  toEip55Hex,
  txHash,
} from "@aethelred/wallet-chain-cosmos";

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

const fromHex = (s: string): Uint8Array => {
  const clean = s.startsWith("0x") ? s.slice(2) : s;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
};

/** Deterministic test key (NOT a real account key). */
const TEST_PRIVKEY = fromHex(
  "2e0834786285daccd064ca17f1654f67b4aef298acbb82cef9ec422fb4975622",
);

describe("chain-cosmos: proto writer", () => {
  it("encodes a string field (hand-computed golden vector)", () => {
    // field 1, wire 2, len 3, "abc" → 0a 03 61 62 63
    expect(hex(new ProtoWriter().string(1, "abc").finish())).toBe(
      "0a03616263",
    );
  });

  it("encodes a varint field (hand-computed golden vector)", () => {
    // field 2, wire 0, 300 → 10 ac 02
    expect(hex(new ProtoWriter().uint64(2, 300).finish())).toBe("10ac02");
  });

  it("encodes bigint varints across the 64-bit range", () => {
    // field 1, max uint64 → 08 ff ff ff ff ff ff ff ff ff 01
    expect(
      hex(new ProtoWriter().uint64(1, (1n << 64n) - 1n).finish()),
    ).toBe("08ffffffffffffffffff01");
  });

  it("omits proto3 default values for scalars", () => {
    const bytes = new ProtoWriter()
      .uint64(1, 0)
      .string(2, "")
      .bytes(3, new Uint8Array(0))
      .finish();
    expect(bytes.length).toBe(0);
  });

  it("always emits embedded messages, even empty (gogo non-nil pointer)", () => {
    // tag(field 2, wire 2)=0x12, len 0
    expect(hex(new ProtoWriter().embedded(2, new Uint8Array(0)).finish())).toBe(
      "1200",
    );
  });

  it("rejects varints outside uint64", () => {
    expect(() => new ProtoWriter().uint64(1, -1n).finish()).toThrow(
      ProtoEncodeError,
    );
    expect(() => new ProtoWriter().uint64(1, 1n << 64n).finish()).toThrow(
      ProtoEncodeError,
    );
  });

  it("rejects invalid field numbers", () => {
    expect(() => new ProtoWriter().uint64(0, 1).finish()).toThrow(
      ProtoEncodeError,
    );
    expect(() => new ProtoWriter().uint64(1.5, 1).finish()).toThrow(
      ProtoEncodeError,
    );
  });

  it("encodes Coin exactly as gogoproto does", () => {
    // denom=1 "uaethel", amount=2 "1000"
    expect(hex(encodeCoin({ denom: "uaethel", amount: "1000" }))).toBe(
      "0a077561657468656c120431303030",
    );
  });
});

describe("chain-cosmos: addresses (aethel1… ⇄ 0x…)", () => {
  const pubkey = compressedPubkey(TEST_PRIVKEY);

  it("bootstraps noble sync signing", () => {
    expect(cryptoBootstrapped).toBe(true);
  });

  it("derives the SAME 20 bytes for the native and EVM faces (eth_secp256k1)", () => {
    const addrBytes = addressBytesFromPubkey(pubkey, "eth_secp256k1");
    expect(addrBytes.length).toBe(20);
    const native = toBech32(AETHELRED_HRP, addrBytes);
    const evm = toEip55Hex(addrBytes);
    expect(native.startsWith("aethel1")).toBe(true);
    // Round-trip both ways.
    expect(bech32ToEthHex(native, AETHELRED_HRP)).toBe(evm);
    expect(ethHexToBech32(evm)).toBe(native);
  });

  it("derives vanilla-cosmos addresses differently (ripemd160∘sha256)", () => {
    const ethStyle = addressBytesFromPubkey(pubkey, "eth_secp256k1");
    const cosmosStyle = addressBytesFromPubkey(pubkey, "secp256k1");
    expect(cosmosStyle.length).toBe(20);
    expect(hex(cosmosStyle)).not.toBe(hex(ethStyle));
  });

  it("EIP-55 checksums the EVM view (known vector)", () => {
    // Canonical EIP-55 test vector.
    const bytes = fromHexAddress("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed");
    expect(toEip55Hex(bytes)).toBe(
      "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    );
  });

  it("round-trips bech32 decode", () => {
    const addrBytes = addressBytesFromPubkey(pubkey, "eth_secp256k1");
    const native = toBech32(AETHELRED_HRP, addrBytes);
    const decoded = fromBech32(native);
    expect(decoded.hrp).toBe("aethel");
    expect(hex(decoded.bytes)).toBe(hex(addrBytes));
  });

  it("rejects malformed inputs", () => {
    expect(() => addressBytesFromPubkey(new Uint8Array(32), "eth_secp256k1"))
      .toThrow(CosmosAddressError);
    expect(() => toBech32(AETHELRED_HRP, new Uint8Array(19))).toThrow(
      CosmosAddressError,
    );
    expect(() => fromBech32("not-a-bech32-address")).toThrow(
      CosmosAddressError,
    );
    expect(() => fromHexAddress("0x1234")).toThrow(CosmosAddressError);
  });

  it("rejects a 32-byte bech32 payload (non-account address)", () => {
    // toBech32 itself guards to 20 bytes, so hand-build a valid bech32
    // string with a consensus-key-sized (32-byte) payload: fromBech32 must
    // reject it rather than truncate.
    const addr = scureBech32.encode(
      "aethel",
      scureBech32.toWords(new Uint8Array(32)),
    );
    expect(() => fromBech32(addr)).toThrow(CosmosAddressError);
  });

  it("rejects an HRP mismatch when one is required", () => {
    const cosmosHubStyle = toBech32("cosmos", new Uint8Array(20));
    expect(() => bech32ToEthHex(cosmosHubStyle, "aethel")).toThrow(
      CosmosAddressError,
    );
  });
});

describe("chain-cosmos: message encoders", () => {
  const delegator = "aethel1qqqsyqcyq5rqwzqfpg9scrgwpugpzysn23nrn0k";
  const validator = "aethelvaloper1qqqsyqcyq5rqwzqfpg9scrgwpugpzysnfl5c3v";

  it("encodes MsgSend with repeated coins", () => {
    const msg = msgSend({
      fromAddress: delegator,
      toAddress: delegator,
      amount: [
        { denom: "uaethel", amount: "1" },
        { denom: "uaethel", amount: "2" },
      ],
    });
    expect(msg.typeUrl).toBe("/cosmos.bank.v1beta1.MsgSend");
    // Two embedded field-3 coins present.
    expect(hex(msg.value)).toContain("0a077561657468656c"); // denom uaethel
  });

  it("encodes staking messages", () => {
    const amount = { denom: "uaethel", amount: "5000000" };
    expect(
      msgDelegate({ delegatorAddress: delegator, validatorAddress: validator, amount })
        .typeUrl,
    ).toBe("/cosmos.staking.v1beta1.MsgDelegate");
    expect(
      msgUndelegate({ delegatorAddress: delegator, validatorAddress: validator, amount })
        .typeUrl,
    ).toBe("/cosmos.staking.v1beta1.MsgUndelegate");
    expect(
      msgBeginRedelegate({
        delegatorAddress: delegator,
        validatorSrcAddress: validator,
        validatorDstAddress: validator,
        amount,
      }).typeUrl,
    ).toBe("/cosmos.staking.v1beta1.MsgBeginRedelegate");
  });

  it("encodes reward withdrawal and votes", () => {
    expect(
      msgWithdrawDelegatorReward({
        delegatorAddress: delegator,
        validatorAddress: validator,
      }).typeUrl,
    ).toBe("/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward");
    const vote = msgVote({
      proposalId: 7n,
      voter: delegator,
      option: VoteOption.Yes,
      metadata: "m",
    });
    expect(vote.typeUrl).toBe("/cosmos.gov.v1.MsgVote");
    // proposal_id is field 1, so the message MUST start 08 07 (varint 7).
    expect(hex(vote.value).startsWith("0807")).toBe(true);
    // metadata "m" appends exactly field-4 tag 0x22, len 1, 0x6d — and an
    // omitted metadata appends nothing (proto3 default).
    const bare = msgVote({ proposalId: 7n, voter: delegator, option: VoteOption.Yes });
    expect(hex(vote.value)).toBe(`${hex(bare.value)}22016d`);
  });
});

describe("chain-cosmos: IBC transfer (ICS-20)", () => {
  const sender = "aethel1qqqsyqcyq5rqwzqfpg9scrgwpugpzysn23nrn0k";
  const receiver = "cosmos1qqqsyqcyq5rqwzqfpg9scrgwpugpzysnnrhtdl";

  it("encodes MsgTransfer with defaults (port, zero height always present)", () => {
    const msg = msgIbcTransfer({
      sourceChannel: "channel-0",
      token: { denom: "uaethel", amount: "42" },
      sender,
      receiver,
    });
    expect(msg.typeUrl).toBe("/ibc.applications.transfer.v1.MsgTransfer");
    const h = hex(msg.value);
    // field 1 default port "transfer": 0a 08 7472616e73666572
    expect(h.startsWith("0a087472616e73666572")).toBe(true);
    // field 6 (timeout_height) is non-nullable: emitted even when zero → 3200
    expect(h).toContain("3200");
    // no timestamp (field 7, tag 0x38) and no memo (field 8, tag 0x42) at tail
    expect(h.endsWith("3200")).toBe(true);
  });

  it("encodes explicit timeout height, timestamp, memo, and custom port", () => {
    const msg = msgIbcTransfer({
      sourcePort: "customport",
      sourceChannel: "channel-7",
      token: { denom: "uaethel", amount: "1" },
      sender,
      receiver,
      timeoutHeight: { revisionNumber: 1n, revisionHeight: 500n },
      timeoutTimestamp: 1_700_000_000_000_000_000n,
      memo: "hi",
    });
    const h = hex(msg.value);
    // Height { 1: 1, 2: 500 } → 08 01 10 f4 03, embedded as field 6 len 5.
    expect(h).toContain("3205080110f403");
    // memo "hi" → field 8: 42 02 6869 at the tail.
    expect(h.endsWith("42026869")).toBe(true);
  });
});

describe("chain-cosmos: SIGN_MODE_DIRECT tx building", () => {
  const pubkey = compressedPubkey(TEST_PRIVKEY);
  const addr = toBech32(
    AETHELRED_HRP,
    addressBytesFromPubkey(pubkey, "eth_secp256k1"),
  );

  const goldenParams = () => ({
    messages: [
      msgSend({
        fromAddress: addr,
        toAddress: addr,
        amount: [{ denom: "uaethel", amount: "1000000" }],
      }),
    ],
    memo: "aethelred-native-e2e",
    fee: {
      amount: [{ denom: "uaethel", amount: "5000" }],
      gasLimit: 200000n,
    },
    chainId: AETHELRED_NATIVE.chainId,
    accountNumber: 7n,
    sequence: 3n,
    pubkey,
    algo: "eth_secp256k1" as const,
    signer: nobleDigestSigner(TEST_PRIVKEY),
  });

  it("builds a stable golden transaction (chain-repo Go proof decodes this)", async () => {
    const signed = await signDirect(goldenParams());
    // Deterministic: fixed key + RFC-6979 low-S signing.
    // The same hex is embedded in the aethelred repo's Go compat test,
    // which decodes it with the node's own codec and verifies the
    // signature via ethsecp256k1.PubKey.VerifySignature (ante parity).
    expect(signed.txRaw.length).toBeGreaterThan(0);
    expect(signed.signature.length).toBe(64);
    expect(signed.txHash).toMatch(/^[0-9A-F]{64}$/);
    // Print-once vector for the Go side (kept as a runtime log so the
    // fixture can be regenerated by running this test with --reporter).
    // eslint-disable-next-line no-console
    console.log(`GOLDEN_TXRAW_HEX=${hex(signed.txRaw)}`);
    // eslint-disable-next-line no-console
    console.log(`GOLDEN_PUBKEY_HEX=${hex(pubkey)}`);
    // eslint-disable-next-line no-console
    console.log(`GOLDEN_ADDR=${addr}`);
  });

  it("signature verifies against keccak256(SignDoc) — the chain's check", async () => {
    const secp = await import("@noble/secp256k1");
    const { keccak_256 } = await import("@noble/hashes/sha3.js");
    const signed = await signDirect(goldenParams());
    const ok = secp.verify(
      signed.signature,
      keccak_256(signed.signDocBytes),
      pubkey,
    );
    expect(ok).toBe(true);
  });

  it("keccak digest for eth_secp256k1, sha256 for vanilla cosmos", () => {
    const doc = new TextEncoder().encode("x");
    expect(hex(signDocDigest(doc, "eth_secp256k1"))).not.toBe(
      hex(signDocDigest(doc, "secp256k1")),
    );
  });

  it("accepts a 65-byte custody signature and trims the recovery byte", async () => {
    const base = nobleDigestSigner(TEST_PRIVKEY);
    const custodyShaped = async (digest: Uint8Array) => {
      const sig64 = await base(digest);
      const sig65 = new Uint8Array(65);
      sig65.set(sig64);
      sig65[64] = 1; // recovery id, as wallet-core custody returns
      return sig65;
    };
    const [a, b] = await Promise.all([
      signDirect({ ...goldenParams(), signer: custodyShaped }),
      signDirect(goldenParams()),
    ]);
    expect(hex(a.txRaw)).toBe(hex(b.txRaw));
  });

  it("rejects signer outputs of the wrong length", async () => {
    await expect(
      signDirect({ ...goldenParams(), signer: () => new Uint8Array(63) }),
    ).rejects.toThrow(CosmosTxError);
  });

  it("rejects an empty message list", () => {
    expect(() => encodeTxBody({ messages: [] })).toThrow(CosmosTxError);
  });

  it("rejects malformed pubkeys and supports both pubkey type URLs", () => {
    expect(() => encodePubkeyAny(new Uint8Array(32), "eth_secp256k1")).toThrow(
      CosmosTxError,
    );
    expect(encodePubkeyAny(pubkey, "eth_secp256k1").typeUrl).toBe(
      ETHSECP256K1_PUBKEY_TYPE_URL,
    );
    expect(encodePubkeyAny(pubkey, "secp256k1").typeUrl).toBe(
      SECP256K1_PUBKEY_TYPE_URL,
    );
  });

  it("omits memo and timeoutHeight when not provided (proto3 defaults)", () => {
    const msg = msgSend({ fromAddress: addr, toAddress: addr, amount: [] });
    const bare = encodeTxBody({ messages: [msg] });
    // A message-only body is exactly one embedded field-1 Any: tag 0x0a,
    // varint length, payload — nothing else follows.
    const anyBytes = encodeAny(msg);
    expect(hex(bare).startsWith("0a")).toBe(true);
    expect(hex(bare).endsWith(hex(anyBytes))).toBe(true);
  });

  it("encodes optional body/fee fields when present", () => {
    const body = encodeTxBody({
      messages: [msgSend({ fromAddress: addr, toAddress: addr, amount: [] })],
      memo: "m",
      timeoutHeight: 99n,
    });
    expect(hex(body)).toContain("1863"); // field 3 varint 99
    const fee = encodeFee({
      amount: [],
      gasLimit: 1n,
      payer: addr,
      granter: addr,
    });
    // gas_limit is field 2: with no coins, the message starts 10 01.
    expect(hex(fee).startsWith("1001")).toBe(true);
    const auth = encodeAuthInfo({
      pubkey: encodePubkeyAny(pubkey, "eth_secp256k1"),
      sequence: 0n, // first tx: sequence omitted as proto3 default
      fee: { amount: [], gasLimit: 0n },
    });
    expect(auth.length).toBeGreaterThan(0);
  });

  it("computes the cosmos tx hash (uppercase sha256)", () => {
    const raw = encodeTxRaw({
      bodyBytes: new Uint8Array([1]),
      authInfoBytes: new Uint8Array([2]),
      signature: new Uint8Array(64),
    });
    expect(txHash(raw)).toMatch(/^[0-9A-F]{64}$/);
  });

  it("encodeSignDoc omits accountNumber 0 (gogo default) and encodeAny round-trips", () => {
    const withZero = encodeSignDoc({
      bodyBytes: new Uint8Array([1]),
      authInfoBytes: new Uint8Array([2]),
      chainId: "c",
      accountNumber: 0n,
    });
    const withOne = encodeSignDoc({
      bodyBytes: new Uint8Array([1]),
      authInfoBytes: new Uint8Array([2]),
      chainId: "c",
      accountNumber: 1n,
    });
    expect(withOne.length).toBe(withZero.length + 2);
    expect(hex(encodeAny({ typeUrl: "/t", value: new Uint8Array([9]) }))).toBe(
      "0a022f7412 0109".replace(/ /g, ""),
    );
  });
});

describe("chain-cosmos: LCD client", () => {
  type FetchStub = (
    url: string,
    init?: { method?: string; body?: string },
  ) => { ok: boolean; status: number; json: () => Promise<unknown> };

  const mkFetch =
    (handler: FetchStub): typeof fetch =>
    (async (url: unknown, init?: unknown) =>
      handler(String(url), init as { method?: string; body?: string })) as unknown as typeof fetch;

  const jsonRes = (body: unknown, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });

  it("normalizes a trailing slash in baseUrl", async () => {
    const seen: string[] = [];
    const client = new CosmosLcdClient({
      baseUrl: "http://lcd.local/",
      fetchFn: mkFetch((url) => {
        seen.push(url);
        return jsonRes({ balances: [] });
      }),
    });
    await client.getBalances("aethel1x");
    expect(seen[0]).toBe(
      "http://lcd.local/cosmos/bank/v1beta1/balances/aethel1x",
    );
  });

  it("parses a plain BaseAccount", async () => {
    const client = new CosmosLcdClient({
      baseUrl: "http://lcd.local",
      fetchFn: mkFetch(() =>
        jsonRes({
          account: {
            "@type": "/cosmos.auth.v1beta1.BaseAccount",
            address: "aethel1x",
            account_number: "5",
            sequence: "12",
          },
        }),
      ),
    });
    expect(await client.getAccount("aethel1x")).toEqual({
      accountNumber: 5n,
      sequence: 12n,
    });
  });

  it("parses a nested EthAccount.base_account", async () => {
    const client = new CosmosLcdClient({
      baseUrl: "http://lcd.local",
      fetchFn: mkFetch(() =>
        jsonRes({
          account: {
            "@type": "/cosmos.evm.types.v1.EthAccount",
            base_account: { account_number: "9", sequence: "1" },
            code_hash: "0x",
          },
        }),
      ),
    });
    expect(await client.getAccount("aethel1x")).toEqual({
      accountNumber: 9n,
      sequence: 1n,
    });
  });

  it("rejects missing/malformed accounts and HTTP failures", async () => {
    const noAccount = new CosmosLcdClient({
      baseUrl: "http://lcd.local",
      fetchFn: mkFetch(() => jsonRes({})),
    });
    await expect(noAccount.getAccount("aethel1x")).rejects.toThrow(
      CosmosLcdError,
    );
    const malformed = new CosmosLcdClient({
      baseUrl: "http://lcd.local",
      fetchFn: mkFetch(() => jsonRes({ account: { sequence: 3 } })),
    });
    await expect(malformed.getAccount("aethel1x")).rejects.toThrow(
      /malformed account/,
    );
    const down = new CosmosLcdClient({
      baseUrl: "http://lcd.local",
      fetchFn: mkFetch(() => jsonRes({}, 500)),
    });
    await expect(down.getAccount("aethel1x")).rejects.toThrow(/HTTP 500/);
  });

  it("reads balances and defaults a missing denom to 0", async () => {
    const client = new CosmosLcdClient({
      baseUrl: "http://lcd.local",
      fetchFn: mkFetch(() =>
        jsonRes({ balances: [{ denom: "uaethel", amount: "42" }] }),
      ),
    });
    expect(await client.getBalance("aethel1x", "uaethel")).toEqual({
      denom: "uaethel",
      amount: "42",
    });
    expect(await client.getBalance("aethel1x", "uother")).toEqual({
      denom: "uother",
      amount: "0",
    });
  });

  it("handles a balances response without the balances key", async () => {
    const client = new CosmosLcdClient({
      baseUrl: "http://lcd.local",
      fetchFn: mkFetch(() => jsonRes({})),
    });
    expect(await client.getBalances("aethel1x")).toEqual([]);
  });

  it("broadcasts in SYNC mode with base64 tx bytes", async () => {
    let captured: { method?: string; body?: string } | undefined;
    const client = new CosmosLcdClient({
      baseUrl: "http://lcd.local",
      fetchFn: mkFetch((url, init) => {
        captured = init;
        expect(url).toBe("http://lcd.local/cosmos/tx/v1beta1/txs");
        return jsonRes({
          tx_response: { txhash: "AB", code: 0, raw_log: "" },
        });
      }),
    });
    const result = await client.broadcastTx(new Uint8Array([1, 2, 3]));
    expect(result).toEqual({ txHash: "AB", code: 0, rawLog: "" });
    const body = JSON.parse(captured?.body ?? "{}");
    expect(body.mode).toBe("BROADCAST_MODE_SYNC");
    expect(body.tx_bytes).toBe(toBase64(new Uint8Array([1, 2, 3])));
  });

  it("broadcast propagates HTTP + malformed-response failures and defaults", async () => {
    const down = new CosmosLcdClient({
      baseUrl: "http://lcd.local",
      fetchFn: mkFetch(() => jsonRes({}, 502)),
    });
    await expect(down.broadcastTx(new Uint8Array(1))).rejects.toThrow(
      /HTTP 502/,
    );
    const malformed = new CosmosLcdClient({
      baseUrl: "http://lcd.local",
      fetchFn: mkFetch(() => jsonRes({})),
    });
    await expect(malformed.broadcastTx(new Uint8Array(1))).rejects.toThrow(
      /no tx_response/,
    );
    const defaulted = new CosmosLcdClient({
      baseUrl: "http://lcd.local",
      fetchFn: mkFetch(() => jsonRes({ tx_response: { txhash: "CD" } })),
    });
    expect(await defaulted.broadcastTx(new Uint8Array(1))).toEqual({
      txHash: "CD",
      code: 0,
      rawLog: "",
    });
  });

  it("waitForTx polls 404s until the tx lands, then returns the result", async () => {
    let calls = 0;
    const client = new CosmosLcdClient({
      baseUrl: "http://lcd.local",
      sleepFn: async () => {},
      fetchFn: mkFetch(() => {
        calls += 1;
        if (calls < 3) return jsonRes({ code: 5 }, 404);
        return jsonRes({
          tx_response: { height: "11", code: 0, raw_log: "ok" },
        });
      }),
    });
    const result = await client.waitForTx("AB", { timeoutMs: 1000, pollMs: 1 });
    expect(result).toEqual({ height: 11n, code: 0, rawLog: "ok" });
    expect(calls).toBe(3);
  });

  it("waitForTx times out, surfaces hard HTTP errors, and skips pending bodies", async () => {
    const pending = new CosmosLcdClient({
      baseUrl: "http://lcd.local",
      sleepFn: async () => {},
      // 200 but no tx_response.height yet (some LCDs return an empty shell).
      fetchFn: mkFetch(() => jsonRes({ tx_response: {} })),
    });
    await expect(
      pending.waitForTx("AB", { timeoutMs: 1, pollMs: 1 }),
    ).rejects.toThrow(/not confirmed/);
    const broken = new CosmosLcdClient({
      baseUrl: "http://lcd.local",
      sleepFn: async () => {},
      fetchFn: mkFetch(() => jsonRes({}, 500)),
    });
    await expect(
      broken.waitForTx("AB", { timeoutMs: 1000, pollMs: 1 }),
    ).rejects.toThrow(/HTTP 500/);
    // Default code/rawLog fill-ins on a found tx.
    const sparse = new CosmosLcdClient({
      baseUrl: "http://lcd.local",
      sleepFn: async () => {},
      fetchFn: mkFetch(() => jsonRes({ tx_response: { height: "2" } })),
    });
    expect(await sparse.waitForTx("AB")).toEqual({
      height: 2n,
      code: 0,
      rawLog: "",
    });
  });

  it("uses the global fetch and a real timer sleep by default", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      (async () => {
        calls += 1;
        if (calls === 1) return jsonRes({ code: 5 }, 404);
        return jsonRes({ tx_response: { height: "4", code: 0, raw_log: "" } });
      }) as unknown as typeof fetch,
    );
    try {
      // No fetchFn, no sleepFn: both defaults must be exercised (the 404
      // forces one real 1ms sleep between polls).
      const client = new CosmosLcdClient({ baseUrl: "http://lcd.local" });
      const result = await client.waitForTx("AB", {
        timeoutMs: 5_000,
        pollMs: 1,
      });
      expect(result.height).toBe(4n);
      expect(calls).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("base64-encodes all padding cases", () => {
    expect(toBase64(new Uint8Array([]))).toBe("");
    expect(toBase64(new Uint8Array([102]))).toBe("Zg==");
    expect(toBase64(new Uint8Array([102, 111]))).toBe("Zm8=");
    expect(toBase64(new Uint8Array([102, 111, 111]))).toBe("Zm9v");
  });
});

describe("chain-cosmos: crypto bootstrap", () => {
  it("wires sync AND async HMAC, and both agree", async () => {
    const secp = await import("@noble/secp256k1");
    const { hmac } = await import("@noble/hashes/hmac.js");
    const { sha256 } = await import("@noble/hashes/sha2.js");
    const key = new Uint8Array(32).fill(7);
    const msg = new Uint8Array([1, 2, 3]);
    expect(secp.etc.hmacSha256Sync).toBeTypeOf("function");
    const sync = secp.etc.hmacSha256Sync!(key, msg);
    const asyncResult = await secp.etc.hmacSha256Async(key, msg);
    expect(hex(sync)).toBe(hex(hmac(sha256, key, msg)));
    expect(hex(asyncResult)).toBe(hex(sync));
  });

  it("is idempotent: a second evaluation leaves the wiring untouched", async () => {
    const secp = await import("@noble/secp256k1");
    const before = secp.etc.hmacSha256Sync;
    // Force the bootstrap module to evaluate again with hooks already set,
    // covering its already-wired (no-op) path.
    vi.resetModules();
    const again = await import(
      "../../../../packages/chain-cosmos/src/crypto-bootstrap"
    );
    expect(again.cryptoBootstrapped).toBe(true);
    expect(secp.etc.hmacSha256Sync).toBe(before);
  });
});

describe("chain-cosmos: network registry", () => {
  it("Aethelred native params bind the sovereign identity", () => {
    expect(AETHELRED_NATIVE.hrp).toBe("aethel");
    expect(AETHELRED_NATIVE.valoperHrp).toBe("aethelvaloper");
    expect(AETHELRED_NATIVE.denom).toBe("uaethel");
    expect(AETHELRED_NATIVE.decimals).toBe(6);
    expect(AETHELRED_NATIVE.coinType).toBe(60);
    expect(AETHELRED_NATIVE.signatureAlgo).toBe("eth_secp256k1");
    expect(AETHELRED_NATIVE.evmChainId).toBe(7332);
  });
});
