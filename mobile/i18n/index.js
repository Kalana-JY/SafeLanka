import AsyncStorage from '@react-native-async-storage/async-storage';
import en from './en.json';
import si from './si.json';
import ta from './ta.json';

const DICTS = { en, si, ta };
const KEY = 'lang';

// Alert/record content stays trilingual from the API; this covers UI chrome.
export function t(lang, key) {
  return DICTS[lang]?.[key] ?? en[key] ?? key;
}

export async function getLang() {
  return (await AsyncStorage.getItem(KEY)) || 'en';
}

export async function saveLang(lang) {
  await AsyncStorage.setItem(KEY, lang);
}
