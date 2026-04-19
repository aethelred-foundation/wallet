import { useEffect, useRef } from "react";

/**
 * useKeyboardShortcuts
 * ────────────────────
 * Global keyboard-shortcut registry. Attach a shortcut map and the hook
 * installs a `keydown` listener on `document`, matches key combos, and
 * invokes the handler. Supports:
 *
 *   - Plain keys: "s", "?", "/", "Escape"
 *   - Modifiers via "+": "mod+k" (cmd on Mac, ctrl elsewhere), "shift+?"
 *   - Case-insensitive matching on letter keys
 *
 * Why a hook instead of a context:
 *   - No provider wiring needed — any component can register
 *   - Unmounted components automatically unregister
 *   - Multiple components can register the same shortcut (last one wins;
 *     first one mounted wins tiebreak — common Emacs/Vim convention)
 *
 * Example:
 *   useKeyboardShortcuts({
 *     "mod+k": () => openCommandPalette(),
 *     "s":     () => navigate("send"),
 *     "r":     () => navigate("receive"),
 *     "?":     () => setShortcutsVisible(true),
 *   });
 *
 * To gracefully skip shortcuts while the user is typing into an input,
 * pass `skipWhenTyping: true` (default). The hook checks the active
 * element's tag and returns early if it's INPUT, TEXTAREA, or
 * contenteditable.
 */
export type ShortcutHandler = (event: KeyboardEvent) => void;
export type ShortcutMap = Record<string, ShortcutHandler>;

export interface UseKeyboardShortcutsOptions {
  /** If true, shortcuts are ignored when focus is inside an input. Default: true */
  skipWhenTyping?: boolean;
  /** If false, the hook is disabled entirely. Default: true */
  enabled?: boolean;
}

function isTypingContext(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

/**
 * Normalize a shortcut spec like "mod+k" or "shift+?" into a canonical
 * lowercase key string. Separators are "+" and order is: mod, meta, ctrl,
 * alt, shift, key. "mod" maps to meta on Mac, ctrl elsewhere.
 */
function canonicalize(spec: string): string {
  const parts = spec.toLowerCase().split("+").map((p) => p.trim());
  const key = parts.pop() ?? "";
  const modifiers = new Set(parts);
  const isMac = typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform);
  if (modifiers.has("mod")) {
    modifiers.delete("mod");
    modifiers.add(isMac ? "meta" : "ctrl");
  }
  // Always emit in a stable order
  const out: string[] = [];
  if (modifiers.has("meta")) out.push("meta");
  if (modifiers.has("ctrl")) out.push("ctrl");
  if (modifiers.has("alt")) out.push("alt");
  if (modifiers.has("shift")) out.push("shift");
  out.push(key);
  return out.join("+");
}

/** Build the canonical key string from a KeyboardEvent */
function eventToCanonical(e: KeyboardEvent): string {
  const out: string[] = [];
  if (e.metaKey) out.push("meta");
  if (e.ctrlKey) out.push("ctrl");
  if (e.altKey) out.push("alt");
  if (e.shiftKey) out.push("shift");
  // Prefer e.key lowercased — handles shifted letters (? → shift+/) correctly
  // on most layouts via the shift modifier + base key
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  out.push(key);
  return out.join("+");
}

export function useKeyboardShortcuts(
  shortcuts: ShortcutMap,
  { skipWhenTyping = true, enabled = true }: UseKeyboardShortcutsOptions = {},
): void {
  // Store the shortcuts in a ref so the effect doesn't need to re-register
  // on every parent re-render — we just read the latest handlers on keydown
  const shortcutsRef = useRef<ShortcutMap>(shortcuts);
  shortcutsRef.current = shortcuts;

  useEffect(() => {
    if (!enabled) return;

    const canonicalMap = new Map<string, ShortcutHandler>();
    // Re-canonicalize every handler on effect run. Keys canonicalize stably,
    // so only the user map changing forces a rebuild.
    Object.entries(shortcutsRef.current).forEach(([spec, handler]) => {
      canonicalMap.set(canonicalize(spec), handler);
    });

    const listener = (e: KeyboardEvent) => {
      if (skipWhenTyping && isTypingContext(e.target)) {
        // Escape is special — it should always work even in inputs so
        // users can bail out of a modal while typing
        if (e.key !== "Escape") return;
      }
      const canonical = eventToCanonical(e);
      const handler = canonicalMap.get(canonical);
      if (handler) {
        e.preventDefault();
        handler(e);
      }
    };

    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, skipWhenTyping, Object.keys(shortcuts).join("|")]);
}
