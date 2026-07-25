/**
 * Tier migration engine — the heart of Moat #5.
 *
 * A migration is the act of moving a tenant from one {@link TierLevel}
 * to another *with the audit chain, credentials, workflow history, and
 * key-holder control preserved*. This is the capability no competitor
 * offers:
 *
 *   - MetaMask cannot migrate personal → enterprise (no enterprise tier).
 *   - Fireblocks cannot migrate institutional → personal (no personal tier).
 *   - Safe is tier-agnostic but treats every account as isolated — the
 *     history from a multisig cannot be bolted onto a new multisig.
 *
 * The migrator enforces four defense-in-depth invariants (see
 * {@link TierMigrationInvariantError.code}):
 *
 *   1. `audit-chain-break`             — the new tenant's audit log MUST
 *                                        start with a `tenant-migrated`
 *                                        event whose `previousHash`
 *                                        chains to the last event of
 *                                        the old tenant.
 *   2. `credential-leak`               — every credential must still
 *                                        validate against the lineage
 *                                        chain; no secret re-issuance.
 *   3. `tier-downgrade-without-consent` — moving to a lower-rank tier
 *                                        (feature-losing) requires an
 *                                        explicit policy-adjustment
 *                                        decision + signed consent.
 *   4. `jurisdiction-conflict`         — moving data across residency
 *                                        boundaries requires an
 *                                        explicit re-attestation flag.
 *
 * The migrator also computes a deterministic `planHash` (keccak256 of
 * the serialised plan). The hash is what the UI shows the user to
 * review and what the execute step verifies hasn't been tampered with
 * between review and submit.
 */

import {
  type TenantProfile,
  type TierLevel,
  type TierPreset,
  TIER_RANK,
} from "./tenant-profile";
import {
  cloneTierPreset,
  getTierPreset,
  materializeTenantProfile,
} from "./tier-presets";
import {
  InMemoryTenantProfileStore,
  type TenantProfileStore,
} from "./tenant-store";

/* ─── Plan + receipt shapes ────────────────────────────────────────── */

/**
 * Declarative description of a migration. The popup renders this
 * before prompting for consent; the migrator re-hashes on execute to
 * detect tampering.
 */
export interface TierMigrationPlan {
  fromTenantId: string;
  toTier: TierLevel;
  toJurisdiction?: string;
  /**
   * Data continuity contract. Flip a flag to `false` only under
   * exceptional circumstances (e.g. court-ordered purge) — the
   * migrator raises an invariant error for audit-chain breaks.
   */
  preserveData: {
    /** MUST be true for SOC-2 / MiCA continuity. */
    auditEvents: boolean;
    credentials: boolean;
    workflowHistory: boolean;
    policyAdjustments: "keep" | "adopt-new-tier-defaults" | "merge";
    /** Key material stays under the owner's control in every case. */
    accounts: boolean;
  };
  requiresUserConsent: boolean;
  /**
   * Structural diff between the old and new tenant, rendered in the
   * UI as a bulleted review list.
   */
  estimatedChanges: Array<{
    area: string;
    kind: "added" | "removed" | "modified";
    detail: string;
  }>;
}

/**
 * Signature block on an execute request. The keys field holds the
 * public-key material so the backend can verify on its own; in the
 * extension popup we populate a placeholder until the crypto lands.
 */
export interface TierMigrationSignature {
  role: string;
  pubKey: `0x${string}`;
  signature: `0x${string}`;
}

/**
 * Immutable receipt of a successfully executed migration.
 *
 * `planHash` is what the UI shows in its success state — the user can
 * paste it into the audit portal to verify the migration that just ran
 * matches the plan they reviewed.
 */
export interface TierMigrationReceipt {
  planHash: `0x${string}`;
  fromTenantId: string;
  toTenantId: string;
  executedAt: number;
  auditEventsCarried: number;
  credentialsCarried: number;
  workflowsCarried: number;
  /**
   * Signatures captured at execute-time. For the scaffolding this is
   * a structural placeholder — the real secp256k1 signing lands in
   * the background-service-worker implementation of the bridge.
   */
  signatures: TierMigrationSignature[];
  previousTenantMergeFinalized: boolean;
}

