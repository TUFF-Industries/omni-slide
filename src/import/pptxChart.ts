// Minimal SVG rendering of the chart data pptxtojson extracts. PowerPoint stores charts as data, not
// pictures, so this redraws the common types (bar/column, line, area, pie, doughnut) in a plain
// style. Anything else gets a labelled placeholder rather than an empty gap.
import type { Chart, ChartItem } from 'pptxtojson';

const PALETTE = ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47'];
/** Height of the drawing in SVG units; the width follows the chart's aspect ratio. */
const UNIT_H = 300;

interface Frame {
  W: number;
  H: number;
}

type SeriesChart = Chart & { data: ChartItem[] };

function esc(s: string | number): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const r2 = (v: number) => +v.toFixed(2);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** A drawing sized to the chart box, so text and legends keep their proportions. */
function frameFor(chart: Chart): Frame {
  const aspect = chart.width > 0 && chart.height > 0 ? chart.width / chart.height : 4 / 3;
  return { W: Math.round(UNIT_H * Math.min(6, Math.max(1 / 6, aspect))), H: UNIT_H };
}

function svg(f: Frame, body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f.W} ${f.H}" ` +
    `style="width:100%;height:100%" font-family="Calibri,Carlito,Arial,sans-serif" font-size="11">${body}</svg>`
  );
}

function seriesColor(chart: Chart, i: number): string {
  return chart.colors?.[i] || PALETTE[i % PALETTE.length];
}

