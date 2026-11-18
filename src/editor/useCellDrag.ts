import { useCallback, useRef, useState } from 'react';
import { parseKey, samePos, slideAt } from '../model/grid';
import type { Deck, Pos, SlideId } from '../model/types';

export interface CellDrag {
  from: Pos;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  /** False until the pointer has moved past the threshold, so a click stays a click. */
  active: boolean;
  over: Pos | null;
}

const DRAG_THRESHOLD = 5;

/** Grid position of a cell element: `data-cell` holds "x,y", the layer is on the nearest `[data-layer]`. */
export function cellPos(el: Element): Pos | null {
  const cell = el.closest<HTMLElement>('[data-cell]');
  const layer = cell?.closest<HTMLElement>('[data-layer]');
  if (!cell || !layer) return null;
  return { ...parseKey(cell.dataset.cell!), z: Number(layer.dataset.layer) };
}

/** The cell under a screen point (2D: the grid shows one layer). */
export function cellAtPoint(x: number, y: number): Pos | null {
  const el = document.elementFromPoint(x, y);
  return el ? cellPos(el) : null;
}

/**
 * The cell under a screen point in the 3D view. Layers seen at an angle overlap on screen, so
 * several cells (on different layers) can be under the pointer; take the one whose on-screen
 * centre is nearest, which is the one the user is aiming at.
 */
export function cellAtPoint3D(x: number, y: number): Pos | null {
  let best: HTMLElement | null = null;
  let bestDist = Infinity;
  for (const el of document.elementsFromPoint(x, y)) {
    const c = el.closest<HTMLElement>('[data-cell]');
    if (!c) continue;
    const r = c.getBoundingClientRect();
    const d = Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2));
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best ? cellPos(best) : null;
}

interface Options {
  deck: Deck;
  cellAt: (x: number, y: number) => Pos | null;
  onSelect: (id: SlideId | null) => void;
  onMove: (from: Pos, to: Pos) => void;
  /** Pointer down somewhere that isn't a slide. Defaults to clearing the selection. */
  onEmptyPointerDown?: (e: React.PointerEvent) => void;
}

/** Pointer-based select + drag & drop of slides between cells, shared by the 2D and 3D grids. */
export function useCellDrag({ deck, cellAt, onSelect, onMove, onEmptyPointerDown }: Options) {
  const [drag, setDrag] = useState<CellDrag | null>(null);
  const dragRef = useRef<CellDrag | null>(null);
  const update = useCallback((d: CellDrag | null) => {
    dragRef.current = d;
    setDrag(d);
  }, []);

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const at = cellAt(e.clientX, e.clientY);
    const slide = at && slideAt(deck, at);
    if (!at || !slide) {
      if (onEmptyPointerDown) onEmptyPointerDown(e);
      else onSelect(null);
      return;
    }
    onSelect(slide.id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    update({
      from: at,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      active: false,
      over: null,
    });
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const active =
      d.active || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > DRAG_THRESHOLD;
    update({
      ...d,
      x: e.clientX,
      y: e.clientY,
      active,
      over: active ? cellAt(e.clientX, e.clientY) : null,
    });
  }

  function onPointerUp(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    update(null);
    if (d.active && d.over && !samePos(d.over, d.from)) onMove(d.from, d.over);
  }

  /** Re-check the cell under a pointer that hasn't moved (e.g. the view scrolled under it). */
  const refreshOver = useCallback(() => {
    const d = dragRef.current;
    if (d) update({ ...d, over: cellAt(d.x, d.y) });
  }, [cellAt, update]);

  return {
    drag,
    dragRef,
    refreshOver,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: () => update(null),
    },
  };
}
