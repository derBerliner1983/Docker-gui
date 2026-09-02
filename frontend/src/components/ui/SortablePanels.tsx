import { useRef, useState, type ReactNode } from 'react';
import { GripVertical, EyeOff, Plus, Pencil, Check, RotateCcw } from 'lucide-react';
import { tt } from '../../lib/i18n';
import { useOrder, usePrefs } from '../../lib/prefs';

export interface SortableItem {
  id: string;
  node: ReactNode;
  /** Anzeigename; fehlt er, wird der Titel beim Ausblenden aus dem Panel gelesen. */
  title?: string;
}

/** Ein ausgeblendetes Panel – Titel wird mitgespeichert, damit es benennbar bleibt. */
interface HiddenPanel { id: string; title: string }

function ordered(items: SortableItem[], saved: string[]): SortableItem[] {
  if (saved.length === 0) return items;
  const rank = new Map(saved.map((id, i) => [id, i]));
  return [...items].sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));
}

const HIDDEN_PREF = 'panelHidden';

/**
 * Vertikale Liste von Panels mit Bearbeiten-Modus.
 *
 * Normal: nur Sortieren per Griff (Ziehen erst nach Anfassen des Griffs, damit
 * das Auf-/Zuklappen nicht ausgelöst wird).
 * Im Bearbeiten-Modus lassen sich Panels zusätzlich ausblenden und über eine
 * Leiste wieder einblenden; Reihenfolge und Sichtbarkeit werden pro Benutzer
 * serverseitig gespeichert.
 */
export function SortablePanels({ storageKey, items }: { storageKey: string; items: SortableItem[] }) {
  const [order, setOrder] = useOrder('panelOrder', storageKey);   // pro-Benutzer serverseitig gespeichert
  const { prefs, setPref } = usePrefs();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);   // Panel, dessen Griff gegriffen wurde
  const [editing, setEditing] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const allHidden = (prefs[HIDDEN_PREF] as Record<string, HiddenPanel[]>) || {};
  const hidden: HiddenPanel[] = allHidden[storageKey] ?? [];
  const hiddenIds = new Set(hidden.map((h) => h.id));
  const setHidden = (next: HiddenPanel[]) => setPref(HIDDEN_PREF, { ...allHidden, [storageKey]: next });

  const list = ordered(items, order).filter((i) => !hiddenIds.has(i.id));

  /** Titel eines Panels: erst aus dem Item, sonst aus der Überschrift im DOM. */
  const titleOf = (it: SortableItem): string => {
    if (it.title) return it.title;
    const el = wrapRef.current?.querySelector(`[data-panel-id="${CSS.escape(it.id)}"] .panel__title`);
    return el?.textContent?.trim() || it.id;
  };

  const hide = (it: SortableItem) => {
    if (hiddenIds.has(it.id)) return;
    setHidden([...hidden, { id: it.id, title: titleOf(it) }]);
  };
  const show = (id: string) => setHidden(hidden.filter((h) => h.id !== id));

  const drop = (targetId: string) => {
    if (!dragId || dragId === targetId) { setDragId(null); setOverId(null); return; }
    const ids = list.map((i) => i.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) { setDragId(null); setOverId(null); return; }
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    // Ausgeblendete Einträge hinten anhängen, damit ihre Position erhalten bleibt.
    setOrder([...ids, ...hidden.map((h) => h.id)]);
    setDragId(null); setOverId(null); setArmed(null);
  };

  const resetLayout = () => {
    if (!confirm(tt('Reihenfolge und Sichtbarkeit dieser Seite zurücksetzen?'))) return;
    setOrder([]);
    setHidden([]);
  };

  return (
    <div ref={wrapRef}>
      {/* Kopfzeile des Bearbeiten-Modus */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <button
          className={`btn btn--sm ${editing ? 'btn--primary' : 'btn--outline'}`}
          onClick={() => setEditing((e) => !e)}
          title={tt('Panels sortieren, ausblenden und wieder einblenden')}
        >
          {editing ? <Check size={13} /> : <Pencil size={13} />}
          {editing ? tt('Fertig') : tt('Layout bearbeiten')}
        </button>
        {editing && (
          <>
            <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>
              {tt('Am Griff ziehen zum Sortieren · Auge zum Ausblenden')}
            </span>
            <button className="btn btn--outline btn--sm" style={{ marginLeft: 'auto' }} onClick={resetLayout}>
              <RotateCcw size={13} /> {tt('Zurücksetzen')}
            </button>
          </>
        )}
        {!editing && hidden.length > 0 && (
          <span style={{ fontSize: 12, color: 'var(--color-faint)' }}>
            {tt('{n} ausgeblendet', { n: hidden.length })}
          </span>
        )}
      </div>

      {/* Ausgeblendete Panels wieder hereinholen */}
      {editing && hidden.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-body" style={{ padding: '10px 12px' }}>
            <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 8 }}>{tt('Ausgeblendet – zum Einblenden anklicken:')}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {hidden.map((h) => (
                <button key={h.id} className="btn btn--outline btn--sm" onClick={() => show(h.id)}>
                  <Plus size={13} /> {h.title}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {list.map((it) => {
          const isOver = overId === it.id && dragId && dragId !== it.id;
          return (
            <div
              key={it.id}
              data-panel-id={it.id}
              // Im Bearbeiten-Modus ist Ziehen sofort möglich, sonst erst nach
              // Anfassen des Griffs.
              draggable={editing || armed === it.id}
              onDragStart={(e) => { setDragId(it.id); e.dataTransfer.effectAllowed = 'move'; }}
              onDragEnd={() => { setDragId(null); setOverId(null); setArmed(null); }}
              onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverId(it.id); } }}
              onDrop={(e) => { e.preventDefault(); drop(it.id); }}
              style={{
                position: 'relative',
                opacity: dragId === it.id ? 0.4 : 1,
                borderRadius: 10,
                boxShadow: isOver ? 'inset 0 3px 0 var(--color-accent)' : 'none',
                outline: editing ? '1px dashed var(--color-border)' : 'none',
                transition: 'box-shadow .12s',
              }}
            >
              {/* Griff zum Ziehen */}
              <button
                type="button"
                title={tt('Zum Sortieren ziehen')}
                onMouseDown={() => setArmed(it.id)}
                onMouseUp={() => setArmed(null)}
                onClick={(e) => e.preventDefault()}
                style={{
                  position: 'absolute', left: -2, top: 12, zIndex: 2,
                  background: 'none', border: 'none', cursor: 'grab', padding: '4px 2px',
                  color: editing ? 'var(--color-accent)' : 'var(--color-faint)',
                  display: 'flex', alignItems: 'center',
                }}
              >
                <GripVertical size={15} />
              </button>

              {/* Ausblenden – nur im Bearbeiten-Modus */}
              {editing && (
                <button
                  type="button"
                  className="icon-btn"
                  title={tt('Dieses Panel ausblenden')}
                  onClick={(e) => { e.stopPropagation(); hide(it); }}
                  style={{ position: 'absolute', right: 44, top: 12, zIndex: 3 }}
                >
                  <EyeOff size={14} />
                </button>
              )}
              {it.node}
            </div>
          );
        })}
      </div>

      {list.length === 0 && (
        <div className="empty-state" style={{ padding: '32px 20px' }}>
          <div className="empty-state__title">{tt('Alle Panels ausgeblendet')}</div>
          <div className="empty-state__desc">{tt('Über „Layout bearbeiten" lassen sie sich wieder einblenden.')}</div>
        </div>
      )}
    </div>
  );
}
