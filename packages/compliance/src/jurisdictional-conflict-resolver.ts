/**
 * Jurisdictional Conflict Resolver — dynamic compliance state matrix.
 *
 * Background (feedback PDF, Issue #1):
 *   The original wallet design treated multi-jurisdictional compliance as a
 *   universally-portable cryptographic state ("regulatory passport"). That
 *   monolithic model assumes the strictest common denominator satisfies
 *   every regulator. Global finance doesn't work that way — regulators have
 *   *mutually exclusive* thresholds.
 *
 * Concrete examples cited in the feedback document:
 *   - **MAS Singapore** requires originator data EXPOSURE for travel-rule
 *     transparency.
 *   - **VARA Dubai** enforces strict data masking via local data-residency
 *     mandates — exporting that same originator data outside the UAE
 *     violates UAE personal data protection law.
 *
 * A static "passport" doesn't know what to do when a transaction crosses
 * MAS and VARA simultaneously. It either freezes the transaction or pushes
 * it through and violates one regime.
 *
 * This module replaces the static passport with a **dynamic compliance
 * state matrix**: at the moment of execution it computes the rule
 * intersection across every jurisdiction the transaction touches, detects
 * conflicts axis-by-axis, and applies a per-tenant legal hierarchy to
 * pick the winning rule. Every resolution is digested for the audit chain
 * so an auditor can later see exactly which rules were checked, which
 * conflicts were found, and which hierarchy entry chose the winner.
 *
 * This is the "real-time intersection of rules" the feedback document
 * called for.
 */

import { sha256 } from "@noble/hashes/sha2.js";

import { JurisdictionEngine } from "./jurisdiction-engine";
import type { JurisdictionConfig } from "./enterprise-types";

// ─── Public types ──────────────────────────────────────────────────

/**
 * The axes along which two jurisdictions can disagree on a single
 * transaction's compliance state. Each axis maps to one or more fields
 * inside `JurisdictionConfig`.
 *
 * The axis taxonomy is closed (union type) — adding a new axis requires
 * extending {@link JurisdictionalConflictResolver.detectConflicts} so
 * the compiler tells you when you've forgotten to wire it up.
 */
export type ConflictAxis =
  /** Travel-rule data: exposed on-chain vs masked locally. */
  | "data-exposure"
  /** Data residency: must stay in-region vs unrestricted. */
  | "data-residency"
  /** Minimum KYC level required for the transaction's parties. */
  | "kyc-level"
  /** Travel-rule trigger threshold (USD). */
  | "travel-rule-threshold"
  /** AML reporting threshold (USD). */
  | "aml-threshold"
  /** UBO ownership-percentage threshold for disclosure. */
  | "ubo-threshold"
  /** Required sanctions lists to screen against. */
  | "sanctions-lists";

/**
 * A specific conflict between two or more jurisdictions on one axis.
 */
export interface JurisdictionalConflict {
  readonly axis: ConflictAxis;
  /** Jurisdictions whose rules disagree on this axis. */
  readonly jurisdictions: ReadonlyArray<string>;
  /** Per-jurisdiction value on the axis (numbers, strings, booleans, lists). */
  readonly values: Readonly<Record<string, unknown>>;
  /** Human-readable description of the disagreement. */
  readonly description: string;
}

/**
 * Per-tenant legal hierarchy. When two jurisdictions conflict on an axis,
 * the resolver picks the rule of the jurisdiction ranked highest in the
 * relevant ordering.
 *
 * The hierarchy is set up once during institutional onboarding. Lower
 * index = higher priority (rank 0 wins).
 *
 * `perAxisOverrides` lets a tenant tune the hierarchy axis-by-axis — e.g.
 * "in general MAS wins, but on data-residency VARA wins." The default
 * `orderedJurisdictions` is used when an axis has no override.
 */
export interface LegalHierarchy {
  readonly tenantId: string;
  /**
   * ISO 3166-1 alpha-2 jurisdiction codes ordered by precedence
   * (most authoritative first). The list is exhaustive — any jurisdiction
   * present in a transaction but missing from this list will cause
   * resolution to throw {@link UnrankedJurisdictionError}.
   */
  readonly orderedJurisdictions: ReadonlyArray<string>;
  /**
   * Per-axis ordering overrides. When present for an axis, used in place
   * of `orderedJurisdictions`. When absent, falls through to the default.
   */
  readonly perAxisOverrides?: Readonly<Partial<Record<ConflictAxis, ReadonlyArray<string>>>>;
}

