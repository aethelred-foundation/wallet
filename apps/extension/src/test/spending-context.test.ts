/**
 * Spending-context assembly for policy enforcement.
 *
 * The policy bundles' value/destination/velocity rules read
 * `amountUsd`, `destinationCategory`, and the velocity fields from the
 * PolicyContext — but until this module existed, neither send path
 * (popup prepare-tx, dApp eth_sendTransaction) supplied them, so every
 * spending rule was dead code (disclosed in PR #190).
 *
 * These tests pin the assembly semantics AND, through the real policy
 * engine + shipped bundles (no mocks), prove the rules actually fire
 * when the context carries the fields:
 *
 *   - a priced transfer above $10,000 trips the personal spend-limit
 *   - a priced transfer to an unknown destination above $100 warns
 *   - >50 operations in 24h trips the personal velocity rule
 *   - an UNPRICED transfer must not silently skip value rules — the
 *     assembly flags it so the caller surfaces an explicit notice
 *     (AETHEL has no market price; production builds fail closed to
 *     "no price", and silence there would be enforcement theater)
 */

import { describe, expect, it } from "vitest";
import {
  buildSpendingFields,
  UNPRICED_POLICY_NOTICE,
} from "../background/spending-context";
import {
  evaluate,
  buildPolicyContext,
  getDefaultPolicyBundle,
} from "@aethelred/wallet-policy";
import type { IntentRequest, WalletAccount } from "@aethelred/wallet-connect";
import type { Workspace } from "@aethelred/wallet-identity";

const OWN = "0x1111111111111111111111111111111111111111";
const OTHER = "0xcafebabecafebabecafebabecafebabecafebabe";
const ONE_AETHEL = 10n ** 18n;

function fields(overrides: Partial<Parameters<typeof buildSpendingFields>[0]> = {}) {
  return buildSpendingFields({
    to: OTHER,
    valueWei: 5n * ONE_AETHEL,
    decimals: 18,
    symbol: "AETHEL",
    priceUsd: 2.47,
    ownAddresses: [OWN],
    ...overrides,
  });
}

describe("buildSpendingFields", () => {
  it("derives the native amount and USD value from wei and price", () => {
    const f = fields({ valueWei: 5n * ONE_AETHEL, priceUsd: 2 });
    expect(f.amount).toBeCloseTo(5);
    expect(f.amountUsd).toBeCloseTo(10);
    expect(f.priced).toBe(true);
    expect(f.assetSymbol).toBe("AETHEL");
    expect(f.assetCategory).toBe("native");
  });

  it("categorizes the wallet's own accounts as known-contact, case-insensitively", () => {
    const f = fields({ to: OWN.toUpperCase().replace("0X", "0x") });
    expect(f.destinationCategory).toBe("known-contact");
  });

  it("categorizes everything else as unknown", () => {
    expect(fields().destinationCategory).toBe("unknown");
  });

  it("flags unpriced transfers instead of inventing a USD value", () => {
    const f = fields({ priceUsd: null });
    expect(f.priced).toBe(false);
    expect(f.amountUsd).toBeUndefined();
    expect(f.amount).toBeCloseTo(5);
  });

  it("treats a non-positive price as unpriced (fail-closed pricing)", () => {
    expect(fields({ priceUsd: 0 }).priced).toBe(false);
  });

  it("passes velocity stats through when provided", () => {
    const f = fields({ velocity: { count24h: 7, valueUsd24h: 123.45 } });
    expect(f.requestedOperationCount24h).toBe(7);
    expect(f.cumulativeValueSpentUsd24h).toBeCloseTo(123.45);
  });

  it("handles contract creation (no destination)", () => {
    const f = fields({ to: null });
    expect(f.destination).toBeUndefined();
    expect(f.destinationCategory).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// Through the REAL engine + shipped personal bundle — the rules must fire.
// ---------------------------------------------------------------------------

const workspace = { id: "ws-1", kind: "personal" } as unknown as Workspace;
const account: WalletAccount = {
  id: "acc-1",
  label: "e2e",
  address: OWN,
  namespace: "eip155",
  custody: "local",
  assurance: "device-key",
} as WalletAccount;
const intent: IntentRequest = {
  kind: "sign-transaction",
  method: "eth_sendTransaction",
  app: { id: "popup", name: "Aethelred Wallet", origin: "popup", trustLevel: "first-party" },
} as IntentRequest;

function evaluateWithSpending(spending: ReturnType<typeof buildSpendingFields>) {
  return evaluate(
    buildPolicyContext({
      intent,
      subjectId: "subj-1",
      subjectRole: "owner",
      workspace,
      account,
      sessionExists: true,
      destination: spending.destination,
      destinationCategory: spending.destinationCategory,
      amount: spending.amount,
      amountUsd: spending.amountUsd,
      assetSymbol: spending.assetSymbol,
      assetCategory: spending.assetCategory,
      requestedOperationCount24h: spending.requestedOperationCount24h,
      cumulativeValueSpentUsd24h: spending.cumulativeValueSpentUsd24h,
    }),
    getDefaultPolicyBundle("personal"),
  );
}

describe("spending rules fire through the real engine (personal bundle)", () => {
  it("trips the $10k per-tx spend-limit warning when priced", () => {
    const result = evaluateWithSpending(
      fields({ valueWei: 99_999n * ONE_AETHEL, priceUsd: 2.47 }), // ≈ $247k
    );
    expect(result.warnings.join(" ")).toMatch(/exceeds \$10,000/i);
  });

  it("warns on an unknown destination above $100 when priced", () => {
    const result = evaluateWithSpending(
      fields({ valueWei: 100n * ONE_AETHEL, priceUsd: 2.47 }), // $247, unknown dest
    );
    expect(result.warnings.join(" ")).toMatch(/never used before|unknown destination/i);
  });

  it("does not fire the spend-limit for a small priced transfer", () => {
    const result = evaluateWithSpending(fields({ valueWei: ONE_AETHEL, priceUsd: 2.47 }));
    expect(result.warnings.join(" ")).not.toMatch(/exceeds \$10,000/i);
  });

  it("trips the velocity-count rule past 50 operations in 24h", () => {
    const result = evaluateWithSpending(
      fields({ velocity: { count24h: 51, valueUsd24h: 10 } }),
    );
    expect(result.warnings.join(" ")).toMatch(/50\+ transactions/i);
  });

  it("keeps USD rules silent when unpriced — the caller must surface the notice", () => {
    const result = evaluateWithSpending(
      fields({ valueWei: 99_999n * ONE_AETHEL, priceUsd: null }),
    );
    expect(result.warnings.join(" ")).not.toMatch(/exceeds \$10,000/i);
    // The notice constant exists for the wiring layer to append; it must
    // name the condition plainly.
    expect(UNPRICED_POLICY_NOTICE).toMatch(/could not be priced/i);
    expect(UNPRICED_POLICY_NOTICE).toMatch(/value-based policy checks/i);
  });
});
