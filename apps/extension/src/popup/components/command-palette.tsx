/* ─── Command Palette (⌘K) ────────────────────────────────────────────── *
 * The killer power-user feature of the Aethelred wallet — an Apple/Raycast
 * inspired fuzzy-search launcher that opens on ⌘K (Mac) or Ctrl+K (Windows),
 * lets you jump to any view, run quick actions, and recall recent commands.
 *
 * Architecture notes:
 *   • Self-contained: a single component that wires into `useNavigation`
 *     for routing and `useComingSoon` / `useToast` for actions that aren't
 *     hooked up yet. It renders a portal-less overlay at the top of the
 *     React tree and relies on a very high z-index for stacking.
 *   • Keyboard first: the host document listens for ⌘K / Ctrl+K globally.
 *     When open, all other keys (↑, ↓, Enter, Escape, a-z for filtering)
 *     are handled by the <input> element which is auto-focused on mount.
 *   • Recent commands: a tiny LRU cache persisted in localStorage so the
 *     palette feels personal across popup reopens. The wallet popup
 *     typically unmounts every time the user closes it, so this is the
 *     only sane place to keep the MRU list.
 *   • Fuzzy scoring: purposely simple and zero-dep. Exact prefix > substring
 *     > in-order char match, with an extra bump for start-of-word matches.
 *     Good enough for a palette with ~40 entries.
 *
 * Layout is ENTIRELY CSS. This file contains only React logic — every
 * visual token (padding, radius, shadow, spring curve) is defined in
 * `src/styles/command-palette.css`, which in turn references the design
 * tokens in `design-tokens.css` and `motion.css`.
 * ─────────────────────────────────────────────────────────────────────── */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type JSX,
  type ReactNode,
} from "react";
import {
  Search,
  Command as CmdIcon,
  CornerDownLeft,
  ArrowUp,
  ArrowDown,
  Hash,
  Zap,
  Home,
  Wallet,
  Settings,
  Send,
  QrCode,
  ArrowDownUp,
  Plus,
  Globe,
  Clock,
  Sparkles,
} from "lucide-react";
import { useNavigation, type ViewName } from "../router";
import { useComingSoon } from "../hooks/use-coming-soon";
import { useToast } from "./toast";

/* ─── Types ──────────────────────────────────────────────────────────── */

type LucideIcon = ComponentType<{ size?: number | string; strokeWidth?: number | string }>;

type CommandKind = "navigation" | "quick-action";

interface PaletteCommand {
  /** Stable identifier used by the MRU recents cache. */
  id: string;
  /** Primary label shown in the result row. */
  label: string;
  /** Secondary description underneath the label. */
  subtitle: string;
  /** Icon component from lucide-react. */
  icon: LucideIcon;
  /** Group heading this command belongs to. */
  kind: CommandKind;
  /** Optional keyword tokens to improve fuzzy matching. */
  keywords?: string[];
  /** Optional right-aligned shortcut hint displayed in the row. */
  shortcut?: string[];
  /** The actual payload to execute when this command is chosen. */
  run: (ctx: RunContext) => void;
}

interface RunContext {
  navigate: (view: ViewName) => void;
  comingSoon: (feature: string, detail?: string) => void;
  toast: (type: "success" | "error" | "warning" | "info", message: string) => void;
}

/* ─── Constants ──────────────────────────────────────────────────────── */

const RECENTS_KEY = "aethelred-cmd-recent";
const RECENTS_MAX = 6;
const RECENTS_SHOW = 3;
const THEME_KEY = "aethelred-theme";
const IS_MAC =
  typeof navigator !== "undefined" &&
  /(Mac|iPhone|iPad|iPod)/i.test(navigator.platform || navigator.userAgent || "");

