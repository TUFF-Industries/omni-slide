import type { CellKey, Deck, Dir, Pos, Slide, SlideId } from './types';

export const DELTA: Record<Dir, Pos> = {
  up: { x: 0, y: -1, z: 0 },
  down: { x: 0, y: 1, z: 0 },
  left: { x: -1, y: 0, z: 0 },
  right: { x: 1, y: 0, z: 0 },
  in: { x: 0, y: 0, z: 1 },
  out: { x: 0, y: 0, z: -1 },
};

/** Directions within a layer. */
export const DIRS: Dir[] = ['up', 'down', 'left', 'right'];
/** Directions between layers. */
export const DEPTH_DIRS: Dir[] = ['in', 'out'];
export const ALL_DIRS: Dir[] = [...DIRS, ...DEPTH_DIRS];

export function pos(x: number, y: number, z = 0): Pos {
  return { x, y, z };
}

export function key(p: Pos): CellKey {
  return `${p.x},${p.y},${p.z}`;
}

/** Parses "x,y,z". Two-part "x,y" keys (decks from before layers) are layer 0. */
export function parseKey(k: string): Pos {
  const [x, y, z = 0] = k.split(',').map(Number);
  return { x, y, z };
}

export function samePos(a: Pos, b: Pos): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

export function slideAt(deck: Deck, p: Pos): Slide | undefined {
  const id = deck.cells[key(p)];
  return id ? deck.slides[id] : undefined;
}

export function step(p: Pos, dir: Dir): Pos {
  const d = DELTA[dir];
  return { x: p.x + d.x, y: p.y + d.y, z: p.z + d.z };
}

/** The cell reached by pressing `dir` from `p`, or null if there is no slide there. */
export function neighbor(deck: Deck, p: Pos, dir: Dir): Pos | null {
  const n = step(p, dir);
  return deck.cells[key(n)] ? n : null;
}

export function occupied(deck: Deck): Pos[] {
  return Object.keys(deck.cells).map(parseKey);
}

export interface Bounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** Bounding box of occupied cells across all layers, or null for an empty deck. */
export function bounds(deck: Deck): Bounds | null {
  const ps = occupied(deck);
  if (ps.length === 0) return null;
  return {
    minX: Math.min(...ps.map((p) => p.x)),
    minY: Math.min(...ps.map((p) => p.y)),
    minZ: Math.min(...ps.map((p) => p.z)),
    maxX: Math.max(...ps.map((p) => p.x)),
    maxY: Math.max(...ps.map((p) => p.y)),
    maxZ: Math.max(...ps.map((p) => p.z)),
  };
}

/** Number of layers with slides on them (at least 1). Valid on a normalized deck. */
export function layerCount(deck: Deck): number {
  const b = bounds(deck);
  return b ? b.maxZ + 1 : 1;
}

/** How many slides sit behind `p` (same column and row, deeper layers). */
export function depthBehind(deck: Deck, p: Pos): number {
  return occupied(deck).filter((q) => q.x === p.x && q.y === p.y && q.z > p.z).length;
}

/**
 * Shift everything so the top-left occupied cell is at x=0, y=0 (measured across all layers, so
 * layers stay aligned), drop empty layers so every layer is reachable, and make sure `start` points
 * at a slide.
 */
export function normalize(deck: Deck): Deck {
  const b = bounds(deck);
  if (!b) return { ...deck, cells: {}, start: pos(0, 0, 0) };
  const layers = [...new Set(occupied(deck).map((p) => p.z))].sort((a, c) => a - c);
  const z = (old: number) => layers.indexOf(old);
  const cells: Record<CellKey, SlideId> = {};
  for (const [k, id] of Object.entries(deck.cells)) {
    const p = parseKey(k);
    cells[key(pos(p.x - b.minX, p.y - b.minY, z(p.z)))] = id;
  }
  let start = pos(deck.start.x - b.minX, deck.start.y - b.minY, z(deck.start.z));
  if (start.z < 0 || !cells[key(start)]) start = firstCell(cells);
  return { ...deck, cells, start };
}

