/**
 * Built-in `VcGateRule` factories.
 *
 * Receivers compose these into a `VcGate` without implementing the
 * rule interface themselves:
 *
 *     const gate = VcGate.all([
 *       requireRegisteredAgent(),
 *       requireNotRevoked(),
 *       requireVcOfSchema(SCHEMA_KYC_STATUS, { issuerRole: "kyc-provider" }),
 *       requireMinReputation(600),
 *       requireFreshVc(SCHEMA_KYC_STATUS, 30 * 24 * 60 * 60_000),
 *     ]);
 *
 * Every factory returns a rule with a stable, descriptive id so audit
 * logs line up across gate evaluations. Receivers with bespoke
 * requirements write their own rules; we expose the contract
 * (`VcGateRule`) in the public API.
 */

import type {
  IssuerRole,
  ReputationTier,
  SchemaId,
  VcGateContext,
  VcGateRule,
  VcGateRuleResult,
} from "./types";
import { defaultScoreForTier } from "./types";

// ─── Registration ──────────────────────────────────────────────

/** Rule: the agent's control address MUST resolve to an ERC-8004 entry. */
export function requireRegisteredAgent(): VcGateRule {
  return {
    id: "require-registered-agent",
    description: "Agent control address must be registered in the ERC-8004 registry",
    evaluate(ctx: VcGateContext): VcGateRuleResult {
      if (!ctx.agent) {
        return {
          ruleId: "require-registered-agent",
          passed: false,
          explanation: "No agent identity resolved for the payer — not registered in ERC-8004",
        };
      }
      return {
        ruleId: "require-registered-agent",
        passed: true,
        explanation: `Agent ${ctx.agent.agentId} is registered`,
      };
    },
  };
}

/** Rule: the resolved agent MUST NOT be revoked. */
export function requireNotRevoked(): VcGateRule {
  return {
    id: "require-not-revoked",
    description: "Agent identity must not be revoked by its operator",
    evaluate(ctx: VcGateContext): VcGateRuleResult {
      if (ctx.agent.revoked) {
        return {
          ruleId: "require-not-revoked",
          passed: false,
          explanation: `Agent ${ctx.agent.agentId} is revoked${
            ctx.agent.revocationReason ? `: ${ctx.agent.revocationReason}` : ""
          }`,
          details: { revocationReason: ctx.agent.revocationReason ?? null },
        };
      }
      return {
        ruleId: "require-not-revoked",
        passed: true,
        explanation: "Agent identity is active",
      };
    },
  };
}

// ─── VC-shape requirements ─────────────────────────────────────

export interface RequireVcOptions {
  /** Require the VC be issued by an issuer in a specific role. */
  readonly issuerRole?: IssuerRole;
  /** Require the VC issuer id matches one of these (exact match). */
  readonly issuerIds?: ReadonlyArray<string>;
  /** Override the rule id — useful when requiring multiple VCs of the same schema. */
  readonly ruleId?: string;
}

/**
 * Rule: agent's credentials MUST include at least one VC matching
 * the schema and optional issuer filters.
 *
 * Does NOT cryptographically re-verify the VC — that's the
 * `CredentialVerifier`'s job. The bridge layer only passes VCs that
 * have already passed verification into the context.
 */
export function requireVcOfSchema(
  schemaId: SchemaId,
  options: RequireVcOptions = {},
): VcGateRule {
  const ruleId =
    options.ruleId ?? `require-vc:${schemaId}${options.issuerRole ? `:${options.issuerRole}` : ""}`;
  const issuerIds = options.issuerIds ? new Set(options.issuerIds) : undefined;

  return {
    id: ruleId,
    description:
      `Require at least one verified VC of schema "${schemaId}"` +
      (options.issuerRole ? ` issued by a ${options.issuerRole}` : "") +
      (issuerIds ? ` from ${issuerIds.size} approved issuer(s)` : ""),
    evaluate(ctx: VcGateContext): VcGateRuleResult {
      for (const vc of ctx.credentials) {
        const att = vc.attestation;
        if (att.schemaId !== schemaId) continue;
        if (options.issuerRole && att.issuer.role !== options.issuerRole) continue;
        if (issuerIds && !issuerIds.has(att.issuer.id)) continue;

        if (att.revokedAt !== undefined) continue;
        if (att.expiresAt !== undefined && att.expiresAt <= ctx.now) continue;

        return {
          ruleId,
          passed: true,
          explanation: `Found VC ${att.uid} (${att.issuer.id})`,
          details: { attestationUid: att.uid, issuerId: att.issuer.id },
        };
      }
      return {
        ruleId,
        passed: false,
        explanation: `No valid VC of schema "${schemaId}"${
          options.issuerRole ? ` from a ${options.issuerRole}` : ""
        } found among ${ctx.credentials.length} credentials`,
      };
    },
  };
}

