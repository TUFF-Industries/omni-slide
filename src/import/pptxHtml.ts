// Turns one slide parsed by pptxtojson into an HTML string laid out in points, so it can be
// rasterized like a PDF page. Pure string building, no DOM, so it can be unit-tested in Node.
// Positions and sizes from pptxtojson are in points (pt).
import type {
  Chart,
  Diagram,
  Element,
  Fill,
  GradientFill,
  Group,
  Image,
  LineEnd,
  Math as MathElement,
  Shadow,
  Shape,
  Slide,
  Table,
  Text,
  TextInset,
} from 'pptxtojson';
import { chartSvg } from './pptxChart';

export interface SlideSize {
  width: number;
  height: number;
}

/** Insets PowerPoint uses when a text box doesn't specify its own (0.1" / 0.05"). */
const DEFAULT_INSET: TextInset = { l: 7.2, t: 3.6, r: 7.2, b: 3.6 };

const BASE_CSS = [
  '.omni-s{position:relative;overflow:hidden;font-family:Calibri,Carlito,Arial,sans-serif;' +
    'color:#000;line-height:1.2;font-size:18pt}',
  '.omni-s *{box-sizing:border-box}',
  '.omni-s p{margin:0}',
  '.omni-s ul,.omni-s ol{margin:0;padding-left:1.4em}',
  '.omni-s table{border-collapse:collapse;table-layout:fixed}',
  '.omni-s td{padding:3.6pt 7.2pt;overflow:hidden}',
].join('');

/** Escape text for use inside a double-quoted attribute or as element text. */
export function esc(s: string | number): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const n = (v: number | undefined): number => (Number.isFinite(v) ? Number(v) : 0);
const pt = (v: number | undefined): string => `${+n(v).toFixed(3)}pt`;

/**
 * Colors from pptxtojson are CSS colors; empty means "none". Values come from the file, so anything
 * that isn't plainly a color (and could break out of a style attribute) is dropped.
 */
function color(c: string | undefined): string {
  const v = typeof c === 'string' ? c.trim() : '';
  return /^[#\w\s(),.%-]+$/.test(v) ? v : '';
}

function stopPos(pos: string | undefined): string {
  return pos && /^[\d.]+%$/.test(pos) ? pos : '0%';
}

/** Only inline images can render (see raster.ts); anything else is dropped. */
export function dataUrl(u: string | undefined): string {
  return typeof u === 'string' && /^data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]*$/.test(u) ? u : '';
}

function gradientStops(g: GradientFill['value']): string {
  return g.colors.map((c) => `${color(c.color) || 'transparent'} ${stopPos(c.pos)}`).join(',');
}

/** CSS `background` value for a fill, or '' for no fill. */
export function fillCss(fill: Fill | null | undefined): string {
  if (!fill) return '';
  switch (fill.type) {
    case 'color':
      return color(fill.value);
    case 'gradient': {
      const g = fill.value;
      if (!g.colors?.length) return '';
      // OOXML angle 0 runs left→right; CSS 0deg runs bottom→top.
      if (g.path === 'line') return `linear-gradient(${n(g.rot) + 90}deg,${gradientStops(g)})`;
      return `radial-gradient(${g.path === 'circle' ? 'circle' : 'ellipse'} at center,${gradientStops(g)})`;
    }
    case 'image':
      return dataUrl(fill.value.base64)
        ? `url('${dataUrl(fill.value.base64)}') center/100% 100% no-repeat`
        : '';
    case 'pattern':
      return color(fill.value.foregroundColor) || color(fill.value.backgroundColor);
    default:
      return '';
  }
}

const SERIF =
  /times|georgia|cambria|garamond|palatino|antiqua|baskerville|bodoni|didot|minion|constantia|bookman|century school|rockwell|serif|mincho|song|ming/i;
