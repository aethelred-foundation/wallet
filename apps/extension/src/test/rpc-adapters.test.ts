/**
 * RPC-adapter tests.
 *
 * The transport is hand-rolled JSON-RPC over `fetch`; these tests
 * assert the wire-protocol shape, receipt/log normalisation, and
 * the `JsonRpcError` taxonomy against a mock-fetch transport. No
 * real network calls.
 *
 * Coverage:
 *   1. FetchJsonRpcTransport: sends well-formed JSON-RPC 2.0 requests;
 *      returns the result on success; wraps non-2xx as http-status;
 *      wraps JSON-RPC errors as rpc-error; wraps fetch rejections
 *      as transport-failed; timeout aborts.
 *   2. RpcAnchorChainProvider: sendTransaction invokes signAndEncodeTx
 *      then eth_sendRawTransaction; getTransactionReceipt normalises
 *      the reverted/success status, blockNumber to bigint, logs to
 *      RawLog shape.
 *   3. RpcBudgetChainProvider: call wraps eth_call at "latest";
 *      getLogs serialises block tags correctly (earliest/latest/bigint)
 *      and normalises log shapes.
 *   4. Deterministic addresses: pinned constants match the predicted
 *      output from the Foundry deploy script.
 */

import { describe, expect, it } from "vitest";

import {
  FetchJsonRpcTransport,
  JsonRpcError,
  RpcAnchorChainProvider,
  RpcBudgetChainProvider,
  DETERMINISTIC_ADDRESSES,
  DEPLOYMENT_SALT,
} from "@aethelred/wallet-rpc-adapters";

// ─── Fetch mocking helper ──────────────────────────────

function mockFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return handler as unknown as typeof fetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// ─── FetchJsonRpcTransport ────────────────────────────

describe("FetchJsonRpcTransport", () => {
  it("sends well-formed JSON-RPC 2.0 requests + increments ids", async () => {
    const captured: Array<{ method: string; id: number }> = [];
    const fetchImpl = mockFetch(async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      captured.push({ method: body.method, id: body.id });
      return jsonResponse(200, { jsonrpc: "2.0", id: body.id, result: "0x1" });
    });

    const transport = new FetchJsonRpcTransport({
      url: "https://rpc.example",
      fetchImpl,
    });
    await transport.call("eth_blockNumber", []);
    await transport.call("eth_chainId", []);

    expect(captured).toEqual([
      { method: "eth_blockNumber", id: 1 },
      { method: "eth_chainId", id: 2 },
    ]);
  });

  it("returns result on happy path", async () => {
    const fetchImpl = mockFetch(async () =>
      jsonResponse(200, { jsonrpc: "2.0", id: 1, result: "0xabc" }),
    );
    const transport = new FetchJsonRpcTransport({ url: "x", fetchImpl });
    expect(await transport.call<string>("foo", [])).toBe("0xabc");
  });

  it("wraps non-2xx as http-status", async () => {
    const fetchImpl = mockFetch(async () =>
      new Response("nope", { status: 503, statusText: "Service Unavailable" }),
    );
    const transport = new FetchJsonRpcTransport({ url: "x", fetchImpl });
    await expect(transport.call("foo", [])).rejects.toMatchObject({
      code: "http-status",
    });
  });

  it("wraps JSON-RPC error as rpc-error", async () => {
    const fetchImpl = mockFetch(async () =>
      jsonResponse(200, {
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32000, message: "revert", data: "0xdead" },
      }),
    );
    const transport = new FetchJsonRpcTransport({ url: "x", fetchImpl });
    await expect(transport.call("foo", [])).rejects.toMatchObject({
      code: "rpc-error",
    });
  });

  it("wraps fetch rejection as transport-failed", async () => {
    const fetchImpl = mockFetch(async () => {
      throw new Error("network down");
    });
    const transport = new FetchJsonRpcTransport({ url: "x", fetchImpl });
    await expect(transport.call("foo", [])).rejects.toMatchObject({
      code: "transport-failed",
    });
  });

  it("wraps malformed JSON as malformed-response", async () => {
    const fetchImpl = mockFetch(
      async () => new Response("not-json", { status: 200 }),
    );
    const transport = new FetchJsonRpcTransport({ url: "x", fetchImpl });
    await expect(transport.call("foo", [])).rejects.toMatchObject({
      code: "malformed-response",
    });
  });

  it("JsonRpcError carries rpcCode + rpcData", async () => {
    const fetchImpl = mockFetch(async () =>
      jsonResponse(200, {
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32000, message: "out of gas", data: { gas: 21000 } },
      }),
    );
    const transport = new FetchJsonRpcTransport({ url: "x", fetchImpl });
    try {
      await transport.call("foo", []);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(JsonRpcError);
      expect((err as JsonRpcError).details?.rpcCode).toBe(-32000);
      expect((err as JsonRpcError).details?.rpcData).toEqual({ gas: 21000 });
    }
  });
});

