import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';
import { useAuth } from './auth';
import type { SystemComponent } from './types';

/**
 * Zustand der optionalen System-Komponenten – einmal geladen, überall nutzbar.
 *
 * Wird eine Komponente entfernt, sollen alle Oberflächenteile verschwinden,
 * die sie voraussetzen – auch die an ganz anderer Stelle (Menüpunkt in der
 * Seitenleiste, Panel auf einer anderen Seite). Damit das konsistent bleibt,
 * liegt der Status hier zentral statt in jeder Komponente einzeln.
 */

interface ComponentsCtx {
  components: SystemComponent[];
  loaded: boolean;
  reload: () => Promise<void>;
  /** Ist der Navigationspfad wegen einer fehlenden Komponente nicht nutzbar? */
  isRouteBlocked: (route: string) => boolean;
  /** Ist das Panel wegen einer fehlenden Komponente nicht nutzbar? */
  isPanelBlocked: (panelKey: string) => boolean;
  /** Komponente, zu der ein Panel gehört (für „Deinstallieren" im Editor). */
  componentForPanel: (panelKey: string) => SystemComponent | undefined;
}

const Ctx = createContext<ComponentsCtx>({
  components: [], loaded: false, reload: async () => {},
  isRouteBlocked: () => false, isPanelBlocked: () => false,
  componentForPanel: () => undefined,
});

export function ComponentsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [components, setComponents] = useState<SystemComponent[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      const r = await api.system.components();
      setComponents(r.components ?? []);
    } catch { /* nicht angemeldet o. ä. – dann wird nichts ausgeblendet */ }
    finally { setLoaded(true); }
  }, []);

  useEffect(() => {
    if (!user) { setComponents([]); setLoaded(false); return; }
    void reload();
  }, [user, reload]);

  // Solange nichts geladen ist, wird bewusst nichts ausgeblendet – sonst würde
  // die Oberfläche beim Start kurz „springen".
  const isRouteBlocked = useCallback(
    (route: string) => components.some((c) => !c.installed && c.routes.includes(route)),
    [components],
  );
  const isPanelBlocked = useCallback(
    (panelKey: string) => components.some((c) => !c.installed && c.panels.includes(panelKey)),
    [components],
  );
  const componentForPanel = useCallback(
    (panelKey: string) => components.find((c) => c.panels.includes(panelKey)),
    [components],
  );

  return (
    <Ctx.Provider value={{ components, loaded, reload, isRouteBlocked, isPanelBlocked, componentForPanel }}>
      {children}
    </Ctx.Provider>
  );
}

export const useComponents = () => useContext(Ctx);
