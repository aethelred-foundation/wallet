import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { defineConfig, type Plugin, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

/* ─── Image-asset sanity gate ─────────────────────────────────────── *
 * Every PNG / JPG under `public/` must have a matching `.webp`
 * sibling. The WebP is what `<DappImage>` actually serves via
 * `<picture><source type="image/webp">` to every modern Chrome — the
 * raster is only a fallback for platforms that predate WebP support.
 *
 * Running sharp inline in Vite would add 5-10 s to every build and
 * force every contributor to install sharp (~40 MB of native
 * bindings). Instead the optimizer runs as a separate step
 * (`npm run optimize:images`) and this plugin only VERIFIES its
 * output. If a raster ships without a WebP sibling, the build fails
 * with a clear, actionable message pointing at the fix command — so
 * we never silently ship the 1.4 MB PNG ZeroID again.
 *
 * Soft exemption: rasters < 30 kB don't meaningfully benefit from
 * WebP (the file header overhead dwarfs the pixel payload), so
 * we waive the check for them. Matches the threshold in
 * `scripts/optimize-images.mjs`.
 */
const IMAGE_SOFT_EXEMPT_BYTES = 30 * 1024;
const RASTER_RE = /\.(png|jpg|jpeg)$/i;

function assetBudgetGate(): Plugin {
  return {
    name: "aethelred:asset-budget-gate",
    apply: "build",
    buildStart() {
      const publicDir = resolve(rootDir, "public");
      if (!existsSync(publicDir)) return;

      const offenders: string[] = [];
      for (const name of readdirSync(publicDir)) {
        if (!RASTER_RE.test(name)) continue;
        if (/@2x\./.test(name)) continue;
        const full = resolve(publicDir, name);
        const stat = statSync(full);
        if (!stat.isFile()) continue;
        if (stat.size < IMAGE_SOFT_EXEMPT_BYTES) continue;
        const base = name.replace(RASTER_RE, "");
        const webp = resolve(publicDir, `${base}.webp`);
        if (!existsSync(webp)) {
          offenders.push(
            `  ${name}  (${(stat.size / 1024).toFixed(1)} kB) — missing ${base}.webp`,
          );
        }
      }

      if (offenders.length > 0) {
        const msg = [
          "",
          "──────────────────────────────────────────────────────",
          "Image optimization gate failed.",
          "",
          "The following source rasters ship without a WebP sibling:",
          "",
          ...offenders,
          "",
          "Fix:",
          "  $ npm install sharp --save-dev --legacy-peer-deps",
          "  $ npm run optimize:images",
          "",
          "Shipping raw PNG/JPG assets balloons the extension install",
          "size by 5-20×. Commit the generated .webp siblings alongside",
          "the source raster.",
          "──────────────────────────────────────────────────────",
          "",
        ].join("\n");
        throw new Error(msg);
      }
    },
  };
}

/**
 * Bundle analysis plugin.
 *
 * Gated behind `ANALYZE=1` so the default `npm run build:extension` is
 * unchanged for CI and release builds — only engineers explicitly asking
 * for a breakdown pay the extra reporting cost. When enabled, rollup
 * emits `dist/bundle-report.html` with per-chunk sizes (raw, gzip,
 * brotli). See `apps/extension/package.json` → `bundle:analyze`.
 *
 * The import is done lazily (require at gate-time) so the default build
 * does NOT depend on `rollup-plugin-visualizer` being installed. That
 * matters during rollout — this file ships before the package-lock gets
 * updated, and we refuse to break the default build path.
 */
function makeAnalyzePlugins(): PluginOption[] {
  if (process.env.ANALYZE !== "1") return [];
  try {
    const require = createRequire(import.meta.url);
    const mod = require("rollup-plugin-visualizer") as {
      visualizer: (opts: Record<string, unknown>) => PluginOption;
    };
    return [
      mod.visualizer({
        filename: "dist/bundle-report.html",
        gzipSize: true,
        brotliSize: true,
        template: "treemap",
        title: "Aethelred Wallet - Bundle Report",
      }),
    ];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[vite.config] rollup-plugin-visualizer not available — skipping analyze plugin. (${message})`,
    );
    return [];
  }
}

export default defineConfig(({ mode }) => {
  /* Preview/dev builds (the in-browser + mobile WebView preview) emit
   * content-hashed filenames so every rebuild produces fresh URLs and the
   * browser can never serve a stale cached bundle. Production builds (Chrome
   * Web Store) keep deterministic, unhashed names so supply-chain auditors get
   * byte-identical ZIPs (see scripts/package-extension.mjs). The entries
   * referenced by fixed name in manifest.json are never hashed. */
  const isProdBuild = mode === "production";
  const fixedEntries = new Set(["background", "content", "inpage"]);

  return {
  appType: "mpa",
  /* PROD/DEV follow the BUILD MODE, never ambient NODE_ENV. Vite derives
   * import.meta.env.PROD from NODE_ENV while --mode controls everything
   * else — so a stray NODE_ENV=development in the invoking shell silently
   * compiled a "production" dist (deterministic unhashed names and all)
   * with every IS_PRODUCTION_BUILD gate open, shipping preview prices and
   * dev fallbacks. One source of truth: the mode. */
  define: {
    "import.meta.env.PROD": JSON.stringify(isProdBuild),
    "import.meta.env.DEV": JSON.stringify(!isProdBuild),
  },
  plugins: [assetBudgetGate(), react(), ...makeAnalyzePlugins()],
  server: {
    port: 3301,
    host: true,
    /* Allow cloudflared `*.trycloudflare.com` hosts (and any other
     * tunneling proxy) to forward requests to this dev server. Vite
     * rejects requests with non-matching `Host:` headers by default
     * as a security measure — but for cross-team remote previewing
     * over a tunnel we need to opt in. Setting this to `true`
     * disables the host check entirely, which is safe ONLY for a
     * local dev server because Vite is never run in production. */
    allowedHosts: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    /**
     * Deterministic Chrome extension builds.
     *
     * Supply-chain auditors re-run `npm run package:extension` on a
     * known-good commit and compare the resulting ZIP hash against the
     * value we publish in the release notes. That only works if Vite /
     * Rollup emit byte-identical files every time, which means:
     *   - source maps off (they embed timestamps / absolute paths),
     *   - minifier and tree-shaker settings pinned,
     *   - no content-hash based filenames (they vary with whitespace).
     * The ZIP-level determinism (fixed mtimes, sorted entries, no extra
     * attributes) is handled in `scripts/package-extension.mjs`.
     */
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: resolve(rootDir, "popup.html"),
        options: resolve(rootDir, "options.html"),
        background: resolve(rootDir, "src/background.ts"),
        content: resolve(rootDir, "src/content.ts"),
        inpage: resolve(rootDir, "src/inpage.ts"),
      },
      output: {
        entryFileNames: (chunk) =>
          isProdBuild || fixedEntries.has(chunk.name)
            ? "[name].js"
            : "[name].[hash].js",
        chunkFileNames: isProdBuild ? "chunks/[name].js" : "chunks/[name].[hash].js",
        assetFileNames: isProdBuild ? "assets/[name].[ext]" : "assets/[name].[hash].[ext]",
      }
    }
  }
  };
});
