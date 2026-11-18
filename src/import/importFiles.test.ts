import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Deck, Slide } from '../model/types';

// Fake PDF importer: emits `pages` slides, then optionally fails.
let pages = 0;
let failAfter: number | null = null;
let fileNo = 0;
vi.mock('./pdf', () => ({
  importPdf: async (_f: File, onSlide: (s: Slide) => Promise<void>) => {
    const prefix = fileNo++ === 0 ? 's' : `f${fileNo}-`;
    for (let i = 1; i <= pages; i++) {
      if (failAfter !== null && i > failAfter) throw new Error('out of memory');
      await onSlide({
        id: `${prefix}${i}`,
        kind: 'image',
        assetId: `a${prefix}${i}`,
        width: 16,
        height: 9,
      });
    }
  },
}));
const saves: Deck[] = [];
vi.mock('../storage/db', () => ({
  saveDeck: async (d: Deck) => {
    const saved = { ...d, updatedAt: saves.length + 1 };
    saves.push(saved);
    return saved;
  },
}));

const { importFiles, SAVE_EVERY } = await import('./index');

const empty: Deck = {
  id: 'd',
  name: 'd',
  createdAt: 0,
  updatedAt: 0,
  slides: {},
  cells: {},
  start: { x: 0, y: 0 },
};
const pdf = (name: string) => new File(['x'], name, { type: 'application/pdf' });
const count = (d: Deck) => Object.keys(d.slides).length;

beforeEach(() => {
  saves.length = 0;
  failAfter = null;
  fileNo = 0;
});

describe('importFiles', () => {
  test('saves the growing row every SAVE_EVERY slides and once at the end', async () => {
    pages = SAVE_EVERY * 2 + 3;
    const seen: number[] = [];
    const deck = await importFiles(empty, [pdf('big.pdf')], {
      onSaved: (d) => seen.push(count(d)),
    });
    expect(seen).toEqual([SAVE_EVERY, SAVE_EVERY * 2, pages]);
    expect(count(deck)).toBe(pages);
    // All in one row, in page order.
    expect(deck.cells['0,0']).toBe('s1');
    expect(deck.cells[`${pages - 1},0`]).toBe(`s${pages}`);
  });

  test('keeps the slides imported before a failure and says so', async () => {
    pages = 40;
    failAfter = 25;
    await expect(importFiles(empty, [pdf('big.pdf')])).rejects.toThrow(
      'out of memory (kept the first 25 from big.pdf)',
    );
    expect(count(saves[saves.length - 1])).toBe(25);
  });

  test('each file gets its own row', async () => {
    pages = 3;
    const deck = await importFiles(empty, [pdf('a.pdf'), pdf('b.pdf')]);
    expect(count(deck)).toBe(6);
    expect(Object.keys(deck.cells).filter((k) => k.endsWith(',1'))).toHaveLength(3);
  });

  test('explains unsupported formats instead of doing nothing', async () => {
    const ppt = new File(['x'], 'old.ppt');
    await expect(importFiles(empty, [ppt])).rejects.toThrow("old.ppt isn't supported");
  });
});
