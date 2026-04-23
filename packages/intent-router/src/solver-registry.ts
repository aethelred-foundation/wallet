/**
 * Solver registry + comparator factories.
 *
 * The registry decouples "what solvers exist" from "how the router
 * picks between them." Deployments compose:
 *
 *   - `InMemorySolverRegistry` (tests, small fleets, static sets).
 *   - A caller-supplied registry backed by a discovery service,
 *     an on-chain `SolverRegistry` contract, or a RPC-fronted
 *     solver network (e.g. UniswapX, CoW).
 *
 * Comparators are pure functions. Ship with three:
 *
 *   - `bestPrice` — for transfer/payment, pick the lowest cost; for
 *     swap, pick the highest output amount.
 *   - `fastestFill` — pick the earliest `estimatedFillTimeMs`.
 *   - `composite(weights)` — weighted blend of price/speed/trust so
 *     operators who don't want a monolithic objective can tune.
 */

import type {
  IntentKind,
  Quote,
  QuoteComparator,
  Solver,
  SolverRegistry,
} from "./types";

// ─── Registry ──────────────────────────────────────────────────

export class InMemorySolverRegistry implements SolverRegistry {
  private readonly byId = new Map<string, Solver>();

  constructor(solvers: ReadonlyArray<Solver> = []) {
    for (const s of solvers) this.register(s);
  }

  register(solver: Solver): void {
    if (this.byId.has(solver.id)) {
      throw new Error(`Solver id "${solver.id}" already registered`);
    }
    this.byId.set(solver.id, solver);
  }

  unregister(solverId: string): void {
    this.byId.delete(solverId);
  }

  listFor(kind: IntentKind): ReadonlyArray<Solver> {
    const out: Solver[] = [];
    for (const s of this.byId.values()) {
      if (s.supportedIntentKinds.includes(kind)) out.push(s);
    }
    return out;
  }

  get(id: string): Solver | null {
    return this.byId.get(id) ?? null;
  }

  /** Used by tests to pre-populate reputation on specific solvers. */
  get solverIds(): ReadonlyArray<string> {
    return [...this.byId.keys()];
  }
}

// ─── Comparators ──────────────────────────────────────────────

/**
 * "Best price" for the caller:
 *   - transfer: lowest commitment (solver is sending the amount; we
 *     want the cheapest solver fee, which is priced as cheaper overall
 *     commitment if solver quotes inclusive).
 *   - swap: highest commitment (buyAmount we receive).
 *   - payment: lowest commitment (amount we pay).
 *
 * When the intent is ambiguous (the caller used the generic path),
 * the comparator inspects `intent.body.kind`.
 */
export const bestPrice: QuoteComparator = (a, b, intent) => {
  const aN = BigInt(a.commitment);
  const bN = BigInt(b.commitment);
  switch (intent.body.kind) {
    case "swap":
      // Higher is better — negate.
      return bigIntSign(bN - aN);
    case "transfer":
    case "payment":
      return bigIntSign(aN - bN);
    default:
      return 0;
  }
};

/** Earliest fill wins. Ties broken by lower commitment. */
export const fastestFill: QuoteComparator = (a, b, intent) => {
  const diff = a.estimatedFillTimeMs - b.estimatedFillTimeMs;
  if (diff !== 0) return diff;
  return bestPrice(a, b, intent);
};

export interface CompositeWeights {
  /** Weight applied to price-rank (0..1). */
  readonly price: number;
  /** Weight applied to speed-rank (0..1). */
  readonly speed: number;
  /**
   * Weight applied to solver-trust score (0..1). Trust scores are
   * caller-supplied — we take a resolver `(solverId) => number`
   * instead of hard-coding so operators can plug reputation from
   * the reputation package or any off-chain store.
   */
  readonly trust: number;
}

/**
 * Composite comparator — ranks each quote by price, speed, and
 * solver-trust individually, then picks the quote with the best
 * weighted sum of ranks.
 *
 * The ranks are zero-indexed positions among the quote set, so
 * `price.weight = 0.7, speed.weight = 0.2, trust.weight = 0.1`
 * means "pick the lowest price unless the winner is too slow or
 * comes from a low-trust solver". Tune empirically per merchant.
 */
export function composite(
  weights: CompositeWeights,
  trustForSolver: (solverId: string) => number = () => 0.5,
): (quotes: ReadonlyArray<Quote>, intent: Parameters<QuoteComparator>[2]) => Quote | undefined {
  return (quotes, intent) => {
    if (quotes.length === 0) return undefined;

    const byPrice = [...quotes].sort((a, b) => bestPrice(a, b, intent));
    const bySpeed = [...quotes].sort((a, b) => a.estimatedFillTimeMs - b.estimatedFillTimeMs);
    const byTrust = [...quotes].sort(
      (a, b) => trustForSolver(b.solverId) - trustForSolver(a.solverId),
    );

    let bestIdx = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < quotes.length; i += 1) {
      const q = quotes[i];
      const priceRank = byPrice.indexOf(q);
      const speedRank = bySpeed.indexOf(q);
      const trustRank = byTrust.indexOf(q);
      // Lower rank = better, so score is the negated weighted sum.
      const score = -(
        weights.price * priceRank +
        weights.speed * speedRank +
        weights.trust * trustRank
      );
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    return bestIdx >= 0 ? quotes[bestIdx] : undefined;
  };
}

/** Pick the single best quote under a comparator. */
export function pickBest(
  quotes: ReadonlyArray<Quote>,
  intent: Parameters<QuoteComparator>[2],
  comparator: QuoteComparator,
): Quote | undefined {
  if (quotes.length === 0) return undefined;
  return [...quotes].sort((a, b) => comparator(a, b, intent))[0];
}

// ─── Helpers ──────────────────────────────────────────────────

function bigIntSign(n: bigint): number {
  if (n < 0n) return -1;
  if (n > 0n) return 1;
  return 0;
}
