import { useState } from "react";
import { createPortal } from "react-dom";
import { User, Shield, Lock, FileText, Settings, Info, QrCode, BadgeCheck, X, ChevronRight, Gift, Stamp, Bot, Globe, ShieldAlert } from "lucide-react";
import { useNavigation, type ViewName } from "../router";
import { useBackground } from "../hooks/use-background";
import { SHORT_VERSION } from "../constants/version";

interface ProfileMenuProps {
  subjectName: string;
  workspaceName: string;
}

export function ProfileMenu({ subjectName, workspaceName }: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const { navigate } = useNavigation();
  const { send } = useBackground();

  /* Apple-grade menu items — each has a semantic color for its icon tile.
     Colors follow iOS Settings conventions: identity=blue, security=red,
     rewards=green, automation=orange, digital=purple, tools=teal, meta=gray */
  const menuItems: Array<{ icon: typeof User; label: string; view: ViewName; detail?: string; color: string }> = [
    { icon: User, label: "Account", view: "accounts", detail: "Manage wallets", color: "#636366" },
    { icon: BadgeCheck, label: "ID Verification", view: "id-verification", detail: "KYC · Enhanced", color: "#34c759" },
    { icon: Shield, label: "Security", view: "security", detail: "Keys · Password", color: "#c41e1e" },
    { icon: ShieldAlert, label: "Token approvals", view: "token-approvals", detail: "Audit · Revoke", color: "#ff3b30" },
    { icon: Globe, label: "Regulatory Passport", view: "regulatory-passport", detail: "Portable KYC", color: "#2775ca" },
    { icon: Bot, label: "AI Agents", view: "machine-delegation", detail: "Delegation · Gates", color: "#ff9f0a" },
    { icon: Stamp, label: "Digital Assets", view: "digital-assets", detail: "Certs · Badges", color: "#8b5cf6" },
    { icon: Gift, label: "Rewards", view: "rewards", detail: "Yields · Incentives", color: "#e63e3e" },
    { icon: FileText, label: "Reports", view: "audit-log", detail: "Compliance export", color: "#0ea5e9" },
    { icon: QrCode, label: "QR Scanner", view: "qr-scanner", detail: "Camera scan", color: "#14b8a6" },
    { icon: Settings, label: "Settings", view: "settings", detail: "Preferences", color: "#8e8e93" },
    { icon: Info, label: "About", view: "deployment-info", detail: SHORT_VERSION, color: "#6e6e73" },
  ];

  const handleLock = async () => {
    setOpen(false);
    await send("lock-request", {});
  };

  // Render dropdown via portal so it escapes the canvas overflow:hidden
  const dropdown = open ? createPortal(
    <>
      <div className="profile-backdrop" onClick={() => setOpen(false)} />
      <div className="profile-dropdown">
        <div className="profile-dropdown-header">
          <div className="profile-dropdown-avatar">
            {subjectName.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <div className="profile-dropdown-name">{subjectName}</div>
            <div className="profile-dropdown-workspace">{workspaceName}</div>
          </div>
          <button className="icon-btn" onClick={() => setOpen(false)} type="button" style={{ marginLeft: "auto" }}>
            <X size={16} />
          </button>
        </div>

        <div className="profile-dropdown-items">
          {menuItems.map(({ icon: Icon, label, view, detail, color }) => (
            <button
              key={label}
              className="profile-dropdown-item"
              onClick={() => { setOpen(false); navigate(view); }}
              type="button"
            >
              <div className="profile-item-icon-tile" style={{ background: color }}>
                <Icon size={14} strokeWidth={2.3} />
              </div>
              <div className="profile-item-text">
                <span>{label}</span>
                {detail && <span className="profile-item-detail">{detail}</span>}
              </div>
              <ChevronRight size={14} className="profile-item-arrow" />
            </button>
          ))}

          <div className="profile-dropdown-divider" />

          <button className="profile-dropdown-item profile-dropdown-lock" onClick={handleLock} type="button">
            <div className="profile-item-icon-tile profile-item-icon-lock">
              <Lock size={14} strokeWidth={2.3} />
            </div>
            <div className="profile-item-text">
              <span>Lock wallet</span>
            </div>
          </button>
        </div>
      </div>
    </>,
    document.body
  ) : null;

  return (
    <div className="profile-menu-wrapper">
      <button className="profile-avatar" onClick={() => setOpen(!open)} type="button" aria-label="Profile">
        <span>{subjectName.slice(0, 1).toUpperCase()}</span>
      </button>
      {dropdown}
    </div>
  );
}
