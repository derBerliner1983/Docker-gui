import { RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';

interface TopbarProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function Topbar({ title, subtitle, actions, onRefresh, refreshing }: TopbarProps) {
  return (
    <header className="topbar">
      <div>
        <div className="topbar__title">{title}</div>
        {subtitle && <div style={{ fontSize: 11, color: 'var(--color-subtle)', marginTop: 1 }}>{subtitle}</div>}
      </div>
      <div className="topbar__actions">
        {actions}
        {onRefresh && (
          <button
            className="icon-btn"
            onClick={onRefresh}
            title="Aktualisieren"
            style={refreshing ? { animation: 'spin 1s linear infinite' } : undefined}
          >
            <RefreshCw size={14} />
          </button>
        )}
      </div>
    </header>
  );
}
