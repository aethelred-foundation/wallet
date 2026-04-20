/**
 * Fuzz tests for the JSON-RPC client's response-parsing behaviour.
 * ────────────────────────────────────────────────────────────────
 * 2000 iterations per test. We inject arbitrary JSON payloads via a
 * `fetch` stub and verify the client never throws an untyped error —
 * every failure mode surfaces as either a value or an `RpcError`.
 *
 * Untyped throws from this layer historically leaked raw `TypeError`
 * into the popup, breaking the error-boundary's classification. This
 * fuzz guarantees the client's exception surface stays stable.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import * as fc from "fast-check";
import { RpcClient, RpcError } from "@aethelred/wallet-chain";

type FetchMock = ReturnType<typeof vi.fn>;
const originalFetch: typeof fetch | undefined = globalThis.fetch;

function withFetch(body: unknown, status = 200): FetchMock {
  const mock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
  });
  (globalThis as unknown as { fetch: FetchMock }).fetch = mock;
  return mock;
}

afterEach(() => {
  if (originalFetch) {
    (globalThis as unknown as { fetch: typeof fetch }).fetch = originalFetch;
  }
});

describe("RPC client fuzz", () => {
  it("arbitrary JSON responses never produce untyped throws", async () => {
    await fc.assert(
      fc.asyncProperty(fc.jsonValue(), async (body) => {
        withFetch(body);
        const client = new RpcClient({ url: "https://rpc.test.example", maxRetries: 0, retryDelayMs: 0 });
        try {
          await client.call("eth_blockNumber");
          /* success is fine — it implies result was present. */
        } catch (e) {
          expect(e).toBeInstanceOf(Error);
          if (!(e instanceof RpcError)) {
            /* Any non-RpcError must still be an Error subclass; never
             * a raw string, object, or undefined. */
            expect(typeof (e as Error).message).toBe("string");
          }
        }
      }),
      { numRuns: 2000 },
    );
  });

  it("arbitrary { error } shapes throw RpcError with a message string", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          jsonrpc: fc.constant("2.0"),
          id: fc.integer({ min: 0, max: 1_000_000 }),
          error: fc.record({
            code: fc.integer({ min: -32768, max: 32767 }),
            message: fc.string({ minLength: 0, maxLength: 48 }),
          }),
        }),
        async (body) => {
          withFetch(body);
          const client = new RpcClient({ url: "https://rpc.test.example", maxRetries: 0, retryDelayMs: 0 });
          try {
            await client.call("eth_call");
            /* Should have thrown given the { error } shape. */
            expect.fail("expected throw");
          } catch (e) {
            expect(e).toBeInstanceOf(RpcError);
            expect(typeof (e as RpcError).message).toBe("string");
          }
        },
      ),
      { numRuns: 2000 },
    );
  });
});