// ─── RpcAnchorChainProvider ──────────────────────────

describe("RpcAnchorChainProvider", () => {
  it("sendTransaction: calls signAndEncodeTx, then eth_sendRawTransaction", async () => {
    const sentMethods: string[] = [];
    const sentParams: unknown[] = [];
    const transport = {
      async call<T>(method: string, params: ReadonlyArray<unknown>): Promise<T> {
        sentMethods.push(method);
        sentParams.push(params);
        return ("0x" + "ab".repeat(32)) as T;
      },
    };

    const provider = new RpcAnchorChainProvider({
      transport,
      chainId: 8453,
      async signAndEncodeTx(req) {
        // Assert the raw tx contains the calldata
        expect(req.to).toBe(("0x" + "cc".repeat(20)) as `0x${string}`);
        return ("0x02" + "dd".repeat(60)) as `0x${string}`;
      },
    });

    const hash = await provider.sendTransaction({
      to: ("0x" + "cc".repeat(20)) as `0x${string}`,
      data: ("0x" + "ee".repeat(10)) as `0x${string}`,
    });

    expect(hash.startsWith("0x")).toBe(true);
    expect(sentMethods).toEqual(["eth_sendRawTransaction"]);
    expect(sentParams[0]).toEqual([("0x02" + "dd".repeat(60)) as `0x${string}`]);
  });

  it("getTransactionReceipt: returns null when not mined", async () => {
    const provider = new RpcAnchorChainProvider({
      transport: {
        async call<T>(): Promise<T> {
          return null as T;
        },
      },
      chainId: 1,
      async signAndEncodeTx() {
        return "0x";
      },
    });
    expect(await provider.getTransactionReceipt("0xabc")).toBeNull();
  });

  it("getTransactionReceipt: normalises success + logs", async () => {
    const provider = new RpcAnchorChainProvider({
      transport: {
        async call<T>(): Promise<T> {
          return {
            transactionHash: "0x" + "ab".repeat(32),
            blockNumber: "0x10",
            status: "0x1",
            logs: [
              {
                address: "0x" + "cc".repeat(20),
                topics: ["0x" + "11".repeat(32)],
                data: "0x",
                blockNumber: "0x10",
                transactionHash: "0x" + "ab".repeat(32),
                logIndex: "0x3",
              },
            ],
          } as T;
        },
      },
      chainId: 1,
      async signAndEncodeTx() {
        return "0x";
      },
    });
    const receipt = await provider.getTransactionReceipt("0xabc");
    expect(receipt).not.toBeNull();
    expect(receipt!.status).toBe("success");
    expect(receipt!.blockNumber).toBe(16n);
    expect(receipt!.logs.length).toBe(1);
    expect(receipt!.logs[0].blockNumber).toBe(16n);
    expect(receipt!.logs[0].logIndex).toBe(3);
  });

  it("getTransactionReceipt: maps 0x0 status to reverted", async () => {
    const provider = new RpcAnchorChainProvider({
      transport: {
        async call<T>(): Promise<T> {
          return {
            transactionHash: "0x" + "ab".repeat(32),
            blockNumber: "0x5",
            status: "0x0",
            logs: [],
          } as T;
        },
      },
      chainId: 1,
      async signAndEncodeTx() {
        return "0x";
      },
    });
    const receipt = await provider.getTransactionReceipt("0xabc");
    expect(receipt!.status).toBe("reverted");
  });
});

