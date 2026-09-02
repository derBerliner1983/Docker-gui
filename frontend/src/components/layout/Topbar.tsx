import { RefreshCw, Menu, Pencil, Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { tt } from '../../lib/i18n';
import { useLayout } from '../../lib/layoutContext';

interface TopbarProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function Topbar({ title, subtitle, actions, onRefresh, refreshing }: TopbarProps) {
  const { openMobileMenu, editLayout, setEditLayout, hasPanels } = useLayout();
  return (
    <header className="topbar">
      <button className="icon-btn topbar__menu-btn" onClick={openMobileMenu} title={tt('Menü öffnen')}>
        <Menu size={16} />
      </button>
      <div>
        <div className="topbar__title">{title}</div>
        {subtitle && <div style={{ fontSize: 11, color: 'var(--color-subtle)', marginTop: 1 }}>{subtitle}</div>}
      </div>
      <div className="topbar__actions">
        {actions}
        {/* Layout bearbeiten: nur das Symbol, und nur auf Seiten mit Panels. */}
        {hasPanels && (
          <button
            className="icon-btn"
            onClick={() => setEditLayout(!editLayout)}
            title={editLayout ? tt('Bearbeiten beenden') : tt('Layout bearbeiten')}
            aria-pressed={editLayout}
            style={editLayout ? { color: 'var(--color-accent)', background: 'var(--color-accent-soft)' } : undefined}
          >
            {editLayout ? <Check size={14} /> : <Pencil size={14} />}
          </button>
        )}
        {onRefresh && (
          <button
            className="icon-btn"
            onClick={onRefresh}
            title={tt('Aktualisieren')}
            style={refreshing ? { animation: 'spin 1s linear infinite' } : undefined}
          >
            <RefreshCw size={14} />
          </button>
        )}
      </div>
    </header>
  );
}
