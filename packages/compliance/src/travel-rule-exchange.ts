/**
 * Travel Rule exchange — the PENDING_TRAVEL_RULE state machine.
 *
 * Formatting an IVMS101 payload is not enough: under MiCA/FATF a transfer must
 * be *held* until the beneficiary VASP confirms receipt and accepts the inbound
 * data. This manager drives that lifecycle on top of
 * {@link TravelRuleInteropEngine}:
 *
 *   pending ─initiate→ awaiting-beneficiary ─response(accept)→ accepted ✅
 *                          │                  └response(reject)→ rejected ✖
 *                          └─(transport send fails)→ rejected ✖
 *                          └─(deadline passes)─────→ timed-out  ✖
 *
 * A transfer may only proceed once the exchange is `accepted` — so the signing
 * pipeline gates on {@link TravelRuleExchangeManager.mayProceed}. The mTLS
 * handshake with the counterparty VASP lives behind the pluggable
 * {@link TravelRuleTransport} (a TRISA/OpenVASP adapter); this module owns the
 * protocol-agnostic state.
 */

import { TravelRuleInteropEngine, type TravelRuleProtocol, type TravelRuleEnvelope } from "./travel-rule-interop";
import type { TravelRuleData } from "./types";

export type ExchangeState = "awaiting-beneficiary" | "accepted" | "rejected" | "timed-out";

export interface TravelRuleExchange {
  readonly id: string;
  readonly transactionId: string;
  readonly protocol: TravelRuleProtocol;
  readonly envelope: TravelRuleEnvelope;
  state: ExchangeState;
  readonly createdAt: number;
  /** createdAt + timeoutMs — after this an un-answered exchange times out. */
  readonly deadline: number;
  /** Counterparty/transport reference (e.g. TRISA envelope id). */
  reference?: string;
  resolvedAt?: number;
  reason?: string;
}

export interface ExchangeConfig {
  /** How long to await a beneficiary response before timing out. Default 1h. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;

export class TravelRuleExchangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TravelRuleExchangeError";
  }
}

function generateId(): string {
  return `trx-${crypto.getRandomValues(new Uint8Array(8)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "")}`;
}

export class TravelRuleExchangeManager {
  private readonly engine: TravelRuleInteropEngine;
  private readonly timeoutMs: number;
  private readonly exchanges = new Map<string, TravelRuleExchange>();

  constructor(engine: TravelRuleInteropEngine, config: ExchangeConfig = {}) {
    this.engine = engine;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Build + transmit the IVMS101 envelope to the beneficiary VASP and open a
   * PENDING exchange. The transfer must NOT sign/broadcast until this exchange
   * reaches `accepted`. Throws if the payload is incomplete (IVMS101 / R.16) or
   * no transport is registered for the protocol.
   */
  async initiate(record: TravelRuleData, protocol: TravelRuleProtocol, now: number = Date.now()): Promise<TravelRuleExchange> {
    // prepareEnvelope validates IVMS101 completeness (throws on incomplete).
    const envelope = this.engine.prepareEnvelope(record, protocol);
    const exchange: TravelRuleExchange = {
      id: generateId(),
      transactionId: record.transactionId,
      protocol,
      envelope,
      state: "awaiting-beneficiary",
      createdAt: now,
      deadline: now + this.timeoutMs,
    };
    this.exchanges.set(exchange.id, exchange);

    const result = await this.engine.transmit(record, protocol);
    if (!result.accepted) {
      exchange.state = "rejected";
      exchange.resolvedAt = now;
      exchange.reason = result.error ?? "transport rejected the envelope";
    } else {
      exchange.reference = result.reference;
    }
    return exchange;
  }

  /** Record the beneficiary VASP's confirm/reject (inbound, post-handshake). */
  recordBeneficiaryResponse(id: string, accepted: boolean, now: number = Date.now(), reason?: string): TravelRuleExchange {
    const exchange = this.mustGet(id);
    if (exchange.state !== "awaiting-beneficiary") {
      throw new TravelRuleExchangeError(`exchange ${id} is ${exchange.state}, cannot record a response`);
    }
    exchange.state = accepted ? "accepted" : "rejected";
    exchange.resolvedAt = now;
    exchange.reason = reason;
    return exchange;
  }

  /** The signing gate: a transfer may proceed only once accepted. */
  mayProceed(id: string): boolean {
    return this.exchanges.get(id)?.state === "accepted";
  }

  /** Time out any exchange still awaiting a response past its deadline. */
  expireStale(now: number = Date.now()): TravelRuleExchange[] {
    const expired: TravelRuleExchange[] = [];
    for (const ex of this.exchanges.values()) {
      if (ex.state === "awaiting-beneficiary" && now > ex.deadline) {
        ex.state = "timed-out";
        ex.resolvedAt = now;
        ex.reason = "beneficiary VASP did not respond before the deadline";
        expired.push(ex);
      }
    }
    return expired;
  }

  get(id: string): TravelRuleExchange | undefined {
    return this.exchanges.get(id);
  }

  listByTransaction(transactionId: string): TravelRuleExchange[] {
    return [...this.exchanges.values()].filter((e) => e.transactionId === transactionId);
  }

  private mustGet(id: string): TravelRuleExchange {
    const exchange = this.exchanges.get(id);
    if (!exchange) throw new TravelRuleExchangeError(`exchange not found: ${id}`);
    return exchange;
  }
}
