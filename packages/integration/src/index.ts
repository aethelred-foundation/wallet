/**
 * `@aethelred/wallet-integration` — the composition surface that
 * threads the Aethelred moat stack into one executable story.
 *
 * Three exports:
 *
 *   - Composition adapters (`AgentBudgetGate`, `ReputationSponsorPolicy`,
 *     `BudgetSponsorPolicy`) — the glue that lets every package
 *     consume every other package without mutual deps.
 *
 *   - In-memory fixtures (`SimulatedEnclave`, `SimulatedAnchorChain`,
 *     `SimulatedBudgetClient`, `SimulatedFireblocksClient`) — stand-
 *     in implementations that behave byte-identically to their real
 *     counterparts so the demo runs in `vitest` without an RPC or a
 *     real enclave.
 *
 *   - `runEndToEndDemo()` — the proof-of-moat executable. One call,
 *     one story, every package exercised.
 *
 * @packageDocumentation
 */

// ─── Composition adapters ─────────────────────────────
export { AgentBudgetGate } from "./budget-gate";
export type { AgentBudgetGateConfig } from "./budget-gate";

export {
  ReputationSponsorPolicy,
  BudgetSponsorPolicy,
} from "./sponsor-policy-adapters";
export type {
  ReputationSponsorPolicyConfig,
  BudgetSponsorPolicyConfig,
} from "./sponsor-policy-adapters";

// ─── Demo fixtures ────────────────────────────────────
export {
  SimulatedEnclave,
  SimulatedAnchorChain,
  SimulatedBudgetClient,
  SimulatedFireblocksClient,
} from "./demo-fixtures";

// ─── End-to-end demo ──────────────────────────────────
export { runEndToEndDemo } from "./end-to-end-demo";
export type {
  EndToEndDemoConfig,
  EndToEndDemoResult,
  DemoStageEvent,
} from "./end-to-end-demo";

// ─── Solver-trio demo ─────────────────────────────────
export { runSolverTrioDemo } from "./solver-trio-demo";
export type {
  SolverTrioDemoConfig,
  SolverTrioDemoResult,
  SolverTrioIntentResult,
} from "./solver-trio-demo";

// ─── Institutional compliance pipeline demo ───────────────
//
// Sibling to runSolverTrioDemo. Where the trio demo exercises
// composition breadth across three intent kinds, this demo
// exercises compliance depth across a single transaction class —
// institutional cross-jurisdictional transfers routed through a
// tier-1 custodian. Returns a structured result suitable for a
// CLI binary, HTML dashboard, or SOC-2 evidence snapshot.

export { runInstitutionalComplianceDemo } from "./institutional-compliance-demo";
export type {
  InstitutionalComplianceDemoConfig,
  InstitutionalComplianceDemoMode,
  InstitutionalComplianceDemoResult,
  InstitutionalComplianceDemoTransaction,
} from "./institutional-compliance-demo";

// ─── HTML dashboard renderer ──────────────────────────
export { renderHtmlDashboard } from "./render-html";
export type { RenderHtmlDashboardOptions } from "./render-html";
