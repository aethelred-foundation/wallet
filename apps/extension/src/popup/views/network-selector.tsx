import { useState, useMemo } from "react";
import {
  Globe, Check, ArrowLeft, TestTube,
  ExternalLink,
} from "lucide-react";
import { type NetworkConfig } from "@aethelred/wallet-simulation";
import { useNavigation } from "../router";
import { useNetworkManager } from "../services/services-context";

/* ─── Chain ID → accent color + short icon override ───────────────── *
 * Well-known chains get their own brand color. Everything else falls
 * back to a neutral teal. Chain IDs can come in decimal OR hex form
 * from the NetworkManager, so we store both. */
const CHAIN_META: Record<string, { color: string; short: string }> = {
  "1":      { color: "#627eea", short: "ETH"  },  // Ethereum mainnet (decimal)
  "0x1":    { color: "#627eea", short: "ETH"  },  // Ethereum mainnet (hex)
  "137":    { color: "#8247e5", short: "POL"  },  // Polygon (decimal)
  "0x89":   { color: "#8247e5", short: "POL"  },  // Polygon (hex)
  "42161":  { color: "#2775ca", short: "ARB"  },  // Arbitrum (decimal)
  "0xa4b1": { color: "#2775ca", short: "ARB"  },  // Arbitrum (hex)
  "10":     { color: "#ff0420", short: "OP"   },  // Optimism (decimal)
  "0xa":    { color: "#ff0420", short: "OP"   },  // Optimism (hex)
  "8453":   { color: "#0052ff", short: "BASE" },  // Base (decimal)
  "0x2105": { color: "#0052ff", short: "BASE" },  // Base (hex)
};

const DEFAULT_COLOR = "#14b8a6";

function colorFor(net: NetworkConfig): string {
  return CHAIN_META[net.chainId]?.color ?? DEFAULT_COLOR;
}
function shortFor(net: NetworkConfig): string {
  return CHAIN_META[net.chainId]?.short ?? net.nativeCurrency.symbol.slice(0, 4);
}

