import { describe, expect, it } from 'vitest';
import {
  appendRow,
  bounds,
  depthBehind,
  insertColumn,
  insertRow,
  layerCount,
  migrateDeck,
  moveSlide,
  neighbor,
  normalize,
  pos as p,
  removeSlide,
  setStart,
} from './grid';
import type { Deck, Pos, Slide } from './types';

const slide = (id: string): Slide => ({ id, kind: 'image', assetId: id, width: 16, height: 9 });

/** Test deck; cell keys may be "x,y" (layer 0) or "x,y,z". */
function deck(cells: Record<string, string>, start: Pos = p(0, 0)): Deck {
  const slides: Record<string, Slide> = {};
  for (const id of Object.values(cells)) slides[id] = slide(id);
  return migrateDeck({
    id: 'd',
    name: 'd',
    createdAt: 0,
    updatedAt: 0,
    slides,
    cells: cells as Deck['cells'],
    start,
  });
}

describe('neighbor', () => {
  const d = deck({ '0,0': 'a', '1,0': 'b', '0,1': 'c', '0,0,1': 'deep' });
  it('finds occupied neighbors', () => {
    expect(neighbor(d, p(0, 0), 'right')).toEqual(p(1, 0));
    expect(neighbor(d, p(0, 0), 'down')).toEqual(p(0, 1));
    expect(neighbor(d, p(0, 1), 'up')).toEqual(p(0, 0));
  });
  it('returns null for empty cells', () => {
    expect(neighbor(d, p(0, 0), 'left')).toBeNull();
    expect(neighbor(d, p(0, 0), 'up')).toBeNull();
    expect(neighbor(d, p(1, 0), 'down')).toBeNull();
  });
  it('moves in and out between layers at the same column and row', () => {
    expect(neighbor(d, p(0, 0), 'in')).toEqual(p(0, 0, 1));
    expect(neighbor(d, p(0, 0, 1), 'out')).toEqual(p(0, 0));
    expect(neighbor(d, p(1, 0), 'in')).toBeNull(); // nothing behind b
    expect(neighbor(d, p(0, 0), 'out')).toBeNull(); // nothing in front of the front layer
    expect(neighbor(d, p(0, 0, 1), 'right')).toBeNull(); // layers don't leak sideways
  });
});

describe('moveSlide', () => {
  it('moves into an empty cell', () => {
    const d = moveSlide(deck({ '0,0': 'a', '1,0': 'b' }), p(1, 0), p(0, 1));
    expect(d.cells).toEqual({ '0,0,0': 'a', '0,1,0': 'b' });
  });
  it('swaps with an occupied cell and the start follows its slide', () => {
    const d = moveSlide(deck({ '0,0': 'a', '1,0': 'b' }), p(0, 0), p(1, 0));
    expect(d.cells).toEqual({ '0,0,0': 'b', '1,0,0': 'a' });
    expect(d.start).toEqual(p(1, 0));
  });
  it('normalizes when moving to negative coordinates', () => {
    const d = moveSlide(deck({ '0,0': 'a', '1,0': 'b' }), p(1, 0), p(-1, -1));
    expect(d.cells).toEqual({ '1,1,0': 'a', '0,0,0': 'b' });
    expect(d.start).toEqual(p(1, 1));
  });
  it('is a no-op from an empty cell', () => {
    const d0 = deck({ '0,0': 'a' });
    expect(moveSlide(d0, p(3, 3), p(0, 0))).toBe(d0);
  });
  it('moves a slide behind another', () => {
    const d = moveSlide(deck({ '0,0': 'a', '1,0': 'b' }), p(1, 0), p(0, 0, 1));
    expect(d.cells).toEqual({ '0,0,0': 'a', '0,0,1': 'b' });
    expect(depthBehind(d, p(0, 0))).toBe(1);
  });
  it('moving a slide in front of layer 0 pushes every other layer back', () => {
    const d = moveSlide(deck({ '0,0': 'a', '1,0': 'b' }), p(1, 0), p(1, 0, -1));
    expect(d.cells).toEqual({ '1,0,0': 'b', '0,0,1': 'a' });
    expect(d.start).toEqual(p(0, 0, 1)); // still on a
  });
});

