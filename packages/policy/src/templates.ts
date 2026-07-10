import type { PolicyBundle } from "./types";

/**
 * Default policy templates for each workspace kind.
 * Templates can be composed and customized. Elixir admin control-plane
 * will make these authorable in Phase 2+.
 */

/**
 * Personal tier policy thresholds.
 *
 * Personal wallets need safety nets but shouldn't require approval for
 * every small transfer. Thresholds (all surfaced on the review screen;
 * the user can still approve themselves — none are hard blocks except
 * the blacklist):
 *   - $10k per-tx → warn
 *   - 50 tx per 24h → warn (likely automation or unusual activity)
 *   - $50k per 24h → warn
 *   - Unknown destination + > $100 → warn
 *   - Any permit → warn (permits bypass regular transaction review)
 *   - Blacklisted destination → deny
 */
export const personalPolicyBundle: PolicyBundle = {
  id: "policy-default-personal",
  name: "Personal default policy",
  mode: "guided",
  workspaceKind: "personal",
  rules: [
    {
      id: "personal-connect-allow-firstparty",
      name: "Auto-allow first-party app connections",
      priority: 10,
      conditions: [
        { field: "intent.kind", operator: "equals", value: "connect" },
        { field: "app.trustLevel", operator: "equals", value: "first-party" },
      ],
      outcome: "allow",
      message: "First-party app connections are automatically allowed.",
    },
    {
      id: "personal-connect-warn-unverified",
      name: "Warn on unverified app connections",
      priority: 20,
      conditions: [
        { field: "intent.kind", operator: "equals", value: "connect" },
        { field: "app.trustLevel", operator: "equals", value: "unverified" },
      ],
      outcome: "warn",
      message: "This app is not verified. Proceed with caution.",
    },
    {
      id: "personal-sign-warn",
      name: "Warn on all message signing",
      priority: 30,
      conditions: [
        { field: "intent.kind", operator: "equals", value: "sign-message" },
      ],
      outcome: "warn",
      message: "Message signing will be visible in the audit trail.",
    },
    {
      id: "personal-tx-warn",
      name: "Warn on all transactions",
      priority: 40,
      conditions: [
        { field: "intent.kind", operator: "equals", value: "sign-transaction" },
      ],
      outcome: "warn",
      message: "Review transaction details before confirming.",
    },
    /* ─── Spend-limit rule: >$10,000 per transaction ─── */
    {
      id: "personal-spend-per-tx-limit",
      name: "High-value transaction warning",
      priority: 50,
      conditions: [
        { field: "intent.kind", operator: "equals", value: "sign-transaction" },
        { field: "amountUsd", operator: "greater-than", value: 10_000 },
      ],
      outcome: "warn",
      message: "Transaction value exceeds $10,000 — double-check recipient.",
    },
    /* ─── Velocity rule: >50 tx in 24h ─── */
    {
      id: "personal-velocity-count",
      name: "Unusual transaction velocity",
      priority: 55,
      conditions: [
        { field: "intent.kind", operator: "equals", value: "sign-transaction" },
        { field: "requestedOperationCount24h", operator: "greater-than", value: 50 },
      ],
      outcome: "warn",
      message: "50+ transactions in the past 24h — unusual activity detected.",
    },
    /* ─── Velocity rule: >$50,000 cumulative in 24h ─── */
    {
      id: "personal-velocity-value",
      name: "High cumulative 24h spend",
      priority: 56,
      conditions: [
        { field: "intent.kind", operator: "equals", value: "sign-transaction" },
        { field: "cumulativeValueSpentUsd24h", operator: "greater-than", value: 50_000 },
      ],
      outcome: "warn",
      message: "You've moved over $50,000 today — verify this transaction isn't a mistake.",
    },
    /* ─── Destination allowlist: unknown destination + non-trivial value ─── */
    {
      id: "personal-destination-unknown",
      name: "Unknown destination warning",
      priority: 60,
      conditions: [
        { field: "destinationCategory", operator: "equals", value: "unknown" },
        { field: "amountUsd", operator: "greater-than", value: 100 },
      ],
      outcome: "warn",
      message: "Sending to an address you've never used before — verify it matches what the dApp displays.",
    },
    /* ─── Blacklisted destination ─── */
    {
      id: "personal-destination-blacklisted",
      name: "Blacklisted destination",
      priority: 5,
      conditions: [
        { field: "destinationCategory", operator: "equals", value: "blacklisted" },
      ],
      outcome: "deny",
      message: "Destination is on the sanctions/scam blacklist. Transaction blocked.",
    },
  ],
  version: 2,
  createdAt: Date.now(),
};

/**
 * Enterprise tier policy thresholds (higher than personal; stricter rules):
 *   - $100k per-tx → dual-control approval
 *   - 200 tx / 24h → deny (requires operational review)
 *   - $500k / 24h → deny
 *   - Unknown destination → always approval-required
 *   - Blacklisted destination → deny
 */
