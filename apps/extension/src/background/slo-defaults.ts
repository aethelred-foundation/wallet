/**
 * Default per-handler latency SLOs for the background service
 * worker.
 *
 * Each entry is a ballpark budget — NOT a measured contract. The
 * numbers fall into a few families:
 *
 *   - **State reads** (get-state, get-tokens, get-networks, …) are
 *     in-memory snapshots served from the already-rehydrated SW
 *     state. p50 targets sit in single-digit milliseconds.
 *   - **RPC reads** (get-balances, get-gas, get-tx-history, rpc-*)
 *     are bounded by the remote provider; budgets lift two orders
 *     of magnitude higher to absorb cross-continent round-trips.
 *   - **Signing + approval** (prepare-tx, execute-tx, approval-
 *     response) are CPU-bound: secp256k1 + keccak on the SW
 *     thread, plus a small policy / audit append.
 *   - **Passkeys / WebAuthn** land between state and signing —
 *     user-agent roundtrip plus a handful of SubtleCrypto calls.
 *   - **Initialization** (init-wallet, import-wallet, unlock-request)
 *     is single-use and does PBKDF2 on the password; budgets are
 *     deliberately loose so a steep KDF parameter bump does not
 *     immediately paint every wallet launch as a breach.
 *   - **Outbound / event-only** kinds (state-update, provider-event,
 *     …) rarely land on the request dispatcher, but we still
 *     register very-lenient budgets so that when they DO flow
 *     through the measurement shim, the monitor produces a real
 *     snapshot instead of silently dropping the sample.
 *
 * Tune these in follow-up work after a week of real telemetry —
 * the whole point of the rolling window is to make that tuning
 * data-driven rather than guessed.
 */

import type { BridgeMessageKind } from "@aethelred/wallet-connect";
import type { HandlerSlo } from "./slo-monitor";

/**
 * The exhaustive default SLO table. Every {@link BridgeMessageKind}
 * variant appears exactly once; adding a new kind and forgetting to
 * register an SLO triggers the exhaustiveness guard in the
 * background message dispatcher because the `kind` field becomes
 * `never` and the SloMonitor receives an unknown-kind warning.
 */
