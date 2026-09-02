import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Fingerprint,
  Key,
  Lock,
  Plus,
  ShieldCheck,
  Smartphone,
  Trash2,
  Usb,
  Bluetooth,
  Radio,
  X,
} from "lucide-react";
import { ConfirmModal } from "../components/confirm-modal";
import { useBackground } from "../hooks/use-background";
import { useNavigation } from "../router";
import { usePasskeyEnrollment } from "../hooks/use-passkey-enrollment";

interface StoredPasskey {
  id: string;
  label: string;
  credentialId: string;
  rpId: string;
  transports?: string[];
  issuedAt: number;
  lastUsedAt?: number;
}

interface SecuritySettings {
  autoLockMs: number;
  passkeyCount: number;
  transactionReview: boolean;
  localKeyEncryption: boolean;
}

const AUTO_LOCK_OPTIONS = [1, 5, 15, 30, 60] as const;
const AUTO_LOCK_VALUES = new Set<number>(AUTO_LOCK_OPTIONS.map((minutes) => minutes * 60_000));

type LoadState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePasskeys(value: unknown): StoredPasskey[] {
  if (!Array.isArray(value)) {
    throw new Error("The wallet returned invalid passkey data");
  }

  return value.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      item.id.trim().length === 0 ||
      typeof item.label !== "string" ||
      typeof item.credentialId !== "string" ||
      item.credentialId.trim().length === 0 ||
      typeof item.rpId !== "string" ||
      item.rpId.trim().length === 0 ||
      typeof item.issuedAt !== "number" ||
      !Number.isFinite(item.issuedAt) ||
      item.issuedAt < 0 ||
      (item.lastUsedAt !== undefined &&
        (typeof item.lastUsedAt !== "number" ||
          !Number.isFinite(item.lastUsedAt) ||
          item.lastUsedAt < 0)) ||
      (item.transports !== undefined &&
        (!Array.isArray(item.transports) ||
          item.transports.some((transport) => typeof transport !== "string")))
    ) {
      throw new Error("The wallet returned invalid passkey data");
    }

    return {
      id: item.id,
      label: item.label,
      credentialId: item.credentialId,
      rpId: item.rpId,
      transports: item.transports as string[] | undefined,
      issuedAt: item.issuedAt,
      lastUsedAt: item.lastUsedAt as number | undefined,
    };
  });
}

function parseSecuritySettings(value: unknown): SecuritySettings {
  if (
    !isRecord(value) ||
    typeof value.autoLockMs !== "number" ||
    !AUTO_LOCK_VALUES.has(value.autoLockMs) ||
    typeof value.passkeyCount !== "number" ||
    !Number.isSafeInteger(value.passkeyCount) ||
    value.passkeyCount < 0 ||
    typeof value.transactionReview !== "boolean" ||
    typeof value.localKeyEncryption !== "boolean"
  ) {
    throw new Error("The wallet returned invalid security settings");
  }

  return {
    autoLockMs: value.autoLockMs,
    passkeyCount: value.passkeyCount,
    transactionReview: value.transactionReview,
    localKeyEncryption: value.localKeyEncryption,
  };
}

function parseAutoLockResult(value: unknown): number {
  if (
    !isRecord(value) ||
    typeof value.autoLockMs !== "number" ||
    !AUTO_LOCK_VALUES.has(value.autoLockMs)
  ) {
    throw new Error("The wallet did not confirm the auto-lock change");
  }
  return value.autoLockMs;
}

function loadError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function transportIcon(transport: string) {
  switch (transport) {
    case "usb":
      return Usb;
    case "ble":
      return Bluetooth;
    case "nfc":
      return Radio;
    case "internal":
      return Smartphone;
    default:
      return ShieldCheck;
  }
}

