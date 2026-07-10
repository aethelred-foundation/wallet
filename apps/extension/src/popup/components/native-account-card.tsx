/**
 * NativeAccountCard
 * ─────────────────
 * Surfaces the account's NATIVE Aethelred identity — the canonical
 * `aethel1…` bech32 address the L1's explorer, staking, and governance
 * speak — alongside the native balance and live delegations.
 *
 * Design stance: the native address is the CANONICAL identity of the
 * account on the sovereign chain; the `0x…` the rest of the wallet shows
 * is the EVM view of the same key. This card is where that duality
 * becomes visible to the user.
 *
 * Honest states:
 *  - identity always renders (derived locally, no network required);
 *  - balances/delegations show a plain "node unreachable" note when the
 *    LCD is down — never fabricated placeholders.
 */

import { useCopyToClipboard } from "../hooks/use-copy-to-clipboard";
import {
  formatUaethel,
  useNativeAccount,
} from "../hooks/use-native-account";

const styles: Record<string, React.CSSProperties> = {
  card: {
    border: "1px solid var(--border-color, rgba(128,128,128,0.25))",
    borderRadius: 12,
    padding: "14px 16px",
    marginTop: 12,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  title: { fontSize: 13, fontWeight: 600, opacity: 0.9 },
  badge: { fontSize: 10, opacity: 0.6, letterSpacing: 0.4 },
  address: {
    fontFamily: "ui-monospace, monospace",
    fontSize: 12,
    wordBreak: "break-all",
    cursor: "pointer",
  },
  metaRow: { display: "flex", justifyContent: "space-between", fontSize: 12 },
  label: { opacity: 0.6 },
  mono: { fontFamily: "ui-monospace, monospace" },
  note: { fontSize: 11, opacity: 0.55 },
};

function shortValoper(valoper: string): string {
  return valoper.length > 24
    ? `${valoper.slice(0, 16)}…${valoper.slice(-6)}`
    : valoper;
}

export function NativeAccountCard({
  evmAddress,
  lcdBaseUrl,
}: {
  evmAddress: string;
  lcdBaseUrl?: string;
}) {
  const native = useNativeAccount(evmAddress, lcdBaseUrl);
  const { copy, copied } = useCopyToClipboard();

  if (native.status === "invalid-address") return null;

  return (
    <section style={styles.card} aria-label="Native Aethelred account">
      <div style={styles.headerRow}>
        <span style={styles.title}>Native identity — Aethelred L1</span>
        <span style={styles.badge}>same key as {evmAddress.slice(0, 8)}…</span>
      </div>

      <code
        style={styles.address}
        title="Canonical bech32 address (click to copy)"
        onClick={() => void copy(native.nativeAddress, "native-addr")}
      >
        {native.nativeAddress}
        {copied === "native-addr" ? "  ✓" : ""}
      </code>

      {native.status === "unreachable" ? (
        <span style={styles.note}>
          Chain endpoint unreachable — identity derived locally; balance and
          staking will load when a node is available.
        </span>
      ) : (
        <>
          <div style={styles.metaRow}>
            <span style={styles.label}>Native balance</span>
            <span style={styles.mono}>
              {native.status === "loading"
                ? "…"
                : `${formatUaethel(native.balanceUaethel)} AETHEL`}
            </span>
          </div>
          {native.status === "ready" && native.delegations.length > 0 && (
            <div>
              <div style={{ ...styles.label, fontSize: 12, marginBottom: 4 }}>
                Staked
              </div>
              {native.delegations.map((d) => (
                <div style={styles.metaRow} key={d.validator}>
                  <span style={styles.mono} title={d.validator}>
                    {shortValoper(d.validator)}
                  </span>
                  <span style={styles.mono}>
                    {formatUaethel(d.amountUaethel)} AETHEL
                  </span>
                </div>
              ))}
            </div>
          )}
          {native.status === "ready" && native.delegations.length === 0 && (
            <span style={styles.note}>No active delegations.</span>
          )}
        </>
      )}
    </section>
  );
}