/* ─── Command registry ───────────────────────────────────────────────── *
 * Kept as a module-level factory so it's only constructed once per popup
 * mount. Each navigation entry has a matching ViewName route; quick
 * actions call into `ctx.comingSoon` or a direct DOM side-effect.
 * ─────────────────────────────────────────────────────────────────────── */

function buildCommands(): PaletteCommand[] {
  /* Shorthand — every navigation row has the same shape. */
  const nav = (
    id: string,
    label: string,
    subtitle: string,
    icon: LucideIcon,
    view: ViewName,
    keywords?: string[],
  ): PaletteCommand => ({
    id: `nav:${id}`,
    label,
    subtitle,
    icon,
    kind: "navigation",
    keywords,
    run: (ctx) => ctx.navigate(view),
  });

  return [
    /* ─── Navigation ─── */
    nav("home", "Home", "Dashboard overview", Home, "home", ["dashboard", "overview", "start"]),
    nav("portfolio", "Portfolio", "Holdings & allocation", Wallet, "portfolio", ["holdings", "assets", "positions"]),
    nav("markets", "Markets", "Prices and watchlists", Zap, "markets", ["prices", "watchlist", "tokens"]),
    nav("payments", "Payments", "Send & schedule payments", Send, "payments", ["pay", "invoice", "bill"]),
    nav("hub", "Hub", "Integrations & apps", Sparkles, "hub", ["integrations", "apps", "connect"]),
    nav("send", "Send", "Transfer tokens", Send, "send", ["transfer", "pay", "move"]),
    nav("receive", "Receive", "Show address / QR", QrCode, "receive", ["address", "qr", "deposit"]),
    nav("swap", "Swap", "Trade tokens", ArrowDownUp, "swap", ["trade", "exchange", "convert"]),
    nav("settings", "Settings", "Preferences & security", Settings, "settings", ["preferences", "options", "config"]),
    nav("accounts", "Accounts", "Manage wallets & keys", Wallet, "accounts", ["wallets", "keys", "addresses"]),
    nav("contacts", "Contacts", "Address book", Hash, "contacts", ["address book", "recipients"]),
    nav("network-selector", "Networks", "Switch chain / RPC", Globe, "network-selector", ["chain", "rpc", "switch"]),
    nav("activity", "Activity", "Transaction history", Clock, "activity", ["history", "transactions", "tx"]),
    nav("developer-tools", "Developer Tools", "Advanced & debug", Hash, "developer-tools", ["debug", "advanced", "dev"]),
    nav("security", "Security", "Lock, keys, policies", Settings, "security", ["lock", "password", "keys"]),
    nav("audit-log", "Audit Log", "Security event trail", Clock, "audit-log", ["audit", "events", "log"]),
    nav("app-catalog", "App Catalog", "Browse connected dApps", Globe, "app-catalog", ["apps", "dapps", "catalog"]),
    nav("approvals", "Approvals", "Pending signatures", CornerDownLeft, "approvals", ["signatures", "pending", "queue"]),
    nav("regulatory-passport", "Regulatory Passport", "KYC credentials", Hash, "regulatory-passport", ["kyc", "passport", "verify"]),
    nav("id-verification", "ID Verification", "Verify identity", Hash, "id-verification", ["kyc", "id", "verify"]),
    nav("machine-delegation", "Machine Delegation", "Automation & agents", Zap, "machine-delegation", ["agents", "automation", "bots"]),
    nav("connected-sites", "Connected Sites", "Active dApp sessions", Globe, "connected-sites", ["sites", "sessions", "permissions"]),

    /* ─── Quick actions ─── */
    {
      id: "action:send",
      label: "Send tokens",
      subtitle: "Jump into the send flow",
      icon: Send,
      kind: "quick-action",
      keywords: ["transfer", "pay", "move"],
      run: (ctx) => ctx.navigate("send"),
    },
    {
      id: "action:receive",
      label: "Receive tokens",
      subtitle: "Display your address",
      icon: QrCode,
      kind: "quick-action",
      keywords: ["deposit", "qr", "address"],
      run: (ctx) => ctx.navigate("receive"),
    },
    {
      id: "action:swap",
      label: "Swap tokens",
      subtitle: "Open the swap view",
      icon: ArrowDownUp,
      kind: "quick-action",
      keywords: ["trade", "exchange", "convert"],
      run: (ctx) => ctx.navigate("swap"),
    },
    {
      id: "action:copy-address",
      label: "Copy Address",
      subtitle: "Copy primary wallet address",
      icon: Plus,
      kind: "quick-action",
      keywords: ["clipboard", "copy", "address"],
      run: (ctx) => ctx.comingSoon("Copy Address", "wire into active account"),
    },
    {
      id: "action:toggle-theme",
      label: "Switch Theme",
      subtitle: "Toggle light / dark",
      icon: Sparkles,
      kind: "quick-action",
      keywords: ["theme", "dark", "light", "mode"],
      run: (ctx) => {
        try {
          const root = document.documentElement;
          const current = root.getAttribute("data-theme") === "dark" ? "dark" : "light";
          const next = current === "dark" ? "light" : "dark";
          root.setAttribute("data-theme", next);
          localStorage.setItem(THEME_KEY, next);
          ctx.toast("success", `Switched to ${next} theme`);
        } catch {
          ctx.toast("error", "Unable to switch theme");
        }
      },
    },
    {
      id: "action:switch-workspace",
      label: "Switch Workspace",
      subtitle: "Pick a different workspace",
      icon: Plus,
      kind: "quick-action",
      keywords: ["workspace", "org", "team"],
      run: (ctx) => ctx.navigate("workspace-selector"),
    },
  ];
}