/** Front-most, then top-most, then left-most occupied cell. */
function firstCell(cells: Record<CellKey, SlideId>): Pos {
  const ps = Object.keys(cells).map(parseKey);
  ps.sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
  return ps[0] ?? pos(0, 0, 0);
}

/**
 * Bring a deck saved before layers existed (cells keyed "x,y", `start` without z) up to date: all
 * of it goes on layer 0. Safe to run on any deck.
 */
export function migrateDeck(deck: Deck): Deck {
  const cells: Record<CellKey, SlideId> = {};
  for (const [k, id] of Object.entries(deck.cells ?? {})) cells[key(parseKey(k))] = id;
  const s = (deck.start ?? {}) as Partial<Pos>;
  return { ...deck, cells, start: pos(s.x ?? 0, s.y ?? 0, s.z ?? 0) };
}

/** Move the slide at `from` to `to` (any layer); if `to` is occupied the two slides swap. */
export function moveSlide(deck: Deck, from: Pos, to: Pos): Deck {
  const id = deck.cells[key(from)];
  if (!id || samePos(from, to)) return deck;
  const cells = { ...deck.cells };
  const other = cells[key(to)];
  delete cells[key(from)];
  if (other) cells[key(from)] = other;
  cells[key(to)] = id;
  // The start marker follows the slide it was on.
  let start = deck.start;
  if (samePos(start, from)) start = to;
  else if (other && samePos(start, to)) start = from;
  return normalize({ ...deck, cells, start });
}

function shiftCells(
  deck: Deck,
  f: (p: Pos) => Pos,
): { cells: Record<CellKey, SlideId>; start: Pos } {
  const cells: Record<CellKey, SlideId> = {};
  for (const [k, id] of Object.entries(deck.cells)) cells[key(f(parseKey(k)))] = id;
  return { cells, start: f(deck.start) };
}

/** Insert an empty row before row `y` on every layer (everything at or below `y` moves down). */
export function insertRow(deck: Deck, y: number): Deck {
  const { cells, start } = shiftCells(deck, (p) => (p.y >= y ? { ...p, y: p.y + 1 } : p));
  return normalize({ ...deck, cells, start });
}

/** Insert an empty column before column `x` on every layer (everything at or right of `x` moves right). */
export function insertColumn(deck: Deck, x: number): Deck {
  const { cells, start } = shiftCells(deck, (p) => (p.x >= x ? { ...p, x: p.x + 1 } : p));
  return normalize({ ...deck, cells, start });
}

/** Remove the slide at `p` (the cell becomes empty; nothing else moves). */
export function removeSlide(deck: Deck, p: Pos): Deck {
  const id = deck.cells[key(p)];
  if (!id) return deck;
  const cells = { ...deck.cells };
  delete cells[key(p)];
  const slides = { ...deck.slides };
  delete slides[id];
  return normalize({ ...deck, cells, slides });
}

/**
 * Add slides as a new row on layer `z`, below everything on every layer (so the new row doesn't
 * land behind or in front of existing slides by accident), left to right.
 */
export function appendRow(deck: Deck, newSlides: Slide[], z = 0): Deck {
  if (newSlides.length === 0) return deck;
  const b = bounds(deck);
  const y = b ? b.maxY + 1 : 0;
  const x0 = b ? b.minX : 0;
  const cells = { ...deck.cells };
  const slides = { ...deck.slides };
  newSlides.forEach((s, i) => {
    slides[s.id] = s;
    cells[key(pos(x0 + i, y, z))] = s.id;
  });
  return normalize({ ...deck, cells, slides, start: b ? deck.start : pos(x0, y, z) });
}

export function setStart(deck: Deck, p: Pos): Deck {
  return deck.cells[key(p)] ? { ...deck, start: p } : deck;
}

export function posOf(deck: Deck, id: SlideId): Pos | null {
  for (const [k, v] of Object.entries(deck.cells)) if (v === id) return parseKey(k);
  return null;
}
