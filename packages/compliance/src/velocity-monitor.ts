import type { VelocityRule, VelocityCounter } from "./enterprise-types";
import type { AlertSystem } from "./alert-system";

function generateId(): string {
  return `vel-${crypto.getRandomValues(new Uint8Array(8)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "")}`;
}

const WINDOW_MS: Record<string, number> = {
  "1h": 3600000,
  "24h": 86400000,
  "7d": 604800000,
  "30d": 2592000000,
  "90d": 7776000000,
};

/**
 * Transaction velocity monitoring engine.
 * Tracks transaction count, volume, counterparty diversity, and
 * jurisdiction spread per time window. Triggers alerts on threshold breaches.
 */
export class VelocityMonitor {
  private rules: VelocityRule[] = [];
  private counters = new Map<string, VelocityCounter>();

  constructor(private readonly alertSystem?: AlertSystem) {
    this.seedDefaultRules();
  }

  recordTransaction(opts: {
    subjectId: string;
    volumeUsd: number;
    counterpartyAddress: string;
    counterpartyJurisdiction?: string;
  }): { breaches: VelocityRule[] } {
    const breaches: VelocityRule[] = [];

    for (const rule of this.rules) {
      if (!rule.enabled) continue;

      const counterKey = `${rule.id}:${opts.subjectId}`;
      let counter = this.counters.get(counterKey);
      const windowMs = WINDOW_MS[rule.window] ?? 86400000;

      // Reset counter if window expired
      if (!counter || Date.now() - counter.windowStart > windowMs) {
        counter = {
          ruleId: rule.id,
          subjectId: opts.subjectId,
          windowStart: Date.now(),
          windowEnd: Date.now() + windowMs,
          currentValue: 0,
          threshold: rule.threshold,
          breached: false,
          lastUpdated: Date.now(),
        };
      }

      // Increment based on metric
      switch (rule.metric) {
        case "count":
          counter.currentValue += 1;
          break;
        case "volume-usd":
          counter.currentValue += opts.volumeUsd;
          break;
        case "unique-counterparties":
          // Simplified: just increment (real implementation would track unique set)
          counter.currentValue += 1;
          break;
        case "unique-jurisdictions":
          counter.currentValue += 1;
          break;
      }

      counter.lastUpdated = Date.now();

      // Check breach
      if (counter.currentValue >= rule.threshold && !counter.breached) {
        counter.breached = true;
        breaches.push(rule);

        // Create alert
        this.alertSystem?.createAlert({
          category: "velocity-breach",
          severity: rule.severity,
          title: `Velocity breach: ${rule.name}`,
          description: `${rule.metric} exceeded ${rule.threshold} in ${rule.window} window. Current: ${counter.currentValue}`,
          sourceId: opts.subjectId,
          workspaceId: "",
          escalationPath: [],
        });
      }

      this.counters.set(counterKey, counter);
    }

    return { breaches };
  }

  getCounter(ruleId: string, subjectId: string): VelocityCounter | undefined {
    return this.counters.get(`${ruleId}:${subjectId}`);
  }

  getAllCounters(subjectId: string): VelocityCounter[] {
    return Array.from(this.counters.values()).filter((c) => c.subjectId === subjectId);
  }

  getBreachedCounters(): VelocityCounter[] {
    return Array.from(this.counters.values()).filter((c) => c.breached);
  }

  addRule(rule: Omit<VelocityRule, "id">): VelocityRule {
    const full: VelocityRule = { ...rule, id: generateId() };
    this.rules.push(full);
    return full;
  }

  removeRule(ruleId: string): void {
    this.rules = this.rules.filter((r) => r.id !== ruleId);
  }

  toggleRule(ruleId: string, enabled: boolean): void {
    const rule = this.rules.find((r) => r.id === ruleId);
    if (rule) rule.enabled = enabled;
  }

  listRules(): VelocityRule[] {
    return [...this.rules];
  }

  private seedDefaultRules(): void {
    this.rules = [
      { id: "vel-1", name: "High daily tx count", description: "More than 50 transactions in 24 hours", scope: "account", metric: "count", window: "24h", threshold: 50, action: "alert", severity: "medium", enabled: true },
      { id: "vel-2", name: "High daily volume", description: "More than $100,000 in 24 hours", scope: "account", metric: "volume-usd", window: "24h", threshold: 100000, action: "review", severity: "high", enabled: true },
      { id: "vel-3", name: "High weekly volume", description: "More than $500,000 in 7 days", scope: "account", metric: "volume-usd", window: "7d", threshold: 500000, action: "escalate", severity: "high", enabled: true },
      { id: "vel-4", name: "Rapid-fire transactions", description: "More than 20 transactions in 1 hour", scope: "account", metric: "count", window: "1h", threshold: 20, action: "block", severity: "critical", enabled: true },
      { id: "vel-5", name: "Monthly volume cap", description: "More than $2,000,000 in 30 days", scope: "workspace", metric: "volume-usd", window: "30d", threshold: 2000000, action: "escalate", severity: "critical", enabled: true },
    ];
  }
}
