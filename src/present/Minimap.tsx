import { bounds, key, layerCount, pos as at, samePos } from '../model/grid';
import type { Deck, Pos } from '../model/types';

export default function Minimap({
  deck,
  pos,
  onJump,
}: {
  deck: Deck;
  pos: Pos;
  onJump: (p: Pos) => void;
}) {
  const b = bounds(deck);
  if (!b) return null;
  // The map shows the layer being presented; its extent covers all layers so they line up.
  const layers = layerCount(deck);
  const cells: Pos[] = [];
  for (let y = b.minY; y <= b.maxY; y++)
    for (let x = b.minX; x <= b.maxX; x++) cells.push(at(x, y, pos.z));
  return (
    <div
      className="minimap"
      data-testid="minimap"
      style={{ gridTemplateColumns: `repeat(${b.maxX - b.minX + 1}, 18px)` }}
    >
      {cells.map((p) =>
        deck.cells[key(p)] ? (
          <button
            key={key(p)}
            className={`mm-cell ${samePos(p, pos) ? 'current' : ''}`}
            aria-label={`Go to slide at column ${p.x + 1}, row ${p.y + 1}${layers > 1 ? `, layer ${p.z + 1}` : ''}`}
            onClick={() => onJump(p)}
          />
        ) : (
          <span key={key(p)} className="mm-cell empty" />
        ),
      )}
    </div>
  );
}
