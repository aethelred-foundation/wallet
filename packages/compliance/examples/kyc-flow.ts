/**
 * Example: end-to-end KYC verification flow.
 *
 * Models the onboarding of a corporate customer (Acme Holdings Ltd, a UK
 * limited company) from profile creation through document upload, level
 * upgrade, and verification. Demonstrates:
 *
 *   1. Profile creation scoped to a regulated jurisdiction (GB).
 *   2. Document evidence capture — the SDK stores content hashes, not the
 *      documents themselves, so the caller owns the document store.
 *   3. Risk-factor tagging and re-assessment.
 *   4. Level upgrade from `standard` → `enhanced` once source-of-funds is
 *      required by the corporate tier.
 *   5. Completion of the verification update from an external vendor.
 *   6. Defensive error handling around the not-found case.
 *
 * The example is self-contained and can be run with `tsx`, `bun`, or any
 * other TypeScript runner, once the package is linked.
 */

import { KycManager } from "../src/index";
import type { KycProfile, KycDocument, RiskFactor } from "../src/index";

/**
 * Drive the KYC flow end-to-end.
 *
 * Returned value is the final profile so tests or demos can assert on it.
 */
export function runKycFlow(): KycProfile {
  // 1. Instantiate a manager. In production this would be a workspace-scoped
  //    singleton backed by your persistent store via `toSnapshot` /
  //    `loadFromSnapshot`.
  const kyc: KycManager = new KycManager();

  // 2. Create a profile for a UK corporation.
  const profile: KycProfile = kyc.createProfile(
    "subject-acme-holdings-ltd",
    "corporation",
    "GB",
  );

  // 3. Upload supporting documents. Only the SHA-256 hash is retained in the
  //    SDK; the document contents should be stored in your evidence vault.
  const incorporation: KycDocument = kyc.addDocument(profile.id, {
    type: "incorporation-cert",
    hash: "sha256:7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069",
  });

  const shareholderRegister: KycDocument = kyc.addDocument(profile.id, {
    type: "shareholder-register",
    hash: "sha256:2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae",
  });

  // Every document uploaded is returned with SDK-generated id + timestamp so
  // the caller can wire UI state to it.
  console.log(
    `Captured documents: ${incorporation.type} (${incorporation.id}), ` +
      `${shareholderRegister.type} (${shareholderRegister.id})`,
  );

  // 4. Tag a risk factor. Here we flag that the company has operations in a
  //    jurisdiction currently on an internal watchlist. The risk-rating is
  //    recomputed automatically.
  const watchlistFactor: Omit<RiskFactor, "detectedAt" | "mitigated"> = {
    category: "jurisdiction",
    level: "medium",
    description: "Active subsidiary in watchlisted jurisdiction (RU)",
  };
  kyc.addRiskFactor(profile.id, watchlistFactor);

  // 5. Submit the profile for vendor verification (Sumsub / Onfido / Jumio /
  //    Veriff / in-house). Status moves to `pending`.
  kyc.submitForVerification(profile.id);

  // 6. Upgrade to enhanced tier — corporate customers require source of
  //    funds. Because source-of-funds is not yet verified the manager puts
  //    status back to `pending` until the vendor returns results.
  kyc.upgradeLevel(profile.id, "enhanced");

  // 7. Vendor returns a clean result. Apply the update.
  kyc.updateVerification(profile.id, {
    identityVerified: true,
    addressVerified: true,
    sourceOfFundsVerified: true,
    sanctionsScreened: true,
    pepScreened: true,
  });

  // 8. Guard against downstream use. `isVerified` checks both status and
  //    expiry; if the profile has expired, callers should trigger re-KYC.
  if (!kyc.isVerified(profile.id)) {
    throw new Error(
      `KYC profile ${profile.id} failed to verify; current status=${profile.status}`,
    );
  }

  // 9. Demonstrate error handling around an unknown profile — the manager
  //    throws a typed error with a predictable message so callers can log
  //    it without having to introspect stack traces.
  try {
    kyc.getProfile("kyc-does-not-exist");
  } catch (err: unknown) {
    // The SDK throws `Error` with a deterministic message prefix. Keep the
    // check loose so we are resilient to future message refinements.
    const message: string = err instanceof Error ? err.message : String(err);
    console.warn(`Expected lookup failure: ${message}`);
  }

  // 10. Return the fully verified profile.
  return kyc.getProfile(profile.id);
}

// Allow `node --loader tsx examples/kyc-flow.ts`-style direct execution.
// The strict Node check keeps this file importable from tests without
// re-running the demo.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("kyc-flow.ts")) {
  const finalProfile: KycProfile = runKycFlow();
  console.log(
    `Final profile: id=${finalProfile.id} level=${finalProfile.level} ` +
      `status=${finalProfile.status} risk=${finalProfile.riskRating}`,
  );
}
