import en from './en.json';

const KEY = 'lang';

// English-only UI. Alert content is plain English strings from the API
// (legacy { en } objects are coerced by callers).

export function t(_lang, key) {
  return en[key] ?? key;
}

export async function getLang() {
  return 'en';
}

export async function saveLang() {}