export function NetworkSelectorView() {
  const { navigate } = useNavigation();
  const networkManager = useNetworkManager();
  const [activeChainId, setActiveChainId] = useState(() => networkManager.getActiveChainId());
  const [showTestnets, setShowTestnets] = useState(false);

  /* ─── Why `networkManager` is in the deps array ───
   * Previously this was a module-level singleton with a stable identity
   * so `useMemo` with `[]` was safe. Now that it comes from context we
   * depend on its identity to stay stable across renders (ServicesProvider
   * uses useMemo with empty deps to guarantee this), so [networkManager]
   * is a safety net rather than a real re-run trigger. */
  const mainnets = useMemo(() => networkManager.listMainnets(), [networkManager]);
  const testnets = useMemo(() => networkManager.listTestnets(), [networkManager]);

  const activeNetwork = useMemo(
    () => [...mainnets, ...testnets].find(n => n.chainId === activeChainId),
    [mainnets, testnets, activeChainId],
  );

  const handleSwitch = (chainId: string) => {
    networkManager.switchChain(chainId);
    setActiveChainId(chainId);
  };

  return (
    <div className="view-padded">
      <button className="acc-back" onClick={() => navigate("settings")} type="button">
        <ArrowLeft size={14} strokeWidth={2.3} />
        <span>Settings</span>
      </button>

      {/* ═════ Hero — active network summary ═════ */}
      <div className="net-hero">
        <div className="net-hero-top">
          <div className="net-hero-icon">
            <Globe size={20} strokeWidth={2.3} />
          </div>
          <div className="net-hero-info">
            <span className="net-hero-label">NETWORKS</span>
            <strong className="net-hero-title">
              {mainnets.length + (showTestnets ? testnets.length : 0)} <span>available</span>
            </strong>
            <span className="net-hero-sub">Ethereum-compatible &amp; Aethelred L1</span>
          </div>
          <div className="net-hero-status">
            <div className="net-hero-dot pulse" />
          </div>
        </div>
        {activeNetwork && (
          <div className="net-hero-active">
            <span className="net-hero-active-label">CONNECTED TO</span>
            <div className="net-hero-active-row">
              <div
                className="net-hero-active-pill"
                style={{ background: `${colorFor(activeNetwork)}28`, borderColor: `${colorFor(activeNetwork)}60` }}
              >
                <div
                  className="net-hero-active-dot"
                  style={{ background: colorFor(activeNetwork) }}
                />
                <strong style={{ color: "var(--ink)" }}>{activeNetwork.name}</strong>
              </div>
              <span className="net-hero-chain-id">Chain {activeNetwork.chainId}</span>
            </div>
          </div>
        )}
      </div>

      {/* ═════ Testnet toggle (iOS style) ═════ */}
      <div className="net-testnet-row" onClick={() => setShowTestnets(!showTestnets)} role="button" tabIndex={0}>
        <div className="net-testnet-icon">
          <TestTube size={13} strokeWidth={2.4} />
        </div>
        <div className="net-testnet-body">
          <strong>Show testnets</strong>
          <span>{showTestnets ? `${testnets.length} test networks visible` : "Development and test chains"}</span>
        </div>
        <div className={`set-toggle ${showTestnets ? "on" : ""}`}>
          <div className="set-toggle-thumb" />
        </div>
      </div>

      {/* ═════ Mainnet section ═════ */}
      <div className="net-section-label">
        <span>MAINNETS</span>
        <span className="net-section-count">{mainnets.length}</span>
      </div>
      <div className="net-list">
        {mainnets.map(net => (
          <NetworkCard
            key={net.chainId}
            network={net}
            active={activeChainId === net.chainId}
            onClick={() => handleSwitch(net.chainId)}
          />
        ))}
      </div>

      {/* ═════ Testnet section (when enabled) ═════ */}
      {showTestnets && testnets.length > 0 && (
        <>
          <div className="net-section-label">
            <span>TESTNETS</span>
            <span className="net-section-count">{testnets.length}</span>
          </div>
          <div className="net-list">
            {testnets.map(net => (
              <NetworkCard
                key={net.chainId}
                network={net}
                active={activeChainId === net.chainId}
                onClick={() => handleSwitch(net.chainId)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ─── Network card component ───────────────────────────────────────── */
function NetworkCard({
  network,
  active,
  onClick,
}: {
  network: NetworkConfig;
  active: boolean;
  onClick: () => void;
}) {
  const color = colorFor(network);
  const short = shortFor(network);

  return (
    <button className={`net-card ${active ? "active" : ""}`} onClick={onClick} type="button">
      <div
        className="net-card-logo"
        style={{
          background: `linear-gradient(135deg, ${color} 0%, ${color}c0 100%)`,
          boxShadow: `0 4px 14px ${color}40`,
        }}
      >
        <strong>{short.slice(0, 3)}</strong>
      </div>
      <div className="net-card-body">
        <div className="net-card-top">
          <strong>{network.name}</strong>
          {network.isTestnet && (
            <span className="net-card-testnet">
              <TestTube size={9} strokeWidth={2.6} />
              Testnet
            </span>
          )}
        </div>
        <div className="net-card-meta">
          <span>{network.nativeCurrency.symbol}</span>
          <span className="net-meta-dot" />
          <span>Chain {network.chainId}</span>
          {network.blockExplorerUrl && (
            <>
              <span className="net-meta-dot" />
              <span className="net-card-explorer">
                <ExternalLink size={8} strokeWidth={2.6} />
                Explorer
              </span>
            </>
          )}
        </div>
      </div>
      <div className={`net-card-select ${active ? "active" : ""}`}>
        {active ? <Check size={12} strokeWidth={3.2} /> : null}
      </div>
    </button>
  );
}
