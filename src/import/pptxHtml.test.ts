import type { ChartItem, Element, Group, Shape, Slide, Table, Text } from 'pptxtojson';
import { describe, expect, test } from 'vitest';
import { chartSvg, niceMax } from './pptxChart';
import { dataUrl, esc, fillCss, fontStack, prepareTextHtml, slideToHtml } from './pptxHtml';

const SIZE = { width: 720, height: 405 };

function slide(elements: Element[], extra: Partial<Slide> = {}): Slide {
  return {
    fill: { type: 'color', value: '#112233' },
    elements,
    layoutElements: [],
    note: '',
    ...extra,
  };
}

const base = {
  id: '1',
  borderColor: '#000000',
  borderWidth: 0,
  borderType: 'solid' as const,
  borderStrokeDasharray: '0',
  isFlipV: false,
  isFlipH: false,
  rotate: 0,
  vAlign: 'up',
  wrap: true,
  name: 'x',
};

function shape(over: Partial<Shape> = {}): Shape {
  return {
    ...base,
    type: 'shape',
    left: 10,
    top: 20,
    width: 100,
    height: 50,
    fill: { type: 'color', value: '#FF0000' },
    content: '',
    shapType: 'rect',
    path: 'M 0 0 L 100 0 L 100 50 L 0 50 Z',
    pathViewBox: { x: 0, y: 0, width: 100, height: 50 },
    order: 1,
    ...over,
  };
}

describe('fillCss', () => {
  test('solid colors pass through, empty means no fill', () => {
    expect(fillCss({ type: 'color', value: '#ABCDEF' })).toBe('#ABCDEF');
    expect(fillCss({ type: 'color', value: '' })).toBe('');
    expect(fillCss(null)).toBe('');
  });

  test('linear gradients turn the OOXML angle into a CSS one and default missing stops to 0%', () => {
    const css = fillCss({
      type: 'gradient',
      value: {
        path: 'line',
        rot: 0,
        colors: [
          { pos: '', color: '#000' },
          { pos: '100%', color: '#fff' },
        ],
      },
    });
    expect(css).toBe('linear-gradient(90deg,#000 0%,#fff 100%)');
  });

  test('image fills stretch to the box', () => {
    const css = fillCss({
      type: 'image',
      value: { ref: '', base64: 'data:image/png;base64,AA', blob: '', opacity: 1 },
    });
    expect(css).toContain("url('data:image/png;base64,AA')");
    expect(css).toContain('100% 100%');
  });
});

describe('fonts', () => {
  test('adds a substitute and a matching generic family', () => {
    expect(fontStack('Calibri')).toBe("'Calibri',Carlito,sans-serif");
    expect(fontStack('Times New Roman')).toBe("'Times New Roman',Liberation Serif,serif");
    expect(fontStack('Consolas')).toBe("'Consolas',monospace");
    expect(fontStack('Microsoft Sans Serif')).toBe("'Microsoft Sans Serif',sans-serif");
  });

  test('prepareTextHtml rewrites font stacks and applies shrink-to-fit', () => {
    const html = '<span style="font-size: 40pt;font-family: Georgia;">Hi</span>';
    const out = prepareTextHtml(html, 50);
    expect(out).toContain("font-family:'Georgia',serif");
    expect(out).toContain('font-size:20pt');
    expect(prepareTextHtml(html)).toContain('font-size: 40pt');
  });
});