/* ─── Fuzzy scoring ───────────────────────────────────────────────────── *
 * Returns a non-negative score. Higher = better match. 0 means no match.
 * Bias is strictly toward: prefix > word-start > substring > in-order chars.
 * ─────────────────────────────────────────────────────────────────────── */

function scoreCommand(cmd: PaletteCommand, raw: string): number {
  const query = raw.trim().toLowerCase();
  if (query.length === 0) return 1;

  const haystack = [cmd.label, cmd.subtitle, ...(cmd.keywords ?? [])]
    .join(" ")
    .toLowerCase();
  const label = cmd.label.toLowerCase();

  /* Exact prefix match on the label is the strongest signal. */
  if (label.startsWith(query)) return 100 + query.length;

  /* Word-start match — e.g. "d" matches "Developer Tools". */
  const words = label.split(/\s+/);
  for (const word of words) {
    if (word.startsWith(query)) return 80 + query.length;
  }

  /* Substring anywhere in label or subtitle or keywords. */
  if (haystack.includes(query)) return 50 + query.length;

  /* In-order character match (fuzzy). */
  let h = 0;
  let matched = 0;
  for (let q = 0; q < query.length; q++) {
    while (h < haystack.length && haystack[h] !== query[q]) h++;
    if (h >= haystack.length) return 0;
    matched++;
    h++;
  }
  return matched === query.length ? 10 : 0;
}

/* ─── Recents persistence ─────────────────────────────────────────────── */

function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string").slice(0, RECENTS_MAX) : [];
  } catch {
    return [];
  }
}

function pushRecent(id: string): string[] {
  try {
    const current = loadRecents();
    const next = [id, ...current.filter((x) => x !== id)].slice(0, RECENTS_MAX);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    return next;
  } catch {
    return [];
  }
}

/* ─── Component ───────────────────────────────────────────────────────── */