/**
 * Rule: any VC matching a schema MUST have been issued within
 * `maxAgeMs` of the evaluation time.
 *
 * Useful for gates like "KYC must be refreshed every 90 days" —
 * common in regulated receiver policies.
 */
export function requireFreshVc(schemaId: SchemaId, maxAgeMs: number): VcGateRule {
  const ruleId = `require-fresh-vc:${schemaId}:${maxAgeMs}ms`;
  return {
    id: ruleId,
    description: `Require a VC of schema "${schemaId}" issued within ${maxAgeMs}ms`,
    evaluate(ctx: VcGateContext): VcGateRuleResult {
      for (const vc of ctx.credentials) {
        const att = vc.attestation;
        if (att.schemaId !== schemaId) continue;
        if (att.revokedAt !== undefined) continue;
        if (att.expiresAt !== undefined && att.expiresAt <= ctx.now) continue;
        const age = ctx.now - att.issuedAt;
        if (age <= maxAgeMs) {
          return {
            ruleId,
            passed: true,
            explanation: `VC ${att.uid} is ${age}ms old (<=${maxAgeMs}ms)`,
            details: { attestationUid: att.uid, ageMs: age },
          };
        }
      }
      return {
        ruleId,
        passed: false,
        explanation: `No VC of schema "${schemaId}" is fresh enough (max age ${maxAgeMs}ms)`,
      };
    },
  };
}

// ─── Reputation-based ──────────────────────────────────────────

/** Rule: reputation score must be at least `minScore`. */
export function requireMinReputation(minScore: number): VcGateRule {
  return {
    id: `require-min-reputation:${minScore}`,
    description: `Require reputation score >= ${minScore}`,
    evaluate(ctx: VcGateContext): VcGateRuleResult {
      if (ctx.reputation.score < minScore) {
        return {
          ruleId: `require-min-reputation:${minScore}`,
          passed: false,
          explanation: `Reputation score ${ctx.reputation.score} < ${minScore}`,
          details: { score: ctx.reputation.score, required: minScore },
        };
      }
      return {
        ruleId: `require-min-reputation:${minScore}`,
        passed: true,
        explanation: `Reputation score ${ctx.reputation.score} >= ${minScore}`,
      };
    },
  };
}

/** Rule: reputation tier must be at least `minTier`. */
export function requireMinTier(minTier: ReputationTier): VcGateRule {
  const minScore = defaultScoreForTier(minTier);
  return {
    id: `require-min-tier:${minTier}`,
    description: `Require reputation tier >= "${minTier}"`,
    evaluate(ctx: VcGateContext): VcGateRuleResult {
      if (ctx.reputation.score < minScore) {
        return {
          ruleId: `require-min-tier:${minTier}`,
          passed: false,
          explanation: `Reputation tier "${ctx.reputation.tier}" (score=${ctx.reputation.score}) < "${minTier}" (>=${minScore})`,
          details: {
            actualTier: ctx.reputation.tier,
            actualScore: ctx.reputation.score,
            requiredTier: minTier,
            requiredScore: minScore,
          },
        };
      }
      return {
        ruleId: `require-min-tier:${minTier}`,
        passed: true,
        explanation: `Reputation tier "${ctx.reputation.tier}" satisfies >= "${minTier}"`,
      };
    },
  };
}

// ─── Custom-predicate escape hatch ─────────────────────────────

/**
 * Escape hatch for receivers that need a one-off predicate. Write
 * the predicate inline without defining a new module.
 *
 *     const rule = customRule(
 *       "receiver-specific-policy",
 *       "Reject if agent's operator is on the internal block-list",
 *       (ctx) => !internalBlockList.has(ctx.agent.operatorAddress.toLowerCase()),
 *       (ctx) =>
 *         `Operator ${ctx.agent.operatorAddress} is on the internal block-list`,
 *     );
 */
export function customRule(
  id: string,
  description: string,
  predicate: (ctx: VcGateContext) => boolean | Promise<boolean>,
  failureExplanation: (ctx: VcGateContext) => string,
): VcGateRule {
  return {
    id,
    description,
    async evaluate(ctx: VcGateContext): Promise<VcGateRuleResult> {
      const ok = await predicate(ctx);
      if (ok) {
        return {
          ruleId: id,
          passed: true,
          explanation: description,
        };
      }
      return {
        ruleId: id,
        passed: false,
        explanation: failureExplanation(ctx),
      };
    },
  };
}