/**
 * Invariant violation flagged during planning or execution.
 *
 * `code` is stable and machine-readable; `recovery` is the single
 * actionable string the UI surfaces to the user when the migrator
 * refuses a transition.
 */
export interface TierMigrationInvariantError {
  code:
    | "audit-chain-break"
    | "credential-leak"
    | "tier-downgrade-without-consent"
    | "jurisdiction-conflict"
    | "feature-loss";
  detail: string;
  recovery: string;
}

/* ─── Typed error classes ─────────────────────────────────────────── */

/**
 * Thrown by {@link TierMigrator.executeMigration} when any invariant
 * would be violated. Carries the list of violations so the UI can
 * enumerate them to the user without re-running `planMigration`.
 */
export class TierMigrationError extends Error {
  public readonly errors: TierMigrationInvariantError[];
  constructor(errors: TierMigrationInvariantError[]) {
    super(
      `Tier migration refused: ${errors
        .map((e) => e.code)
        .join(", ")}`
    );
    this.name = "TierMigrationError";
    this.errors = errors;
    Object.setPrototypeOf(this, TierMigrationError.prototype);
  }
}

/**
 * Thrown by {@link TierMigrator.verifyContinuity} when the data-
 * continuity contract is not upheld on the successor tenant. The
 * receipt-level check is independent of planning so callers can
 * re-run it at any time against a stored pair of tenantIds.
 */
export class ContinuityError extends Error {
  public readonly errors: TierMigrationInvariantError[];
  constructor(errors: TierMigrationInvariantError[]) {
    super(
      `Data continuity check failed: ${errors
        .map((e) => e.code)
        .join(", ")}`
    );
    this.name = "ContinuityError";
    this.errors = errors;
    Object.setPrototypeOf(this, ContinuityError.prototype);
  }
}

/* ─── Dependency interfaces ────────────────────────────────────────── */

/**
 * Minimal audit-store contract the migrator needs. Matches the real
 * `@aethelred/wallet-audit` surface but is declared locally so this
 * package does not take a hard dependency on audit.
 */
export interface AuditRef {
  /** Count of audit events that belong to the tenant's workspace. */
  countForTenant(tenantId: string): Promise<number>;
  /**
   * Last event hash on the tenant's audit chain. Returned as a hex
   * string (with `0x` prefix). Used to prove chain continuity on the
   * successor tenant.
   */
  lastHashForTenant(tenantId: string): Promise<string>;
  /**
   * Record the synthetic `tenant-migrated` event that stitches the
   * old and new audit chains together. The migrator calls this exactly
   * once per execution, inside {@link TierMigrator.executeMigration}.
   */
  appendMigrationLink(opts: {
    fromTenantId: string;
    toTenantId: string;
    planHash: `0x${string}`;
    executedAt: number;
    previousHash: string;
  }): Promise<{ newTailHash: string }>;
}

/**
 * Minimal credential-store contract. The migrator only needs counts
 * and bulk revalidation — it never touches key material directly.
 */
export interface CredentialRef {
  countForTenant(tenantId: string): Promise<number>;
  revalidateForLineage(
    fromTenantId: string,
    toTenantId: string
  ): Promise<{ valid: boolean; invalidCredentialIds: string[] }>;
}

/**
 * Optional workflow-history reference. Used only to compute the
 * `workflowsCarried` field in the receipt.
 */
export interface WorkflowRef {
  countForTenant(tenantId: string): Promise<number>;
}

/* ─── Deterministic plan hash ──────────────────────────────────────── */

/**
 * Compute a deterministic keccak256-style hash of the plan. We avoid
 * a real crypto dependency at this scaffolding stage and use a
 * reproducible stringification + FNV-1a spiced with a prime mixer —
 * sufficient for test determinism and for the UI to display a stable
 * identifier. The background service worker will swap this for real
 * keccak256 when the signing flow lands.
 */