const MONO = /courier|consolas|mono|menlo|monaco/i;
/** Free metric-compatible stand-ins, used when the Microsoft font isn't installed. */
const SUBSTITUTES: Record<string, string> = {
  calibri: 'Carlito',
  cambria: 'Caladea',
  arial: 'Liberation Sans',
  'times new roman': 'Liberation Serif',
  'courier new': 'Liberation Mono',
};

/** Font stack for a font named in the file, with a substitute and a generic family to fall back on. */
export function fontStack(family: string): string {
  const names = family
    .split(',')
    .map((f) => f.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  if (names.length === 0) return 'sans-serif';
  const first = names[0];
  const generic = SERIF.test(first)
    ? /sans/i.test(first)
      ? 'sans-serif'
      : 'serif'
    : MONO.test(first)
      ? 'monospace'
      : 'sans-serif';
  const sub = SUBSTITUTES[first.toLowerCase()];
  const all = [...names.map((f) => `'${f.replace(/'/g, '')}'`), ...(sub ? [sub] : []), generic];
  return all.join(',');
}

/**
 * Fix up a text body from pptxtojson: give every font a fallback (otherwise a missing font falls
 * back to the browser default, usually Times) and apply PowerPoint's shrink-on-overflow scale.
 */
export function prepareTextHtml(html: string, fontScalePercent?: number): string {
  let out = html.replace(/font-family:\s*([^;"]+)/g, (_, fam: string) => {
    return `font-family:${fontStack(fam.replace(/&quot;/g, ''))}`;
  });
  const scale = fontScalePercent && fontScalePercent > 0 ? fontScalePercent / 100 : 1;
  if (scale !== 1) {
    out = out.replace(
      /font-size:\s*([\d.]+)pt/g,
      (_, size: string) => `font-size:${+(parseFloat(size) * scale).toFixed(2)}pt`,
    );
  }
  return out;
}

interface Ctx {
  nextId: number;
}

type Box = { left: number; top: number; width: number; height: number };

function boxStyle(e: Box, extra = ''): string {
  return `position:absolute;left:${pt(e.left)};top:${pt(e.top)};width:${pt(e.width)};height:${pt(e.height)};${extra}`;
}

function rotateCss(rotate: number | undefined): string {
  return n(rotate) ? `transform:rotate(${n(rotate)}deg);` : '';
}

function transformCss(rotate: number | undefined, h?: boolean, v?: boolean): string {
  const parts = [
    n(rotate) ? `rotate(${n(rotate)}deg)` : '',
    h || v ? `scale(${h ? -1 : 1},${v ? -1 : 1})` : '',
  ];
  const t = parts.filter(Boolean).join(' ');
  return t ? `transform:${t};` : '';
}

function flipCss(h?: boolean, v?: boolean): string {
  return h || v ? `transform:scale(${h ? -1 : 1},${v ? -1 : 1});` : '';
}

function shadowCss(s: Shadow | undefined): string {
  if (!s) return '';
  return `filter:drop-shadow(${pt(s.h)} ${pt(s.v)} ${pt(s.blur)} ${color(s.color) || 'rgba(0,0,0,.4)'});`;
}

function borderType(t: string | undefined): string {
  return t === 'dashed' || t === 'dotted' ? t : 'solid';
}

function borderCss(e: { borderWidth: number; borderType: string; borderColor: string }): string {
  if (!(n(e.borderWidth) > 0) || !color(e.borderColor)) return '';
  const type = borderType(e.borderType);
  return `border:${pt(e.borderWidth)} ${type} ${color(e.borderColor)};`;
}

const V_ALIGN: Record<string, string> = { up: 'flex-start', mid: 'center', down: 'flex-end' };

function textBody(e: Shape | Text): string {
  if (!e.content || !e.content.replace(/<[^>]*>/g, '').trim()) return '';
  const inset = e.textInset ?? DEFAULT_INSET;
  const vertical = e.type === 'text' && e.isVertical ? 'writing-mode:vertical-rl;' : '';
  const style =
    'position:absolute;inset:0;display:flex;flex-direction:column;' +
    `justify-content:${V_ALIGN[e.vAlign] ?? 'flex-start'};` +
    `padding:${pt(inset.t)} ${pt(inset.r)} ${pt(inset.b)} ${pt(inset.l)};` +
    `white-space:${e.wrap === false ? 'nowrap' : 'normal'};overflow-wrap:break-word;${vertical}`;
  const fontScale = e.autoFit?.type === 'text' ? e.autoFit.fontScale : undefined;
  return `<div style="${style}"><div>${prepareTextHtml(e.content, fontScale)}</div></div>`;
}

function svgPaint(fill: Fill | null | undefined, ctx: Ctx, defs: string[]): string {
  if (!fill) return 'none';
  if (fill.type === 'color') return color(fill.value) || 'none';
  if (fill.type === 'pattern') {
    return color(fill.value.foregroundColor) || color(fill.value.backgroundColor) || 'none';
  }
  const id = `g${ctx.nextId++}`;
  if (fill.type === 'gradient') {
    const g = fill.value;
    if (!g.colors?.length) return 'none';
    const stops = g.colors
      .map(
        (c) =>
          `<stop offset="${stopPos(c.pos)}" stop-color="${esc(color(c.color) || 'transparent')}"/>`,
      )
      .join('');
    if (g.path === 'line') {
      defs.push(
        `<linearGradient id="${id}" gradientTransform="rotate(${n(g.rot)} .5 .5)">${stops}</linearGradient>`,
      );
    } else {
      defs.push(`<radialGradient id="${id}">${stops}</radialGradient>`);
    }
    return `url(#${id})`;
  }
  if (fill.type === 'image' && dataUrl(fill.value.base64)) {
    defs.push(
      `<pattern id="${id}" patternContentUnits="objectBoundingBox" width="1" height="1">` +
        `<image href="${esc(dataUrl(fill.value.base64))}" width="1" height="1" preserveAspectRatio="none"/></pattern>`,
    );
    return `url(#${id})`;
  }
  return 'none';
}

function marker(
  end: LineEnd | undefined,
  which: 'start' | 'end',
  stroke: string,
  ctx: Ctx,
  defs: string[],
): string {
  if (!end || end.type === 'none') return '';
  const id = `m${ctx.nextId++}`;
  const size = { sm: 2, med: 3, lg: 5 };
  const w = size[end.width ?? 'med'];
  const l = size[end.length ?? 'med'];
  // Drawn pointing right (+x) with its tip at x=l; orient="auto-start-reverse" flips the start one.
  const shape =
    end.type === 'oval'
      ? `<ellipse cx="${l / 2}" cy="${w / 2}" rx="${l / 2}" ry="${w / 2}"/>`
      : end.type === 'diamond'
        ? `<path d="M0 ${w / 2}L${l / 2} 0L${l} ${w / 2}L${l / 2} ${w}Z"/>`
        : end.type === 'arrow'
          ? `<path d="M0 0L${l} ${w / 2}L0 ${w}" fill="none" stroke="${esc(stroke)}" stroke-width="0.6"/>`
          : `<path d="M0 0L${l} ${w / 2}L0 ${w}Z"/>`;
  const refX = end.type === 'oval' || end.type === 'diamond' ? l / 2 : l;
  defs.push(
    `<marker id="${id}" viewBox="0 0 ${l} ${w}" markerWidth="${l}" markerHeight="${w}" refX="${refX}" ` +
      `refY="${w / 2}" orient="auto-start-reverse" markerUnits="strokeWidth" fill="${esc(stroke)}">${shape}</marker>`,
  );
  return ` marker-${which}="url(#${id})"`;
}

function shapeHtml(e: Shape, ctx: Ctx): string {
  const defs: string[] = [];
  let svg = '';
  if (e.path) {
    const vb = e.pathViewBox ?? { x: 0, y: 0, width: e.width, height: e.height };
    const stroke = n(e.borderWidth) > 0 ? color(e.borderColor) || 'none' : 'none';
    const fill = e.strokeOnly ? 'none' : svgPaint(e.fill, ctx, defs);
    const dash =
      e.borderStrokeDasharray && e.borderStrokeDasharray !== '0'
        ? ` stroke-dasharray="${esc(e.borderStrokeDasharray)}"`
        : '';
    const markers =
      stroke !== 'none'
        ? marker(e.headEnd, 'start', stroke, ctx, defs) +
          marker(e.tailEnd, 'end', stroke, ctx, defs)
        : '';
    // Straight lines have a zero-width or zero-height box, and a zero-sized SVG draws nothing, so
    // give both the box and the viewBox at least 1pt (keeping their 1:1 scale).
    const vbW = Math.max(n(vb.width), 1);
    const vbH = Math.max(n(vb.height), 1);
    svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(vb.x)} ${n(vb.y)} ${vbW} ${vbH}" ` +
      `preserveAspectRatio="none" overflow="visible" style="position:absolute;left:0;top:0;` +
      `width:${pt(Math.max(n(e.width), 1))};height:${pt(Math.max(n(e.height), 1))};overflow:visible;` +
      `${flipCss(e.isFlipH, e.isFlipV)}${shadowCss(e.shadow)}">` +
      (defs.length ? `<defs>${defs.join('')}</defs>` : '') +
      `<path d="${esc(e.path)}" fill="${esc(fill)}" stroke="${esc(stroke)}" stroke-width="${n(e.borderWidth)}"${dash}${markers} ` +
      `stroke-linejoin="round"/></svg>`;
  }
  return `<div style="${boxStyle(e, rotateCss(e.rotate))}">${svg}${textBody(e)}</div>`;
}

function textHtml(e: Text): string {
  const bg = fillCss(e.fill);
  const extra = `${rotateCss(e.rotate)}${bg ? `background:${bg};` : ''}${borderCss(e)}${shadowCss(e.shadow)}`;
  return `<div style="${boxStyle(e, extra)}">${textBody(e)}</div>`;
}

function imageHtml(e: Image): string {
  const src = dataUrl(e.base64);
  if (!src) return '';
  const rect = e.rect ?? {};
  const l = n(rect.l),
    r = n(rect.r),
    t = n(rect.t),
    b = n(rect.b);
  const w = Math.max(1, 100 - l - r);
  const h = Math.max(1, 100 - t - b);
  const imgStyle =
    `position:absolute;left:${(-l / w) * 100}%;top:${(-t / h) * 100}%;` +
    `width:${(100 / w) * 100}%;height:${(100 / h) * 100}%;max-width:none;${flipCss(e.isFlipH, e.isFlipV)}`;
  const radius =
    e.geom === 'ellipse' ? 'border-radius:50%;' : e.geom === 'roundRect' ? 'border-radius:8%;' : '';
  const extra = `overflow:hidden;${radius}${rotateCss(e.rotate)}${borderCss(e)}`;
  return `<div style="${boxStyle(e, extra)}"><img src="${esc(src)}" alt="" style="${imgStyle}"/></div>`;
}

function tableHtml(e: Table): string {
  const cols = (e.colWidths ?? []).map((w) => `<col style="width:${pt(w)}"/>`).join('');
  const rows = (Array.isArray(e.data) ? e.data : [])
    .map((row, ri) => {
      const cells = (Array.isArray(row) ? row : [])
        .map((c) => {
          if (c.hMerge || c.vMerge) return '';
          const span =
            (c.rowSpan && c.rowSpan > 1 ? ` rowspan="${c.rowSpan}"` : '') +
            (c.colSpan && c.colSpan > 1 ? ` colspan="${c.colSpan}"` : '');
          const sides = (['top', 'right', 'bottom', 'left'] as const)
            .map((side) => {
              const bd = c.borders?.[side];
              return bd && n(bd.borderWidth) > 0 && color(bd.borderColor)
                ? `border-${side}:${pt(bd.borderWidth)} ${borderType(bd.borderType)} ${color(bd.borderColor)};`
                : '';
            })
            .join('');
          const style =
            (color(c.fillColor) ? `background:${color(c.fillColor)};` : '') +
            (color(c.fontColor) ? `color:${color(c.fontColor)};` : '') +
            (c.fontBold ? 'font-weight:bold;' : '') +
            `vertical-align:${c.vAlign === 'mid' ? 'middle' : c.vAlign === 'down' ? 'bottom' : 'top'};${sides}`;
          return `<td${span} style="${style}">${prepareTextHtml(c.text ?? '')}</td>`;
        })
        .join('');
      const h = e.rowHeights?.[ri];
      return `<tr${h ? ` style="height:${pt(h)}"` : ''}>${cells}</tr>`;
    })
    .join('');
  const style = `position:absolute;left:${pt(e.left)};top:${pt(e.top)};width:${pt(e.width)};`;
  return `<table style="${style}"><colgroup>${cols}</colgroup><tbody>${rows}</tbody></table>`;
}

function mediaHtml(e: Box): string {
  // No poster frame is available; show where the media sits.
  const s = Math.min(e.width, e.height) * 0.3;
  return (
    `<div style="${boxStyle(e, 'background:#111;display:flex;align-items:center;justify-content:center;')}">` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" style="width:${pt(s)};height:${pt(s)}">` +
    `<path d="M2 1L9 5L2 9Z" fill="#fff" fill-opacity=".85"/></svg></div>`
  );
}

function mathHtml(e: MathElement): string {
  if (dataUrl(e.picBase64)) {
    return `<div style="${boxStyle(e)}"><img src="${esc(dataUrl(e.picBase64))}" alt="" style="width:100%;height:100%"/></div>`;
  }
  return `<div style="${boxStyle(e, 'font-style:italic;font-family:serif')}">${esc(e.text ?? e.latex ?? '')}</div>`;
}

function containerHtml(e: Group | Diagram, ctx: Ctx): string {
  // One transform property, or the flip would replace the rotation. (A flipped group also mirrors
  // its text, which PowerPoint doesn't; rare enough to accept.)
  const extra = e.type === 'group' ? transformCss(e.rotate, e.isFlipH, e.isFlipV) : '';
  return `<div style="${boxStyle(e, extra)}">${elementsHtml(e.elements, ctx)}</div>`;
}

function chartHtml(e: Chart): string {
  return `<div style="${boxStyle(e)}">${chartSvg(e)}</div>`;
}

function elementHtml(e: Element, ctx: Ctx): string {
  switch (e.type) {
    case 'shape':
      return shapeHtml(e, ctx);
    case 'text':
      return textHtml(e);
    case 'image':
      return imageHtml(e);
    case 'table':
      return tableHtml(e);
    case 'chart':
      return chartHtml(e);
    case 'video':
    case 'audio':
      return mediaHtml(e);
    case 'math':
      return mathHtml(e);
    case 'group':
    case 'diagram':
      return containerHtml(e, ctx);
    default:
      return '';
  }
}

function elementsHtml(elements: Element[] | undefined, ctx: Ctx): string {
  if (!Array.isArray(elements)) return '';
  return elements
    .filter((e) => e && typeof e === 'object')
    .sort((a, b) => n(a.order) - n(b.order))
    .map((e) => {
      // Best effort: an element pptxtojson parsed into an unexpected shape is left out rather than
      // losing the whole slide.
      try {
        return elementHtml(e, ctx);
      } catch {
        return '';
      }
    })
    .join('');
}

/** HTML for a whole slide: a `size.width`×`size.height` pt box with the master/layout art under the slide's own. */
export function slideToHtml(slide: Slide, size: SlideSize): string {
  const ctx: Ctx = { nextId: 0 };
  const bg = fillCss(slide.fill) || '#fff';
  const style = `width:${pt(size.width)};height:${pt(size.height)};background:${bg};`;
  return (
    `<div class="omni-s" style="${style}"><style>${BASE_CSS}</style>` +
    elementsHtml(slide.layoutElements, ctx) +
    elementsHtml(slide.elements, ctx) +
    '</div>'
  );
}