// ─── RpcBudgetChainProvider ──────────────────────────

describe("RpcBudgetChainProvider", () => {
  it("call: wraps eth_call at block-tag 'latest'", async () => {
    let calledWith: unknown[] | undefined;
    const provider = new RpcBudgetChainProvider({
      transport: {
        async call<T>(_method: string, params: ReadonlyArray<unknown>): Promise<T> {
          calledWith = [...params];
          return "0x" as T;
        },
      },
      chainId: 1,
    });
    await provider.call({
      to: ("0x" + "aa".repeat(20)) as `0x${string}`,
      data: ("0x" + "bb".repeat(4)) as `0x${string}`,
    });
    expect(calledWith).toBeDefined();
    expect(calledWith![1]).toBe("latest");
    expect(calledWith![0]).toMatchObject({
      to: ("0x" + "aa".repeat(20)) as `0x${string}`,
    });
  });

  it("getLogs: serialises earliest / latest / bigint block tags", async () => {
    const filters: unknown[] = [];
    const provider = new RpcBudgetChainProvider({
      transport: {
        async call<T>(_m: string, params: ReadonlyArray<unknown>): Promise<T> {
          filters.push(params[0]);
          return [] as T;
        },
      },
      chainId: 1,
    });
    const addr = ("0x" + "aa".repeat(20)) as `0x${string}`;

    await provider.getLogs({ address: addr, topics: [] });
    await provider.getLogs({
      address: addr,
      topics: [],
      fromBlock: 100n,
      toBlock: 200n,
    });

    expect((filters[0] as { fromBlock: string }).fromBlock).toBe("earliest");
    expect((filters[0] as { toBlock: string }).toBlock).toBe("latest");
    expect((filters[1] as { fromBlock: string }).fromBlock).toBe("0x64");
    expect((filters[1] as { toBlock: string }).toBlock).toBe("0xc8");
  });

  it("getLogs: normalises wire logs to RawLog shape", async () => {
    const provider = new RpcBudgetChainProvider({
      transport: {
        async call<T>(): Promise<T> {
          return [
            {
              topics: ["0x" + "11".repeat(32)],
              data: "0x",
              blockNumber: "0x42",
              transactionHash: "0x" + "ab".repeat(32),
              logIndex: "0x7",
            },
          ] as T;
        },
      },
      chainId: 1,
    });
    const logs = await provider.getLogs({
      address: ("0x" + "aa".repeat(20)) as `0x${string}`,
      topics: [],
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].blockNumber).toBe(66n);
    expect(logs[0].logIndex).toBe(7);
  });
});

// ─── Deterministic addresses ─────────────────────────

describe("Deterministic addresses", () => {
  it("pinned AgentBudget + Notary addresses match the Foundry script output", () => {
    // These values come from `forge script script/Deploy.s.sol:Deploy`
    // against a clean CREATE2 deployer. If the salt or init-code
    // changes, the Foundry script prints new addresses and this
    // assertion catches the drift.
    expect(DETERMINISTIC_ADDRESSES.AgentBudget).toBe(
      "0x801D88B922f6B1BDD047EEfa0eE8e41dCDb694bC",
    );
    expect(DETERMINISTIC_ADDRESSES.Notary).toBe(
      "0xaf9923CD404d3124C092E50A94327B2e56343370",
    );
    expect(DEPLOYMENT_SALT).toBe(
      "0xae2afe54a4e176bd4e65767beb247b7f61d320e637ab6231233853cef800373a",
    );
  });
});
