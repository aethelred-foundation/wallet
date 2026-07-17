/** Runtime build provenance exposed by the installed extension manifest. */
export interface RuntimeBuildProvenance {
  /** Chrome's required numeric extension version. */
  version: string | null;
  /** Optional human-readable release name from `version_name`. */
  versionName: string | null;
  /** Release channel only when it is encoded by the runtime manifest. */
  channel: "alpha" | "beta" | "rc" | "stable" | null;
  source: "runtime-manifest" | "unavailable";
}

const UNAVAILABLE: RuntimeBuildProvenance = Object.freeze({
  version: null,
  versionName: null,
  channel: null,
  source: "unavailable",
});

/**
 * Read version facts from Chrome's installed manifest. Build dates, commit
 * SHAs, package counts, and deployment tiers are intentionally not guessed:
 * this release does not embed authoritative values for those fields.
 */
export function getRuntimeBuildProvenance(): RuntimeBuildProvenance {
  try {
    if (
      typeof chrome === "undefined" ||
      typeof chrome.runtime?.getManifest !== "function"
    ) {
      return UNAVAILABLE;
    }

    const manifest = chrome.runtime.getManifest();
    const version = typeof manifest.version === "string" && manifest.version.trim()
      ? manifest.version.trim()
      : null;
    const versionName = typeof manifest.version_name === "string" && manifest.version_name.trim()
      ? manifest.version_name.trim()
      : null;
    const channelMatch = versionName?.match(/(?:^|[-.])(alpha|beta|rc|stable)(?:[.-]|$)/i);
    const channel = channelMatch
      ? channelMatch[1].toLowerCase() as RuntimeBuildProvenance["channel"]
      : null;

    return {
      version,
      versionName,
      channel,
      source: version ? "runtime-manifest" : "unavailable",
    };
  } catch {
    return UNAVAILABLE;
  }
}

export function formatRuntimeVersion(
  provenance: RuntimeBuildProvenance = getRuntimeBuildProvenance(),
): string {
  return provenance.versionName ?? provenance.version ?? "Unavailable";
}

/** Copyright range is legal copy, not build provenance. */
export const COPYRIGHT_YEAR = "2025–2026";
