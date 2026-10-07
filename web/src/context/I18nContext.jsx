import { createContext, useContext } from 'react';
import en from '../i18n/en.json';

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  // English-only UI.
  const lang = 'en';
  function switchLang() {}
  const t = (key) => en[key] ?? key;
  return <I18nContext.Provider value={{ lang, switchLang, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

export function LangSwitcher() {
  return <span title="English only">EN</span>;
}
