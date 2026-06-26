import { createContext, useContext, useState, useCallback, useEffect } from 'react';

// ── Verfügbare Sprachen ──────────────────────────────────────────────────────
// Neue Sprache hinzufügen: hier eintragen + Wörterbuch in ./locales/<code>.ts
// anlegen und unten in DICTS importieren. Fehlt ein Schlüssel, wird automatisch
// auf Deutsch (Basis) zurückgegriffen.
export const LANGUAGES = [
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
] as const;

export type LangCode = (typeof LANGUAGES)[number]['code'];

import { de } from './locales/de';
import { en } from './locales/en';

export type TranslationDict = Record<string, string>;

const DICTS: Record<LangCode, TranslationDict> = { de, en };

const STORAGE_KEY = 'lang';

function detectInitial(): LangCode {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && DICTS[stored as LangCode]) return stored as LangCode;
  const nav = (navigator.language || 'de').slice(0, 2).toLowerCase();
  return (DICTS[nav as LangCode] ? nav : 'de') as LangCode;
}

interface I18nContextValue {
  lang: LangCode;
  setLang: (l: LangCode) => void;
  /** Übersetzt einen Schlüssel; optional mit {platzhalter}-Ersetzung. */
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<LangCode>(detectInitial);

  useEffect(() => {
    document.documentElement.setAttribute('lang', lang);
  }, [lang]);

  const setLang = useCallback((l: LangCode) => {
    setLangState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* */ }
  }, []);

  const t = useCallback((key: string, vars?: Record<string, string | number>) => {
    const dict = DICTS[lang] ?? de;
    let s = dict[key] ?? de[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }
    return s;
  }, [lang]);

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}

/** Bequemer Hook, der nur die t-Funktion liefert. */
export function useT() {
  return useI18n().t;
}
