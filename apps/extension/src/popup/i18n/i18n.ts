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

const resources = {
  en: en,
  es: es,
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