// Note: intentionally *not* explicitly typed as `readonly HandlerSlo[]`
// — the `as const` below preserves literal types so the exhaustiveness
// check at the bottom of the file can surface missing kinds at compile
// time. The shape is still assignable to HandlerSlo[].
export const DEFAULT_SLOS = [
  /* ─── State reads — in-memory, single-digit ms ───────────────── */
  { kind: "get-state",          p50Ms: 10,  p99Ms: 50,  maxMs: 150,  category: "state" },
  { kind: "lock-state",         p50Ms: 5,   p99Ms: 25,  maxMs: 75,   category: "state" },
  { kind: "popup-ready",        p50Ms: 10,  p99Ms: 50,  maxMs: 150,  category: "state" },
  { kind: "content-ready",      p50Ms: 10,  p99Ms: 50,  maxMs: 150,  category: "state" },

  /* ─── RPC reads — network-bound, wide latency distribution ───── */
  { kind: "rpc-request",        p50Ms: 80,  p99Ms: 500, maxMs: 3000, category: "rpc" },
  { kind: "rpc-response",       p50Ms: 10,  p99Ms: 50,  maxMs: 200,  category: "rpc" },
  { kind: "get-balances",       p50Ms: 150, p99Ms: 800, maxMs: 5000, category: "rpc" },
  { kind: "get-tx-history",     p50Ms: 100, p99Ms: 500, maxMs: 3000, category: "rpc" },
  { kind: "get-gas",            p50Ms: 50,  p99Ms: 300, maxMs: 2000, category: "rpc" },
  { kind: "get-token-allowances", p50Ms: 50, p99Ms: 300, maxMs: 2000, category: "rpc" },

  /* ─── Signing / approval — CPU-bound crypto ──────────────────── */
  { kind: "prepare-tx",         p50Ms: 40,  p99Ms: 200, maxMs: 1000, category: "approval" },
  { kind: "execute-tx",         p50Ms: 60,  p99Ms: 250, maxMs: 2000, category: "approval" },
  { kind: "cancel-tx",          p50Ms: 20,  p99Ms: 100, maxMs: 500,  category: "approval" },
  { kind: "approval-request",   p50Ms: 20,  p99Ms: 100, maxMs: 500,  category: "approval" },
  { kind: "approval-response",  p50Ms: 30,  p99Ms: 150, maxMs: 500,  category: "approval" },

  /* ─── Passkey / WebAuthn — SubtleCrypto + UA prompt ──────────── */
  { kind: "passkey-enroll",     p50Ms: 15,  p99Ms: 75,  maxMs: 250,  category: "passkey" },
  { kind: "passkey-verify",     p50Ms: 25,  p99Ms: 100, maxMs: 500,  category: "passkey" },
  { kind: "passkey-remove",     p50Ms: 10,  p99Ms: 50,  maxMs: 200,  category: "passkey" },
  { kind: "passkey-list",       p50Ms: 5,   p99Ms: 25,  maxMs: 100,  category: "passkey" },
  { kind: "passkey-set-label",  p50Ms: 10,  p99Ms: 50,  maxMs: 200,  category: "passkey" },

  /* ─── Audit ──────────────────────────────────────────────────── */
  { kind: "get-audit-events",   p50Ms: 20,  p99Ms: 100, maxMs: 500,  category: "audit" },

  /* ─── Account management — in-memory mutation ────────────────── */
  { kind: "derive-account",     p50Ms: 40,  p99Ms: 200, maxMs: 1000, category: "state" },
  { kind: "set-active-account", p50Ms: 10,  p99Ms: 50,  maxMs: 200,  category: "state" },
  { kind: "rename-account",     p50Ms: 15,  p99Ms: 75,  maxMs: 250,  category: "state" },

  /* ─── Tokens ─────────────────────────────────────────────────── */
  { kind: "add-token",          p50Ms: 15,  p99Ms: 75,  maxMs: 300,  category: "state" },
  { kind: "remove-token",       p50Ms: 10,  p99Ms: 50,  maxMs: 200,  category: "state" },
  { kind: "get-tokens",         p50Ms: 5,   p99Ms: 25,  maxMs: 100,  category: "state" },

  /* ─── Networks ───────────────────────────────────────────────── */
  { kind: "get-networks",       p50Ms: 5,   p99Ms: 25,  maxMs: 100,  category: "state" },
  { kind: "switch-network",     p50Ms: 15,  p99Ms: 75,  maxMs: 300,  category: "state" },

  /* ─── Wallet init / import — one-time, KDF-heavy ─────────────── */
  { kind: "init-wallet",        p50Ms: 300, p99Ms: 2000, maxMs: 10000, category: "state" },
  { kind: "import-wallet",      p50Ms: 300, p99Ms: 2000, maxMs: 10000, category: "state" },
  { kind: "unlock-request",     p50Ms: 100, p99Ms: 500,  maxMs: 3000,  category: "state" },
  { kind: "lock-request",       p50Ms: 20,  p99Ms: 100,  maxMs: 500,   category: "state" },
  { kind: "get-recovery-phrase",p50Ms: 30,  p99Ms: 150,  maxMs: 750,   category: "state" },

  /* ─── Tx replacement ─────────────────────────────────────────── */
  { kind: "tx-speed-up",        p50Ms: 50,  p99Ms: 250, maxMs: 2000, category: "approval" },
  { kind: "tx-cancel",          p50Ms: 50,  p99Ms: 250, maxMs: 2000, category: "approval" },
  { kind: "tx-pending-list",    p50Ms: 10,  p99Ms: 50,  maxMs: 200,  category: "state" },

  /* ─── Verifiable credentials ─────────────────────────────────── */
  { kind: "credentials-list",   p50Ms: 15,  p99Ms: 75,  maxMs: 300,  category: "credentials" },
  { kind: "credentials-revoke", p50Ms: 25,  p99Ms: 100, maxMs: 500,  category: "credentials" },
  { kind: "credential-presentation-prepare", p50Ms: 80, p99Ms: 400, maxMs: 2000, category: "credentials" },

  /* ─── WalletConnect ──────────────────────────────────────────── */
  { kind: "wc-pair",            p50Ms: 50,  p99Ms: 250, maxMs: 2000, category: "walletconnect" },
  { kind: "wc-sessions",        p50Ms: 10,  p99Ms: 50,  maxMs: 200,  category: "walletconnect" },
  { kind: "wc-disconnect",      p50Ms: 30,  p99Ms: 150, maxMs: 1000, category: "walletconnect" },
  { kind: "wc-session-proposal",p50Ms: 30,  p99Ms: 150, maxMs: 1000, category: "walletconnect" },
  { kind: "wc-approve-proposal",p50Ms: 30,  p99Ms: 150, maxMs: 1000, category: "walletconnect" },
  { kind: "wc-reject-proposal", p50Ms: 20,  p99Ms: 100, maxMs: 500,  category: "walletconnect" },

  /* ─── Tenant / deployment (graceful-fail placeholders) ───────── */
  { kind: "tenant-list",              p50Ms: 15,  p99Ms: 75,   maxMs: 300,   category: "deployment" },
  { kind: "tenant-plan-migration",    p50Ms: 50,  p99Ms: 250,  maxMs: 2000,  category: "deployment" },
  { kind: "tenant-execute-migration", p50Ms: 500, p99Ms: 2500, maxMs: 15000, category: "deployment" },
  { kind: "tenant-verify-continuity", p50Ms: 30,  p99Ms: 150,  maxMs: 1000,  category: "deployment" },

  /* ─── Outbound / event-only — included for completeness ──────── *
   * These kinds flow background → popup / inpage / subscribers and
   * rarely land on the request dispatcher. We still register lenient
   * budgets so that if they ARE measured (e.g. when reflected back
   * through the bridge during a test), the snapshot pipeline
   * returns a real record instead of tripping the unknown-kind
   * warning log.                                                      */
  { kind: "state-update",           p50Ms: 10, p99Ms: 50,  maxMs: 200,  category: "misc" },
  { kind: "provider-event",         p50Ms: 10, p99Ms: 50,  maxMs: 200,  category: "misc" },
  { kind: "tx-updated",             p50Ms: 10, p99Ms: 50,  maxMs: 200,  category: "misc" },
  { kind: "merkle-batch-ready",     p50Ms: 10, p99Ms: 50,  maxMs: 200,  category: "misc" },
  /* Audit metrics snapshot (PR #115) — pure in-memory read of meter
   * counters; ballpark identical to other state reads. */
  { kind: "get-audit-metrics",      p50Ms: 5,  p99Ms: 30,  maxMs: 100,  category: "state" },
  { kind: "navigate-to-approval",   p50Ms: 10, p99Ms: 50,  maxMs: 200,  category: "misc" },
  { kind: "handshake-init",         p50Ms: 15, p99Ms: 75,  maxMs: 300,  category: "misc" },
  { kind: "handshake-ack",          p50Ms: 15, p99Ms: 75,  maxMs: 300,  category: "misc" },
  /* The SLO-snapshot handler itself — measured so the operator can
   * see the cost of reading the monitor. Budget is generous because
   * it sorts per-handler ring buffers + projects N rows.                */
  { kind: "get-slo-snapshot",       p50Ms: 15, p99Ms: 75,  maxMs: 300,  category: "misc" },
] as const;

