/**
 * Example: screen an outbound transaction against OFAC and FATF high-risk
 * jurisdictions, then flag it if the decision is not `approve`.
 *
 * This example demonstrates:
 *
 *   1. Screening a "clean" counterparty and asserting the decision is
 *      `approve`.
 *   2. Screening a known OFAC-sanctioned mixer contract (Tornado Cash) and
 *      asserting that the engine blocks it.
 *   3. Screening an otherwise-clean transfer to a counterparty in a FATF
 *      high-risk jurisdiction (IR — Iran) and asserting that the risk is
 *      escalated.
 *   4. Using `screenAddress` for a lower-level address risk check with the
 *      structured `ScreeningResult` payload.
 *   5. Error handling: callers must treat a non-`approve` decision as a
 *      hard fail and surface the reason to operators.
 */

import { TransactionScreeningEngine } from "../src/index";
import type { TransactionScreening, ScreeningResult } from "../src/index";

/**
 * Structured outcome for each screening call so callers can route the
 * result through their own approval pipeline.
 */
export interface ScreeningOutcome {
  readonly result: TransactionScreening;
  readonly allowed: boolean;
  readonly reason: string;
}

/**
 * Run three screening scenarios and return their outcomes. The caller is
 * expected to fan the results out to: (a) the approval UI, (b) the audit
 * log, and (c) the alert system if `allowed === false`.
 */
export async function runTransactionScreeningExamples(): Promise<ScreeningOutcome[]> {
  const engine: TransactionScreeningEngine = new TransactionScreeningEngine();
  const outcomes: ScreeningOutcome[] = [];

  // Scenario 1: a clean counterparty. Expect `approve` and `allowed=true`.
  const cleanResult: TransactionScreening = await engine.screenTransaction({
    fromAddress: "0x1111111111111111111111111111111111111111",
    toAddress: "0x2222222222222222222222222222222222222222",
    amount: "250",
    asset: "USDC",
    counterpartyJurisdiction: "GB", // United Kingdom — low risk.
  });
  outcomes.push({
    result: cleanResult,
    allowed: cleanResult.decision === "approve",
    reason:
      cleanResult.decision === "approve"
        ? "Counterparty clean, jurisdiction low-risk"
        : `Unexpected decision: ${cleanResult.decision}`,
  });

  // Scenario 2: OFAC-sanctioned mixer. The engine recognises the known
  // Tornado Cash contract and must block.
  const mixerAddress: string = "0xd90e2f925da726b50c4ed8d0fb90ad053324f31b";
  const mixerResult: TransactionScreening = await engine.screenTransaction({
    fromAddress: "0x1111111111111111111111111111111111111111",
    toAddress: mixerAddress,
    amount: "5000",
    asset: "USDC",
  });
  outcomes.push({
    result: mixerResult,
    allowed: mixerResult.decision === "approve",
    reason: mixerResult.sanctionsFlag
      ? `Blocked: OFAC SDN match against ${mixerAddress}`
      : `Blocked: ${mixerResult.decision}`,
  });

  // Scenario 3: clean address but counterparty jurisdiction is on FATF
  // high-risk list. The engine should lift the risk to `high` and the
  // decision to `escalate`.
  const highRiskJurisdictionResult: TransactionScreening =
    await engine.screenTransaction({
      fromAddress: "0x1111111111111111111111111111111111111111",
      toAddress: "0x3333333333333333333333333333333333333333",
      amount: "250",
      asset: "USDC",
      counterpartyJurisdiction: "IR", // Iran — FATF high-risk.
    });
  outcomes.push({
    result: highRiskJurisdictionResult,
    allowed: highRiskJurisdictionResult.decision === "approve",
    reason: highRiskJurisdictionResult.highRiskJurisdiction
      ? "Escalate to compliance officer: FATF high-risk jurisdiction"
      : `Escalate: ${highRiskJurisdictionResult.decision}`,
  });

  // Scenario 4: lower-level address-only screen. Useful for pre-flight
  // checks before the caller has assembled the full transaction envelope
  // (fees, asset, amount, etc.).
  const addressOnly: ScreeningResult = await engine.screenAddress(mixerAddress);
  if (!addressOnly.sanctionsMatch) {
    throw new Error(
      `Expected sanctions match for ${mixerAddress}; got riskScore=${addressOnly.riskScore}`,
    );
  }

  // Scenario 5: review workflow. A senior officer approves or blocks a
  // previously-flagged screening. Demonstrates the error path when the id
  // is unknown.
  try {
    engine.reviewScreening("scr-does-not-exist", "officer-mlro", "block", "test");
  } catch (err: unknown) {
    const message: string = err instanceof Error ? err.message : String(err);
    console.warn(`Expected review failure for unknown id: ${message}`);
  }

  return outcomes;
}

// Direct-execution guard (see `kyc-flow.ts` for the rationale).
if (
  typeof process !== "undefined" &&
  process.argv[1]?.endsWith("transaction-screening.ts")
) {
  runTransactionScreeningExamples()
    .then((outcomes: ScreeningOutcome[]) => {
      for (const outcome of outcomes) {
        console.log(
          `[${outcome.allowed ? "ALLOW" : "BLOCK"}] ` +
            `decision=${outcome.result.decision} ` +
            `risk=${outcome.result.overallRisk} — ${outcome.reason}`,
        );
      }
    })
    .catch((err: unknown) => {
      const message: string = err instanceof Error ? err.message : String(err);
      console.error(`Screening example failed: ${message}`);
      process.exitCode = 1;
    });
}
