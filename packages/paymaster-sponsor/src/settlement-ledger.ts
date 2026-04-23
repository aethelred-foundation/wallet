/**
 * In-memory `SettlementLedger`.
 *
 * Production callers swap this for a DB-backed implementation (we
 * keep the interface tight). Used by:
 *
 *   - The sponsor service at approval time to record the sponsorship.
 *   - The reconciliation worker when it observes the on-chain
 *     settlement event and calls `markSettled(requestId, txHash)`.
 *   - The expiry sweep when `validUntil` elapses and nothing settled.
 *
 * The in-memory implementation is atomic under single-threaded JS
 * execution. Multi-instance deployments need a shared store with
 * proper concurrency control — that's the implementation's job, not
 * this interface's.
 */

import type { SponsorshipRecord, SettlementLedger } from "./types";
import { PaymasterSponsorError } from "./errors";

export class InMemorySettlementLedger implements SettlementLedger {
  private readonly byRequestId = new Map<string, SponsorshipRecord>();
  private readonly byAgent = new Map<string, string[]>();

  async record(record: SponsorshipRecord): Promise<void> {
    const key = record.requestId.toLowerCase();
    if (this.byRequestId.has(key)) {
      throw new PaymasterSponsorError(
        "request-id-reused",
        `sponsorship ${record.requestId} already recorded`,
      );
    }
    this.byRequestId.set(key, record);
    const agentKey = record.agentId.toLowerCase();
    const list = this.byAgent.get(agentKey) ?? [];
    list.push(key);
    this.byAgent.set(agentKey, list);
  }

  async getByRequestId(id: `0x${string}`): Promise<SponsorshipRecord | null> {
    return this.byRequestId.get(id.toLowerCase()) ?? null;
  }

  async listByAgent(
    agentId: `0x${string}`,
    opts: { readonly since?: number; readonly limit?: number } = {},
  ): Promise<ReadonlyArray<SponsorshipRecord>> {
    const keys = this.byAgent.get(agentId.toLowerCase()) ?? [];
    const out: SponsorshipRecord[] = [];
    for (const k of keys) {
      const r = this.byRequestId.get(k);
      if (!r) continue;
      if (opts.since !== undefined && r.approvedAt < opts.since) continue;
      out.push(r);
    }
    // Newest first.
    out.sort((a, b) => b.approvedAt - a.approvedAt);
    if (opts.limit !== undefined) return out.slice(0, opts.limit);
    return out;
  }

  async markSettled(
    requestId: `0x${string}`,
    txHash: `0x${string}`,
    settledAt: number,
  ): Promise<void> {
    const key = requestId.toLowerCase();
    const record = this.byRequestId.get(key);
    if (!record) {
      throw new PaymasterSponsorError(
        "settlement-not-found",
        `sponsorship ${requestId} not found`,
      );
    }
    if (record.status === "settled") {
      throw new PaymasterSponsorError(
        "settlement-double-reconcile",
        `sponsorship ${requestId} already settled at tx ${record.settlementTxHash}`,
      );
    }
    if (record.status === "expired" || record.status === "rejected") {
      throw new PaymasterSponsorError(
        "settlement-double-reconcile",
        `sponsorship ${requestId} terminal in status "${record.status}"`,
      );
    }
    this.byRequestId.set(key, {
      ...record,
      status: "settled",
      settledAt,
      settlementTxHash: txHash,
    });
  }

  async markExpired(requestId: `0x${string}`, at: number): Promise<void> {
    const key = requestId.toLowerCase();
    const record = this.byRequestId.get(key);
    if (!record) {
      throw new PaymasterSponsorError(
        "settlement-not-found",
        `sponsorship ${requestId} not found`,
      );
    }
    if (record.status !== "approved") {
      // Idempotent: don't fail when already terminal.
      return;
    }
    this.byRequestId.set(key, { ...record, status: "expired", settledAt: at });
  }

  /** Test helper: total approved cost for an agent since `since`. */
  sumApprovedFor(agentId: `0x${string}`, since: number = 0): bigint {
    const keys = this.byAgent.get(agentId.toLowerCase()) ?? [];
    let total = 0n;
    for (const k of keys) {
      const r = this.byRequestId.get(k);
      if (!r) continue;
      if (r.approvedAt < since) continue;
      if (r.status === "rejected" || r.status === "expired") continue;
      total += r.usdcCost;
    }
    return total;
  }
}
