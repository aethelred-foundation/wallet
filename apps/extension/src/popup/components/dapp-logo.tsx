/**
 * dApp logo component with inline SVG icons — same pattern as token-logo.tsx.
 * No external image files needed. React.memo wrapped — pure render from
 * two primitive props.
 */
import { memo, type JSX } from "react";

interface DappLogoProps {
  name: string;
  size?: number;
}

const CruzibleLogo = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
    <rect width="40" height="40" rx="10" fill="#c41e1e"/>
    <path d="M12 20c0-4.4 3.6-8 8-8s8 3.6 8 8-3.6 8-8 8" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/>
    <path d="M16 20l3 3 5-6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const NoblePayLogo = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
    <rect width="40" height="40" rx="10" fill="#1d7f52"/>
    <rect x="10" y="14" width="20" height="14" rx="3" stroke="#fff" strokeWidth="2"/>
    <path d="M10 19h20" stroke="#fff" strokeWidth="2"/>
    <circle cx="26" cy="24" r="2" fill="#34c759"/>
  </svg>
);

const ZeroIDLogo = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
    <rect width="40" height="40" rx="10" fill="#2775ca"/>
    <circle cx="20" cy="17" r="5" stroke="#fff" strokeWidth="2"/>
    <path d="M12 30c0-4.4 3.6-8 8-8s8 3.6 8 8" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
    <path d="M24 15l2-2m0 0l2-2m-2 2l2 2m-2-2l-2-2" stroke="#34c759" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const ShioraLogo = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
    <rect width="40" height="40" rx="10" fill="#8b5cf6"/>
    <path d="M20 10l2 4h4l-3 3 1 4-4-2-4 2 1-4-3-3h4l2-4z" fill="#fff" opacity="0.9"/>
    <circle cx="20" cy="27" r="5" stroke="#fff" strokeWidth="1.5"/>
    <path d="M18 27h4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const TerraQuraLogo = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
    <rect width="40" height="40" rx="10" fill="#059669"/>
    <circle cx="20" cy="18" r="8" stroke="#fff" strokeWidth="1.5" fill="none"/>
    <path d="M16 18c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round"/>
    <path d="M14 28l6-8 6 8" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    <circle cx="20" cy="18" r="2" fill="#34d399"/>
  </svg>
);

const LOGO_MAP: Record<string, (props: { size: number }) => JSX.Element> = {
  Cruzible: CruzibleLogo,
  NoblePay: NoblePayLogo,
  ZeroID: ZeroIDLogo,
  Shiora: ShioraLogo,
  TerraQura: TerraQuraLogo,
};

function DappLogoImpl({ name, size = 30 }: DappLogoProps) {
  const Logo = LOGO_MAP[name];

  if (Logo) {
    return <Logo size={size} />;
  }

  // Fallback: colored circle with initials
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        background: "#3a3a3c",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontSize: size * 0.3,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {name.slice(0, 2)}
    </div>
  );
}

export const DappLogo = memo(DappLogoImpl);