describe('slideToHtml', () => {
  test('lays the slide out in points with its background', () => {
    const html = slideToHtml(slide([]), SIZE);
    expect(html).toMatch(
      /^<div class="omni-s" style="width:720pt;height:405pt;background:#112233;">/,
    );
  });

  test('defaults to a white background', () => {
    expect(slideToHtml(slide([], { fill: { type: 'color', value: '' } }), SIZE)).toContain(
      'background:#fff;',
    );
  });

  test('draws shapes as SVG paths at their position, with their text on top', () => {
    const html = slideToHtml(
      slide([shape({ content: '<p>Label</p>', vAlign: 'mid', rotate: 30 })]),
      SIZE,
    );
    expect(html).toContain('left:10pt;top:20pt;width:100pt;height:50pt;transform:rotate(30deg);');
    expect(html).toContain('<path d="M 0 0 L 100 0 L 100 50 L 0 50 Z" fill="#FF0000"');
    expect(html).toContain('justify-content:center');
    expect(html).toContain('<p>Label</p>');
  });

  test('puts layout/master elements under slide elements, each in z-order', () => {
    const html = slideToHtml(
      slide([shape({ order: 9, content: '<p>B</p>' }), shape({ order: 2, content: '<p>A</p>' })], {
        layoutElements: [shape({ order: 1, content: '<p>Layout</p>' })],
      }),
      SIZE,
    );
    const at = (s: string) => html.indexOf(s);
    expect(at('Layout')).toBeLessThan(at('<p>A</p>'));
    expect(at('<p>A</p>')).toBeLessThan(at('<p>B</p>'));
  });

  test('escapes attribute values taken from the file', () => {
    const html = slideToHtml(slide([shape({ path: 'M0 0"/><script>x</script>' })]), SIZE);
    expect(html).not.toContain('<script>');
    expect(esc('"<&>')).toBe('&quot;&lt;&amp;&gt;');
  });

  test('gives arrowheads to lines that have them', () => {
    const html = slideToHtml(
      slide([
        shape({
          strokeOnly: true,
          borderWidth: 2,
          borderColor: '#333333',
          path: 'M 0 0 L 100 0',
          height: 0,
          pathViewBox: { x: 0, y: 0, width: 100, height: 0 },
          tailEnd: { type: 'triangle' },
        }),
      ]),
      SIZE,
    );
    expect(html).toContain('fill="none" stroke="#333333"');
    expect(html).toMatch(/marker-end="url\(#m\d+\)"/);
    expect(html).toContain('viewBox="0 0 100 1"'); // zero-height line still draws
  });

  test('renders text boxes with fill, border and vertical writing', () => {
    const text: Text = {
      ...base,
      type: 'text',
      left: 0,
      top: 0,
      width: 50,
      height: 50,
      fill: { type: 'color', value: '#EEEEEE' },
      borderWidth: 1,
      borderColor: '#FF00FF',
      isVertical: true,
      content: '<p>V</p>',
      order: 1,
    };
    const html = slideToHtml(slide([text]), SIZE);
    expect(html).toContain('background:#EEEEEE;border:1pt solid #FF00FF;');
    expect(html).toContain('writing-mode:vertical-rl');
  });

  test('crops images to their source rectangle', () => {
    const html = slideToHtml(
      slide([
        {
          ...base,
          type: 'image',
          left: 0,
          top: 0,
          width: 100,
          height: 100,
          ref: '',
          blob: '',
          base64: 'data:image/png;base64,AA',
          geom: 'ellipse',
          rect: { l: 25, r: 25 },
          order: 1,
        },
      ]),
      SIZE,
    );
    expect(html).toContain('border-radius:50%');
    expect(html).toContain('left:-50%;top:0%;width:200%;height:100%');
  });

  test('skips merged-away table cells and applies spans', () => {
    const cell = { text: '<p>x</p>', vAlign: 'up', borders: {} };
    const table: Table = {
      type: 'table',
      id: 't',
      left: 0,
      top: 0,
      width: 200,
      height: 40,
      borders: {},
      order: 1,
      colWidths: [100, 100],
      rowHeights: [20, 20],
      data: [
        [
          { ...cell, colSpan: 2, fillColor: '#00FF00' },
          { ...cell, hMerge: 1 },
        ],
        [cell, cell],
      ],
    };
    const html = slideToHtml(slide([table]), SIZE);
    expect(html.match(/<td/g)).toHaveLength(3);
    expect(html).toContain('<td colspan="2" style="background:#00FF00;');
  });

  test('ignores element types it does not know', () => {
    const odd = { type: 'hologram', order: 1 } as unknown as Element;
    expect(() => slideToHtml(slide([odd]), SIZE)).not.toThrow();
  });
});