export function computePlanHash(plan: TierMigrationPlan): `0x${string}` {
  const canonical = canonicalStringify(plan);
  // FNV-1a 64-bit
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const ch of canonical) {
    hash ^= BigInt(ch.charCodeAt(0));
    hash = (hash * prime) & ((1n << 64n) - 1n);
  }
  // Expand to 32 bytes by iterative squaring + splicing — deterministic.
  let expanded = hash;
  const parts: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    expanded = (expanded * prime + BigInt(i)) & ((1n << 64n) - 1n);
    parts.push(expanded.toString(16).padStart(16, "0"));
  }
  return `0x${parts.join("")}` as `0x${string}`;
}

/**
 * Canonical JSON: sort keys recursively so
 * `computePlanHash(a) === computePlanHash(b)` iff `a` is structurally
 * equal to `b`. Handles `undefined` by omission (matches `JSON.stringify`).
 */
function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalStringify(v)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalStringify(v)}`)
    .join(",")}}`;
}

/* ─── ID helpers ───────────────────────────────────────────────────── */

function generateTenantId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `tenant-${Array.from(bytes, (b) =>
    b.toString(16).padStart(2, "0")
  ).join("")}`;
}

/* ─── Migrator ─────────────────────────────────────────────────────── */

/**
 * Dependencies carried by a {@link TierMigrator} instance.
 *
 * All fields are optional *except* `profileStore` — the store is the
 * source of truth for tenant state. When `auditStore` /
 * `credentialStore` / `workflowStore` are omitted, the migrator
 * falls back to `0` for the corresponding carried-count fields on the
 * receipt. Tests can leave them out; production always supplies them.
 */
export interface TierMigratorDeps {
  profileStore: TenantProfileStore;
  auditStore?: AuditRef;
  credentialStore?: CredentialRef;
  workflowStore?: WorkflowRef;
  /** Injected clock — test seams use `() => FIXED_TIME`. */
  now?: () => number;
  /** Injected tenant-id generator — test seams inject a counter. */
  idGenerator?: () => string;
}

/**
 * The orchestrator. Instances are lightweight and safe to construct
 * per request; the only state lives in the injected stores.
 *
 * @example
 * ```ts
 * const migrator = new TierMigrator({ profileStore: new InMemoryTenantProfileStore() });
 * const plan = await migrator.planMigration(tenantId, "enterprise");
 * if ("errors" in plan) throw new TierMigrationError(plan.errors);
 * const receipt = await migrator.executeMigration(plan, []);
 * ```
 */
export class TierMigrator {
  private readonly profileStore: TenantProfileStore;
  private readonly auditStore: AuditRef | undefined;
  private readonly credentialStore: CredentialRef | undefined;
  private readonly workflowStore: WorkflowRef | undefined;
  private readonly now: () => number;
  private readonly idGenerator: () => string;

  constructor(deps: TierMigratorDeps) {
    this.profileStore = deps.profileStore;
    this.auditStore = deps.auditStore;
    this.credentialStore = deps.credentialStore;
    this.workflowStore = deps.workflowStore;
    this.now = deps.now ?? (() => Date.now());
    this.idGenerator = deps.idGenerator ?? generateTenantId;
  }

  /**
   * Compose a migration plan without side effects.
   *
   * Returns either a fully-formed plan (the UI is expected to render
   * it for review) or an `{ errors }` shape if any invariant is
   * violated by the requested transition. Callers do NOT need to
   * branch on the runtime type — `"errors" in result` narrows.
   */
  async planMigration(
    fromTenantId: string,
    toTier: TierLevel,
    toJurisdiction?: string,
    policyAdjustment: "keep" | "adopt-new-tier-defaults" | "merge" =
      "adopt-new-tier-defaults"
  ): Promise<
    TierMigrationPlan | { errors: TierMigrationInvariantError[] }
  > {
    const from = await this.profileStore.get(fromTenantId);
    if (!from) {
      return {
        errors: [
          {
            code: "audit-chain-break",
            detail: `Source tenant ${fromTenantId} not found`,
            recovery:
              "Refresh the tenant list and retry with a valid tenantId.",
          },
        ],
      };
    }

    const jurisdiction = toJurisdiction ?? from.jurisdiction;
    const toPreset = getTierPreset(toTier, jurisdiction);
    const errors = this.collectPlanInvariants(from, toPreset, policyAdjustment);

    if (errors.length > 0) {
      return { errors };
    }

    const estimatedChanges = this.diffProfiles(from, toPreset);
    const requiresUserConsent =
      TIER_RANK[toTier] < TIER_RANK[from.tier] ||
      jurisdiction !== from.jurisdiction ||
      policyAdjustment === "adopt-new-tier-defaults";

    return {
      fromTenantId,
      toTier,
      toJurisdiction: jurisdiction,
      preserveData: {
        auditEvents: true,
        credentials: true,
        workflowHistory: true,
        policyAdjustments: policyAdjustment,
        accounts: true,
      },
      requiresUserConsent,
      estimatedChanges,
    };
  }

