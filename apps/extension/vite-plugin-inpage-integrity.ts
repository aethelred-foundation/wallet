/**
 * Custom Vite plugin that stamps the content script with the SHA-256
 * hash of the bundled `inpage.js`.
 *
 * The content script needs to know the expected hash at runtime so it
 * can verify what `chrome.runtime.getURL("inpage.js")` actually returns
 * before injecting it. Hard-coding the hash would break every time the
 * inpage source changes; shipping it as a data file in `dist/` would
 * invite a time-of-check-vs-time-of-use race. The right answer is to
 * bake the hash into the content-script chunk at build time — that way
 * the hash is covered by Chrome's extension signature and cannot be
 * tampered with without invalidating the whole package.
 *
 * How it works
 * ────────────
 *   1. During Rollup's `generateBundle` phase (which runs after each
 *      entry chunk has been built), find the emitted `inpage.js`
 *      chunk.
 *   2. Compute SHA-256 over the chunk's `code` (i.e. the exact bytes
 *      that will be written to disk).
 *   3. Find the emitted `content.js` chunk and rewrite the sentinel
 *      string `__INPAGE_INTEGRITY_HASH__` to the computed hex hash.
 *   4. Emit a warning if either chunk name is missing, since that
 *      would silently degrade the security story.
 *
 * Invariants
 * ──────────
 *   - The plugin only runs during `apply: "build"` — dev server
 *     rebuilds do not need to stamp a hash because the content script
 *     does not enforce the check outside of production builds.
 *   - The rewrite uses literal-string replacement, not a regex. That
 *     avoids accidental double-replacements inside a comment or string
 *     literal that happens to look like the sentinel.
 *   - A missing sentinel in the content-script chunk is a fatal
 *     build-time error, not a warning. If the sentinel was refactored
 *     out by accident the build MUST fail, not silently ship an empty
 *     hash.
 */

import { createHash } from "node:crypto";
import type { Plugin, Rollup } from "vite";

/** Literal string the content-script source contains — we rewrite it. */
export const INPAGE_INTEGRITY_SENTINEL = "__INPAGE_INTEGRITY_HASH__";

/** Name of the inpage chunk we look for in the generated bundle. */
const INPAGE_CHUNK_NAME = "inpage.js";

/** Name of the content chunk whose source we rewrite. */
const CONTENT_CHUNK_NAME = "content.js";

/**
 * Options accepted by {@link inpageIntegrityPlugin}. Currently only a
 * custom sentinel override, which exists purely to make the plugin
 * easier to unit-test in isolation from the wallet's actual source.
 */
export interface InpageIntegrityPluginOptions {
  sentinel?: string;
  inpageChunkName?: string;
  contentChunkName?: string;
}

/**
 * Compute SHA-256 hex of a string or byte buffer. Kept as a small
 * helper so downstream tests can re-use the exact digest path.
 */
export function sha256Hex(data: string | Uint8Array): string {
  const h = createHash("sha256");
  h.update(typeof data === "string" ? data : Buffer.from(data));
  return h.digest("hex");
}

/**
 * Returns a Vite plugin that rewrites the content-script chunk with
 * the hex SHA-256 of the inpage chunk.
 *
 * Apply ordering: this plugin has no ordering constraints vs other
 * plugins because it runs in `generateBundle`, which always fires
 * after the chunk graph has been built. Order of emission within
 * `generateBundle` is undefined, so the plugin looks up both chunks
 * by name rather than relying on iteration order.
 */
export function inpageIntegrityPlugin(
  opts: InpageIntegrityPluginOptions = {},
): Plugin {
  const sentinel = opts.sentinel ?? INPAGE_INTEGRITY_SENTINEL;
  const inpageName = opts.inpageChunkName ?? INPAGE_CHUNK_NAME;
  const contentName = opts.contentChunkName ?? CONTENT_CHUNK_NAME;

  return {
    name: "aethelred:inpage-integrity",
    apply: "build",
    generateBundle(
      this: Rollup.PluginContext,
      _options: Rollup.NormalizedOutputOptions,
      bundle: Rollup.OutputBundle,
    ) {
      const inpageChunk = bundle[inpageName];
      const contentChunk = bundle[contentName];

      if (!inpageChunk || inpageChunk.type !== "chunk") {
        this.warn(
          `[inpage-integrity] expected chunk '${inpageName}' not found in `
            + `the generated bundle. Skipping hash injection — the content `
            + `script will refuse to inject inpage at runtime.`,
        );
        return;
      }
      if (!contentChunk || contentChunk.type !== "chunk") {
        this.warn(
          `[inpage-integrity] expected chunk '${contentName}' not found in `
            + `the generated bundle. Skipping hash injection — no content `
            + `script to stamp.`,
        );
        return;
      }

      const staticImports = contentChunk.imports ?? [];
      const dynamicImports = contentChunk.dynamicImports ?? [];
      if (staticImports.length > 0 || dynamicImports.length > 0) {
        this.error(
          `[content-script] '${contentName}' must be a self-contained classic script, `
            + `but Rollup emitted imports (static: ${staticImports.join(", ") || "none"}; `
            + `dynamic: ${dynamicImports.join(", ") || "none"}). Chrome manifest content `
            + `scripts cannot execute top-level ESM imports.`,
        );
        return;
      }

      // Hash the exact bytes that will be written to disk.
      const hash = sha256Hex(inpageChunk.code);
      if (!contentChunk.code.includes(sentinel)) {
        this.error(
          `[inpage-integrity] sentinel '${sentinel}' not found in `
            + `'${contentName}'. The content script was refactored without `
            + `updating the integrity plugin — build cannot produce a `
            + `self-verifying bundle.`,
        );
        return;
      }
      // Literal-string rewrite; safe even if the sentinel appears in
      // a comment (it doesn't, but this keeps the substitution robust
      // against future edits).
      contentChunk.code = contentChunk.code.split(sentinel).join(hash);
      this.info?.(
        `[inpage-integrity] stamped content.js with sha256(inpage.js) = `
          + `${hash.slice(0, 12)}…`,
      );
    },
  };
}

export default inpageIntegrityPlugin;
