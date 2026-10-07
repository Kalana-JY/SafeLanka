import { createContext, useContext, useState } from 'react';
import en from '../i18n/en.json';
import si from '../i18n/si.json';
import ta from '../i18n/ta.json';

const DICTS = { en, si, ta };
const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(localStorage.getItem('lang') || 'en');
  function switchLang(l) {
    setLang(l);
    localStorage.setItem('lang', l);
  }
  // Alert/record content stays trilingual from the API; this covers UI chrome.
  const t = (key) => DICTS[lang]?.[key] ?? en[key] ?? key;
  return <I18nContext.Provider value={{ lang, switchLang, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

export function LangSwitcher() {
  const { lang, switchLang } = useI18n();
  return (
    <select value={lang} onChange={(e) => switchLang(e.target.value)} title="Language / භාෂාව / மொழி">
      <option value="en">EN</option>
      <option value="si">SI</option>
      <option value="ta">TA</option>
    </select>
  );
}
