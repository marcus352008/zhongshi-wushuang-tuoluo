import type { FusedStats } from '../rules/fuse';

export const RADAR_MIN = 0.5;
export const RADAR_MAX = 1.6;

const AXES: { key: keyof FusedStats; label: string }[] = [
  { key: 'ATK', label: '攻擊' },
  { key: 'DEF', label: '防禦' },
  { key: 'STA_DECAY', label: '耗轉↑差' },
  { key: 'SPD', label: '速度' },
  { key: 'MAS', label: '重量' },
  { key: 'BR', label: '抗爆' },
];

const NS = 'http://www.w3.org/2000/svg';

function el(tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** Hexagon radar of the 6 fused multipliers. Axis 0.5 → 1.6, dashed ring at 1.0. */
export function radarSvg(stats: FusedStats | null, size = 260): SVGSVGElement {
  const svg = el('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: 'img' }) as SVGSVGElement;
  svg.setAttribute('aria-label', '六項合成數值雷達圖');
  const c = size / 2;
  const R = size * 0.34;
  const angle = (i: number) => -Math.PI / 2 + (i * Math.PI * 2) / AXES.length;
  const radiusOf = (v: number) => {
    const t = (Math.min(RADAR_MAX, Math.max(RADAR_MIN, v)) - RADAR_MIN) / (RADAR_MAX - RADAR_MIN);
    return t * R;
  };
  const poly = (rFor: (i: number) => number) =>
    AXES.map((_, i) => `${c + Math.cos(angle(i)) * rFor(i)},${c + Math.sin(angle(i)) * rFor(i)}`).join(' ');

  svg.append(el('polygon', { points: poly(() => R), fill: 'rgba(255,255,255,0.03)', stroke: 'rgba(150,175,255,0.35)' }));
  svg.append(
    el('polygon', {
      points: poly(() => radiusOf(1.0)),
      fill: 'none',
      stroke: 'rgba(255,255,255,0.75)',
      'stroke-dasharray': '5 4',
    }),
  );
  AXES.forEach((a, i) => {
    svg.append(
      el('line', {
        x1: c,
        y1: c,
        x2: c + Math.cos(angle(i)) * R,
        y2: c + Math.sin(angle(i)) * R,
        stroke: 'rgba(150,175,255,0.25)',
      }),
    );
    const lx = c + Math.cos(angle(i)) * (R + 26);
    const ly = c + Math.sin(angle(i)) * (R + 18);
    const t = el('text', { x: lx, y: ly, fill: '#c8d2f0', 'font-size': 13, 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
    t.textContent = stats ? `${a.label} ${stats[a.key].toFixed(2)}` : a.label;
    svg.append(t);
  });
  if (stats) {
    svg.append(
      el('polygon', {
        points: poly((i) => radiusOf(stats[AXES[i].key])),
        fill: 'rgba(255,210,63,0.28)',
        stroke: '#ffd23f',
        'stroke-width': 2,
      }),
    );
  }
  const note = el('text', { x: c, y: size - 6, fill: '#9aa6cc', 'font-size': 11, 'text-anchor': 'middle' });
  note.textContent = `範圍 ${RADAR_MIN}–${RADAR_MAX}，虛線 = 1.0 基準`;
  svg.append(note);
  return svg;
}
