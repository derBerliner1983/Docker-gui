import { useEffect, useRef, useState, useCallback } from 'react';
import { BrainCircuit, AlertTriangle, MemoryStick, Cpu } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { useT, tt } from '../lib/i18n';
import { api } from '../lib/api';
import type { OllamaStatus, OllamaPsModel } from '../lib/types';

// ── Hilfsfunktionen ────────────────────────────────────────────────────────────
function fmtBytes(b: number): string {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(0) + ' MB';
  return (b / 1e3).toFixed(0) + ' KB';
}
function shortName(name: string): string {
  return name.split('/').pop() || name;
}

// CSS-Farb-Token (#RRGGBB) in {r,g,b} umwandeln – für die Canvas-Kugel.
// Fällt auf Emerald zurück, falls die Variable (noch) nicht lesbar ist.
function readAccentRgb(): { r: number; g: number; b: number } {
  const fallback = { r: 16, g: 185, b: 129 }; // #10B981
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim();
    const hex = raw.replace('#', '');
    if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      };
    }
    const m = raw.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const [r, g, b] = m[1].split(',').map((s) => parseInt(s, 10));
      return { r, g, b };
    }
  } catch { /* */ }
  return fallback;
}

// ── Animierte Netz-Kugel (Plexus/Globe) im Farbkonzept ──────────────────────────
// Punkte auf einer Fibonacci-Kugel, rotierend, mit Verbindungslinien zwischen
// nahen Nachbarn und "Datenpulsen" entlang der Kanten. Farbe = --color-accent,
// passt sich also automatisch an Theme & Farbkonzept an.
function AiSphere({ active }: { active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const accent = useRef(readAccentRgb());

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Akzentfarbe bei Theme-Wechsel neu einlesen
    const mo = new MutationObserver(() => { accent.current = readAccentRgb(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    // ── Geometrie: Punkte auf der Einheitskugel (Fibonacci-Verteilung) ──
    const N = 150;
    const pts: { x: number; y: number; z: number }[] = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const theta = golden * i;
      pts.push({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r });
    }

    // ── Kanten: nahe Nachbarn verbinden ──
    const edges: [number, number][] = [];
    const MAXD = 0.46; // Abstand auf Einheitskugel
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y, dz = pts[i].z - pts[j].z;
        if (dx * dx + dy * dy + dz * dz < MAXD * MAXD) edges.push([i, j]);
      }
    }

    // ── Datenpulse entlang zufälliger Kanten ──
    const pulses = Array.from({ length: 16 }, () => ({
      e: (Math.random() * edges.length) | 0,
      t: Math.random(),
      speed: 0.004 + Math.random() * 0.008,
    }));

    let raf = 0;
    let dpr = 1;
    let size = 320;

    const resize = () => {
      const w = wrap.clientWidth || 320;
      size = Math.max(240, Math.min(460, w));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      canvas.style.width = size + 'px';
      canvas.style.height = size + 'px';
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    let angle = 0;
    let tilt = 0;

    const render = () => {
      const { r, g, b } = accent.current;
      const cx = size / 2, cy = size / 2;
      const R = size * 0.40;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);

      angle += 0.0035;
      tilt = Math.sin(angle * 0.6) * 0.35;

      const cosA = Math.cos(angle), sinA = Math.sin(angle);
      const cosT = Math.cos(tilt), sinT = Math.sin(tilt);

      // Rotierte + projizierte Punkte
      const proj = pts.map((p) => {
        // Rotation um Y
        let x = p.x * cosA + p.z * sinA;
        let z = -p.x * sinA + p.z * cosA;
        let y = p.y;
        // Kippen um X
        const y2 = y * cosT - z * sinT;
        const z2 = y * sinT + z * cosT;
        y = y2; z = z2;
        const persp = 1 / (1.9 - z * 0.9); // leichte Perspektive
        return {
          sx: cx + x * R * persp,
          sy: cy + y * R * persp,
          depth: (z + 1) / 2, // 0 = hinten, 1 = vorne
        };
      });

      // Hintergrund-Glühen
      const glow = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 1.5);
      glow.addColorStop(0, `rgba(${r},${g},${b},0.16)`);
      glow.addColorStop(0.6, `rgba(${r},${g},${b},0.05)`);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, size, size);

      // Kanten
      ctx.lineWidth = 1;
      for (const [i, j] of edges) {
        const a = proj[i], c = proj[j];
        const d = (a.depth + c.depth) / 2;
        const alpha = 0.05 + d * 0.28;
        ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(c.sx, c.sy);
        ctx.stroke();
      }

      // Knoten
      for (const p of proj) {
        const rad = 0.7 + p.depth * 1.9;
        const alpha = 0.25 + p.depth * 0.7;
        ctx.beginPath();
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.shadowBlur = 6 * p.depth;
        ctx.shadowColor = `rgba(${r},${g},${b},0.9)`;
        ctx.arc(p.sx, p.sy, rad, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      // Datenpulse
      for (const pu of pulses) {
        const edge = edges[pu.e];
        if (!edge) continue;
        const a = proj[edge[0]], c = proj[edge[1]];
        const px = a.sx + (c.sx - a.sx) * pu.t;
        const py = a.sy + (c.sy - a.sy) * pu.t;
        const d = a.depth + (c.depth - a.depth) * pu.t;
        ctx.beginPath();
        ctx.fillStyle = `rgba(255,255,255,${0.35 + d * 0.5})`;
        ctx.shadowBlur = 8;
        ctx.shadowColor = `rgba(${r},${g},${b},1)`;
        ctx.arc(px, py, 1.4 + d * 1.2, 0, Math.PI * 2);
        ctx.fill();
        pu.t += pu.speed;
        if (pu.t > 1) { pu.t = 0; pu.e = (Math.random() * edges.length) | 0; }
      }
      ctx.shadowBlur = 0;

      raf = requestAnimationFrame(render);
    };

    if (active) render();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
    };
  }, [active]);

  return (
    <div ref={wrapRef} style={{ width: '100%', maxWidth: 460, aspectRatio: '1 / 1', margin: '0 auto' }}>
      <canvas ref={canvasRef} style={{ display: 'block', margin: '0 auto' }} />
    </div>
  );
}

