import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, AlertTriangle, ArrowDownLeft, ArrowUpRight, CheckCircle2, Fuel,
  Loader2, TrendingDown, TrendingUp, XCircle, Zap,
} from "lucide-react";
import { useBackground } from "../hooks/use-background";
import { useNavigation } from "../router";
import "../../styles/legacy/tx-detail.css";

/* ─── Lightweight local shapes mirroring @aethelred/wallet-simulation ──
 * Kept local so the view stays decoupled from the package build graph
 * and can render partial results during streaming simulation. */
type Outcome = "success" | "revert" | "warning";

interface BalanceChange {
  symbol: string; amount: string; direction: "in" | "out"; usdValue?: string;
}
interface DecodedEvent {
  name: string; signature?: string; args?: Record<string, string>;
  address?: string; topics?: string[];
}
interface Warning {
  id: string; level: "low" | "medium" | "high" | "critical";
  title: string; description: string;
}
interface GasEstimate {
  gasLimit?: string; gasPrice?: string; totalCostWei?: string; totalCostUsd?: string;
}
interface SimResult {
  status: Outcome;
  balanceChanges: BalanceChange[];
  events: DecodedEvent[];
  warnings: Warning[];
  gasEstimate?: GasEstimate;
  error?: string;
}

const OUTCOME_META: Record<Outcome, { label: string; color: string; soft: string; icon: typeof CheckCircle2 }> = {
  success: { label: "Simulation passed",  color: "#34c759", soft: "rgba(52,199,89,0.14)", icon: CheckCircle2  },
  revert:  { label: "Reverts on execution", color: "#ff3b30", soft: "rgba(255,59,48,0.14)", icon: XCircle      },
  warning: { label: "Proceed with caution", color: "#ff9f0a", soft: "rgba(255,159,10,0.14)", icon: AlertTriangle },
};

