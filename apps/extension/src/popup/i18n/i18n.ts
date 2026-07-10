import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import es from "./locales/es.json";

/* ─── Language resolution ─────────────────────
 * Priority: saved preference in localStorage → "en" fallback.
 * The key ("aethelred-language") mirrors the convention used for
 * other persisted UI preferences (theme, UI version). Reading it
 * up front keeps the user's choice across sessions without the
 * flash of a wrong language on mount. */
function getInitialLanguage(): string {
  try {
    const saved = localStorage.getItem("aethelred-language");
    if (saved) return saved;
  } catch {
    // localStorage may be unavailable (private mode)
  }
  return "en";
}

/* Each locale bundle MUST be nested under the default namespace
 * ("translation"). i18next treats the top-level keys of a resource entry
 * as *namespaces*, so registering the bare object (`en: en`) turned every
 * section ("nav", "header", …) into its own namespace, left the default
 * namespace empty, and every bare-useTranslation() dotted lookup echoed
 * the raw key into the UI ("nav.home", "HEADER.LIVELABEL"). Guarded by
 * src/test/i18n-key-resolution.test.ts, which resolves every leaf key of
 * every shipped locale. */
const resources = {
  en: { translation: en },
  es: { translation: es },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: getInitialLanguage(),
  fallbackLng: "en",
  interpolation: {
    // React already escapes values, so i18next doesn't need to.
    escapeValue: false,
  },
});

export default i18n;