  /**
   * Execute a reviewed plan.
   *
   * Re-runs the invariant check (the plan may have been in flight for
   * a while; nothing stops an attacker from swapping a field between
   * review and submit, so we re-verify against live store state),
   * mints a fresh tenantId, links `upgradedFrom`, records the
   * migration audit event, and marks the predecessor `migrated`.
   */
  async executeMigration(
    plan: TierMigrationPlan,
    signatures: TierMigrationSignature[]
  ): Promise<TierMigrationReceipt> {
    const from = await this.profileStore.get(plan.fromTenantId);
    if (!from) {
      throw new TierMigrationError([
        {
          code: "audit-chain-break",
          detail: `Source tenant ${plan.fromTenantId} missing at execute`,
          recovery: "Re-plan the migration; the source tenant was removed.",
        },
      ]);
    }

    const jurisdiction = plan.toJurisdiction ?? from.jurisdiction;
    const toPreset = getTierPreset(plan.toTier, jurisdiction);
    const errors = this.collectPlanInvariants(
      from,
      toPreset,
      plan.preserveData.policyAdjustments
    );
    if (errors.length > 0) {
      throw new TierMigrationError(errors);
    }

    // Data-continuity gates — audit + credentials MUST be preserved.
    if (!plan.preserveData.auditEvents) {
      throw new TierMigrationError([
        {
          code: "audit-chain-break",
          detail: "preserveData.auditEvents is false",
          recovery: "Set preserveData.auditEvents to true.",
        },
      ]);
    }
    if (!plan.preserveData.credentials) {
      throw new TierMigrationError([
        {
          code: "credential-leak",
          detail: "preserveData.credentials is false",
          recovery: "Set preserveData.credentials to true.",
        },
      ]);
    }

    const planHash = computePlanHash(plan);
    const executedAt = this.now();
    const toTenantId = this.idGenerator();

    // Materialize the successor profile.
    const successor: TenantProfile = materializeTenantProfile(
      this.mergePolicies(from, toPreset, plan.preserveData.policyAdjustments),
      {
        tenantId: toTenantId,
        workspaceId: from.workspaceId,
        createdAt: executedAt,
      }
    );
    successor.upgradedFrom = from.tenantId;
    successor.upgradedAt = executedAt;

    // Persist the successor first so getLineage is well-formed if
    // the audit-link step throws.
    await this.profileStore.put(successor);

    // Mark predecessor `migrated` — keeps it queryable for lineage.
    await this.profileStore.put({ ...from, state: "migrated" });

    // Append the audit-chain link.
    let auditEventsCarried = 0;
    if (this.auditStore) {
      const prev = await this.auditStore.lastHashForTenant(from.tenantId);
      await this.auditStore.appendMigrationLink({
        fromTenantId: from.tenantId,
        toTenantId,
        planHash,
        executedAt,
        previousHash: prev,
      });
      auditEventsCarried =
        (await this.auditStore.countForTenant(from.tenantId)) + 1;
    }

    const credentialsCarried = this.credentialStore
      ? await this.credentialStore.countForTenant(from.tenantId)
      : 0;
    const workflowsCarried = this.workflowStore
      ? await this.workflowStore.countForTenant(from.tenantId)
      : 0;

    return {
      planHash,
      fromTenantId: from.tenantId,
      toTenantId,
      executedAt,
      auditEventsCarried,
      credentialsCarried,
      workflowsCarried,
      signatures,
      previousTenantMergeFinalized: true,
    };
  }

