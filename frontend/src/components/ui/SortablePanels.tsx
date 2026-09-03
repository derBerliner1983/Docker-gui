import { useEffect, useRef, useState, type ReactNode } from 'react';
import { GripVertical, EyeOff, Plus, RotateCcw, Trash2, PackagePlus } from 'lucide-react';
import { tt } from '../../lib/i18n';
import { useOrder, usePrefs } from '../../lib/prefs';
import { useLayout } from '../../lib/layoutContext';
import { useComponents } from '../../lib/components';
import { allNavItems } from '../../lib/navItems';
import { api } from '../../lib/api';

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
  const wrapRef = useRef<HTMLDivElement>(null);
  // Der Bleistift sitzt in der Topbar – der Modus kommt deshalb aus dem Layout.
  const { editLayout: editing, registerPanels } = useLayout();
  const { components, componentForPanel, isPanelBlocked, reload: reloadComponents } = useComponents();
  const [busyId, setBusyId] = useState<string | null>(null);

  // Der Topbar melden, dass diese Seite Panels hat (und beim Verlassen abmelden).
  useEffect(() => {
    registerPanels(true);
    return () => registerPanels(false);
  }, [registerPanels]);

  const allHidden = (prefs[HIDDEN_PREF] as Record<string, HiddenPanel[]>) || {};
  const hidden: HiddenPanel[] = allHidden[storageKey] ?? [];
  const hiddenIds = new Set(hidden.map((h) => h.id));
  const setHidden = (next: HiddenPanel[]) => setPref(HIDDEN_PREF, { ...allHidden, [storageKey]: next });

  // Zusätzlich zu manuell ausgeblendeten fallen Panels weg, deren Komponente
  // nicht installiert ist – egal auf welcher Seite sie liegen.
  const list = ordered(items, order).filter((i) => !hiddenIds.has(i.id) && !isPanelBlocked(`${storageKey}:${i.id}`));

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

  /** Komponente zu einem Panel entfernen – mit Vorschau der Folgen. */
  const uninstall = async (panelId: string) => {
    const panelKey = `${storageKey}:${panelId}`;
    const c = componentForPanel(panelKey);
    if (!c) return;
    // Betroffene Bereiche mit ihren Menünamen benennen – ein Pfad wie
    // „/containers" sagt beim Lesen wenig.
    const nav = allNavItems();
    const betroffen = [
      ...c.routes.map((r) => {
        const item = nav.find((n) => n.to === r);
        return item ? tt(item.labelKey) : r;
      }),
      ...c.panels.filter((pk) => pk !== panelKey).map((pk) => `Panel „${pk.split(':').pop()}"`),
    ];
    const text = [
      `„${c.name}" entfernen?`,
      c.description,
      '',
      betroffen.length
        ? `Dadurch verschwinden auch: ${betroffen.join(', ')}.`
        : 'Es hängen keine weiteren Bereiche daran.',
      c.packages.length ? `Paket(e): ${c.packages.join(', ')}` : '',
      '',
      'OK = Dienst stoppen UND Paket deinstallieren.',
    ].filter(Boolean).join('\n');
    if (!confirm(text)) return;
    setBusyId(panelKey);
    try {
      const r = await api.system.uninstallComponent(c.id, true);
      await reloadComponents();
      alert(`„${c.name}" entfernt:\n${r.steps.join('\n')}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : tt('Entfernen fehlgeschlagen'));
    } finally { setBusyId(null); }
  };

  /** Auf dieser Seite entfernte Komponenten – zum Wiederinstallieren. */
  const removedHere = components.filter(
    (c) => !c.installed && c.packages.length > 0
      && c.panels.some((pk) => items.some((i) => `${storageKey}:${i.id}` === pk)),
  );

  const install = async (id: string) => {
    const c = components.find((x) => x.id === id);
    if (!c) return;
    if (!confirm(tt('„{name}" wieder installieren? Das kann einige Minuten dauern.', { name: c.name }))) return;
    setBusyId(id);
    try {
      const r = await api.system.installComponent(id);
      await reloadComponents();
      alert(`„${c.name}":\n${r.steps.join('\n')}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : tt('Installation fehlgeschlagen'));
    } finally { setBusyId(null); }
  };

  const resetLayout = () => {
    if (!confirm(tt('Reihenfolge und Sichtbarkeit dieser Seite zurücksetzen?'))) return;
    setOrder([]);
    setHidden([]);
  };

  return (
    <div ref={wrapRef}>
      {/* Nur im Bearbeiten-Modus sichtbar – sonst steht hier nichts über den
          Panels. Umgeschaltet wird über den Bleistift in der Topbar. */}
      {editing && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>
            {tt('Am Griff ziehen zum Sortieren · Auge zum Ausblenden')}
          </span>
          <button className="btn btn--outline btn--sm" style={{ marginLeft: 'auto' }} onClick={resetLayout}>
            <RotateCcw size={13} /> {tt('Zurücksetzen')}
          </button>
        </div>
      )}

      {/* Entfernte Komponenten wieder installieren */}
      {editing && removedHere.length > 0 && (
        <div className="card" style={{ marginBottom: 12, borderColor: 'var(--color-warning)' }}>
          <div className="card-body" style={{ padding: '10px 12px' }}>
            <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 8 }}>
              {tt('Entfernte Komponenten – zum Wiederinstallieren anklicken:')}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {removedHere.map((c) => (
                <button
                  key={c.id}
                  className="btn btn--outline btn--sm"
                  disabled={busyId === c.id}
                  onClick={() => void install(c.id)}
                  title={c.description}
                >
                  {busyId === c.id
                    ? <span className="spinner" style={{ width: 12, height: 12 }} />
                    : <PackagePlus size={13} />}
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

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
          const comp = componentForPanel(`${storageKey}:${it.id}`);
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
              {/* Im Bearbeiten-Modus eine Werkzeugleiste ÜBER dem Panel:
                  Griff, Ausblenden und – falls das Panel zu einer optionalen
                  Komponente gehört – Deinstallieren, alle nebeneinander.
                  Einzeln am Rand positioniert überlappten sie den Panel-Inhalt. */}
              {editing ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
                  padding: '5px 8px', marginBottom: 4,
                  background: 'var(--color-surface-sunken)', borderRadius: 8,
                }}>
                  <span
                    title={tt('Zum Sortieren ziehen')}
                    style={{ cursor: 'grab', color: 'var(--color-muted)', display: 'flex' }}
                  >
                    <GripVertical size={15} />
                  </span>
                  <button
                    type="button"
                    className="btn btn--outline btn--sm"
                    title={tt('Nur ausblenden – die Komponente bleibt installiert')}
                    onClick={(e) => { e.stopPropagation(); hide(it); }}
                  >
                    <EyeOff size={13} /> {tt('Ausblenden')}
                  </button>
                  {comp && comp.packages.length > 0 && (
                    <button
                      type="button"
                      className="btn btn--outline btn--sm"
                      title={tt('Komponente vom System entfernen – blendet alle zugehörigen Bereiche aus')}
                      disabled={busyId === it.id}
                      onClick={(e) => { e.stopPropagation(); void uninstall(it.id); }}
                      style={{ color: 'var(--color-error)' }}
                    >
                      {busyId === it.id
                        ? <span className="spinner" style={{ width: 12, height: 12 }} />
                        : <Trash2 size={13} />}
                      {tt('Deinstallieren')}
                    </button>
                  )}
                  {comp && (
                    <span style={{ fontSize: 11.5, color: 'var(--color-faint)' }}>
                      {tt('gehört zu: {name}', { name: comp.name })}
                    </span>
                  )}
                </div>
              ) : (
                /* Außerhalb des Modus nur der dezente Griff am Rand. */
                <button
                  type="button"
                  title={tt('Zum Sortieren ziehen')}
                  onMouseDown={() => setArmed(it.id)}
                  onMouseUp={() => setArmed(null)}
                  onClick={(e) => e.preventDefault()}
                  style={{
                    position: 'absolute', left: -2, top: 12, zIndex: 2,
                    background: 'none', border: 'none', cursor: 'grab', padding: '4px 2px',
                    color: 'var(--color-faint)', display: 'flex', alignItems: 'center',
                  }}
                >
                  <GripVertical size={15} />
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
          <div className="empty-state__desc">{tt('Über den Bleistift oben rechts lassen sie sich wieder einblenden.')}</div>
        </div>
      )}
    </div>
  );
}
