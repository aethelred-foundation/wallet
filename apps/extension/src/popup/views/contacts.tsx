import { useState } from "react";
import {
  UserPlus, User, Trash2, Copy, Check, ArrowLeft, Plus, X,
} from "lucide-react";
import { useNavigation } from "../router";
import {
  useAddressBook,
  useAddressBookContacts,
} from "../services/services-context";
import { useCopyToClipboard } from "../hooks/use-copy-to-clipboard";
import "../../styles/legacy/simple-pages.css";

/* ─── Avatar gradient palette ─────────────────────────────────────── *
 * A small palette of pastel two-stop gradients. The choice is derived
 * from a stable hash of the contact address so each entry gets a
 * unique, consistent color across re-renders. */
const AVATAR_GRADIENTS: readonly string[] = [
  "linear-gradient(135deg, #0ea5e9 0%, #38bdf8 100%)", // sky
  "linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%)", // violet
  "linear-gradient(135deg, #14b8a6 0%, #2dd4bf 100%)", // teal
  "linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)", // amber
  "linear-gradient(135deg, #ec4899 0%, #f472b6 100%)", // pink
  "linear-gradient(135deg, #34c759 0%, #6bd880 100%)", // green
];

function gradientFor(address: string): string {
  let sum = 0;
  for (let i = 0; i < address.length; i++) sum += address.charCodeAt(i);
  return AVATAR_GRADIENTS[sum % AVATAR_GRADIENTS.length];
}

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function ContactsView() {
  const { navigate } = useNavigation();
  const addressBook = useAddressBook();

  const contacts = useAddressBookContacts();
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [saving, setSaving] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const { copy, copied, error: copyError } = useCopyToClipboard(1600);

  const handleAdd = async () => {
    if (!newLabel || !newAddress) return;
    setSaving(true);
    setOperationError(null);
    try {
      await addressBook.addContact(newAddress, newLabel);
      setNewLabel("");
      setNewAddress("");
      setAdding(false);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "Failed to save contact");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setNewLabel("");
    setNewAddress("");
    setOperationError(null);
    setAdding(false);
  };

  const handleRemove = async (address: string) => {
    setSaving(true);
    setOperationError(null);
    try {
      await addressBook.removeContact(address);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "Failed to remove contact");
    } finally {
      setSaving(false);
    }
  };

  const copyAddress = (address: string) => {
    void copy(address, address);
  };

  const canSave = newLabel.trim().length > 0 && newAddress.trim().length > 0;

  return (
    <div className="view-padded">
      <button className="acc-back" onClick={() => navigate("settings")} type="button">
        <ArrowLeft size={14} strokeWidth={2.3} />
        <span>Settings</span>
      </button>

      {/* ═════ Hero ═════ */}
      <div className="con-hero">
        <div className="con-hero-top">
          <div className="con-hero-icon">
            <User size={20} strokeWidth={2.3} />
          </div>
          <div className="con-hero-info">
            <span className="con-hero-label">CONTACTS</span>
            <strong className="con-hero-title">
              {contacts.length} <span>saved</span>
            </strong>
            <span className="con-hero-sub">
              Address book for frequent recipients
            </span>
          </div>
          <button
            className={`con-hero-add${adding ? " is-open" : ""}`}
            onClick={() => (adding ? handleCancel() : setAdding(true))}
            type="button"
            aria-label={adding ? "Cancel" : "Add contact"}
            title={adding ? "Cancel" : "Add contact"}
          >
            {adding
              ? <X size={15} strokeWidth={2.6} />
              : <Plus size={15} strokeWidth={2.6} />}
          </button>
        </div>
      </div>

      {/* ═════ Add form ═════ */}
      {adding && (
        <div className="con-form">
          <div className="con-form-field">
            <label className="con-form-label" htmlFor="contact-label">Label</label>
            <input
              id="contact-label"
              className="con-form-input"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="e.g., Treasury Vault"
              autoFocus
            />
          </div>
          <div className="con-form-field">
            <label className="con-form-label" htmlFor="contact-address">Address</label>
            <input
              id="contact-address"
              className="con-form-input is-mono"
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              placeholder="0x…"
            />
          </div>
          <div className="con-form-actions">
            <button
              className="con-form-btn secondary"
              onClick={handleCancel}
              type="button"
            >
              Cancel
            </button>
            <button
              className="con-form-btn primary"
              onClick={handleAdd}
              type="button"
              disabled={!canSave || saving}
            >
              <Check size={13} strokeWidth={2.8} />
              {saving ? "Saving…" : "Save contact"}
            </button>
          </div>
          {operationError ? <div className="form-error" role="alert">{operationError}</div> : null}
        </div>
      )}

      {!adding && operationError ? (
        <div className="form-error" role="alert">{operationError}</div>
      ) : null}
      {copyError ? (
        <div className="form-error" role="alert">Unable to copy address to the clipboard.</div>
      ) : null}

      {/* ═════ List / Empty state ═════ */}
      {contacts.length === 0 && !adding ? (
        <div className="con-empty">
          <div className="con-empty-icon">
            <User size={26} strokeWidth={2.1} />
          </div>
          <strong className="con-empty-title">No contacts yet</strong>
          <span className="con-empty-desc">
            Add frequently used addresses for one-tap access when sending funds.
          </span>
          <button
            className="con-empty-cta"
            onClick={() => setAdding(true)}
            type="button"
          >
            <UserPlus size={13} strokeWidth={2.6} />
            Add first contact
          </button>
        </div>
      ) : contacts.length > 0 ? (
        <>
          <div className="con-section-label">
            <span>SAVED ADDRESSES</span>
            <span className="con-section-hint">
              {contacts.length} {contacts.length === 1 ? "contact" : "contacts"}
            </span>
          </div>

          <div className="con-list">
            {contacts.map((contact) => {
              const initial = (contact.label || "?").trim().charAt(0) || "?";
              return (
                <div className="con-card" key={contact.address}>
                  <div
                    className="con-card-avatar"
                    style={{ background: gradientFor(contact.address) }}
                  >
                    {initial}
                  </div>
                  <div className="con-card-body">
                    <strong className="con-card-label">{contact.label}</strong>
                    <code className="con-card-addr">
                      {truncateAddress(contact.address)}
                    </code>
                  </div>
                  <div className="con-card-actions">
                    <button
                      className={`con-card-btn${
                        copied === contact.address ? " is-copied" : ""
                      }`}
                      onClick={() => copyAddress(contact.address)}
                      type="button"
                      aria-label="Copy address"
                      title="Copy address"
                    >
                      {copied === contact.address
                        ? <Check size={13} strokeWidth={2.8} />
                        : <Copy size={13} strokeWidth={2.3} />}
                    </button>
                    <button
                      className="con-card-btn is-danger"
                      onClick={() => void handleRemove(contact.address)}
                      type="button"
                      disabled={saving}
                      aria-label="Remove contact"
                      title="Remove"
                    >
                      <Trash2 size={13} strokeWidth={2.3} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
