import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  appType: "mpa",
  plugins: [react()],
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
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name].js",
        assetFileNames: "assets/[name].[ext]"
      }
    }
  }
});
