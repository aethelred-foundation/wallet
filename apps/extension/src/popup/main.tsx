import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./i18n/i18n";
import {
  initColdStartTimer,
  markReactMounted,
  markInteractive,
  finalizeColdStart,
} from "./perf/cold-start";

/* Start the cold-start timer BEFORE anything else in this module runs —
 * the measurement needs to include the CSS imports, i18n bundle, and
 * React runtime cost. Idempotent on reruns (hot reload). */
initColdStartTimer();

/* ─── Reduced-motion preference ───────────────── *
 * Apply the user's in-app reduced-motion override (from Settings) before
 * the first paint so no entrance animation plays when they've opted out.
 * OS-level `prefers-reduced-motion` is honoured directly by motion.css
 * via a media query — the `data-reduced-motion` attribute serves only
 * the in-app override path. */
(() => {
  try {
    if (localStorage.getItem("aethelred-reduced-motion") === "1") {
      document.documentElement.setAttribute("data-reduced-motion", "1");
    }
  } catch {
    // private mode — ignore
  }
})();

/* ─── Theme initialization ───────────────────── *
 * Runs BEFORE React mounts to prevent a flash of
 * the wrong theme. Reads saved preference from
 * localStorage, falls back to OS-level preference. */
(() => {
  try {
    const saved = localStorage.getItem("aethelred-theme");
    if (saved === "light" || saved === "dark") {
      document.documentElement.setAttribute("data-theme", saved);
    } else if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.setAttribute("data-theme", "light");
    }
  } catch {
    // localStorage may be unavailable (private mode)
    document.documentElement.setAttribute("data-theme", "dark");
  }
})();

/* ─── Foundation (design tokens + motion) ──── *
 * These two files MUST load first so every
 * downstream stylesheet can reference the CSS
 * custom properties they define. */
import "../styles/design-tokens.css";
import "../styles/motion.css";

import "../styles.css";
import "../styles/nav.css";
import "../styles/form.css";
import "../styles/onboarding.css";
import "../styles/lock-screen.css";
import "../styles/views.css";
import "../styles/dashboard.css";
import "../styles/send.css";
import "../styles/dapps.css";
import "../styles/audit.css";
import "../styles/components.css";
import "../styles/swap.css";
import "../styles/enterprise.css";
import "../styles/home-feed.css";
import "../styles/home-v2.css";
import "../styles/premium-global.css";
import "../styles/moat.css";
import "../styles/settings.css";
import "../styles/view-error-boundary.css";
import "../styles/toast.css";
import "../styles/command-palette.css";
import "../styles/primitives.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Render request issued → mark the React mount milestone, then defer to the
// next frame so the browser has flushed a paint before we declare
// interactivity.
markReactMounted();
if (typeof requestAnimationFrame === "function") {
  requestAnimationFrame(() => {
    markInteractive();
    finalizeColdStart();
  });
} else {
  markInteractive();
  finalizeColdStart();
}

/* ─── Splash teardown ────────────────────────── *
 * The splash in popup.html runs a 1700ms CSS animation, ending in
 * opacity 0 + visibility:hidden (via `forwards`). It's already invisible
 * at that point — we just remove it from the DOM afterwards for
 * cleanliness. If the .skip class is set (already seen this session),
 * remove immediately so it doesn't linger. */
(() => {
  const splash = document.getElementById("splash-screen");
  if (!splash) return;
  const delay = splash.classList.contains("skip") ? 0 : 1750;
  setTimeout(() => splash.remove(), delay);
})();