// React 19's types moved the `JSX` namespace out of global scope so
// bare `JSX.Element` fails with TS2503. Import the `JSX` type
// directly from "react" (named import above) and use `JSX.Element`
// against the imported value.
export function CommandPalette(): JSX.Element | null {
  const { navigate } = useNavigation();
  const comingSoon = useComingSoon();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [recents, setRecents] = useState<string[]>(() => loadRecents());

  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  /* Commands only need to be built once per mount. */
  const commands = useMemo(() => buildCommands(), []);
  const commandById = useMemo(() => {
    const map = new Map<string, PaletteCommand>();
    for (const cmd of commands) map.set(cmd.id, cmd);
    return map;
  }, [commands]);

  /* ─── Global ⌘K / Ctrl+K listener ─────────────────────────────────── *
   * Detects the Meta key (Command) OR the Control key — NOT "both" —
   * which means a Mac user pressing ⌘K and a Windows user pressing
   * Ctrl+K both work out of the box, no platform detection required.
   * The Escape handling is scoped to the palette itself via the input's
   * onKeyDown so we don't swallow Escape globally when the palette is
   * closed. */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      /* Open on ⌘K (Mac) / Ctrl+K (Windows+Linux). */
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => {
          if (prev) return prev;
          /* Capture focused element for restoration on close. */
          if (typeof document !== "undefined") {
            previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
          }
          return true;
        });
        return;
      }
      /* Escape is handled globally for convenience — if the palette is
         open, clicking outside shouldn't be the only way out. */
      if (e.key === "Escape" && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  /* Reset query + highlight whenever the palette opens, and focus
     the input on the next frame (after animation mount). */
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      setRecents(loadRecents());
      const raf = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(raf);
    }
    /* Restore focus to whatever was focused before the palette opened
       so keyboard users don't end up stranded at the top of the doc. */
    if (previouslyFocusedRef.current && typeof previouslyFocusedRef.current.focus === "function") {
      try {
        previouslyFocusedRef.current.focus();
      } catch {
        /* no-op — element may have unmounted */
      }
    }
    return undefined;
  }, [open]);

  /* ─── Results pipeline ─────────────────────────────────────────────── *
   * Produces a grouped list: [Recent (top N when no query), Navigation,
   * Quick Actions], with each command scored and filtered. When the user
   * has typed a query, the "Recent" section collapses so the list reads
   * like a flat search result. */
  const sections = useMemo(() => {
    const hasQuery = query.trim().length > 0;

    const scored = commands
      .map((cmd) => ({ cmd, score: scoreCommand(cmd, query) }))
      .filter((x) => x.score > 0);

    const navs = scored
      .filter((x) => x.cmd.kind === "navigation")
      .sort((a, b) => b.score - a.score)
      .map((x) => x.cmd);

    const actions = scored
      .filter((x) => x.cmd.kind === "quick-action")
      .sort((a, b) => b.score - a.score)
      .map((x) => x.cmd);

    const result: { key: string; label: string; items: PaletteCommand[] }[] = [];

    if (!hasQuery) {
      const recentItems = recents
        .slice(0, RECENTS_SHOW)
        .map((id) => commandById.get(id))
        .filter((x): x is PaletteCommand => Boolean(x));
      if (recentItems.length > 0) {
        result.push({ key: "recent", label: "Recent", items: recentItems });
      }
    }

    if (actions.length > 0) result.push({ key: "actions", label: "Quick Actions", items: actions });
    if (navs.length > 0) result.push({ key: "nav", label: "Navigation", items: navs });

    return result;
  }, [commands, commandById, query, recents]);

  /* Flattened list for keyboard traversal. */
  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  /* Clamp the active index when the results list shrinks on typing. */
  useEffect(() => {
    if (activeIdx >= flat.length) setActiveIdx(Math.max(0, flat.length - 1));
  }, [flat.length, activeIdx]);

  /* Scroll the active row into view when it changes. */
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(`[data-cmd-idx="${activeIdx}"]`);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [activeIdx, open, flat.length]);

  const close = useCallback(() => setOpen(false), []);

  const run = useCallback(
    (cmd: PaletteCommand) => {
      /* Persist to recents first so the user sees the update next time. */
      const next = pushRecent(cmd.id);
      setRecents(next);
      /* Close the palette BEFORE running — nav transitions look smoother
         and any toast fired by the action lands on the destination view. */
      setOpen(false);
      cmd.run({ navigate, comingSoon, toast });
    },
    [navigate, comingSoon, toast],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => (flat.length === 0 ? 0 : (i + 1) % flat.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => (flat.length === 0 ? 0 : (i - 1 + flat.length) % flat.length));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const target = flat[activeIdx];
        if (target) run(target);
      } else if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    },
    [flat, activeIdx, run, close],
  );

  if (!open) return null;

  /* Walk `sections` tracking the flat-array offset so highlight bookkeeping
     stays consistent between the grouped render and the flat keyboard list. */
  let runningIdx = 0;
  const rendered: ReactNode[] = [];
  for (const section of sections) {
    rendered.push(
      <div key={`label-${section.key}`} className="cmdp-group-label type-micro">
        {section.label}
      </div>,
    );
    for (const cmd of section.items) {
      const idx = runningIdx++;
      const Icon = cmd.icon;
      const active = idx === activeIdx;
      rendered.push(
        <button
          type="button"
          key={cmd.id}
          data-cmd-idx={idx}
          className={`cmdp-row${active ? " active" : ""}`}
          onMouseEnter={() => setActiveIdx(idx)}
          onClick={() => run(cmd)}
        >
          <span className="cmdp-row-icon">
            <Icon size={16} strokeWidth={2} />
          </span>
          <span className="cmdp-row-body">
            <span className="cmdp-row-label">{cmd.label}</span>
            <span className="cmdp-row-subtitle">{cmd.subtitle}</span>
          </span>
          {cmd.shortcut && (
            <span className="cmdp-shortcut" aria-hidden="true">
              {cmd.shortcut.map((k, i) => (
                <kbd key={i}>{k}</kbd>
              ))}
            </span>
          )}
          {active && (
            <span className="cmdp-row-enter" aria-hidden="true">
              <CornerDownLeft size={14} strokeWidth={2.25} />
            </span>
          )}
        </button>,
      );
    }
  }

  return (
    <div className="cmdp-overlay" onClick={close} role="presentation">
      <div
        className="cmdp-shell"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cmdp-input-row">
          <Search size={16} strokeWidth={2.25} className="cmdp-input-icon" />
          <input
            ref={inputRef}
            className="cmdp-input"
            placeholder="Type a command or search…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            onKeyDown={onKeyDown}
            autoFocus
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
          <span className="cmdp-input-badge" aria-hidden="true">
            <kbd>{IS_MAC ? "⌘" : "Ctrl"}</kbd>
            <kbd>K</kbd>
          </span>
        </div>

        <div ref={listRef} className="cmdp-list">
          {flat.length === 0 ? (
            <div className="cmdp-empty">
              <span className="cmdp-empty-title">No results</span>
              <span className="cmdp-empty-sub">Try a different search</span>
            </div>
          ) : (
            rendered
          )}
        </div>

        <div className="cmdp-footer" aria-hidden="true">
          <span className="cmdp-hint">
            <kbd>
              <ArrowUp size={10} strokeWidth={2.5} />
            </kbd>
            <kbd>
              <ArrowDown size={10} strokeWidth={2.5} />
            </kbd>
            <em>navigate</em>
          </span>
          <span className="cmdp-hint">
            <kbd>
              <CornerDownLeft size={10} strokeWidth={2.5} />
            </kbd>
            <em>open</em>
          </span>
          <span className="cmdp-hint">
            <kbd>esc</kbd>
            <em>close</em>
          </span>
          <span className="cmdp-hint cmdp-hint-brand">
            <kbd>
              <CmdIcon size={10} strokeWidth={2.5} />
            </kbd>
            <em>Aethelred</em>
          </span>
        </div>
      </div>
    </div>
  );
}