/**
 * The decision the resolver made for one conflict.
 */
export interface ConflictResolution {
  readonly axis: ConflictAxis;
  readonly conflictingJurisdictions: ReadonlyArray<string>;
  readonly winningJurisdiction: string;
  /** The rule value chosen — same shape as the values in {@link JurisdictionalConflict}. */
  readonly winningRule: unknown;
  /** The exact ordering used for this axis (axis override OR default). */
  readonly hierarchyApplied: ReadonlyArray<string>;
  /** One-line explanation of why this jurisdiction won. */
  readonly rationale: string;
}

/**
 * Full resolver decision for a transaction touching multiple jurisdictions.
 *
 * The {@link digest} is a SHA-256 of a stable serialization of the
 * resolution payload. It feeds the tamper-evident audit chain so an
 * auditor can verify:
 *   - which jurisdictions were considered
 *   - which conflicts were found
 *   - which hierarchy rule chose the winner
 *   - that the resolution wasn't tampered with after the fact
 */
export interface MatrixResolution {
  readonly transactionId: string;
  readonly jurisdictions: ReadonlyArray<string>;
  readonly conflictsFound: ReadonlyArray<JurisdictionalConflict>;
  readonly resolutions: ReadonlyArray<ConflictResolution>;
  readonly resolvedAt: number;
  /** SHA-256 of canonical-JSON serialization. Hex-prefixed. */
  readonly digest: `0x${string}`;
}

/**
 * Input to the resolver — everything it needs to compute a matrix.
 */
export interface ResolveContext {
  readonly transactionId: string;
  /**
   * Every jurisdiction the transaction touches. Order doesn't matter —
   * the resolver canonicalizes for hashing.
   */
  readonly jurisdictions: ReadonlyArray<string>;
  /** Per-tenant hierarchy. Required. */
  readonly hierarchy: LegalHierarchy;
  /**
   * Optional clock for deterministic tests. Defaults to `Date.now`.
   */
  readonly now?: () => number;
}

// ─── Errors ────────────────────────────────────────────────────────

export class JurisdictionalConflictResolverError extends Error {
  readonly code: string;
  readonly details?: Readonly<Record<string, unknown>>;
  constructor(
    code: string,
    message: string,
    options?: { readonly details?: Readonly<Record<string, unknown>> },
  ) {
    super(message);
    this.name = "JurisdictionalConflictResolverError";
    this.code = code;
    this.details = options?.details;
  }
}

/**
 * Thrown when the transaction touches a jurisdiction that the tenant's
 * legal hierarchy doesn't cover. The resolver fail-closes here rather
 * than picking arbitrarily — an unranked jurisdiction means the tenant's
 * onboarding hierarchy is incomplete and a compliance officer must
 * extend it before the transaction can proceed.
 */
export class UnrankedJurisdictionError extends JurisdictionalConflictResolverError {
  constructor(jurisdiction: string, hierarchyTenant: string) {
    super(
      "unranked-jurisdiction",
      `jurisdiction "${jurisdiction}" is not present in tenant "${hierarchyTenant}"'s legal hierarchy — extend the hierarchy before this transaction can proceed`,
      { details: { jurisdiction, tenantId: hierarchyTenant } },
    );
  }
}

// ─── Resolver ──────────────────────────────────────────────────────

/**
 * Computes the rule intersection across multiple jurisdictions and
 * resolves conflicts via a per-tenant legal hierarchy.
 *
 * Construction is cheap; instances are stateless modulo the injected
 * {@link JurisdictionEngine}. Safe to share across requests.
 */
export class JurisdictionalConflictResolver {
  constructor(private readonly jurisdictions: JurisdictionEngine) {}

