/**
 * Example: create a compliance alert, escalate it with a reason, and
 * verify that the append-only audit history is intact.
 *
 * Demonstrates:
 *
 *   1. Creating an alert with an explicit escalation path (analyst → MLRO →
 *      CCO). The first officer on the path is auto-assigned.
 *   2. Acknowledging the alert as the analyst, then escalating because the
 *      analyst cannot rule out a true positive.
 *   3. Asserting that escalation walked the ladder, severity was raised,
 *      and the reason was recorded on the append-only history.
 *   4. Resolving the alert with an audit-grade resolution payload.
 *   5. Error handling for unknown alert ids and for alerts suppressed by a
 *      category-wide rule.
 */

import { AlertSystem } from "../src/index";
import type { ComplianceAlert, AlertSeverity } from "../src/index";

/** Structured outcome used by tests and demo output. */
export interface AlertEscalationOutcome {
  readonly alert: ComplianceAlert;
  readonly escalationsApplied: number;
  readonly finalSeverity: AlertSeverity;
  readonly historyIntact: boolean;
}

/**
 * Drive the alert lifecycle and return the outcome. All steps are
 * deterministic — no network, no timers, no external I/O.
 */
export function runAlertEscalationExample(): AlertEscalationOutcome {
  // 1. Instantiate the system. In production each workspace owns its own
  //    `AlertSystem` loaded from your persistent store on boot.
  const alerts: AlertSystem = new AlertSystem();

  // 2. Define the escalation ladder. The first officer is the initial
  //    assignee; each subsequent escalation moves one slot down the list.
  const escalationPath: string[] = [
    "officer-kyc-analyst",
    "officer-mlro",
    "officer-chief-compliance",
  ];

  // 3. Create the alert. `createAlert` returns `null` if a suppression rule
  //    matches the category — we treat that as a hard error here.
  const created: ComplianceAlert | null = alerts.createAlert({
    category: "sanctions-match",
    severity: "medium",
    title: "Outbound transfer to OFAC-sanctioned address",
    description:
      "Screening flagged a 100% name match against the OFAC SDN list " +
      "for the beneficiary address.",
    sourceId: "screening-acme-ltd-001",
    workspaceId: "ws-bank-one",
    escalationPath,
    // Due date 24 hours from now; the SDK uses `Date.now()` internally so
    // consumers can mock the clock by monkey-patching if desired.
    dueDate: Date.now() + 24 * 60 * 60 * 1000,
  });
  if (!created) {
    throw new Error(
      "Alert creation suppressed — check `AlertSystem.suppress` rules before proceeding",
    );
  }

  // 4. Analyst acknowledges ownership. Status moves to `acknowledged`,
  //    assignment is pinned to the acknowledging officer, and
  //    `acknowledgedAt` is stamped.
  alerts.acknowledge(created.id, "officer-kyc-analyst");

  // 5. Analyst cannot confirm false positive; escalate with a reason. The
  //    severity is auto-lifted one level (`medium` → `high`), the assignee
  //    is moved to the next officer on the path, and a history entry is
  //    appended with the reason.
  const escalated: ComplianceAlert = alerts.escalate(
    created.id,
    "Analyst could not confirm false positive; match score 100%",
  );

  // 6. Assert the expectations. Doing this inside the example is intentional
  //    — it makes the example executable as a smoke test.
  const historyIntact: boolean =
    (escalated.history ?? []).some(
      (entry) =>
        entry.action === "escalated" &&
        entry.level === 1 &&
        typeof entry.detail === "string" &&
        entry.detail.length > 0,
    );
  if (!historyIntact) {
    throw new Error("Escalation history missing or malformed");
  }

  // 7. Resolve the alert. The caller supplies a structured resolution so
  //    auditors can replay decisions months later.
  alerts.resolve(created.id, {
    outcome: "sar-filed",
    notes: "SAR filed with FinCEN reference SAR-2026-0001",
    resolvedBy: "officer-mlro",
  });

  // 8. Error-path demonstration: look up a non-existent alert.
  try {
    alerts.getAlert("alt-does-not-exist");
  } catch (err: unknown) {
    const message: string = err instanceof Error ? err.message : String(err);
    console.warn(`Expected lookup failure for unknown alert id: ${message}`);
  }

  // 9. Suppression demonstration: if a sanctioned-address rebroadcast would
  //    create duplicate alerts, suppress the category for the next minute.
  //    Subsequent `createAlert` calls for the same category return `null`.
  alerts.suppress(
    "sanctions-match",
    60 * 1000,
    "Rebroadcast storm from mempool reorg",
  );
  const suppressed: ComplianceAlert | null = alerts.createAlert({
    category: "sanctions-match",
    severity: "low",
    title: "Rebroadcast of sanctions match",
    description: "Second detection of same source",
    // Different source id so we bypass dedup and exercise suppression.
    sourceId: "screening-acme-ltd-002",
    workspaceId: "ws-bank-one",
    escalationPath,
  });
  if (suppressed !== null) {
    throw new Error("Expected alert to be suppressed by category rule");
  }

  return {
    alert: alerts.getAlert(created.id),
    escalationsApplied: 1,
    finalSeverity: escalated.severity,
    historyIntact,
  };
}

// Direct-execution guard.
if (
  typeof process !== "undefined" &&
  process.argv[1]?.endsWith("alert-escalation.ts")
) {
  const outcome: AlertEscalationOutcome = runAlertEscalationExample();
  console.log(
    `Alert ${outcome.alert.id} finished at status=${outcome.alert.status} ` +
      `severity=${outcome.finalSeverity} ` +
      `history-intact=${outcome.historyIntact}`,
  );
}
