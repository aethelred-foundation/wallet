/**
 * Built-in sponsor policies.
 *
 * Operators compose these (and custom predicates) into a
 * `CompositeSponsorPolicy` that the sponsor service evaluates
 * before signing an approval. Every policy returns a structured
 * `PolicyResult` — refusal is a first-class outcome, not an
 * exception.
 *
 * Built-in policies:
 *
 *   - `KillSwitchPolicy` — global off-switch. Ops can flip this
 *     to halt ALL sponsorship without redeploying.
 *   - `AgentBlocklistPolicy` — hard-block a set of agent ids.
 *   - `RateLimitPolicy` — per-agent ceiling on USDC cost within a
 *     rolling window.
 *   - `MaxPerRequestPolicy` — single-request ceiling; protects
 *     against pricing oracle bugs.
 *   - `CustomPredicate` — escape hatch for operator-specific rules.
 *
 * The `CompositeSponsorPolicy` runs every component in order; the
 * first denial short-circuits. This mirrors `VcGate.all` from the
 * reputation package intentionally — ops teams already know the
 * pattern.
 */

import type {
  PolicyContext,
  PolicyResult,
  SponsorPolicy,
  SponsorshipRecord,
} from "./types";

// ─── Kill switch ───────────────────────────────────────────────

export class KillSwitchPolicy implements SponsorPolicy {
  readonly id = "kill-switch";
  private enabled = false;

  arm(): void {
    this.enabled = true;
  }

  disarm(): void {
    this.enabled = false;
  }

  isArmed(): boolean {
    return this.enabled;
  }

  async evaluate(_ctx: PolicyContext): Promise<PolicyResult> {
    if (this.enabled) {
      return {
        allowed: false,
        reasonCode: "kill-switch-engaged",
        reason: "paymaster sponsorship globally disabled",
      };
    }
    return { allowed: true };
  }
}

// ─── Blocklist ────────────────────────────────────────────────

export class AgentBlocklistPolicy implements SponsorPolicy {
  readonly id = "agent-blocklist";
  private readonly blocked: Set<string>;

  constructor(initial: ReadonlyArray<`0x${string}`> = []) {
    this.blocked = new Set(initial.map((a) => a.toLowerCase()));
  }

  block(agentId: `0x${string}`): void {
    this.blocked.add(agentId.toLowerCase());
  }

  unblock(agentId: `0x${string}`): void {
    this.blocked.delete(agentId.toLowerCase());
  }

  async evaluate(ctx: PolicyContext): Promise<PolicyResult> {
    const key = ctx.request.agentId.toLowerCase();
    if (this.blocked.has(key)) {
      return {
        allowed: false,
        reasonCode: "agent-blocked",
        reason: `agent ${ctx.request.agentId} is on the block-list`,
      };
    }
    return { allowed: true };
  }
}

// ─── Rate limit ────────────────────────────────────────────────

export interface RateLimitConfig {
  /** Max total USDC cost allowed in the rolling window. */
  readonly maxUsdcPerWindow: bigint;
  /** Window length in ms. Default: 24h = 86_400_000. */
  readonly windowMs?: number;
}

export class RateLimitPolicy implements SponsorPolicy {
  readonly id: string;
  private readonly maxUsdc: bigint;
  private readonly windowMs: number;

  constructor(config: RateLimitConfig) {
    this.id = `rate-limit:${config.maxUsdcPerWindow}/${config.windowMs ?? 86_400_000}ms`;
    this.maxUsdc = config.maxUsdcPerWindow;
    this.windowMs = config.windowMs ?? 86_400_000;
  }

  async evaluate(ctx: PolicyContext): Promise<PolicyResult> {
    const since = ctx.now - this.windowMs;
    const recentTotal = sumWithinWindow(ctx.ledgerState, since);
    const wouldBe = recentTotal + ctx.computedUsdcCost;
    if (wouldBe > this.maxUsdc) {
      return {
        allowed: false,
        reasonCode: "rate-limit-exceeded",
        reason: `agent would spend ${wouldBe} over the ${this.windowMs}ms window, max ${this.maxUsdc}`,
        details: {
          recentTotal: recentTotal.toString(),
          requested: ctx.computedUsdcCost.toString(),
          max: this.maxUsdc.toString(),
          windowMs: this.windowMs,
        },
      };
    }
    return { allowed: true };
  }
}

function sumWithinWindow(
  records: ReadonlyArray<SponsorshipRecord>,
  since: number,
): bigint {
  let total = 0n;
  for (const r of records) {
    if (r.approvedAt < since) continue;
    if (r.status === "rejected" || r.status === "expired") continue;
    total += r.usdcCost;
  }
  return total;
}

// ─── Max per request ──────────────────────────────────────────

export class MaxPerRequestPolicy implements SponsorPolicy {
  readonly id: string;
  private readonly maxUsdc: bigint;

  constructor(maxUsdc: bigint) {
    this.id = `max-per-request:${maxUsdc}`;
    this.maxUsdc = maxUsdc;
  }

  async evaluate(ctx: PolicyContext): Promise<PolicyResult> {
    if (ctx.computedUsdcCost > this.maxUsdc) {
      return {
        allowed: false,
        reasonCode: "policy-denied",
        reason: `request cost ${ctx.computedUsdcCost} exceeds per-request max ${this.maxUsdc}`,
        details: {
          requested: ctx.computedUsdcCost.toString(),
          max: this.maxUsdc.toString(),
        },
      };
    }
    return { allowed: true };
  }
}

// ─── Custom predicate ────────────────────────────────────────

export class CustomPredicatePolicy implements SponsorPolicy {
  readonly id: string;
  private readonly predicate: (ctx: PolicyContext) => boolean | Promise<boolean>;
  private readonly reasonBuilder: (ctx: PolicyContext) => string;

  constructor(
    id: string,
    predicate: (ctx: PolicyContext) => boolean | Promise<boolean>,
    reasonBuilder: (ctx: PolicyContext) => string,
  ) {
    this.id = id;
    this.predicate = predicate;
    this.reasonBuilder = reasonBuilder;
  }

  async evaluate(ctx: PolicyContext): Promise<PolicyResult> {
    const ok = await this.predicate(ctx);
    if (ok) return { allowed: true };
    return {
      allowed: false,
      reasonCode: "policy-denied",
      reason: this.reasonBuilder(ctx),
    };
  }
}

// ─── Composite ────────────────────────────────────────────────

export class CompositeSponsorPolicy implements SponsorPolicy {
  readonly id: string;
  private readonly components: ReadonlyArray<SponsorPolicy>;

  constructor(components: ReadonlyArray<SponsorPolicy>) {
    if (components.length === 0) {
      throw new Error("CompositeSponsorPolicy requires at least one component");
    }
    const ids = new Set<string>();
    for (const c of components) {
      if (ids.has(c.id)) throw new Error(`duplicate sponsor policy id "${c.id}"`);
      ids.add(c.id);
    }
    this.components = components;
    this.id = `composite:[${components.map((c) => c.id).join(",")}]`;
  }

  async evaluate(ctx: PolicyContext): Promise<PolicyResult> {
    for (const c of this.components) {
      const result = await c.evaluate(ctx);
      if (!result.allowed) {
        return {
          ...result,
          details: { ...(result.details ?? {}), deniedBy: c.id },
        };
      }
    }
    return { allowed: true };
  }
}