// ── Seite: KI-Zentrale ──────────────────────────────────────────────────────────
export function AiHub() {
  const t = useT();
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [running, setRunning] = useState<OllamaPsModel[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, ps] = await Promise.allSettled([api.ki.status(), api.ki.ps()]);
      if (s.status === 'fulfilled') setStatus(s.value);
      if (ps.status === 'fulfilled') setRunning(ps.value.models ?? []);
    } catch { /* */ }
  }, []);

  const refresh = async () => { setLoading(true); try { await load(); } finally { setLoading(false); } };

  useEffect(() => { void refresh(); }, []);

  // Laufende Modelle regelmäßig abfragen, damit die Kugel live erscheint/verschwindet
  useEffect(() => {
    const iv = setInterval(load, 6000);
    return () => clearInterval(iv);
  }, [load]);

  const active = running.length > 0;

  if (!status) {
    return (
      <>
        <Topbar title={t('nav.aihub')} />
        <main className="page"><div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><span className="spinner" style={{ width: 28, height: 28 }} /></div></main>
      </>
    );
  }

  return (
    <>
      <Topbar
        title={t('nav.aihub')}
        subtitle={active
          ? t('page.aihub.subtitle.active', { n: running.length })
          : tt('Keine KI aktiv')}
        onRefresh={refresh}
        refreshing={loading}
      />
      <main className="page">
        <div className="card">
          <div className="card-body" style={{ padding: '32px 24px' }}>
            {active ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
                <AiSphere active={active} />

                <div style={{ textAlign: 'center' }}>
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7, padding: '4px 12px',
                    background: 'var(--color-accent-soft)', border: '1px solid var(--color-accent)',
                    borderRadius: 999, fontSize: 12.5, fontWeight: 700, color: 'var(--color-accent)',
                  }}>
                    <BrainCircuit size={14} /> {tt('KI aktiv im Arbeitsspeicher')}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--color-muted)', marginTop: 10 }}>
                    {running.length === 1
                      ? tt('1 Sprachmodell ist geladen und einsatzbereit.')
                      : tt('{n} Sprachmodelle sind geladen und einsatzbereit.', { n: running.length })}
                  </div>
                </div>

                {/* Geladene Modelle */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', width: '100%' }}>
                  {running.map((r) => {
                    const onGpu = r.size_vram >= r.size && r.size_vram > 0;
                    return (
                      <div key={r.name} style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                        background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                        borderRadius: 10, minWidth: 200,
                      }}>
                        {onGpu ? <Cpu size={16} color="var(--color-success)" /> : <MemoryStick size={16} color="var(--color-accent)" />}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 700, fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>
                            {shortName(r.name)}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>
                            {fmtBytes(r.size)} · {onGpu ? tt('GPU (VRAM)') : tt('RAM (CPU)')}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              // ── Warnhinweis, wenn keine KI geladen ist ──
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '36px 20px', textAlign: 'center' }}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 76, height: 76, borderRadius: '50%',
                  background: 'rgba(217,119,6,0.10)', border: '1px solid var(--color-warning)',
                }}>
                  <AlertTriangle size={36} strokeWidth={1.5} color="var(--color-warning)" />
                </div>
                <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--color-warning)' }}>
                  {tt('Aktuell keine KI in den Arbeitsspeicher geladen')}
                </div>
                <div style={{ fontSize: 13.5, color: 'var(--color-muted)', maxWidth: 420, lineHeight: 1.6 }}>
                  {tt('Lade unter „KI-Modelle" ein Sprachmodell in den Arbeitsspeicher (RAM oder GPU), damit die KI-Visualisierung erscheint.')}
                </div>
                {status && !status.running && (
                  <div style={{ fontSize: 12, color: 'var(--color-faint)' }}>
                    {tt('Hinweis: Ollama ist derzeit gestoppt.')}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
