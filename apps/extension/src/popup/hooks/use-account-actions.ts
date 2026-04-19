import { useCallback, useState } from "react";
import { useBackground } from "./use-background";

/**
 * Thin wrapper around `useBackground()` that centralizes the three
 * account-management bridge calls so every view uses the same mutation
 * surface:
 *
 *   - `setActive(id)` → `set-active-account`
 *   - `rename(id, label)` → `rename-account`
 *   - `remove(id)` → placeholder until `remove-account` lands
 *
 * Every mutation returns a discriminated result `{ ok: true } |
 * { ok: false, error }` so callers can render a toast without having
 * to try/catch themselves. The `busy` flag is a single boolean rather
 * than a per-operation map — the account list only mutates one row at
 * a time, so a single in-flight flag is enough to disable buttons.
 *
 * This hook intentionally does NOT manage optimistic local state: the
 * background service worker is authoritative, and the state-update
 * broadcast that fires at the end of each handler will refresh every
 * subscriber through `useWalletState`. Trying to double-update from
 * here would just race the broadcast.
 */
export interface AccountActionResult {
  ok: boolean;
  error?: string;
}

export function useAccountActions() {
  const { send } = useBackground();
  const [busy, setBusy] = useState(false);

  const setActive = useCallback(
    async (accountId: string): Promise<AccountActionResult> => {
      if (!accountId) return { ok: false, error: "missing accountId" };
      setBusy(true);
      try {
        await send("set-active-account", { accountId });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      } finally {
        setBusy(false);
      }
    },
    [send],
  );

  const rename = useCallback(
    async (accountId: string, label: string): Promise<AccountActionResult> => {
      const trimmed = label.trim();
      if (!accountId) return { ok: false, error: "missing accountId" };
      if (!trimmed) return { ok: false, error: "Label cannot be empty" };
      if (trimmed.length > 40)
        return { ok: false, error: "Label too long (max 40 chars)" };
      setBusy(true);
      try {
        await send("rename-account", { id: accountId, label: trimmed });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      } finally {
        setBusy(false);
      }
    },
    [send],
  );

  return { setActive, rename, busy };
}
