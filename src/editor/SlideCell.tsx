import { depthBehind, DIRS, neighbor } from '../model/grid';
import type { Deck, Pos, Slide } from '../model/types';
import SlideImage from '../ui/SlideImage';

interface Props {
  deck: Deck;
  pos: Pos;
  /** Position inside the rendered grid (0-based, excluding the empty border ring). */
  gridPos: { x: number; y: number };
  slide: Slide | undefined;
  /** For an empty cell on a deeper layer: the slide in front of it, shown faintly for alignment. */
  ghost?: Slide;
  selected: boolean;
  isStart: boolean;
  dropTarget: boolean;
  dragging: boolean;
}

export default function SlideCell({
  deck,
  pos,
  gridPos,
  slide,
  ghost,
  selected,
  isStart,
  dropTarget,
  dragging,
}: Props) {
  const cls = [
    'cell',
    slide ? 'filled' : 'empty',
    selected && 'selected',
    dropTarget && 'drop-target',
    dragging && 'dragging',
  ]
    .filter(Boolean)
    .join(' ');
  const behind = slide ? depthBehind(deck, pos) : 0;
  return (
    <div
      className={cls}
      data-cell={`${pos.x},${pos.y}`}
      data-slide={slide?.id}
      style={{ gridColumn: gridPos.x + 2, gridRow: gridPos.y + 2 }}
    >
      {!slide && ghost && (
        <div className="cell-ghost" aria-hidden>
          <SlideImage slide={ghost} size="thumb" />
        </div>
      )}
      {slide && (
        <>
          <SlideImage slide={slide} size="thumb" />
          {isStart && <span className="badge start-badge">Start</span>}
          {behind > 0 && (
            <span
              className="badge depth-badge"
              title={`${behind} slide${behind > 1 ? 's' : ''} behind this one (Z to go in)`}
              data-testid="depth-badge"
            >
              ⧉ {behind}
            </span>
          )}
          {DIRS.map((d) => neighbor(deck, pos, d) && <span key={d} className={`link link-${d}`} />)}
        </>
      )}
    </div>
  );
}
