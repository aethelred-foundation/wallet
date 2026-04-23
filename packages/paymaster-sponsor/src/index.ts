/**
 * `@aethelred/wallet-paymaster-sponsor` — USDC gas sponsorship for
 * ERC-4337 UserOperations.
 *
 * The sponsor service sits between bundler / wallet and the on-chain
 * VerifyingPaymaster contract. Prices gas in USDC, evaluates sponsor
 * policy (rate-limits, blocklists, VC gates), signs an approval. The
 * service never custodies user funds — the paymaster contract
 * settles both sides atomically at UserOp execution time.
 *
 * @packageDocumentation
 */

// ─── Types ────────────────────────────────────────────────────
export type {
  PriceQuote,
  PriceOracle,
  SponsorshipRequest,
  SponsorshipApproval,
  SponsorshipRecord,
  SponsorshipStatus,
  SponsorPolicy,
  PolicyContext,
  PolicyResult,
  SettlementLedger,
  SerializedVcGate,
} from "./types";

// ─── Errors ───────────────────────────────────────────────────
export { PaymasterSponsorError } from "./errors";
export type { PaymasterSponsorErrorCode } from "./errors";

// ─── Price oracle ─────────────────────────────────────────────
export {
  FixedPriceOracle,
  CachingPriceOracle,
  PRICE_SCALE,
  buildQuote,
  assertQuoteFresh,
} from "./price-oracle";
export type {
  FixedPriceOracleConfig,
  CachingPriceOracleConfig,
} from "./price-oracle";

// ─── Gas pricer ───────────────────────────────────────────────
export { GasPricer, scalePrice } from "./gas-pricer";
export type { GasPricerConfig, PricedOperation } from "./gas-pricer";

// ─── Settlement ledger ────────────────────────────────────────
export { InMemorySettlementLedger } from "./settlement-ledger";

// ─── Policies ─────────────────────────────────────────────────
export {
  KillSwitchPolicy,
  AgentBlocklistPolicy,
  RateLimitPolicy,
  MaxPerRequestPolicy,
  CustomPredicatePolicy,
  CompositeSponsorPolicy,
} from "./sponsor-policy";
export type { RateLimitConfig } from "./sponsor-policy";

// ─── Paymaster signer ─────────────────────────────────────────
export {
  PaymasterSigner,
  buildApprovalDigest,
  encodePaymasterData,
  decodePaymasterData,
} from "./paymaster-signer";
export type { PaymasterSignerConfig, PaymasterSignature } from "./paymaster-signer";

// ─── Sponsor service ──────────────────────────────────────────
export { SponsorService, buildRequestId } from "./sponsor-service";
export type { SponsorServiceConfig } from "./sponsor-service";