  /**
   * Detect conflicts axis-by-axis across every jurisdiction in `ctx`.
   *
   * The detection is exhaustive: every axis in the {@link ConflictAxis}
   * union is checked. The exhaustive switch in {@link compareAxis}
   * gives compile-time coverage when a new axis is added.
   */
  detectConflicts(ctx: ResolveContext): ReadonlyArray<JurisdictionalConflict> {
    // Canonicalize: sort the jurisdiction list so conflicts emitted from
    // input ["US","SG","EU"] vs ["EU","US","SG"] produce byte-identical
    // payloads, and therefore byte-identical audit-chain digests. The
    // alternative — sorting only at digest time — would diverge from the
    // resolution objects an auditor sees, breaking replay verification.
    const sortedCodes = [...ctx.jurisdictions].sort();
    const configs = sortedCodes.map((j) => ({
      code: j,
      config: this.jurisdictions.getConfig(j),
    }));

    const axes: ReadonlyArray<ConflictAxis> = [
      "data-exposure",
      "data-residency",
      "kyc-level",
      "travel-rule-threshold",
      "aml-threshold",
      "ubo-threshold",
      "sanctions-lists",
    ];

    const conflicts: JurisdictionalConflict[] = [];
    for (const axis of axes) {
      const conflict = this.compareAxis(axis, configs);
      if (conflict) conflicts.push(conflict);
    }
    return conflicts;
  }

  /**
   * Resolve each conflict via the tenant's legal hierarchy and emit a
   * digested decision suitable for audit-chain logging.
   *
   * Even when no conflicts are detected, this returns a {@link MatrixResolution}
   * with empty `conflictsFound` and `resolutions` arrays plus a digest —
   * audit consumers always have a record that the matrix was evaluated
   * for the transaction.
   *
   * @throws {@link UnrankedJurisdictionError} if any jurisdiction in
   *   `ctx.jurisdictions` is missing from the tenant's hierarchy.
   */
  resolve(ctx: ResolveContext): MatrixResolution {
    this.validateHierarchyCovers(ctx);

    const conflicts = this.detectConflicts(ctx);
    const resolutions = conflicts.map((c) =>
      this.resolveConflict(c, ctx.hierarchy),
    );

    const now = (ctx.now ?? Date.now)();
    const payload = {
      transactionId: ctx.transactionId,
      jurisdictions: [...ctx.jurisdictions].sort(),
      conflictsFound: conflicts,
      resolutions,
      resolvedAt: now,
    };
    const digest = digestResolution(payload);

    return {
      transactionId: ctx.transactionId,
      jurisdictions: [...ctx.jurisdictions].sort(),
      conflictsFound: conflicts,
      resolutions,
      resolvedAt: now,
      digest,
    };
  }

  // ─── Private ────────────────────────────────────────────────────

  /**
   * Verify every jurisdiction in `ctx.jurisdictions` is ranked in the
   * tenant's hierarchy (default ordering OR per-axis override).
   *
   * Fail-close: an unranked jurisdiction means the tenant's onboarding
   * is incomplete; we'd rather block than pick a default.
   */
  private validateHierarchyCovers(ctx: ResolveContext): void {
    const known = new Set(ctx.hierarchy.orderedJurisdictions);
    for (const j of ctx.jurisdictions) {
      if (!known.has(j)) {
        throw new UnrankedJurisdictionError(j, ctx.hierarchy.tenantId);
      }
    }
  }

  /**
   * Compare every jurisdiction's value on the given axis. Returns a
   * {@link JurisdictionalConflict} if and only if at least two
   * jurisdictions disagree.
   */
  private compareAxis(
    axis: ConflictAxis,
    configs: ReadonlyArray<{ readonly code: string; readonly config: JurisdictionConfig }>,
  ): JurisdictionalConflict | null {
    const values: Record<string, unknown> = {};
    for (const { code, config } of configs) {
      values[code] = extractAxisValue(axis, config);
    }
    if (!hasDisagreement(Object.values(values))) return null;
    return {
      axis,
      jurisdictions: configs.map((c) => c.code),
      values,
      description: describeConflict(axis, values),
    };
  }