/**
 * Assert at compile time that every BridgeMessageKind has an SLO
 * definition. If a new kind is added to the union without a matching
 * entry here, the `never` lookup below fails typechecking with the
 * missing kind in the error message.
 */
type _ExhaustiveKinds = BridgeMessageKind;
// The next line is a compile-time check; it reads "every kind in the
// DEFAULT_SLOS array is assignable to a BridgeMessageKind variant,
// AND every BridgeMessageKind variant appears at least once". The
// `never` branch is what forces exhaustiveness.
type _CoveredKinds = (typeof DEFAULT_SLOS)[number]["kind"];
// If the next alias is `never`, coverage is wrong. TypeScript surfaces
// the missing kind in the error message.
type _MissingKinds = Exclude<_ExhaustiveKinds, _CoveredKinds>;
/** Compile-time exhaustiveness: alias is `never` iff all kinds are covered. */
export type SloExhaustivenessCheck = _MissingKinds extends never ? true : never;
// Explicit `true` witness — if coverage breaks, this assignment fails.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const __sloExhaustivenessWitness: SloExhaustivenessCheck = true;
void __sloExhaustivenessWitness;

/**
 * Widened array view of DEFAULT_SLOS. The `as const` on DEFAULT_SLOS
 * preserves literal types for the compile-time exhaustiveness witness
 * below, but runtime callers of SloMonitor, getHandlerSlo, etc. need a
 * regular `HandlerSlo[]` view. We spread into a fresh mutable array +
 * cast each entry, widening the literal field types (e.g. `p50Ms: 10`
 * becomes `p50Ms: number`) so the array is assignable to
 * `readonly HandlerSlo[]` / `HandlerSlo[]` call sites.
 */
export const DEFAULT_SLOS_LIST: HandlerSlo[] = DEFAULT_SLOS.map<HandlerSlo>((s) => ({
  kind: s.kind,
  p50Ms: s.p50Ms,
  p99Ms: s.p99Ms,
  maxMs: s.maxMs,
  category: s.category,
}));

/**
 * Lookup helper. Returns `undefined` when no SLO is registered, so
 * call sites can choose between strict and lenient handling.
 */
export function getHandlerSlo(kind: BridgeMessageKind): HandlerSlo | undefined {
  return DEFAULT_SLOS_LIST.find((s) => s.kind === kind);
}
