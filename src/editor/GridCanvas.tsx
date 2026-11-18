import { useEffect } from 'react';
import { bounds, key, pos, samePos, slideAt } from '../model/grid';
import type { Deck, Pos, SlideId } from '../model/types';
import SlideImage from '../ui/SlideImage';
import SlideCell from './SlideCell';
import { cellAtPoint, useCellDrag } from './useCellDrag';

interface Props {
  deck: Deck;
  /** The layer (z) being shown and edited. */
  layer: number;
  cellWidth: number;
  selected: SlideId | null;
  onSelect: (id: SlideId | null) => void;
  onMove: (from: Pos, to: Pos) => void;
  onOpen: (pos: Pos) => void;
}

/** Distance from the scroll container's edge at which dragging starts auto-scrolling. */
const EDGE_PX = 48;
const EDGE_SPEED = 14;

export default function GridCanvas({
  deck,
  layer,
  cellWidth,
  selected,
  onSelect,
  onMove,
  onOpen,
}: Props) {
  const { drag, dragRef, refreshOver, handlers } = useCellDrag({
    deck,
    cellAt: cellAtPoint,
    onSelect,
    onMove,
  });

  // One ring of empty cells around the content so slides can be dropped anywhere next to it. The
  // extent covers every layer, so a cell sits at the same spot on screen whichever layer is shown.
  const b = bounds(deck) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const cols = b.maxX - b.minX + 3;
  const rows = b.maxY - b.minY + 3;
  const cells: Pos[] = [];
  for (let y = b.minY - 1; y <= b.maxY + 1; y++)
    for (let x = b.minX - 1; x <= b.maxX + 1; x++) cells.push(pos(x, y, layer));

  const cellHeight = Math.round((cellWidth * 9) / 16);

  // Auto-scroll the canvas while dragging near its edges.
  const dragging = !!drag?.active;
  useEffect(() => {
    if (!dragging) return;
    let raf = 0;
    const tick = () => {
      const d = dragRef.current;
      const scroller = document.querySelector<HTMLElement>('.canvas');
      if (d && scroller) {
        const r = scroller.getBoundingClientRect();
        const edge = (v: number, lo: number, hi: number) =>
          v < lo + EDGE_PX ? -EDGE_SPEED : v > hi - EDGE_PX ? EDGE_SPEED : 0;
        const dx = edge(d.x, r.left, r.right);
        const dy = edge(d.y, r.top, r.bottom);
        if (dx || dy) {
          scroller.scrollBy(dx, dy);
          refreshOver();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dragging, dragRef, refreshOver]);

  const dragSlide = drag?.active ? slideAt(deck, drag.from) : undefined;

  return (
    <div
      className={`grid ${drag?.active ? 'is-dragging' : ''}`}
      style={{
        gridTemplateColumns: `repeat(${cols}, ${cellWidth}px)`,
        gridTemplateRows: `repeat(${rows}, ${cellHeight}px)`,
      }}
      data-testid="grid"
      data-layer={layer}
      {...handlers}
      onDoubleClick={(e) => {
        const p = cellAtPoint(e.clientX, e.clientY);
        if (p && slideAt(deck, p)) onOpen(p);
      }}
    >
      {cells.map((p) => {
        const slide = slideAt(deck, p);
        const ghost = !slide && layer > 0 ? slideAt(deck, { ...p, z: layer - 1 }) : undefined;
        return (
          <SlideCell
            key={key(p)}
            deck={deck}
            pos={p}
            gridPos={{ x: p.x - b.minX, y: p.y - b.minY }}
            slide={slide}
            ghost={ghost}
            selected={!!slide && slide.id === selected}
            isStart={samePos(p, deck.start)}
            dropTarget={!!drag?.active && !!drag.over && samePos(drag.over, p)}
            dragging={!!drag?.active && samePos(drag.from, p)}
          />
        );
      })}
      {dragSlide && drag && (
        <div
          className="drag-ghost"
          style={{
            width: cellWidth,
            height: cellHeight,
            transform: `translate(${drag.x - cellWidth / 2}px, ${drag.y - cellHeight / 2}px)`,
          }}
        >
          <SlideImage slide={dragSlide} size="thumb" />
        </div>
      )}
    </div>
  );
}
