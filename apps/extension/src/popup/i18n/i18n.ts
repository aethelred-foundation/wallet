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

/* Each locale JSON is a flat object of namespaced keys (`common`,
 * `nav`, `home`, …). i18next treats the top-level keys of a resource
 * entry as *namespaces*, so the catalog must be nested under the
 * default namespace ("translation") for dotted lookups like
 * `t("nav.home")` to resolve. Registering the bare object instead
 * turned every section into its own namespace and left the default
 * namespace empty — so every `t()` call fell back to the raw key. */
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
