import { useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Landmark,
  Send,
  Users,
  Wallet,
} from "lucide-react";
import { useNavigation } from "../router";
import { TokenLogo } from "../components/token-logo";
import { CurrencyText } from "../components/currency-text";
import { useWalletState } from "../hooks/use-wallet-state";
import { useLiveBalances } from "../hooks/use-live-balances";
import { useAddressBookContacts } from "../services/services-context";
import { EmptyState } from "../components/empty-state";

type SubTab = "overview" | "transfer" | "recipients";

function formatRelativeContactDate(addedAt: number): string {
  const diffMs = Date.now() - addedAt;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "1 day ago";
  if (diffDays < 30) return `${diffDays} days ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return diffMonths === 1 ? "1 month ago" : `${diffMonths} months ago`;
}

function formatLastUpdatedAt(lastUpdatedAt: number | null): string | null {
  if (!lastUpdatedAt) return null;
  return new Date(lastUpdatedAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Payments is a live-account launcher and overview. Batch execution,
 * scheduling, settlement queues, compliance status, and volume analytics are
 * deliberately absent until authoritative services exist for those features.
 */
export function PaymentsView() {
  const { navigate } = useNavigation();
  const [tab, setTab] = useState<SubTab>("overview");
  const { state, loading, contextError } = useWalletState();
  const savedContacts = useAddressBookContacts();
  const activeAccount = state?.activeAccountId
    ? state.accounts.find((account) => account.id === state.activeAccountId) ??
      state.accounts[0]
    : state?.accounts[0];
  const {
    tokens,
    totalValue,
    isLoading,
    error,
    lastUpdatedAt,
  } = useLiveBalances(activeAccount?.address);
  const recipients = [...savedContacts].sort(
    (a, b) => b.addedAt - a.addedAt,
  );
  const lastUpdatedLabel = formatLastUpdatedAt(lastUpdatedAt);
  const hasPricedBalance = tokens.some((token) => token.value !== null);

  return (
    <div className="view-padded">
      <div className="sub-tabs">
        <button
          className={`sub-tab ${tab === "overview" ? "active" : ""}`}
          onClick={() => setTab("overview")}
          type="button"
        >
          <BarChart3 size={13} /> Overview
        </button>
        <button
          className={`sub-tab ${tab === "transfer" ? "active" : ""}`}
          onClick={() => setTab("transfer")}
          type="button"
        >
          <Send size={13} /> Transfer
        </button>
        <button
          className={`sub-tab ${tab === "recipients" ? "active" : ""}`}
          onClick={() => setTab("recipients")}
          type="button"
        >
          <Users size={13} /> Recipients
        </button>
      </div>

      {contextError ? (
        <EmptyState
          icon={<AlertTriangle size={24} />}
          title="Wallet context unavailable"
          description={contextError}
          tone="warning"
          action={{ label: "Open Accounts", onClick: () => navigate("accounts") }}
        />
      ) : null}

      {!contextError && !loading && !activeAccount ? (
        <EmptyState
          icon={<Wallet size={24} />}
          title="No active account connected"
          description="Payments needs an initialized wallet account before it can show live balances or saved recipients."
          tone="info"
          action={{ label: "Open Accounts", onClick: () => navigate("accounts") }}
        />
      ) : null}

      {!contextError && activeAccount && tab === "overview" && (
        <div>
          <div className="ac-hero" style={{ paddingBottom: 4 }}>
            <span className="ac-hero-label">Production Treasury</span>
            <h1 className="ac-hero-amount" style={{ fontSize: 28 }}>
              {isLoading ? (
                "Loading..."
              ) : hasPricedBalance ? (
                <CurrencyText
                  value={totalValue}
                  compact
                  maximumFractionDigits={1}
                />
              ) : (
                "—"
              )}
            </h1>
            <span className="ac-hero-sub">
              {tokens.length > 0
                ? `${tokens.length} live asset${tokens.length === 1 ? "" : "s"} from ${activeAccount.label ?? "active account"}`
                : "No funded assets detected for the active account"}
            </span>
          </div>

          {error ? (
            <EmptyState
              icon={<AlertTriangle size={24} />}
              title="Live balances are temporarily unavailable"
              description={error.message}
              tone="warning"
              action={{ label: "Open Send", onClick: () => navigate("send") }}
            />
          ) : tokens.length > 0 ? (
            <>
              <div className="section-header">
                <h3>Live Assets</h3>
                {lastUpdatedLabel && <span>Updated {lastUpdatedLabel}</span>}
              </div>
              {tokens.slice(0, 4).map((token) => (
                <div className="xfer-tx-row" key={token.address}>
                  <div
                    className="xfer-tx-icon"
                    style={{ background: "rgba(255,255,255,0.08)" }}
                  >
                    <TokenLogo symbol={token.symbol} size={20} />
                  </div>
                  <div className="xfer-tx-info">
                    <strong>{token.name}</strong>
                    <span>
                      {token.balance} {token.symbol}
                    </span>
                  </div>
                  <div className="xfer-tx-amount">
                    {token.value === null || token.change24h === null ? (
                      <strong>Unpriced</strong>
                    ) : (
                      <>
                        <strong>
                          <CurrencyText
                            value={token.value}
                            compact
                            maximumFractionDigits={1}
                          />
                        </strong>
                        <span>
                          {token.change24h >= 0 ? "+" : ""}
                          {token.change24h.toFixed(2)}%
                        </span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </>
          ) : (
            <EmptyState
              icon={<Landmark size={24} />}
              title="No treasury balances yet"
              description="This overview only renders verified on-chain balances. Fund the active account to populate it."
              tone="info"
              action={{ label: "Open Receive", onClick: () => navigate("receive") }}
            />
          )}
        </div>
      )}

      {!contextError && activeAccount && tab === "transfer" && (
        <EmptyState
          icon={<ArrowUpRight size={24} />}
          title="Send from the active account"
          description="Transfers use the wallet's live gas quote, policy review, signing, and broadcast flow."
          tone="info"
          action={{
            label: "Open Send",
            onClick: () => navigate("send"),
            primary: true,
          }}
        />
      )}

      {!contextError && activeAccount && tab === "recipients" && (
        <div>
          <div className="section-header">
            <h3>Saved Recipients</h3>
            <span>
              {recipients.length} contact{recipients.length === 1 ? "" : "s"}
            </span>
          </div>
          {recipients.length === 0 ? (
            <EmptyState
              icon={<Users size={24} />}
              title="No saved recipients"
              description="Add a verified address in Contacts before using it from Payments."
              tone="info"
              action={{ label: "Open Contacts", onClick: () => navigate("contacts") }}
            />
          ) : (
            recipients.map((recipient) => (
              <button
                className="xfer-tx-row"
                key={recipient.address}
                type="button"
                onClick={() =>
                  navigate("send", {
                    to: recipient.address,
                  })
                }
              >
                <div className="xfer-tx-icon">
                  <Users size={16} />
                </div>
                <div className="xfer-tx-info">
                  <strong>{recipient.label}</strong>
                  <span>{recipient.address}</span>
                </div>
                <span>Added {formatRelativeContactDate(recipient.addedAt)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
