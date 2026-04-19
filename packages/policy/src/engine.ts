import type { DecisionOutcome } from "@aethelred/wallet-connect";
import type {
  PolicyBundle,
  PolicyCondition,
  PolicyContext,
  PolicyEvaluationResult,
  PolicyRule,
} from "./types";

/**
 * PolicyEngine evaluates a PolicyContext against a PolicyBundle.
 * This is a pure function: same inputs always produce the same output.
 * No side effects, no storage, no signing.
 *
 * Rule evaluation order: rules are sorted by priority (ascending).
 * - "deny" short-circuits: first deny rule stops evaluation.
 * - "approval-required" is collected; most restrictive approval wins.
 * - "warn" is collected.
 * - "allow" is the default if no rules match.
 */
export function evaluate(
  context: PolicyContext,
  bundle: PolicyBundle
): PolicyEvaluationResult {
  const sortedRules = [...bundle.rules].sort((a, b) => a.priority - b.priority);
  const matchedRules: PolicyRule[] = [];
  const warnings: string[] = [];
  let highestOutcome: DecisionOutcome = "allow";
  let approvalDetails: PolicyEvaluationResult["approvalDetails"] | undefined;

  for (const rule of sortedRules) {
    if (matchesAllConditions(context, rule.conditions)) {
      matchedRules.push(rule);

      if (rule.outcome === "deny") {
        return {
          outcome: "deny",
          matchedRules,
          warnings: [rule.message],
          requiresApproval: false,
          timestamp: Date.now(),
        };
      }

      if (rule.outcome === "approval-required") {
        highestOutcome = "approval-required";
        approvalDetails = {
          requiredAction: rule.message,
          reviewerRoles: ["owner", "treasury-admin"],
        };
      }

      if (rule.outcome === "warn") {
        warnings.push(rule.message);
        if (highestOutcome === "allow") {
          highestOutcome = "warn";
        }
      }
    }
  }

  return {
    outcome: highestOutcome,
    matchedRules,
    warnings,
    requiresApproval: highestOutcome === "approval-required",
    approvalDetails,
    timestamp: Date.now(),
  };
}

function matchesAllConditions(
  context: PolicyContext,
  conditions: PolicyCondition[]
): boolean {
  return conditions.every((condition) => matchesCondition(context, condition));
}

function matchesCondition(
  context: PolicyContext,
  condition: PolicyCondition
): boolean {
  const fieldValue = resolveField(context, condition.field);

  switch (condition.operator) {
    case "equals":
      return fieldValue === condition.value;
    case "not-equals":
      return fieldValue !== condition.value;
    case "in":
      return Array.isArray(condition.value) && condition.value.includes(fieldValue);
    case "not-in":
      return Array.isArray(condition.value) && !condition.value.includes(fieldValue);
    case "greater-than":
      return typeof fieldValue === "number" && fieldValue > (condition.value as number);
    case "less-than":
      return typeof fieldValue === "number" && fieldValue < (condition.value as number);
    case "exists":
      return fieldValue !== undefined && fieldValue !== null;
    case "not-exists":
      return fieldValue === undefined || fieldValue === null;
    default:
      return false;
  }
}

function resolveField(
  context: PolicyContext,
  field: string
): unknown {
  const parts = field.split(".");
  let current: unknown = context;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}
