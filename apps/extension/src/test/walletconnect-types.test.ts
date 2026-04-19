/**
 * WalletConnect v2 type-level helpers — correctness tests.
 *
 * Covers:
 *   - `parseWalletConnectUri` accepts canonical v2 pairing URIs and
 *     rejects malformed or non-wc inputs
 *   - `toCaip10Account` produces spec-compliant CAIP-10 identifiers
 *   - `fromCaip2ChainId` extracts numeric EIP-155 chain ids and
 *     rejects non-EIP-155 / malformed strings
 *   - Round-trip invariants between the helpers
 */

import { describe, it, expect } from "vitest";
import {
  parseWalletConnectUri,
  toCaip10Account,
  toCaip2ChainId,
  fromCaip2ChainId,
  fromCaip10Account,
} from "@aethelred/wallet-connect";

describe("parseWalletConnectUri", () => {
  it("accepts a canonical v2 pairing URI with symKey", () => {
    const uri =
      "wc:abc123def456@2?relay-protocol=irn&symKey=" +
      "e5d3a9f0fc8d5d5b6ae2c6f7e3b2cfdc5d5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c";
    const parsed = parseWalletConnectUri(uri);
    expect(parsed).not.toBeNull();
    expect(parsed as string).toBe(uri);
  });

  it("accepts a URI with relay-protocol but no symKey (v2 relay handshake)", () => {
    const uri = "wc:topic@2?relay-protocol=irn";
    const parsed = parseWalletConnectUri(uri);
    expect(parsed).not.toBeNull();
  });

  it("rejects a URI missing the query string", () => {
    // v1-style URIs (no query) cannot be used with a v2 wallet.
    expect(parseWalletConnectUri("wc:topic@1")).toBeNull();
    expect(parseWalletConnectUri("wc:topic@2")).toBeNull();
  });

  it("rejects a URI with only an irrelevant query string", () => {
    // Must contain either symKey or relay-protocol.
    expect(parseWalletConnectUri("wc:topic@2?foo=bar")).toBeNull();
  });

  it("returns null for random non-wc strings", () => {
    expect(parseWalletConnectUri("invalid")).toBeNull();
    expect(parseWalletConnectUri("not-a-wc-uri")).toBeNull();
    expect(parseWalletConnectUri("https://example.com")).toBeNull();
    expect(parseWalletConnectUri("")).toBeNull();
  });

  it("returns null for wc-prefixed but malformed inputs", () => {
    expect(parseWalletConnectUri("wc:")).toBeNull();
    expect(parseWalletConnectUri("wc:no-version")).toBeNull();
    expect(parseWalletConnectUri("wc:topic@?symKey=abc")).toBeNull();
  });

  it("trims whitespace before parsing", () => {
    const uri = "  wc:topic@2?relay-protocol=irn  ";
    expect(parseWalletConnectUri(uri)).not.toBeNull();
  });

  it("is defensive against non-string inputs", () => {
    // These would normally be filtered by TS, but the helper is a
    // boundary so it must cope with runtime garbage.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(parseWalletConnectUri(null as any)).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(parseWalletConnectUri(undefined as any)).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(parseWalletConnectUri(123 as any)).toBeNull();
  });
});

describe("toCaip10Account", () => {
  it("composes a CAIP-10 id from chainId + address", () => {
    const id = toCaip10Account(1, "0xAbC1234567890123456789012345678901234567");
    expect(id).toBe("eip155:1:0xabc1234567890123456789012345678901234567");
  });

  it("lower-cases the address to the CAIP-10 canonical form", () => {
    const mixed = "0xAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCdEfAbCd";
    const id = toCaip10Account(137, mixed);
    expect(id).toBe(`eip155:137:${mixed.toLowerCase()}`);
  });

  it("throws on invalid chain ids", () => {
    expect(() =>
      toCaip10Account(0, "0x1234567890123456789012345678901234567890"),
    ).toThrow(/chainId/);
    expect(() =>
      toCaip10Account(-1, "0x1234567890123456789012345678901234567890"),
    ).toThrow(/chainId/);
    expect(() =>
      toCaip10Account(
        1.5,
        "0x1234567890123456789012345678901234567890",
      ),
    ).toThrow(/chainId/);
  });

  it("throws on invalid addresses", () => {
    expect(() => toCaip10Account(1, "not-an-address")).toThrow(/address/);
    expect(() => toCaip10Account(1, "0xshort")).toThrow(/address/);
    expect(() => toCaip10Account(1, "")).toThrow(/address/);
  });
});

describe("fromCaip2ChainId", () => {
  it("parses EIP-155 identifiers to their numeric chain id", () => {
    expect(fromCaip2ChainId("eip155:1")).toBe(1);
    expect(fromCaip2ChainId("eip155:137")).toBe(137);
    expect(fromCaip2ChainId("eip155:42161")).toBe(42161);
  });

  it("returns null for non-EIP-155 namespaces", () => {
    expect(fromCaip2ChainId("solana:mainnet")).toBeNull();
    expect(fromCaip2ChainId("cosmos:cosmoshub-4")).toBeNull();
    expect(fromCaip2ChainId("polkadot:91b171bb158e2d3848fa23a9f1c25182")).toBeNull();
  });

  it("returns null for malformed CAIP-2 strings", () => {
    expect(fromCaip2ChainId("bad-format")).toBeNull();
    expect(fromCaip2ChainId("eip155")).toBeNull();
    expect(fromCaip2ChainId("eip155:")).toBeNull();
    expect(fromCaip2ChainId("eip155:not-a-number")).toBeNull();
    expect(fromCaip2ChainId("eip155:1:extra")).toBeNull();
    expect(fromCaip2ChainId("")).toBeNull();
  });

  it("returns null for negative or zero chain ids", () => {
    expect(fromCaip2ChainId("eip155:0")).toBeNull();
    // Negative reference is rejected by the digits-only regex before
    // even reaching the `<= 0` guard, so this is a regex check.
    expect(fromCaip2ChainId("eip155:-1")).toBeNull();
  });
});

describe("CAIP round-trips", () => {
  it("toCaip2ChainId ∘ fromCaip2ChainId is the identity on EIP-155", () => {
    for (const chainId of [1, 10, 137, 8453, 42161, 11155111]) {
      const caip2 = toCaip2ChainId(chainId);
      expect(fromCaip2ChainId(caip2)).toBe(chainId);
    }
  });

  it("toCaip10Account → fromCaip10Account round-trips cleanly", () => {
    const address = "0xAbcdefabcdefabcdefabcdefabcdefabcdefabcd";
    const caip10 = toCaip10Account(42161, address);
    const decoded = fromCaip10Account(caip10);
    expect(decoded).not.toBeNull();
    expect(decoded?.chainId).toBe(42161);
    expect(decoded?.address).toBe(address.toLowerCase());
  });

  it("fromCaip10Account rejects non-EVM identifiers", () => {
    expect(fromCaip10Account("solana:mainnet:abc")).toBeNull();
    expect(fromCaip10Account("eip155:1:not-an-address")).toBeNull();
    expect(fromCaip10Account("eip155:1:0xshort")).toBeNull();
    expect(fromCaip10Account("bad")).toBeNull();
  });
});
