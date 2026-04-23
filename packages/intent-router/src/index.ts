/**
 * `@aethelred/wallet-intent-router` — EIP-712 typed intents + solver
 * marketplace.
 *
 * Agents declare outcomes ("transfer X to Y", "swap A for ≥ B",
 * "pay merchant M for resource R"); solvers compete on price, speed,
 * and reputation; the router picks a winner and verifies the fill.
 *
 * The full pipeline:
 *
 *     createSignedIntent() ──┐
 *                            ├──> router.execute()
 *                            │     │
 *                            │     ├──> verifyIntentSignature()
 *                            │     ├──> paymentGate.evaluate()   (payment only)
 *                            │     ├──> registry.listFor(kind)
 *                            │     ├──> solvers.quote(...)
 *                            │     ├──> pickBest(quotes, intent, comparator)
 *                            │     ├──> winner.settle()
 *                            │     └──> verifyFillAgainstQuote()
 *                            │
 *                            └──> AuditSink (every stage)
 *
 * @packageDocumentation
 */

// ─── Types ──────────────────────────────────────────────────────
export type {
  Intent,
  IntentBody,
  IntentEnvelope,
  IntentKind,
  IntentExecutionResult,
  IntentRouterAuditEvent,
  TransferIntentBody,
  SwapIntentBody,
  PaymentIntentBody,
  Quote,
  QuoteComparator,
  Fill,
  Solver,
  SolverRegistry,
  AuditSink,
  TypedDataDomain,
  TypedDataField,
  TypedDataSigner,
} from "./types";

// ─── Errors ─────────────────────────────────────────────────────
export {
  IntentRouterError,
  NoQuotesError,
  FillMismatchError,
} from "./errors";
export type { IntentRouterErrorCode } from "./errors";

// ─── EIP-712 layer ──────────────────────────────────────────────
export {
  INTENT_DOMAIN_NAME,
  INTENT_DOMAIN_VERSION,
  INTENT_STRUCTS,
  intentDomain,
  buildUnsignedIntentRequest,
} from "./eip712-intents";

// ─── Envelope factory ──────────────────────────────────────────
export {
  createSignedIntent,
  verifyIntentSignature,
  assertIntentFresh,
} from "./intent-envelope";
export type { CreateSignedIntentOptions } from "./intent-envelope";

// ─── Solver registry + comparators ─────────────────────────────
export {
  InMemorySolverRegistry,
  bestPrice,
  fastestFill,
  composite,
  pickBest,
} from "./solver-registry";
export type { CompositeWeights } from "./solver-registry";

// ─── Router ────────────────────────────────────────────────────
export {
  IntentRouter,
  InMemoryNonceStore,
  verifyFillAgainstQuote,
} from "./router";
export type {
  IntentRouterConfig,
  NonceStore,
  PaymentGate,
  PaymentGateResult,
} from "./router";

// ─── Reputation gate adapter ───────────────────────────────────
export { ReputationPaymentGate } from "./reputation-gate";
export type { ReputationPaymentGateConfig } from "./reputation-gate";
