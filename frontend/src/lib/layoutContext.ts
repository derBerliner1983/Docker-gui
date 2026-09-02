import { createContext, useContext } from 'react';

interface LayoutCtx {
  openMobileMenu: () => void;
  /** Bearbeiten-Modus für die Panels der aktuellen Seite. */
  editLayout: boolean;
  setEditLayout: (v: boolean) => void;
  /**
   * Meldet, ob die aktuelle Seite eine sortierbare Panel-Liste enthält.
   * Nur dann zeigt die Topbar den Bleistift.
   */
  registerPanels: (present: boolean) => void;
  hasPanels: boolean;
}

export const LayoutContext = createContext<LayoutCtx>({
  openMobileMenu: () => {},
  editLayout: false,
  setEditLayout: () => {},
  registerPanels: () => {},
  hasPanels: false,
});
export const useLayout = () => useContext(LayoutContext);