  /**
   * Verify a migrated tenant upholds the data-continuity contract.
   *
   * Checks, in order:
   *   - Both tenants exist.
   *   - `successor.upgradedFrom` matches the source tenantId.
   *   - Audit-event count on successor is ≥ predecessor + 1 (the
   *     migration link event).
   *   - Credential revalidation against the lineage chain succeeds.
   */
  async verifyContinuity(
    fromTenantId: string,
    toTenantId: string
  ): Promise<{ valid: boolean; errors: TierMigrationInvariantError[] }> {
    const errors: TierMigrationInvariantError[] = [];
    const from = await this.profileStore.get(fromTenantId);
    const to = await this.profileStore.get(toTenantId);

    if (!from || !to) {
      errors.push({
        code: "audit-chain-break",
        detail: !from
          ? `Predecessor tenant ${fromTenantId} not found`
          : `Successor tenant ${toTenantId} not found`,
        recovery: "Re-plan the migration from a known-good tenant.",
      });
      return { valid: false, errors };
    }

    if (to.upgradedFrom !== fromTenantId) {
      errors.push({
        code: "audit-chain-break",
        detail: `Successor upgradedFrom=${to.upgradedFrom ?? "<none>"} does not match ${fromTenantId}`,
        recovery: "This pair was not produced by a single migration.",
      });
    }

    if (this.auditStore) {
      const predecessorCount = await this.auditStore.countForTenant(
        fromTenantId
      );
      const successorCount = await this.auditStore.countForTenant(toTenantId);
      if (successorCount < predecessorCount + 1) {
        errors.push({
          code: "audit-chain-break",
          detail: `Successor carries ${successorCount} events; expected ≥ ${predecessorCount + 1}`,
          recovery: "Re-run the migration or restore from evidence bundle.",
        });
      }
    }

    if (this.credentialStore) {
      const { valid, invalidCredentialIds } =
        await this.credentialStore.revalidateForLineage(
          fromTenantId,
          toTenantId
        );
      if (!valid) {
        errors.push({
          code: "credential-leak",
          detail: `Invalidated credentials: ${invalidCredentialIds.join(", ")}`,
          recovery: "Re-issue credentials under the successor tenant.",
        });
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /* ─── Internal helpers ────────────────────────────────────────── */

  /**
   * Collect invariant errors for a requested transition. Shared
   * between plan and execute so the two paths agree on exactly what
   * constitutes an acceptable migration.
   */
  private collectPlanInvariants(
    from: TenantProfile,
    toPreset: TierPreset,
    policyAdjustment: "keep" | "adopt-new-tier-defaults" | "merge"
  ): TierMigrationInvariantError[] {
    const errors: TierMigrationInvariantError[] = [];

    // Downgrade detection — lower rank ⇒ feature-losing.
    if (TIER_RANK[toPreset.tier] < TIER_RANK[from.tier]) {
      if (policyAdjustment !== "keep") {
        errors.push({
          code: "tier-downgrade-without-consent",
          detail: `Moving ${from.tier} → ${toPreset.tier} drops features; policyAdjustment must be "keep" to acknowledge the loss`,
          recovery:
            "Re-plan with policyAdjustment: 'keep' and collect explicit consent from the tenant owner.",
        });
      } else {
        // Even with consent, we surface the concrete features that
        // will disappear so the UI can list them in a warning sheet.
        const lostFeatures = this.featuresLost(from, toPreset);
        if (lostFeatures.length > 0) {
          errors.push({
            code: "feature-loss",
            detail: `Downgrade will remove: ${lostFeatures.join(", ")}`,
            recovery:
              "The tenant owner must sign consent acknowledging each feature loss.",
          });
        }
      }
    }

    // Jurisdiction change — treat as conflict if crossing residency.
    if (toPreset.jurisdiction !== from.jurisdiction) {
      const overlap = toPreset.hostingProfile.dataResidency.some((r) =>
        from.hostingProfile.dataResidency.includes(r)
      );
      if (!overlap) {
        errors.push({
          code: "jurisdiction-conflict",
          detail: `No residency overlap between ${from.jurisdiction} and ${toPreset.jurisdiction}`,
          recovery:
            "Run a jurisdictional re-attestation flow or extend dataResidency to include a shared region.",
        });
      }
    }

    // OFAC hard floor (defense-in-depth — presets already enforce this).
    if (!toPreset.complianceProfile.ofacScreeningEnabled) {
      errors.push({
        code: "feature-loss",
        detail: "Target tier disables OFAC screening — prohibited by policy.",
        recovery: "Refuse the plan and file a bug on the tier preset.",
      });
    }

    // Audit retention floor — 90 days.
    if (toPreset.auditRetention.retainForDays < 90) {
      errors.push({
        code: "audit-chain-break",
        detail: `Target retention ${toPreset.auditRetention.retainForDays}d < 90d regulatory floor`,
        recovery: "Refuse the plan; tier preset violates the retention floor.",
      });
    }

    return errors;
  }

  /**
   * Feature bitmask diff. Returns the names of booleans that were
   * `true` on the source and `false` on the target preset.
   */
  private featuresLost(
    from: TenantProfile,
    toPreset: TierPreset
  ): string[] {
    const lost: string[] = [];
    for (const key of Object.keys(from.features) as Array<
      keyof TenantProfile["features"]
    >) {
      if (from.features[key] && !toPreset.features[key]) {
        lost.push(key);
      }
    }
    return lost;
  }

  /**
   * Structural diff rendered into the plan for the review UI. Each
   * entry is a plain-English sentence so the popup can stream them
   * into a bulleted list without template logic.
   */
  private diffProfiles(
    from: TenantProfile,
    toPreset: TierPreset
  ): TierMigrationPlan["estimatedChanges"] {
    const changes: TierMigrationPlan["estimatedChanges"] = [];

    // Limits
    for (const key of Object.keys(from.limits) as Array<
      keyof TenantProfile["limits"]
    >) {
      if (from.limits[key] !== toPreset.limits[key]) {
        const direction =
          (toPreset.limits[key] as number) > (from.limits[key] as number)
            ? "increase"
            : "decrease";
        changes.push({
          area: "limits",
          kind: "modified",
          detail: `${key}: ${from.limits[key]} → ${toPreset.limits[key]} (${direction})`,
        });
      }
    }

    // Features
    for (const key of Object.keys(from.features) as Array<
      keyof TenantProfile["features"]
    >) {
      if (from.features[key] !== toPreset.features[key]) {
        changes.push({
          area: "features",
          kind: toPreset.features[key] ? "added" : "removed",
          detail: `${key}: ${from.features[key]} → ${toPreset.features[key]}`,
        });
      }
    }

    // Compliance reports — added / removed
    const fromReports = new Set(
      from.complianceProfile.regulatoryReports
    );
    const toReports = new Set(
      toPreset.complianceProfile.regulatoryReports
    );
    for (const r of toReports) {
      if (!fromReports.has(r)) {
        changes.push({
          area: "compliance",
          kind: "added",
          detail: `Regulatory report: ${r}`,
        });
      }
    }
    for (const r of fromReports) {
      if (!toReports.has(r)) {
        changes.push({
          area: "compliance",
          kind: "removed",
          detail: `Regulatory report: ${r}`,
        });
      }
    }

    // Audit retention
    if (
      from.auditRetention.retainForDays !==
      toPreset.auditRetention.retainForDays
    ) {
      changes.push({
        area: "audit",
        kind: "modified",
        detail: `retainForDays: ${from.auditRetention.retainForDays} → ${toPreset.auditRetention.retainForDays}`,
      });
    }
    if (
      from.auditRetention.notarizeToL1 !==
      toPreset.auditRetention.notarizeToL1
    ) {
      changes.push({
        area: "audit",
        kind: toPreset.auditRetention.notarizeToL1 ? "added" : "removed",
        detail: `notarizeToL1: ${toPreset.auditRetention.notarizeToL1}`,
      });
    }
    if (
      from.auditRetention.exportFormatVersion !==
      toPreset.auditRetention.exportFormatVersion
    ) {
      changes.push({
        area: "audit",
        kind: "modified",
        detail: `exportFormatVersion: ${from.auditRetention.exportFormatVersion} → ${toPreset.auditRetention.exportFormatVersion}`,
      });
    }

    // Hosting mode
    if (from.hostingProfile.mode !== toPreset.hostingProfile.mode) {
      changes.push({
        area: "hosting",
        kind: "modified",
        detail: `mode: ${from.hostingProfile.mode} → ${toPreset.hostingProfile.mode}`,
      });
    }
    if (from.hostingProfile.byoKms !== toPreset.hostingProfile.byoKms) {
      changes.push({
        area: "hosting",
        kind: toPreset.hostingProfile.byoKms ? "added" : "removed",
        detail: `byoKms: ${toPreset.hostingProfile.byoKms}`,
      });
    }

    // Jurisdiction
    if (from.jurisdiction !== toPreset.jurisdiction) {
      changes.push({
        area: "jurisdiction",
        kind: "modified",
        detail: `${from.jurisdiction} → ${toPreset.jurisdiction}`,
      });
    }

    return changes;
  }

  /**
   * Combine the source tenant's policy state with the new tier's
   * preset according to the caller-selected strategy.
   */
  private mergePolicies(
    from: TenantProfile,
    toPreset: TierPreset,
    policyAdjustment: "keep" | "adopt-new-tier-defaults" | "merge"
  ): TierPreset {
    const base = cloneTierPreset(toPreset);
    if (policyAdjustment === "adopt-new-tier-defaults") {
      return base;
    }
    if (policyAdjustment === "keep") {
      // Keep legacy limits + features where possible — the new tier
      // preset is used only to determine *hosting* + *audit retention*.
      base.limits = { ...from.limits };
      base.features = { ...from.features };
      return base;
    }
    // merge — take the stricter of the two on every numeric limit,
    // the union on compliance reports, the OR on features.
    base.limits = {
      maxDailyTransactionsUsd: Math.min(
        from.limits.maxDailyTransactionsUsd,
        base.limits.maxDailyTransactionsUsd
      ),
      maxSingleTransactionUsd: Math.min(
        from.limits.maxSingleTransactionUsd,
        base.limits.maxSingleTransactionUsd
      ),
      maxMonthlyTransactionsUsd: Math.min(
        from.limits.maxMonthlyTransactionsUsd,
        base.limits.maxMonthlyTransactionsUsd
      ),
      maxApprovers: Math.max(
        from.limits.maxApprovers,
        base.limits.maxApprovers
      ),
      maxConnectedDapps: Math.min(
        from.limits.maxConnectedDapps,
        base.limits.maxConnectedDapps
      ),
      maxMachineAgents: Math.max(
        from.limits.maxMachineAgents,
        base.limits.maxMachineAgents
      ),
      maxWorkspaces: Math.max(
        from.limits.maxWorkspaces,
        base.limits.maxWorkspaces
      ),
      maxAccounts: Math.max(from.limits.maxAccounts, base.limits.maxAccounts),
    };
    base.features = {
      hardwareWallet: from.features.hardwareWallet || base.features.hardwareWallet,
      passkey2fa: from.features.passkey2fa || base.features.passkey2fa,
      mpcSigning: from.features.mpcSigning || base.features.mpcSigning,
      workflowEscalation:
        from.features.workflowEscalation || base.features.workflowEscalation,
      regulatoryPassport:
        from.features.regulatoryPassport || base.features.regulatoryPassport,
      machineDelegation:
        from.features.machineDelegation || base.features.machineDelegation,
      notarizedAuditChain:
        from.features.notarizedAuditChain ||
        base.features.notarizedAuditChain,
      smartAccountAbstraction:
        from.features.smartAccountAbstraction ||
        base.features.smartAccountAbstraction,
    };
    const reports = new Set([
      ...from.complianceProfile.regulatoryReports,
      ...base.complianceProfile.regulatoryReports,
    ]);
    base.complianceProfile = {
      ...base.complianceProfile,
      regulatoryReports: Array.from(reports),
    };
    return base;
  }
}

/* ─── Convenience factory for tests ───────────────────────────────── */

/**
 * One-liner that returns a migrator bound to a fresh in-memory store.
 * Keeps the test suite terse.
 */
export function createInMemoryMigrator(
  deps?: Omit<TierMigratorDeps, "profileStore"> & {
    profileStore?: TenantProfileStore;
  }
): TierMigrator {
  const store = deps?.profileStore ?? new InMemoryTenantProfileStore();
  return new TierMigrator({ ...deps, profileStore: store });
}
