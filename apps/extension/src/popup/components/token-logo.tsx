/**
 * Token logo component with real SVG icons for enterprise tokens.
 * Falls back to colored circle with initials for unknown tokens.
 *
 * Wrapped in React.memo — pure presentational, props are primitives, and
 * this component re-renders on every token list refresh which makes it a
 * high-value memoization target. */
import { memo, type JSX } from "react";

interface TokenLogoProps {
  symbol: string;
  size?: number;
  color?: string;
}

// Aethelred red hexagon
const AethelredLogo = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
    <rect width="40" height="40" rx="20" fill="#c41e1e"/>
    <path d="M13 27L20 12l7 15h-4l-1.2-2.5h-3.6L16 27h-3zm7-6h1.4l-.7-1.5-.7 1.5z" fill="#fff"/>
  </svg>
);

// stAETHEL green
const StAethelLogo = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
    <rect width="40" height="40" rx="20" fill="#1d7f52"/>
    <path d="M13 27L20 12l7 15h-4l-1.2-2.5h-3.6L16 27h-3zm7-6h1.4l-.7-1.5-.7 1.5z" fill="#fff" opacity="0.9"/>
    <circle cx="30" cy="10" r="5" fill="#34c759"/>
    <path d="M28 10l1.5 1.5 3-3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// USDC blue circle
const UsdcLogo = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
    <circle cx="20" cy="20" r="20" fill="#2775ca"/>
    <path d="M20 6a14 14 0 100 28 14 14 0 000-28zm0 2a12 12 0 110 24 12 12 0 010-24z" fill="#fff" opacity="0.2"/>
    <text x="20" y="25" textAnchor="middle" fill="#fff" fontSize="15" fontWeight="700" fontFamily="Helvetica">$</text>
  </svg>
);

// PYUSD PayPal blue
const PyusdLogo = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
    <rect width="40" height="40" rx="20" fill="#003087"/>
    <text x="20" y="17" textAnchor="middle" fill="#fff" fontSize="8" fontWeight="700" fontFamily="Helvetica">PAY</text>
    <text x="20" y="28" textAnchor="middle" fill="#009cde" fontSize="9" fontWeight="700" fontFamily="Helvetica">USD</text>
  </svg>
);

// EURC Euro Coin
const EurcLogo = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
    <circle cx="20" cy="20" r="20" fill="#2775ca"/>
    <text x="20" y="26" textAnchor="middle" fill="#fff" fontSize="18" fontWeight="600" fontFamily="Helvetica Neue">€</text>
  </svg>
);

// WETH Ethereum
const WethLogo = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
    <circle cx="20" cy="20" r="20" fill="#627eea"/>
    <path d="M20 7l-8 13 8 4.5 8-4.5L20 7z" fill="#fff" opacity="0.6"/>
    <path d="M20 26.5l-8-4.5 8 11 8-11-8 4.5z" fill="#fff" opacity="0.9"/>
  </svg>
);

// BUIDL BlackRock
const BuidlLogo = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
    <rect width="40" height="40" rx="20" fill="#000000"/>
    <text x="20" y="16" textAnchor="middle" fill="#fff" fontSize="7" fontWeight="700" fontFamily="Helvetica" letterSpacing="0.5">BLACK</text>
    <text x="20" y="25" textAnchor="middle" fill="#fff" fontSize="7" fontWeight="700" fontFamily="Helvetica" letterSpacing="0.5">ROCK</text>
    <rect x="10" y="28" width="20" height="2" rx="1" fill="#4caf50"/>
  </svg>
);

// USDY Ondo
const UsdyLogo = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
    <rect width="40" height="40" rx="20" fill="#1a3a5c"/>
    <text x="20" y="17" textAnchor="middle" fill="#fff" fontSize="7" fontWeight="600" fontFamily="Helvetica">ONDO</text>
    <text x="20" y="28" textAnchor="middle" fill="#64b5f6" fontSize="10" fontWeight="700" fontFamily="Helvetica">USDY</text>
  </svg>
);

// Solana
const SolLogo = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
    <circle cx="20" cy="20" r="20" fill="#000"/>
    <linearGradient id="sol-grad" x1="8" y1="32" x2="32" y2="8">
      <stop offset="0%" stopColor="#9945FF"/>
      <stop offset="50%" stopColor="#14F195"/>
      <stop offset="100%" stopColor="#00FFA3"/>
    </linearGradient>
    <path d="M11 26l3-3h15l-3 3H11zm0-6h15l3-3H14l-3 3zm18-3l-3-3H11l3 3h15z" fill="url(#sol-grad)"/>
  </svg>
);

// Bitcoin
const BtcLogo = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
    <circle cx="20" cy="20" r="20" fill="#f7931a"/>
    <text x="20" y="26" textAnchor="middle" fill="#fff" fontSize="18" fontWeight="700" fontFamily="Helvetica">₿</text>
  </svg>
);

// Aave ghost
const AaveLogo = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
    <defs>
      <linearGradient id="aave-grad" x1="0" y1="0" x2="40" y2="40">
        <stop offset="0%" stopColor="#b6509e"/>
        <stop offset="100%" stopColor="#2ebac6"/>
      </linearGradient>
    </defs>
    <circle cx="20" cy="20" r="20" fill="url(#aave-grad)"/>
    <path d="M20 9l8 20h-3.5l-1.8-4.5h-5.4L15.5 29H12l8-20zm-1.6 12.8h3.2L20 17.5l-1.6 4.3z" fill="#fff"/>
  </svg>
);

// Compound
const CompLogo = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none">
    <circle cx="20" cy="20" r="20" fill="#00d395"/>
    <circle cx="20" cy="20" r="11" fill="none" stroke="#fff" strokeWidth="2.5"/>
    <circle cx="20" cy="20" r="6" fill="none" stroke="#fff" strokeWidth="2" opacity="0.6"/>
    <circle cx="20" cy="20" r="2" fill="#fff"/>
  </svg>
);

const LOGO_MAP: Record<string, (props: { size: number }) => JSX.Element> = {
  "AETHEL": AethelredLogo,
  "stAETHEL": StAethelLogo,
  "USDC": UsdcLogo,
  "PYUSD": PyusdLogo,
  "EURC": EurcLogo,
  "WETH": WethLogo,
  "BUIDL": BuidlLogo,
  "USDY": UsdyLogo,
  "SOL": SolLogo,
  "BTC": BtcLogo,
  "AAVE": AaveLogo,
  "COMP": CompLogo,
};

function TokenLogoImpl({ symbol, size = 36, color = "#8b5e2e" }: TokenLogoProps) {
  const Logo = LOGO_MAP[symbol];

  if (Logo) {
    return <Logo size={size} />;
  }

  // Fallback: colored circle with initials
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        fontSize: size * 0.3,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {symbol.slice(0, 2)}
    </div>
  );
}

export const TokenLogo = memo(TokenLogoImpl);
