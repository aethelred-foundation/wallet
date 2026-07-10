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

/* Each bundle MUST be wrapped under the default "translation" namespace.
 * Passing the bundle directly (`en: en`) makes i18next treat every
 * top-level key ("nav", "header", …) as a NAMESPACE, so bare
 * useTranslation() lookups of dotted keys miss and the raw key string
 * renders in the UI ("nav.home", "HEADER.LIVELABEL"). Guarded by
 * src/test/i18n-key-resolution.test.ts. */
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
