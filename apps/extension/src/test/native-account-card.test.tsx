/**
 * NativeAccountCard + useNativeAccount — the wallet's native-identity UI.
 *
 * Proves the canonical `aethel1…` derivation is shown for EVM accounts
 * (identity is local — rendered even with the node down), that native
 * balance + delegations render from the LCD, and that non-EVM accounts
 * render nothing.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ethHexToBech32 } from "@aethelred/wallet-chain-cosmos";

import { NativeAccountCard } from "../popup/components/native-account-card";
import { formatUaethel } from "../popup/hooks/use-native-account";

const EVM_ADDR = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const NATIVE_ADDR = ethHexToBech32(EVM_ADDR);
const LCD = "http://lcd.test";

type StubRoute = (url: string) => { status: number; body: unknown } | null;

function stubFetch(route: StubRoute): void {
  vi.stubGlobal(
    "fetch",
    (async (url: unknown) => {
      const match = route(String(url));
      if (!match) return { ok: false, status: 404, json: async () => ({}) };
      return {
        ok: match.status >= 200 && match.status < 300,
        status: match.status,
        json: async () => match.body,
      };
    }) as unknown as typeof fetch,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("formatUaethel", () => {
  it("formats 6-decimal base units", () => {
    expect(formatUaethel("0")).toBe("0.000000");
    expect(formatUaethel("1000000")).toBe("1.000000");
    expect(formatUaethel("100000000")).toBe("100.000000");
    expect(formatUaethel("123")).toBe("0.000123");
  });
});

describe("NativeAccountCard", () => {
  it("shows the canonical aethel1 identity + balance + delegations", async () => {
    stubFetch((url) => {
      if (url.includes("/cosmos/bank/v1beta1/balances/")) {
        return {
          status: 200,
          body: { balances: [{ denom: "uaethel", amount: "94000000" }] },
        };
      }
      if (url.includes("/cosmos/staking/v1beta1/delegations/")) {
        return {
          status: 200,
          body: {
            delegation_responses: [
              {
                delegation: {
                  validator_address:
                    "aethelvaloper1qqqsyqcyq5rqwzqfpg9scrgwpugpzysnfl5c3v",
                },
                balance: { denom: "uaethel", amount: "5000000" },
              },
            ],
          },
        };
      }
      return null;
    });

    render(<NativeAccountCard evmAddress={EVM_ADDR} lcdBaseUrl={LCD} />);

    // Identity: canonical bech32 of the SAME 20 bytes as the 0x address.
    expect(screen.getByText(NATIVE_ADDR)).toBeTruthy();
    // Balance + staked position load from the LCD.
    await waitFor(() =>
      expect(screen.getByText("94.000000 AETHEL")).toBeTruthy(),
    );
    expect(screen.getByText("Staked")).toBeTruthy();
    expect(screen.getByText("5.000000 AETHEL")).toBeTruthy();
  });

  it("still shows the identity when the node is unreachable (honest degrade)", async () => {
    vi.stubGlobal(
      "fetch",
      (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    );

    render(<NativeAccountCard evmAddress={EVM_ADDR} lcdBaseUrl={LCD} />);

    expect(screen.getByText(NATIVE_ADDR)).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText(/Chain endpoint unreachable/)).toBeTruthy(),
    );
    // No fabricated balance while unreachable.
    expect(screen.queryByText(/AETHEL$/)).toBeNull();
  });

  it("shows 'no active delegations' when none exist", async () => {
    stubFetch((url) => {
      if (url.includes("/balances/")) {
        return { status: 200, body: { balances: [] } };
      }
      return null; // delegations 404 → none
    });

    render(<NativeAccountCard evmAddress={EVM_ADDR} lcdBaseUrl={LCD} />);
    await waitFor(() =>
      expect(screen.getByText("No active delegations.")).toBeTruthy(),
    );
    expect(screen.getByText("0.000000 AETHEL")).toBeTruthy();
  });

  it("renders nothing for non-EVM account addresses (BTC/SOL)", () => {
    const { container } = render(
      <NativeAccountCard
        evmAddress="bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
        lcdBaseUrl={LCD}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