describe('charts', () => {
  test('niceMax rounds up to a readable axis maximum', () => {
    expect(niceMax(7)).toBe(10);
    expect(niceMax(42)).toBe(50);
    expect(niceMax(0)).toBe(1);
  });

  test('draws one bar per value and a pie slice per point', () => {
    const data = [
      {
        key: 'S1',
        values: [
          { x: 'a', y: 1 },
          { x: 'b', y: 3 },
        ],
        xlabels: { '0': 'a', '1': 'b' },
      },
    ];
    const common = {
      type: 'chart' as const,
      id: 'c',
      left: 0,
      top: 0,
      width: 1,
      height: 1,
      order: 1,
      colors: [],
    };
    const bars = chartSvg({ ...common, chartType: 'barChart', barDir: 'col', data });
    expect(bars.match(/<rect /g)).toHaveLength(2);
    const pie = chartSvg({ ...common, chartType: 'pieChart', data });
    expect(pie.match(/<path /g)).toHaveLength(2);
  });

  test('falls back to a placeholder for unsupported chart types', () => {
    const svg = chartSvg({
      type: 'chart',
      id: 'c',
      left: 0,
      top: 0,
      width: 1,
      height: 1,
      order: 1,
      colors: [],
      chartType: 'scatterChart',
      data: [[1, 2]],
    });
    expect(svg).toContain('>Chart</text>');
  });
});

describe('robustness against odd file content', () => {
  test('drops color values that could break out of a style attribute', () => {
    expect(fillCss({ type: 'color', value: 'red" onload="x' })).toBe('');
    expect(fillCss({ type: 'color', value: 'rgba(0, 0, 0, .5)' })).toBe('rgba(0, 0, 0, .5)');
  });

  test('only inline images are used', () => {
    expect(dataUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(dataUrl('https://example.com/x.png')).toBe('');
    expect(dataUrl("data:image/png;base64,AA')")).toBe('');
  });

  test('a rotated, flipped group keeps both transforms', () => {
    const group: Group = {
      type: 'group',
      id: 'g',
      left: 0,
      top: 0,
      width: 10,
      height: 10,
      rotate: 30,
      isFlipH: true,
      isFlipV: false,
      order: 1,
      elements: [shape()],
    };
    expect(slideToHtml(slide([group]), SIZE)).toContain('transform:rotate(30deg) scale(-1,1);');
  });

  test('malformed tables and elements are skipped, not fatal', () => {
    const table = { type: 'table', order: 1, left: 0, top: 0, width: 1, height: 1 } as Table;
    const broken = { ...shape(), pathViewBox: null } as unknown as Shape;
    expect(() =>
      slideToHtml(slide([table, broken, null as unknown as Element]), SIZE),
    ).not.toThrow();
  });
});

describe('chart layout', () => {
  const common = { type: 'chart' as const, id: 'c', left: 0, top: 0, order: 1, colors: [] };
  const data = (ys: number[]) => [
    { key: 'S', values: ys.map((y, i) => ({ x: String(i), y })), xlabels: {} },
  ];

  test('the drawing follows the chart box aspect ratio', () => {
    const svg = chartSvg({
      ...common,
      width: 600,
      height: 200,
      chartType: 'lineChart',
      data: data([1, 2]),
    });
    expect(svg).toContain('viewBox="0 0 900 300"');
  });

  test('negative values get bars below the zero line', () => {
    const svg = chartSvg({
      ...common,
      width: 400,
      height: 300,
      chartType: 'barChart',
      barDir: 'col',
      data: data([5, -5]),
    });
    const heights = [
      ...svg.matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"/g),
    ];
    expect(heights).toHaveLength(2);
    const [pos, neg] = heights.map((m) => ({ y: +m[1], h: +m[2] }));
    expect(pos.h).toBeGreaterThan(0);
    expect(neg.h).toBeCloseTo(pos.h);
    expect(neg.y).toBeCloseTo(pos.y + pos.h); // starts where the positive bar ends: the zero line
  });

  test('series without values do not throw', () => {
    const bad = [{ key: 'S', xlabels: {} }] as unknown as ChartItem[];
    expect(() =>
      chartSvg({ ...common, width: 1, height: 1, chartType: 'barChart', data: bad }),
    ).not.toThrow();
  });
});
