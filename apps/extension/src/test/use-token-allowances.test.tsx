/**
 * useTokenAllowances — hook + enrichment unit tests.
 *
 * Covers:
 *   • classifyRisk: all four quadrants of the risk matrix
 *   • enrichAllowance: label resolution against the known-spenders
 *     registry, unlimited detection (hex vs. decimal), finite USD
 *     preservation, and graceful defaults on missing fields
 *   • useTokenAllowances (hook): empty-handler passthrough (dev mode),
 *     error surfacing, refresh handle, high-risk sort order
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import {
  classifyRisk,
  enrichAllowance,
  useTokenAllowances,
  type RawAllowancePayload,
} from "../popup/hooks/use-token-allowances";
import {
  lookupSpender,
  knownSpenderCount,
} from "../lib/known-spenders";

/* ─── classifyRisk ─────────────────────────────────────────────── */

describe("classifyRisk", () => {
  it("unlimited + unverified → high", () => {
    expect(classifyRisk(true, false)).toBe("high");
  });

  it("unlimited + verified → medium", () => {
    expect(classifyRisk(true, true)).toBe("medium");
  });

  it("finite + unverified → medium", () => {
    expect(classifyRisk(false, false)).toBe("medium");
  });

  it("finite + verified → low", () => {
    expect(classifyRisk(false, true)).toBe("low");
  });
});

/* ─── enrichAllowance ─────────────────────────────────────────── */

describe("enrichAllowance", () => {
  // 2^256 - 1, the canonical "max uint256" sentinel. Hex form is
  // 64 hex chars of 'f' — same value Uniswap Router uses.
  const MAX_UINT256 =
    "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

  it("flags hex max-uint256 as unlimited with high risk", () => {
    const result = enrichAllowance({
      tokenAddress: "0xtoken",
      tokenSymbol: "USDC",
      tokenName: "USD Coin",
      spenderAddress: "0xUnknownSpender000000000000000000000000",
      allowanceRaw: MAX_UINT256,
      chainId: 1,
    });
    expect(result.allowanceFormatted).toBe("Unlimited");
    expect(result.spenderVerified).toBe(false);
    expect(result.riskLevel).toBe("high");
    // Unlimited → USD exposure becomes Infinity so the caller can opt
    // to hide or emphasize; non-finite is how CurrencyText renders "—".
    expect(Number.isFinite(result.allowanceUsd)).toBe(false);
  });

  it("resolves a known Uniswap V2 Router as verified on ETH mainnet", () => {
    const result = enrichAllowance({
      tokenAddress: "0xtoken",
      tokenSymbol: "DAI",
      tokenName: "Dai Stablecoin",
      spenderAddress: "0x7A250d5630B4cF539739dF2C5dAcb4c659F2488D",
      allowanceRaw: "100000000000000000000",
      tokenDecimals: 18,
      chainId: 1,
    });
    expect(result.spenderVerified).toBe(true);
    expect(result.spenderLabel).toBe("Uniswap V2 Router");
    // Finite + verified = low risk
    expect(result.riskLevel).toBe("low");
    // 100e18 wei = "100" with 18 decimals
    expect(result.allowanceFormatted).toBe("100");
  });

  it("formats a fractional allowance without trailing zeros", () => {
    const result = enrichAllowance({
      tokenAddress: "0xtoken",
      tokenSymbol: "USDC",
      tokenName: "USD Coin",
      spenderAddress: "0xUnknown00000000000000000000000000000001",
      allowanceRaw: "1234567",
      tokenDecimals: 6,
      chainId: 1,
    });
    // 1.234567 USDC → displays as "1.2345" (truncated to 4 places)
    expect(result.allowanceFormatted).toBe("1.2345");
    // Unknown spender + finite = medium risk
    expect(result.riskLevel).toBe("medium");
  });

  it("preserves a background-provided formatted string", () => {
    const result = enrichAllowance({
      tokenAddress: "0xtoken",
      tokenSymbol: "DAI",
      tokenName: "Dai Stablecoin",
      spenderAddress: "0xUnknown00000000000000000000000000000002",
      allowanceRaw: "100000000000000000000",
      allowanceFormatted: "100.00 DAI",
      tokenDecimals: 18,
    });
    expect(result.allowanceFormatted).toBe("100.00 DAI");
  });

  it("returns a finite allowanceUsd when provided by the background", () => {
    const result = enrichAllowance({
      tokenAddress: "0xtoken",
      tokenSymbol: "USDC",
      tokenName: "USD Coin",
      spenderAddress: "0x7A250d5630B4cF539739dF2C5dAcb4c659F2488D",
      allowanceRaw: "100000000",
      allowanceUsd: 100,
      tokenDecimals: 6,
    });
    expect(result.allowanceUsd).toBe(100);
    expect(Number.isFinite(result.allowanceUsd)).toBe(true);
  });

  it("tolerates a malformed allowanceRaw gracefully (finite fallback)", () => {
    const result = enrichAllowance({
      tokenAddress: "0xtoken",
      tokenSymbol: "FOO",
      tokenName: "Foo Token",
      spenderAddress: "0xUnknown00000000000000000000000000000003",
      allowanceRaw: "not-a-number",
      tokenDecimals: 18,
    });
    // Malformed raw → treated as finite so we don't misclassify as
    // "Unlimited", and the raw string echoes back in the formatted
    // field.
    expect(result.allowanceFormatted).toBe("not-a-number");
    expect(result.riskLevel).not.toBe("high");
  });
});