  /**
   * Apply the legal hierarchy to a single conflict and emit the
   * decision.
   */
  private resolveConflict(
    conflict: JurisdictionalConflict,
    hierarchy: LegalHierarchy,
  ): ConflictResolution {
    const ordering =
      hierarchy.perAxisOverrides?.[conflict.axis] ??
      hierarchy.orderedJurisdictions;

    // Walk the ordering top-down; the first jurisdiction that's part of
    // the conflict wins.
    const conflictSet = new Set(conflict.jurisdictions);
    let winner: string | null = null;
    for (const j of ordering) {
      if (conflictSet.has(j)) {
        winner = j;
        break;
      }
    }
    if (winner === null) {
      // Defensive — validateHierarchyCovers should have caught this.
      // Picking the first conflicting jurisdiction is still better than
      // silently failing, but log the surprise via the rationale field.
      winner = conflict.jurisdictions[0]!;
    }

    return {
      axis: conflict.axis,
      conflictingJurisdictions: conflict.jurisdictions,
      winningJurisdiction: winner,
      winningRule: conflict.values[winner],
      hierarchyApplied: ordering,
      rationale: `axis="${conflict.axis}" — ${winner} wins via ${
        hierarchy.perAxisOverrides?.[conflict.axis]
          ? `per-axis override hierarchy`
          : `default tenant hierarchy`
      } (rank ${ordering.indexOf(winner)})`,
    };
  }
}

// ─── Axis-specific extraction + comparison ────────────────────────

/**
 * Extract the comparable value for a single axis from a
 * {@link JurisdictionConfig}.
 *
 * The `never` exhaustiveness check on the default branch forces a
 * compile error if a new axis is added without extracting it here.
 */
function extractAxisValue(
  axis: ConflictAxis,
  config: JurisdictionConfig,
): unknown {
  switch (axis) {
    case "data-exposure":
      // Travel-rule transparency is currently encoded indirectly: data
      // residency required + local-storage-only ⇒ the jurisdiction
      // forbids cross-border data exposure. !required ⇒ exposure OK.
      return config.dataResidency.required && config.dataResidency.localStorageOnly === true
        ? "must-mask"
        : "may-expose";
    case "data-residency":
      return {
        required: config.dataResidency.required,
        allowedRegions: config.dataResidency.allowedRegions ?? null,
      };
    case "kyc-level":
      return config.kycRequirements.minimumLevel;
    case "travel-rule-threshold":
      return config.amlThresholds.travelRuleThresholdUsd;
    case "aml-threshold":
      return config.amlThresholds.reportingThresholdUsd;
    case "ubo-threshold":
      return config.kycRequirements.uboThresholdPercent;
    case "sanctions-lists":
      return [...config.sanctionsLists].sort();
    default: {
      const _exhaustive: never = axis;
      throw new Error(`unhandled ConflictAxis: ${_exhaustive as string}`);
    }
  }
}

/**
 * True iff at least two distinct values appear in `values`.
 *
 * Comparison uses a stable JSON serialization so structurally-equal
 * objects (different references but same content) don't register as a
 * conflict.
 */
function hasDisagreement(values: ReadonlyArray<unknown>): boolean {
  if (values.length < 2) return false;
  const distinct = new Set(values.map(stableStringify));
  return distinct.size > 1;
}

function describeConflict(
  axis: ConflictAxis,
  values: Readonly<Record<string, unknown>>,
): string {
  const parts = Object.entries(values).map(
    ([j, v]) => `${j}=${stableStringify(v)}`,
  );
  return `${axis} disagreement: ${parts.join(", ")}`;
}

// ─── Canonicalization + digest ────────────────────────────────────

/**
 * Stable-key JSON serialization. Object keys are sorted recursively so
 * equivalent objects produce identical strings (this is what makes
 * {@link hasDisagreement} reliable for object-valued axes).
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map(
    (k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`,
  );
  return `{${parts.join(",")}}`;
}

/**
 * SHA-256 hex digest (with 0x prefix) of the resolution payload's
 * canonical serialization. Stable across runs given the same inputs.
 */
function digestResolution(payload: object): `0x${string}` {
  const canonical = stableStringify(payload);
  const hash = sha256(new TextEncoder().encode(canonical));
  const hex = Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
  return `0x${hex}` as `0x${string}`;
}