export const enterprisePolicyBundle: PolicyBundle = {
  id: "policy-default-enterprise",
  name: "Enterprise default policy",
  mode: "approval-required",
  workspaceKind: "enterprise",
  rules: [
    {
      id: "enterprise-connect-allow-firstparty",
      name: "Auto-allow first-party app connections",
      priority: 10,
      conditions: [
        { field: "intent.kind", operator: "equals", value: "connect" },
        { field: "app.trustLevel", operator: "equals", value: "first-party" },
      ],
      outcome: "allow",
      message: "First-party app connections are automatically allowed.",
    },
    {
      id: "enterprise-connect-deny-unverified",
      name: "Deny unverified app connections",
      priority: 15,
      conditions: [
        { field: "intent.kind", operator: "equals", value: "connect" },
        { field: "app.trustLevel", operator: "equals", value: "unverified" },
      ],
      outcome: "deny",
      message: "Unverified apps are not permitted in enterprise workspaces.",
    },
    {
      id: "enterprise-tx-approval",
      name: "All transactions require approval",
      priority: 30,
      conditions: [
        { field: "intent.kind", operator: "equals", value: "sign-transaction" },
      ],
      outcome: "approval-required",
      message: "Transaction requires reviewer approval before signer execution.",
    },
    {
      id: "enterprise-sign-warn",
      name: "Warn on message signing",
      priority: 40,
      conditions: [
        { field: "intent.kind", operator: "equals", value: "sign-message" },
      ],
      outcome: "warn",
      message: "Message signing should be visible in the audit trail.",
    },
    /* ─── Spend-limit: >$100k/tx → dual-control ─── */
    {
      id: "enterprise-high-value-tx",
      name: "High-value transaction dual-control",
      priority: 25,
      conditions: [
        { field: "intent.kind", operator: "equals", value: "sign-transaction" },
        { field: "amountUsd", operator: "greater-than", value: 100_000 },
      ],
      outcome: "approval-required",
      message: "Transactions over $100k require dual-control approval.",
    },
    /* ─── Velocity: >200 tx/24h → deny ─── */
    {
      id: "enterprise-velocity-count-deny",
      name: "Enterprise velocity ceiling",
      priority: 12,
      conditions: [
        { field: "intent.kind", operator: "equals", value: "sign-transaction" },
        { field: "requestedOperationCount24h", operator: "greater-than", value: 200 },
      ],
      outcome: "deny",
      message: "Over 200 transactions in 24h — operational review required. Contact treasury admin.",
    },
    /* ─── Velocity: >$500k/24h → deny ─── */
    {
      id: "enterprise-velocity-value-deny",
      name: "Enterprise cumulative spend ceiling",
      priority: 13,
      conditions: [
        { field: "intent.kind", operator: "equals", value: "sign-transaction" },
        { field: "cumulativeValueSpentUsd24h", operator: "greater-than", value: 500_000 },
      ],
      outcome: "deny",
      message: "Over $500k moved in 24h — operational review required.",
    },
    /* ─── Unknown destination → always approval-required ─── */
    {
      id: "enterprise-destination-unknown",
      name: "Unknown destination approval",
      priority: 35,
      conditions: [
        { field: "destinationCategory", operator: "equals", value: "unknown" },
      ],
      outcome: "approval-required",
      message: "Destination is not in the enterprise address book — reviewer required.",
    },
    /* ─── Blacklisted destination → deny ─── */
    {
      id: "enterprise-destination-blacklisted",
      name: "Blacklisted destination",
      priority: 5,
      conditions: [
        { field: "destinationCategory", operator: "equals", value: "blacklisted" },
      ],
      outcome: "deny",
      message: "Destination is on the compliance blacklist. Transaction blocked.",
    },
  ],
  version: 2,
  createdAt: Date.now(),
};

export const sovereignPolicyBundle: PolicyBundle = {
  id: "policy-default-sovereign",
  name: "Sovereign default policy",
  mode: "dual-control",
  workspaceKind: "sovereign",
  rules: [
    {
      id: "sovereign-connect-approval",
      name: "All connections require approval",
      priority: 10,
      conditions: [
        { field: "intent.kind", operator: "equals", value: "connect" },
      ],
      outcome: "approval-required",
      message: "All app connections in sovereign mode require explicit approval.",
    },
    {
      id: "sovereign-sign-approval",
      name: "All signing requires approval",
      priority: 20,
      conditions: [
        { field: "intent.kind", operator: "in", value: ["sign-message", "sign-transaction"] },
      ],
      outcome: "approval-required",
      message: "All signing operations require dual-control approval.",
    },
  ],
  version: 1,
  createdAt: Date.now(),
};

export function getDefaultPolicyBundle(workspaceKind: string): PolicyBundle {
  switch (workspaceKind) {
    case "enterprise":
      return enterprisePolicyBundle;
    case "sovereign":
      return sovereignPolicyBundle;
    default:
      return personalPolicyBundle;
  }
}