/* ─── Known spender registry ──────────────────────────────────── */

describe("known-spenders registry", () => {
  it("contains at least 15 entries across chains", () => {
    expect(knownSpenderCount()).toBeGreaterThanOrEqual(15);
  });

  it("normalizes mixed-case addresses on lookup", () => {
    const match = lookupSpender(
      1,
      "0X7A250D5630B4CF539739DF2C5DACB4C659F2488D",
    );
    expect(match?.label).toBe("Uniswap V2 Router");
    expect(match?.verified).toBe(true);
  });

  it("returns null for unknown chain ids", () => {
    expect(
      lookupSpender(999999, "0x7a250d5630b4cf539739df2c5dacb4c659f2488d"),
    ).toBeNull();
  });

  it("returns null for addresses not in the registry", () => {
    expect(
      lookupSpender(1, "0x0000000000000000000000000000000000000000"),
    ).toBeNull();
  });
});

/* ─── Hook integration (Chrome-runtime mock) ─────────────────── */

type SendMessageCallback = (response: unknown) => void;
type MockResponse = { result?: unknown; error?: { code: number; message: string } };

interface RuntimeMock {
  id: string;
  sendMessage: (msg: unknown, cb: SendMessageCallback) => void;
  lastError?: { message: string };
}

let currentResponse: MockResponse | "throw" = { result: [] };
let sendMessageCalls = 0;

function installChromeMock() {
  sendMessageCalls = 0;
  const runtime: RuntimeMock = {
    id: "test-extension",
    sendMessage: (_msg, cb) => {
      sendMessageCalls += 1;
      const resp = currentResponse;
      queueMicrotask(() => {
        if (resp === "throw") {
          runtime.lastError = { message: "simulated runtime error" };
          cb({});
          runtime.lastError = undefined;
        } else {
          cb({ payload: resp });
        }
      });
    },
  };
  (globalThis as unknown as { chrome?: unknown }).chrome = { runtime };
}

function uninstallChromeMock() {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
}

function Harness({ address }: { address?: string }) {
  const result = useTokenAllowances(address);
  return (
    <div>
      <span data-testid="loading">{result.loading ? "true" : "false"}</span>
      <span data-testid="count">{result.allowances.length}</span>
      <span data-testid="error">{result.error ?? ""}</span>
      <span data-testid="first-risk">
        {result.allowances[0]?.riskLevel ?? ""}
      </span>
      <button onClick={() => result.refresh()}>refresh</button>
    </div>
  );
}

const RAW_HIGH: RawAllowancePayload = {
  tokenAddress: "0xaaa",
  tokenSymbol: "USDT",
  tokenName: "Tether",
  spenderAddress: "0xNeverSeenBefore0000000000000000000000000",
  allowanceRaw:
    "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  chainId: 1,
};

const RAW_LOW: RawAllowancePayload = {
  tokenAddress: "0xbbb",
  tokenSymbol: "DAI",
  tokenName: "Dai Stablecoin",
  spenderAddress: "0x7A250d5630B4cF539739dF2C5dAcb4c659F2488D", // Uniswap V2
  allowanceRaw: "100",
  tokenDecimals: 18,
  chainId: 1,
};

describe("useTokenAllowances", () => {
  beforeEach(() => {
    installChromeMock();
    currentResponse = { result: [RAW_LOW, RAW_HIGH] };
  });

  afterEach(() => {
    uninstallChromeMock();
  });

  it("returns empty list without firing a fetch when address is missing", async () => {
    render(<Harness address={undefined} />);
    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("count").textContent).toBe("0");
    expect(sendMessageCalls).toBe(0);
  });

  it("fetches, enriches, and sorts by risk (high-first)", async () => {
    render(<Harness address="0xdeadbeef" />);
    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("count").textContent).toBe("2");
    // High-risk row must come first regardless of payload order.
    expect(screen.getByTestId("first-risk").textContent).toBe("high");
  });

  it("surfaces runtime errors via the error field", async () => {
    render(<Harness address="0xdeadbeef" />);
    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    currentResponse = "throw";
    const btn = screen.getByText("refresh");
    await act(async () => {
      btn.click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("error").textContent).toBe(
        "simulated runtime error",
      );
    });
  });

  it("returns an empty list cleanly when the handler is not wired", async () => {
    // Dev-mode / staged-rollout shape: background returns {}, the hook
    // interprets this as "no data yet" and should render empty rather
    // than surfacing an error.
    currentResponse = { result: undefined };
    render(<Harness address="0xdeadbeef" />);
    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("count").textContent).toBe("0");
    expect(screen.getByTestId("error").textContent).toBe("");
  });
});