export function SimulationPreviewView() {
  const { send } = useBackground();
  const { navigate, params } = useNavigation();

  const [sim, setSim] = useState<SimResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (send as any)("simulate-transaction", params ?? {})
      .then((r: any) => {
        if (r && typeof r === "object") {
          setSim({
            status: r.status === "success" ? "success"
              : r.status === "revert" ? "revert"
              : (r.warnings?.length ?? r.riskSignals?.length ?? 0) > 0 ? "warning" : "success",
            balanceChanges: r.balanceChanges ?? [],
            events: r.events ?? r.decodedEvents ?? [],
            warnings: (r.warnings ?? r.riskSignals ?? []).map((w: any) => ({
              id: w.id ?? Math.random().toString(36).slice(2),
              level: w.level ?? "medium",
              title: w.title ?? "Risk detected",
              description: w.description ?? "",
            })),
            gasEstimate: r.gasEstimate,
            error: r.error,
          });
        }
      })
      .catch((err: any) => setSim({
        status: "revert", balanceChanges: [], events: [], warnings: [],
        error: err?.message ?? "Simulation failed",
      }))
      .finally(() => setLoading(false));
  }, [params, send]);

  const outcome: Outcome = sim?.status ?? (loading ? "success" : "warning");
  const meta = OUTCOME_META[outcome];
  const OutcomeIcon = meta.icon;

  const hasContent = useMemo(() => sim && (
    sim.balanceChanges.length > 0 || sim.events.length > 0 || sim.warnings.length > 0
  ), [sim]);

  return (
    <div className="view-padded">
      <button className="acc-back" onClick={() => navigate("approvals")} type="button">
        <ArrowLeft size={14} strokeWidth={2.3} /><span>Back</span>
      </button>

      {/* Simulation hero — cyan "pre-execution" accent */}
      <div className="sim-hero">
        <div className="sim-hero-top">
          <div className="sim-hero-badge">
            <Zap size={16} strokeWidth={2.4} />
          </div>
          <div className="sim-hero-body">
            <span className="sim-hero-kicker">PRE-EXECUTION</span>
            <strong className="sim-hero-title">Transaction Preview</strong>
            <span className="sim-hero-sub">Dry-run outcome before signing</span>
          </div>
        </div>
        <div className="sim-outcome" style={{
          background: meta.soft, color: meta.color, borderColor: `${meta.color}60`,
        }}>
          {loading
            ? <><Loader2 size={12} className="txd-spin" /> Simulating…</>
            : <><OutcomeIcon size={12} strokeWidth={2.6} /> {meta.label}</>}
        </div>
      </div>

      {sim?.error && (
        <div className="sim-error">
          <XCircle size={14} /> <span>{sim.error}</span>
        </div>
      )}

      {/* Balance changes */}
      {sim && sim.balanceChanges.length > 0 && (
        <>
          <div className="txd-section-label">BALANCE CHANGES</div>
          <div className="sim-balances">
            {sim.balanceChanges.map((bc, i) => {
              const out = bc.direction === "out";
              const Icon = out ? ArrowUpRight : ArrowDownLeft;
              const Trend = out ? TrendingDown : TrendingUp;
              const color = out ? "var(--danger)" : "var(--success)";
              return (
                <div className="sim-balance-row" key={i}>
                  <div className="sim-balance-left">
                    <div className="sim-balance-icon" style={{ color, background: `${color}1a` }}>
                      <Icon size={14} strokeWidth={2.5} />
                    </div>
                    <div className="sim-balance-info">
                      <strong>{bc.symbol}</strong>
                      {bc.usdValue && <span>≈ {bc.usdValue}</span>}
                    </div>
                  </div>
                  <div className="sim-balance-delta" style={{ color }}>
                    <Trend size={11} strokeWidth={2.5} />
                    {out ? "-" : "+"}{bc.amount}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Decoded events */}
      {sim && sim.events.length > 0 && (
        <>
          <div className="txd-section-label">EVENT LOG</div>
          <div className="sim-events">
            {sim.events.map((ev, i) => (
              <div className="sim-event" key={i}>
                <strong>{ev.name ?? "Unknown event"}</strong>
                {ev.signature && <code className="sim-event-sig">{ev.signature}</code>}
                {ev.args && Object.keys(ev.args).length > 0 ? (
                  <div className="sim-event-args">
                    {Object.entries(ev.args).map(([k, v]) => (
                      <div key={k}><span>{k}</span><code>{String(v)}</code></div>
                    ))}
                  </div>
                ) : ev.topics && ev.topics.length > 0 ? (
                  <div className="sim-event-topics">
                    {ev.topics.map((t, j) => <code key={j}>{t.slice(0, 10)}…</code>)}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Gas estimate */}
      {sim?.gasEstimate && (
        <>
          <div className="txd-section-label">GAS ESTIMATE</div>
          <div className="sim-gas">
            <div className="sim-gas-icon"><Fuel size={14} strokeWidth={2.4} /></div>
            <div className="sim-gas-body">
              <strong>{sim.gasEstimate.totalCostUsd ?? sim.gasEstimate.totalCostWei ?? "—"}</strong>
              <span>
                {sim.gasEstimate.gasLimit && <>Limit {sim.gasEstimate.gasLimit}</>}
                {sim.gasEstimate.gasLimit && sim.gasEstimate.gasPrice && " · "}
                {sim.gasEstimate.gasPrice && <>Price {sim.gasEstimate.gasPrice}</>}
              </span>
            </div>
          </div>
        </>
      )}

      {/* Warnings */}
      {sim && sim.warnings.length > 0 && (
        <>
          <div className="txd-section-label">WARNINGS</div>
          <div className="sim-warnings">
            {sim.warnings.map((w) => (
              <div className={`sim-warning level-${w.level}`} key={w.id}>
                <AlertTriangle size={14} strokeWidth={2.5} />
                <div>
                  <strong>{w.title}</strong>
                  {w.description && <p>{w.description}</p>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {!loading && !hasContent && !sim?.error && (
        <div className="acc-empty">
          <CheckCircle2 size={20} />
          <strong>Nothing notable</strong>
          <span>The simulator reported no balance changes, events, or warnings.</span>
        </div>
      )}

      {/* Bottom actions */}
      <div className="sim-footer">
        <button className="sim-btn secondary" onClick={() => navigate("approvals")} type="button">
          Cancel
        </button>
        <button className="sim-btn primary" type="button" disabled={outcome === "revert"}>
          Sign &amp; Send
        </button>
      </div>
    </div>
  );
}
