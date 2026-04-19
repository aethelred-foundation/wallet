import { useCallback } from "react";
import { useToast } from "../components/toast";
import { IS_PRODUCTION_BUILD } from "../lib/release-mode";

/**
 * useComingSoon
 * ─────────────
 * Centralized handling for features that are still on the roadmap but
 * visible in the UI so users know what's ahead.
 *
 * Why a hook instead of sprinkling `alert(...)`:
 *   1. Consistency — every "not yet" message uses the same tone + copy pattern,
 *      so the wallet feels designed, not hacked together.
 *   2. Discoverability — one grep tells you exactly which features are faked,
 *      which is critical for an audit punch list.
 *   3. Swap-in-place — when we eventually want to replace the toast with a
 *      modal ("Notify me when it ships"), or a dev-tools link, it's one file
 *      change instead of dozens.
 *   4. Telemetry — later we can count how often users click the fake buttons
 *      to prioritize the backlog.
 *
 * Usage:
 *   const comingSoon = useComingSoon();
 *   <button onClick={() => comingSoon("Rename account")}>Rename</button>
 *
 * The optional `detail` second arg appends a short clarifier:
 *   comingSoon("Download Passport", "PDF export ships in v1.0")
 */
export function useComingSoon(): (feature: string, detail?: string) => void {
  const { toast } = useToast();

  return useCallback(
    (feature: string, detail?: string) => {
      const suffix = detail ? ` — ${detail}` : "";
      if (IS_PRODUCTION_BUILD) {
        toast("info", `${feature} is not available in this release${suffix}`);
        return;
      }
      toast("info", `${feature}: coming soon${suffix}`);
      if (import.meta.env?.DEV) {
        // eslint-disable-next-line no-console
        console.info(`[coming-soon] Feature clicked: ${feature}${detail ? ` (${detail})` : ""}`);
      }
    },
    [toast],
  );
}