function formatRelative(timestamp?: number): string {
  if (!timestamp) return "Never";
  const days = Math.floor((Date.now() - timestamp) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function SecurityView() {
  const { send } = useBackground();
  const { navigate } = useNavigation();
  const { enroll, verifySupport, enrolling } = usePasskeyEnrollment();

  const [passkeyState, setPasskeyState] = useState<LoadState<StoredPasskey[]>>({
    status: "loading",
  });
  const [settingsState, setSettingsState] = useState<LoadState<SecuritySettings>>({
    status: "loading",
  });
  const [showAutoLock, setShowAutoLock] = useState(false);
  const [savingAutoLock, setSavingAutoLock] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [enrollSheetOpen, setEnrollSheetOpen] = useState(false);
  const [enrollLabel, setEnrollLabel] = useState("");
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [passkeySupport, setPasskeySupport] = useState<{
    supported: boolean;
    reason?: string;
  } | null>(null);
  const [removeTarget, setRemoveTarget] = useState<StoredPasskey | null>(null);
  const [removingCredentialId, setRemovingCredentialId] = useState<string | null>(null);

  const refreshSecurity = useCallback(async () => {
    setActionError(null);
    setPasskeyState({ status: "loading" });
    setSettingsState({ status: "loading" });

    const [listed, current] = await Promise.allSettled([
      send("passkey-list", {}),
      send("get-security-settings", {}),
    ]);

    if (listed.status === "fulfilled") {
      try {
        setPasskeyState({ status: "ready", data: parsePasskeys(listed.value) });
      } catch (error) {
        setPasskeyState({
          status: "error",
          message: loadError(error, "Could not validate passkey data"),
        });
      }
    } else {
      setPasskeyState({
        status: "error",
        message: loadError(listed.reason, "Could not load passkeys"),
      });
    }

    if (current.status === "fulfilled") {
      try {
        setSettingsState({
          status: "ready",
          data: parseSecuritySettings(current.value),
        });
      } catch (error) {
        setSettingsState({
          status: "error",
          message: loadError(error, "Could not validate security settings"),
        });
      }
    } else {
      setSettingsState({
        status: "error",
        message: loadError(current.reason, "Could not load security settings"),
      });
    }
  }, [send]);

  useEffect(() => {
    void refreshSecurity();
    void verifySupport()
      .then(setPasskeySupport)
      .catch(() => setPasskeySupport({ supported: false, reason: "Passkey capability probe failed" }));
  }, [refreshSecurity, verifySupport]);

  const passkeys = passkeyState.status === "ready" ? passkeyState.data : null;
  const settings = settingsState.status === "ready" ? settingsState.data : null;
  const autoLockMinutes = settings ? Math.round(settings.autoLockMs / 60_000) : null;
  const setupCoverage = useMemo(() => {
    if (!settings || !passkeys) return null;
    const protections = [
      settings.localKeyEncryption,
      settings.transactionReview,
      settings.autoLockMs > 0,
      passkeys.length > 0,
    ];
    return {
      configured: protections.filter(Boolean).length,
      total: protections.length,
    };
  }, [passkeys, settings]);

  const ringRadius = 36;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = setupCoverage
    ? ringCircumference * (1 - setupCoverage.configured / setupCoverage.total)
    : ringCircumference;

  const handleSetAutoLock = useCallback(async (minutes: number) => {
    if (settingsState.status !== "ready") return;
    setSavingAutoLock(true);
    setActionError(null);
    try {
      const result = await send("set-auto-lock", { autoLockMs: minutes * 60_000 });
      const autoLockMs = parseAutoLockResult(result);
      setSettingsState((previous) => previous.status === "ready"
        ? { status: "ready", data: { ...previous.data, autoLockMs } }
        : previous);
      setShowAutoLock(false);
    } catch (error) {
      setActionError(loadError(error, "Could not update auto-lock"));
    } finally {
      setSavingAutoLock(false);
    }
  }, [send, settingsState.status]);

  const handleEnrollPasskey = useCallback(async () => {
    setEnrollError(null);
    const result = await enroll({
      userId: "aethelred-wallet-owner",
      userName: "wallet-owner",
      userDisplayName: "Aethelred Wallet Owner",
      rpName: "Aethelred Wallet",
      label: enrollLabel.trim() || "Passkey",
    });
    if (!result.ok) {
      setEnrollError(result.error ?? "Passkey enrollment failed");
      return;
    }
    setEnrollSheetOpen(false);
    setEnrollLabel("");
    await refreshSecurity();
  }, [enroll, enrollLabel, refreshSecurity]);

  const handleRemovePasskey = useCallback(async () => {
    if (!removeTarget || removingCredentialId) return;
    const target = removeTarget;
    setRemovingCredentialId(target.credentialId);
    setActionError(null);
    try {
      const result = await send("passkey-remove", { credentialId: target.credentialId });
      if (!isRecord(result) || result.ok !== true) {
        throw new Error("The wallet did not confirm passkey removal");
      }
      setRemoveTarget(null);
      await refreshSecurity();
    } catch (error) {
      setActionError(loadError(error, "Could not remove passkey"));
    } finally {
      setRemovingCredentialId(null);
    }
  }, [refreshSecurity, removeTarget, removingCredentialId, send]);

  const removingLastPasskey =
    removeTarget !== null && passkeys !== null && passkeys.length === 1 &&
    passkeys[0]?.credentialId === removeTarget.credentialId;

  return (
    <div className="view-padded">
      {setupCoverage && (
        <div className="sec-hero">
          <div className="sec-hero-ring-wrap">
            <svg className="sec-hero-ring" viewBox="0 0 80 80" width="80" height="80" aria-hidden="true">
              <circle cx="40" cy="40" r={ringRadius} fill="none" stroke="rgba(52, 199, 89, 0.14)" strokeWidth="7" />
              <circle
                cx="40"
                cy="40"
                r={ringRadius}
                fill="none"
                stroke="url(#sec-ring-gradient)"
                strokeWidth="7"
                strokeLinecap="round"
                strokeDasharray={ringCircumference}
                strokeDashoffset={ringOffset}
                transform="rotate(-90 40 40)"
              />
              <defs>
                <linearGradient id="sec-ring-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#34c759" />
                  <stop offset="100%" stopColor="#30d158" />
                </linearGradient>
              </defs>
            </svg>
            <div className="sec-hero-ring-center">
              <strong>{setupCoverage.configured}/{setupCoverage.total}</strong>
              <span>set up</span>
            </div>
          </div>
          <div className="sec-hero-info">
            <span className="sec-hero-label">SECURITY SETUP COVERAGE</span>
            <strong className="sec-hero-status">
              {setupCoverage.configured} of {setupCoverage.total} protections configured
            </strong>
            <span className="sec-hero-sub">
              <ShieldCheck size={11} strokeWidth={2.6} /> Reported by the wallet runtime
            </span>
          </div>
        </div>
      )}

      {actionError && (
        <div className="sec-warning-strip" role="alert">
          <AlertTriangle size={12} strokeWidth={2.6} />
          <span>{actionError}</span>
        </div>
      )}

      <div className="sec-section-header">
        <div className="sec-section-icon" style={{ background: "linear-gradient(135deg, #34c759 0%, #30d158 100%)" }}>
          <Lock size={12} strokeWidth={2.4} />
        </div>
        <span>ACTIVE PROTECTIONS</span>
      </div>
      <div className="sec-group">
        {settingsState.status === "loading" && (
          <div className="pk-empty-state" role="status" aria-live="polite">
            <strong>Loading security settings…</strong>
            <span>Protection status will appear after the wallet runtime responds.</span>
          </div>
        )}

        {settingsState.status === "error" && (
          <>
            <div className="sec-warning-strip" role="alert">
              <AlertTriangle size={12} strokeWidth={2.6} />
              <span>{settingsState.message}</span>
            </div>
            <button className="sec-row" type="button" onClick={() => void refreshSecurity()}>
              <div className="sec-row-body">
                <strong>Retry security settings</strong>
                <span>No protection status is assumed while settings are unavailable.</span>
              </div>
              <ChevronRight size={14} className="sec-row-chev" />
            </button>
          </>
        )}

        {settings && (
          <>
            <div className="sec-row" style={{ cursor: "default" }}>
              <div className="sec-row-icon" style={{ background: "linear-gradient(135deg, #14b8a6 0%, #2dd4bf 100%)" }}>
                <Key size={14} strokeWidth={2.3} />
              </div>
              <div className="sec-row-body">
                <strong>Encrypted local vault</strong>
                <span>
                  {settings.localKeyEncryption
                    ? "PBKDF2 (600K) · AES-256-GCM · keys remain on this device"
                    : "Local key encryption was not reported as active"}
                </span>
              </div>
              {settings.localKeyEncryption ? (
                <span className="sec-pill good static"><Check size={9} strokeWidth={3.2} /> Active</span>
              ) : (
                <span className="sec-pill static"><AlertTriangle size={9} strokeWidth={2.8} /> Inactive</span>
              )}
            </div>

            <button className="sec-row" onClick={() => setShowAutoLock((value) => !value)} type="button">
              <div className="sec-row-icon" style={{ background: "linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)" }}>
                <Lock size={14} strokeWidth={2.3} />
              </div>
              <div className="sec-row-body">
                <strong>Auto-lock</strong>
                <span>
                  Up to {autoLockMinutes} minute{autoLockMinutes === 1 ? "" : "s"} without wallet activity; browser suspension may lock sooner
                </span>
              </div>
              <ChevronRight size={14} className={`sec-row-chev ${showAutoLock ? "flipped" : ""}`} />
            </button>
            {showAutoLock && (
              <div className="sec-expand">
                <div className="sec-chip-row">
                  {AUTO_LOCK_OPTIONS.map((minutes) => (
                    <button
                      key={minutes}
                      className={`sec-chip ${autoLockMinutes === minutes ? "active" : ""}`}
                      onClick={() => void handleSetAutoLock(minutes)}
                      disabled={savingAutoLock}
                      type="button"
                    >
                      {minutes}m
                    </button>
                  ))}
                </div>
                <div className="sec-row-body">
                  <span>
                    This is the maximum idle duration while the extension is running. Closing the browser or suspending its service worker can clear the unlocked session earlier.
                  </span>
                </div>
              </div>
            )}

            <div className="sec-row" style={{ cursor: "default" }}>
              <div className="sec-row-icon" style={{ background: "linear-gradient(135deg, #6366f1 0%, #818cf8 100%)" }}>
                <ShieldCheck size={14} strokeWidth={2.3} />
              </div>
              <div className="sec-row-body">
                <strong>Transaction intent review</strong>
                <span>
                  {settings.transactionReview
                    ? "Signing requests pass through policy, simulation, and explicit approval"
                    : "Transaction intent review was not reported as active"}
                </span>
              </div>
              {settings.transactionReview ? (
                <span className="sec-pill good static"><Check size={9} strokeWidth={3.2} /> Active</span>
              ) : (
                <span className="sec-pill static"><AlertTriangle size={9} strokeWidth={2.8} /> Inactive</span>
              )}
            </div>
          </>
        )}
      </div>

      <div className="sec-section-header">
        <div className="sec-section-icon" style={{ background: "linear-gradient(135deg, #14b8a6 0%, #2dd4bf 100%)" }}>
          <Fingerprint size={12} strokeWidth={2.4} />
        </div>
        <span>PASSKEY UNLOCK</span>
      </div>
      <div className="sec-group">
        {passkeyState.status === "loading" && (
          <div className="pk-empty-state" role="status" aria-live="polite">
            <strong>Loading passkeys…</strong>
            <span>Unlock requirements will appear after enrolled credentials are verified.</span>
          </div>
        )}

        {passkeyState.status === "error" && (
          <>
            <div className="sec-warning-strip" role="alert">
              <AlertTriangle size={12} strokeWidth={2.6} />
              <span>{passkeyState.message}</span>
            </div>
            <button className="sec-row" type="button" onClick={() => void refreshSecurity()}>
              <div className="sec-row-body">
                <strong>Retry passkey status</strong>
                <span>The wallet will not label unlock as password-only while passkey data is unavailable.</span>
              </div>
              <ChevronRight size={14} className="sec-row-chev" />
            </button>
          </>
        )}

        {passkeys?.length === 0 && (
          <div className="pk-empty-state" role="note">
            <div className="pk-empty-icon"><Fingerprint size={18} strokeWidth={2.2} /></div>
            <strong>Password-only unlock</strong>
            <span>Add a device passkey or compatible USB, NFC, or Bluetooth security key to require it alongside your password on every unlock.</span>
          </div>
        )}

        {passkeys?.map((passkey) => (
          <div className="pk-authenticator-row" key={passkey.id}>
            <div className="sec-row-icon" style={{ background: "linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%)" }}>
              <Fingerprint size={14} strokeWidth={2.3} />
            </div>
            <div className="sec-row-body">
              <strong>{passkey.label || "Unnamed passkey"}</strong>
              <span>Enrolled {formatRelative(passkey.issuedAt)} · Last verified {formatRelative(passkey.lastUsedAt)}</span>
              {!!passkey.transports?.length && (
                <div className="pk-transport-row" aria-label="Passkey transports">
                  {passkey.transports.map((transport) => {
                    const Icon = transportIcon(transport);
                    return (
                      <span className="pk-transport-badge" key={transport} title={transport}>
                        <Icon size={10} strokeWidth={2.4} /> {transport}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
            <button
              type="button"
              className="pk-icon-btn"
              aria-label={`Remove passkey ${passkey.label || "Unnamed passkey"}`}
              onClick={() => setRemoveTarget(passkey)}
              disabled={removingCredentialId !== null}
            >
              <Trash2 size={13} strokeWidth={2.3} />
            </button>
          </div>
        ))}

        <button
          className="sec-row"
          onClick={() => {
            setEnrollError(null);
            setEnrollLabel("");
            setEnrollSheetOpen(true);
          }}
          type="button"
          disabled={passkeyState.status !== "ready" || !passkeySupport?.supported || removingCredentialId !== null}
        >
          <div className="sec-row-icon" style={{ background: "linear-gradient(135deg, #34c759 0%, #30d158 100%)" }}>
            <Plus size={14} strokeWidth={2.3} />
          </div>
          <div className="sec-row-body">
            <strong>Add passkey</strong>
            <span>
              {passkeySupport?.supported
                ? "Use a device passkey or compatible security key with your password"
                : passkeySupport?.reason ?? "Checking passkey support…"}
            </span>
          </div>
          <ChevronRight size={14} className="sec-row-chev" />
        </button>
      </div>

      <div className="sec-section-header">
        <div className="sec-section-icon" style={{ background: "linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%)" }}>
          <Key size={12} strokeWidth={2.4} />
        </div>
        <span>RECOVERY</span>
      </div>
      <div className="sec-group">
        <button className="sec-row" onClick={() => navigate("recovery-backup")} type="button">
          <div className="sec-row-icon" style={{ background: "linear-gradient(135deg, #6366f1 0%, #818cf8 100%)" }}>
            <Key size={14} strokeWidth={2.3} />
          </div>
          <div className="sec-row-body">
            <strong>Verify recovery phrase backup</strong>
            <span>Reveal securely, then prove you recorded the 12-word phrase</span>
          </div>
          <ChevronRight size={14} className="sec-row-chev" />
        </button>
      </div>

      {enrollSheetOpen && (
        <div
          className="pk-enrollment-sheet-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pk-enroll-title"
          onClick={() => (enrolling ? undefined : setEnrollSheetOpen(false))}
        >
          <div className="pk-enrollment-sheet" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="pk-icon-btn pk-icon-btn-close"
              aria-label="Close enrollment"
              onClick={() => setEnrollSheetOpen(false)}
              disabled={enrolling}
            >
              <X size={14} strokeWidth={2.3} />
            </button>
            <div className="pk-enrollment-hero"><Fingerprint size={28} strokeWidth={2.2} /></div>
            <h3 id="pk-enroll-title" className="pk-enrollment-title">Enrol a passkey</h3>
            <p className="pk-enrollment-desc">
              Choose a device passkey or compatible security key. After enrollment, the wallet requires it together with your password on every unlock.
            </p>
            <label className="sec-field">
              <span>Label (optional)</span>
              <input
                type="text"
                placeholder="e.g. MacBook Touch ID"
                value={enrollLabel}
                onChange={(event) => setEnrollLabel(event.target.value.slice(0, 60))}
                disabled={enrolling}
                autoFocus
              />
            </label>
            {enrollError && (
              <div className="sec-warning-strip" role="alert">
                <AlertTriangle size={12} strokeWidth={2.6} /> <span>{enrollError}</span>
              </div>
            )}
            <div className="pk-enrollment-actions">
              <button type="button" className="sec-btn" onClick={() => setEnrollSheetOpen(false)} disabled={enrolling}>Cancel</button>
              <button type="button" className="sec-btn primary" onClick={() => void handleEnrollPasskey()} disabled={enrolling}>
                {enrolling ? "Waiting for authenticator…" : "Enrol passkey"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={removeTarget !== null}
        title={removingLastPasskey ? "Remove your last passkey?" : "Remove this passkey?"}
        description={removeTarget
          ? removingLastPasskey
            ? `“${removeTarget.label || "Unnamed passkey"}” is your last enrolled passkey. Removing it turns off passkey protection and returns unlock to password only.`
            : `Unlock will no longer accept “${removeTarget.label || "Unnamed passkey"}”. Your other enrolled passkeys will continue to work.`
          : ""}
        confirmLabel={removingCredentialId ? "Removing…" : "Remove passkey"}
        variant="danger"
        icon={<Trash2 size={24} />}
        onConfirm={() => void handleRemovePasskey()}
        onCancel={() => {
          if (!removingCredentialId) setRemoveTarget(null);
        }}
      />
    </div>
  );
}
