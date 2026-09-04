import { useEffect, useRef } from 'react';
import { useAuth } from './auth';
import { usePrefs } from './prefs';
import { useI18n } from './i18n';
import type { LangCode } from './i18n';

// Kontogebundene Einstellungen, die nicht an einer einzelnen Seite hängen:
// Sprache und die Abmeldezeit bei Inaktivität. Beides wird im Benutzer-Panel
// („Mein Konto") gesetzt und hier auf die laufende Sitzung angewendet.

export const LANG_PREF = 'lang';
export const IDLE_PREF = 'idleTimeoutMin';

/** Voreinstellung, wenn der Benutzer nichts gewählt hat (Minuten). */
export const DEFAULT_IDLE_MIN = 120;

/** Auswählbare Abmeldezeiten in Minuten; 0 = nie automatisch abmelden. */
export const IDLE_CHOICES = [15, 30, 60, 120, 240, 480, 0];

/** Gespeicherte Abmeldezeit lesen (mit Prüfung auf einen erlaubten Wert). */
export function idleMinutes(prefs: Record<string, unknown>): number {
  const v = prefs[IDLE_PREF];
  return typeof v === 'number' && IDLE_CHOICES.includes(v) ? v : DEFAULT_IDLE_MIN;
}

const IDLE_CHECK_MS = 60_000;   // einmal pro Minute prüfen

/**
 * Wendet die kontogebundenen Einstellungen an. Rendert nichts – muss aber
 * innerhalb von AuthProvider, PrefsProvider und I18nProvider hängen.
 */
export function AccountPrefsSync() {
  const { user, logout } = useAuth();
  const { prefs, loaded } = usePrefs();
  const { lang, setLang } = useI18n();

  // ── Sprache des Kontos übernehmen ──
  useEffect(() => {
    if (!loaded) return;
    const stored = prefs[LANG_PREF];
    if (typeof stored === 'string' && stored && stored !== lang) setLang(stored as LangCode);
    // lang bewusst nicht als Abhängigkeit: eine lokale Umschaltung würde sonst
    // sofort wieder vom (noch alten) gespeicherten Wert überschrieben.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, prefs[LANG_PREF], setLang]);

  // ── Automatische Abmeldung bei Inaktivität ──
  const lastActivity = useRef(Date.now());
  const minutes = idleMinutes(prefs);

  useEffect(() => {
    if (!user) return;
    const touch = () => { lastActivity.current = Date.now(); };
    const events = ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'];
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, touch));
  }, [user]);

  useEffect(() => {
    if (!user || minutes <= 0) return;      // 0 = nie abmelden
    lastActivity.current = Date.now();      // nach einer Änderung neu zählen
    const timer = setInterval(() => {
      if (Date.now() - lastActivity.current > minutes * 60_000) void logout();
    }, IDLE_CHECK_MS);
    return () => clearInterval(timer);
  }, [user, minutes, logout]);

  return null;
}
