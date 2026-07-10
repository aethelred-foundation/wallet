/**
 * i18n key resolution — no raw keys may ever reach the UI.
 *
 * Regression: `resources: { en: en }` hands the locale JSON to i18next as a
 * MAP OF NAMESPACES — every top-level key ("nav", "header", …) becomes a
 * namespace instead of a key prefix. Bare useTranslation() then looks up
 * dotted keys ("nav.home") in the default "translation" namespace, which
 * doesn't exist, and the key echoes back into the DOM: the popup shipped
 * showing "HEADER.LIVELABEL" and "nav.home" in the header and tab bar.
 * The bundles must be registered under the default namespace:
 * `resources: { en: { translation: en } }`.
 *
 * The exhaustive walk below fails on ANY bundle key that does not resolve,
 * in every shipped locale — not just the ones that happened to be visible.
 */

import { describe, expect, it } from "vitest";
import i18n from "../popup/i18n/i18n";
import en from "../popup/i18n/locales/en.json";
import es from "../popup/i18n/locales/es.json";

/** Collect every dotted leaf path of a locale bundle. */
function leafPaths(node: unknown, prefix = ""): string[] {
  if (typeof node !== "object" || node === null) return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leafPaths(value, prefix ? `${prefix}.${key}` : key),
  );
}

describe("popup i18n key resolution", () => {
  it("resolves the header and nav keys that once leaked raw into the UI", () => {
    expect(i18n.t("nav.home")).toBe("Home");
    expect(i18n.t("nav.portfolio")).toBe("Portfolio");
    expect(i18n.t("nav.markets")).toBe("Markets");
    expect(i18n.t("nav.payments")).toBe("Payments");
    expect(i18n.t("nav.hub")).toBe("Hub");
    expect(i18n.t("nav.mainNavigation")).toBe("Main navigation");
    expect(i18n.t("header.liveLabel")).toBe("Live");
  });

  it("resolves every English bundle key (no raw-key leakage)", () => {
    const unresolved = leafPaths(en).filter((path) => i18n.t(path) === path);
    expect(unresolved).toEqual([]);
  });

  it("resolves every Spanish bundle key under lng=es", async () => {
    await i18n.changeLanguage("es");
    try {
      const unresolved = leafPaths(es).filter(
        (path) => i18n.t(path) === path,
      );
      expect(unresolved).toEqual([]);
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("falls back to English for keys a locale is missing", async () => {
    await i18n.changeLanguage("es");
    try {
      // Every English leaf must resolve to SOMETHING under es — either the
      // Spanish string or the English fallback — never the raw key.
      const unresolved = leafPaths(en).filter((path) => i18n.t(path) === path);
      expect(unresolved).toEqual([]);
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