/** Nice upper bound for an axis: 1, 2, 2.5 or 5 times a power of ten. */
export function niceMax(v: number): number {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function categories(series: ChartItem[]): string[] {
  const first = series[0];
  if (!first) return [];
  return (first.values ?? []).map((v, i) => first.xlabels?.[String(i)] ?? String(v?.x ?? ''));
}

function placeholder(f: Frame, label: string): string {
  return svg(
    f,
    `<rect x="1" y="1" width="${f.W - 2}" height="${f.H - 2}" fill="#f4f4f4" stroke="#ccc"/>` +
      `<text x="${f.W / 2}" y="${f.H / 2}" text-anchor="middle" fill="#888" font-size="16">${esc(label)}</text>`,
  );
}

function legend(f: Frame, colors: string[], names: string[]): string {
  const step = f.W / Math.max(1, names.length);
  const y = f.H - 10;
  return names
    .map((name, i) => {
      const x = r2(step * i + step / 2 - 30);
      return (
        `<rect x="${x}" y="${y - 9}" width="10" height="10" fill="${esc(colors[i])}"/>` +
        `<text x="${x + 14}" y="${y}" fill="#333">${esc(name)}</text>`
      );
    })
    .join('');
}

function axesChart(f: Frame, chart: SeriesChart): string {
  const type = String(chart.chartType);
  const series = chart.data;
  const cats = categories(series);
  const isBar = type.startsWith('bar');
  const horizontal = isBar && 'barDir' in chart && chart.barDir === 'bar';
  const isArea = type.startsWith('area');
  const stacked =
    'grouping' in chart && (chart.grouping === 'stacked' || chart.grouping === 'percentStacked');
  const values = series.map((s) => (s.values ?? []).map((v) => num(v?.y)));

  // Value axis: [lo, hi] always includes 0. Stacks only grow upward, so they ignore negatives.
  const flat = values.flat();
  const totals = cats.map((_, ci) => values.reduce((sum, s) => sum + Math.max(0, s[ci] ?? 0), 0));
  const hi = niceMax(stacked ? Math.max(0, ...totals) : Math.max(0, ...flat));
  const minV = Math.min(0, ...flat);
  const lo = stacked || minV >= 0 ? 0 : -niceMax(-minV);
  const span = hi - lo;

  const legendH = series.length > 1 ? 22 : 0;
  const pad = { l: horizontal ? 80 : 40, r: 12, t: 12, b: 28 + legendH };
  const pw = f.W - pad.l - pad.r;
  const ph = f.H - pad.t - pad.b;
  /** Distance along the value axis from its start, for a value. */
  const at = (v: number) => ((v - lo) / span) * (horizontal ? pw : ph);
  const zero = at(0);
  const parts: string[] = [];

  for (let i = 0; i <= 4; i++) {
    const v = lo + (span * i) / 4;
    const label = esc(+v.toFixed(2));
    if (horizontal) {
      const x = r2(pad.l + at(v));
      parts.push(`<line x1="${x}" y1="${pad.t}" x2="${x}" y2="${pad.t + ph}" stroke="#ddd"/>`);
      parts.push(
        `<text x="${x}" y="${pad.t + ph + 14}" text-anchor="middle" fill="#555">${label}</text>`,
      );
    } else {
      const y = r2(pad.t + ph - at(v));
      parts.push(`<line x1="${pad.l}" y1="${y}" x2="${pad.l + pw}" y2="${y}" stroke="#ddd"/>`);
      parts.push(
        `<text x="${pad.l - 4}" y="${y + 4}" text-anchor="end" fill="#555">${label}</text>`,
      );
    }
  }

  const band = (horizontal ? ph : pw) / Math.max(1, cats.length);
  cats.forEach((c, ci) => {
    const mid = r2((horizontal ? pad.t : pad.l) + band * (ci + 0.5));
    parts.push(
      horizontal
        ? `<text x="${pad.l - 4}" y="${mid + 4}" text-anchor="end" fill="#555">${esc(c)}</text>`
        : `<text x="${mid}" y="${pad.t + ph + 14}" text-anchor="middle" fill="#555">${esc(c)}</text>`,
    );
  });

  if (isBar) {
    const inner = band * 0.7;
    const barW = stacked ? inner : inner / Math.max(1, series.length);
    const stackTop = cats.map(() => 0);
    values.forEach((vals, si) => {
      vals.forEach((v, ci) => {
        if (ci >= cats.length) return;
        let from: number;
        let to: number;
        if (stacked) {
          from = stackTop[ci];
          to = from + Math.max(0, v);
          stackTop[ci] = to;
        } else {
          from = Math.min(0, v);
          to = Math.max(0, v);
        }
        const a = at(from);
        const len = at(to) - a;
        const start =
          (horizontal ? pad.t : pad.l) + band * ci + (band - inner) / 2 + (stacked ? 0 : barW * si);
        const rect = horizontal
          ? `x="${r2(pad.l + a)}" y="${r2(start)}" width="${r2(len)}" height="${r2(barW)}"`
          : `x="${r2(start)}" y="${r2(pad.t + ph - a - len)}" width="${r2(barW)}" height="${r2(len)}"`;
        parts.push(`<rect ${rect} fill="${esc(seriesColor(chart, si))}"/>`);
      });
    });
  } else {
    values.forEach((vals, si) => {
      const pts = vals.map((v, ci) => [r2(pad.l + band * (ci + 0.5)), r2(pad.t + ph - at(v))]);
      if (pts.length === 0) return;
      const line = pts.map(([x, y]) => `${x},${y}`).join(' ');
      const col = esc(seriesColor(chart, si));
      if (isArea) {
        const base = r2(pad.t + ph - zero);
        parts.push(
          `<polygon points="${pts[0][0]},${base} ${line} ${pts[pts.length - 1][0]},${base}" fill="${col}" fill-opacity=".6"/>`,
        );
      }
      parts.push(`<polyline points="${line}" fill="none" stroke="${col}" stroke-width="2.5"/>`);
    });
  }

  const axis = horizontal
    ? `<line x1="${r2(pad.l + zero)}" y1="${pad.t}" x2="${r2(pad.l + zero)}" y2="${pad.t + ph}" stroke="#999"/>`
    : `<line x1="${pad.l}" y1="${r2(pad.t + ph - zero)}" x2="${pad.l + pw}" y2="${r2(pad.t + ph - zero)}" stroke="#999"/>`;
  parts.push(axis);
  if (series.length > 1) {
    parts.push(
      legend(
        f,
        series.map((_, i) => seriesColor(chart, i)),
        series.map((s) => String(s.key ?? '')),
      ),
    );
  }
  return svg(f, parts.join(''));
}

function pieChart(f: Frame, chart: SeriesChart, hole: number): string {
  const s = chart.data[0];
  const vals = (s?.values ?? []).map((v) => Math.max(0, num(v?.y)));
  const total = vals.reduce((a, b) => a + b, 0);
  if (total <= 0) return placeholder(f, 'Chart');
  const colors = vals.map((_, i) => seriesColor(chart, i));
  const cx = f.W / 2;
  const cy = (f.H - 28) / 2;
  const r = Math.max(1, Math.min(cx, cy) - 8);
  let a0 = -Math.PI / 2;
  const p = (a: number) => `${r2(cx + r * Math.cos(a))},${r2(cy + r * Math.sin(a))}`;
  const parts = vals.map((v, i) => {
    const col = esc(colors[i]);
    if (v === total) return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${col}"/>`;
    const a1 = a0 + (v / total) * Math.PI * 2;
    const d = `M${p(a0)}A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)}L${cx},${cy}Z`;
    a0 = a1;
    return `<path d="${d}" fill="${col}" stroke="#fff" stroke-width="1"/>`;
  });
  if (hole > 0) parts.push(`<circle cx="${cx}" cy="${cy}" r="${r2(r * hole)}" fill="#fff"/>`);
  parts.push(legend(f, colors, categories(chart.data)));
  return svg(f, parts.join(''));
}

/** SVG markup for a chart element, sized to fill its box. */
export function chartSvg(chart: Chart): string {
  const f = frameFor(chart);
  const type = String(chart.chartType ?? '');
  if (type === 'scatterChart' || type === 'bubbleChart' || !Array.isArray(chart.data)) {
    return placeholder(f, 'Chart');
  }
  const c = chart as SeriesChart;
  if (c.data.length === 0) return placeholder(f, 'Chart');
  if (/^(bar|line|area)(3D)?Chart$/.test(type)) return axesChart(f, c);
  if (/^pie(3D)?Chart$/.test(type)) return pieChart(f, c, 0);
  if (type === 'doughnutChart') return pieChart(f, c, 0.5);
  return placeholder(f, 'Chart');
}