describe('normalize', () => {
  it('shifts to origin and repairs start', () => {
    const d = normalize(deck({ '2,3': 'a', '3,3': 'b' }, p(9, 9)));
    expect(d.cells).toEqual({ '0,0,0': 'a', '1,0,0': 'b' });
    expect(d.start).toEqual(p(0, 0));
  });
  it('handles an empty deck', () => {
    expect(bounds(normalize(deck({})))).toBeNull();
  });
  it('keeps layers aligned: x/y shift is measured across all layers', () => {
    const d = normalize(deck({ '2,2,0': 'front', '1,1,1': 'back' }, p(2, 2)));
    expect(d.cells).toEqual({ '1,1,0': 'front', '0,0,1': 'back' });
  });
  it('drops empty layers so every layer stays reachable', () => {
    const d = normalize(deck({ '0,0,0': 'a', '0,0,3': 'b' }, p(0, 0, 3)));
    expect(d.cells).toEqual({ '0,0,0': 'a', '0,0,1': 'b' });
    expect(d.start).toEqual(p(0, 0, 1));
    expect(layerCount(d)).toBe(2);
  });
  it('a deck whose front layer emptied moves the rest forward', () => {
    const d = removeSlide(deck({ '0,0,0': 'a', '0,0,1': 'b' }), p(0, 0, 0));
    expect(d.cells).toEqual({ '0,0,0': 'b' });
  });
});

describe('migrateDeck', () => {
  it('puts a pre-layers deck on layer 0', () => {
    const old = {
      ...deck({}),
      cells: { '0,0': 'a', '1,0': 'b' },
      start: { x: 1, y: 0 },
    } as unknown as Deck;
    const d = migrateDeck(old);
    expect(d.cells).toEqual({ '0,0,0': 'a', '1,0,0': 'b' });
    expect(d.start).toEqual(p(1, 0, 0));
  });
  it('leaves current decks unchanged', () => {
    const d = deck({ '0,0,0': 'a', '0,0,1': 'b' }, p(0, 0, 1));
    expect(migrateDeck(d)).toEqual(d);
  });
});

describe('appendRow', () => {
  it('starts at the origin on an empty deck', () => {
    const d = appendRow(deck({}), [slide('a'), slide('b')]);
    expect(d.cells).toEqual({ '0,0,0': 'a', '1,0,0': 'b' });
    expect(Object.keys(d.slides)).toEqual(['a', 'b']);
  });
  it('adds a row below existing content', () => {
    const d = appendRow(deck({ '0,0': 'a', '0,1': 'b' }), [slide('c'), slide('d')]);
    expect(d.cells['0,2,0']).toBe('c');
    expect(d.cells['1,2,0']).toBe('d');
    expect(d.start).toEqual(p(0, 0));
  });
  it('can add to a deeper layer, below everything on every layer', () => {
    const d = appendRow(deck({ '0,0,0': 'a', '0,1,1': 'b' }), [slide('c')], 1);
    expect(d.cells['0,2,1']).toBe('c');
  });
});

describe('insert / remove', () => {
  it('inserts a row on every layer', () => {
    const d = insertRow(deck({ '0,0': 'a', '0,1': 'b', '0,1,1': 'c' }, p(0, 1)), 1);
    expect(d.cells).toEqual({ '0,0,0': 'a', '0,2,0': 'b', '0,2,1': 'c' });
    expect(d.start).toEqual(p(0, 2));
  });
  it('inserts a column on every layer', () => {
    const d = insertColumn(deck({ '0,0': 'a', '1,0': 'b', '1,0,1': 'c' }), 1);
    expect(d.cells).toEqual({ '0,0,0': 'a', '2,0,0': 'b', '2,0,1': 'c' });
  });
  it('removes a slide and its data', () => {
    const d = removeSlide(deck({ '0,0': 'a', '1,0': 'b' }), p(0, 0));
    expect(d.cells).toEqual({ '0,0,0': 'b' });
    expect(d.slides).toEqual({ b: slide('b') });
    expect(d.start).toEqual(p(0, 0));
  });
  it('setStart ignores empty cells', () => {
    const d0 = deck({ '0,0': 'a', '1,0': 'b', '1,0,1': 'c' });
    expect(setStart(d0, p(1, 0)).start).toEqual(p(1, 0));
    expect(setStart(d0, p(1, 0, 1)).start).toEqual(p(1, 0, 1));
    expect(setStart(d0, p(5, 0)).start).toEqual(p(0, 0));
  });
});
