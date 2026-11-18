import { useEffect, useMemo, useRef, useState } from 'react';
import { bounds, key, layerCount, occupied, samePos, slideAt } from '../model/grid';
import type { Deck, Pos } from '../model/types';
import SlideImage from '../ui/SlideImage';
import {
  defaultAngles,
  focusCamera,
  orbit,
  overviewCamera,
  sceneTransform,
  TILE_H,
  TILE_W,
  tileOrigin,
  type Camera,
  type Viewport,
} from './camera';

/** Keep in sync with the `.ov-scene` transition in styles.css. */
const FLY_MS = 650;
const DRAG_PX = 5;
/** Above this many slides, tiles get a cheaper shadow (each one is its own 3D layer). */
const MANY_TILES = 100;

interface Props {
  deck: Deck;
  /** The slide being presented; the camera starts and ends on it. */
  pos: Pos;
  onPick: (p: Pos) => void;
  onClose: () => void;
}

function viewport(): Viewport {
  return { width: window.innerWidth, height: window.innerHeight };
}

function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

interface Drag {
  pointerId: number;
  x: number;
  y: number;
  from: Camera;
  /** Where the drag has turned the camera to; committed to state when it ends. */
  cam: Camera;
  moved: boolean;
}

/**
 * The whole deck as a 3D scene: every layer, tilted so depth shows. Opens by flying the camera
 * out from the current slide, and flies into a slide when one is clicked. Drag to look around.
 */
export default function Overview3D({ deck, pos, onPick, onClose }: Props) {
  const [vp, setVp] = useState(viewport);
  // Start exactly where present mode is (looking straight at the current slide), then fly out.
  const [cam, setCam] = useState<Camera>(() => focusCamera(pos, viewport()));
  const [dragging, setDragging] = useState(false);
  const drag = useRef<Drag | null>(null);
  const leaving = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const sceneRef = useRef<HTMLDivElement>(null);
  const layers = layerCount(deck);
  const b = bounds(deck);

  useEffect(() => {
    if (!b) return;
    let raf = requestAnimationFrame(() => {
      // Second frame: the start position has been painted, so the change animates.
      raf = requestAnimationFrame(() =>
        setCam(overviewCamera(b, viewport(), defaultAngles(layers))),
      );
    });
    return () => cancelAnimationFrame(raf);
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onResize = () => setVp(viewport());
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      // Don't navigate after present mode has gone (e.g. browser Back mid-flight).
      window.clearTimeout(timer.current);
    };
  }, []);

  /** Fly the camera into `p`, then hand over to present mode. */
  const flyTo = (p: Pos, then: () => void) => {
    if (leaving.current) return;
    leaving.current = true;
    setCam(focusCamera(p, vp));
    timer.current = window.setTimeout(then, reducedMotion() ? 0 : FLY_MS);
  };
  const pickRef = useRef<(p: Pos) => void>(() => {});
  pickRef.current = (p: Pos) => {
    // A click that ends a drag shouldn't also pick the slide under the pointer.
    if (drag.current?.moved) return;
    flyTo(p, () => onPick(p));
  };

  // The tiles only change with the deck or the current slide, not with the camera, so dragging
  // (which moves the camera every frame) doesn't re-render hundreds of them.
  const tiles = useMemo(() => {
    const all = occupied(deck);
    const labels =
      layers > 1
        ? Array.from({ length: layers }, (_, z) => {
            // Label each layer at its own top-left slide.
            const onLayer = all.filter((p) => p.z === z);
            const top = Math.min(...onLayer.map((p) => p.y));
            const left = Math.min(...onLayer.filter((p) => p.y === top).map((p) => p.x));
            const o = tileOrigin({ x: left, y: top, z });
            return (
              <div
                key={`layer-${z}`}
                className="ov-layer-label"
                style={{ transform: `translate3d(${o.x}px, ${o.y - 64}px, ${o.z}px)` }}
              >
                Layer {z + 1}
              </div>
            );
          })
        : [];
    const buttons = all.map((p) => {
      const o = tileOrigin(p);
      const isCurrent = samePos(p, pos);
      const where = `column ${p.x + 1}, row ${p.y + 1}${layers > 1 ? `, layer ${p.z + 1}` : ''}`;
      return (
        <button
          key={key(p)}
          className={`ov-tile ${isCurrent ? 'current' : ''}`}
          style={{
            width: TILE_W,
            height: TILE_H,
            transform: `translate3d(${o.x}px, ${o.y}px, ${o.z}px)`,
          }}
          aria-label={`Go to slide at ${where}`}
          aria-current={isCurrent || undefined}
          onClick={() => pickRef.current(p)}
        >
          <SlideImage slide={slideAt(deck, p)} size={isCurrent ? 'full' : 'thumb'} />
        </button>
      );
    });
    return { labels, buttons, count: all.length };
  }, [deck, pos, layers]);

  // Escape / M close the overview (flying back to the current slide) before present mode sees
  // them, so Escape doesn't also leave presenting. Arrow keys still move underneath.
  const closeRef = useRef(() => {});
  closeRef.current = () => flyTo(pos, onClose);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape' || e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  if (!b) return null;

  return (
    <div
      className={`overview ${dragging ? 'dragging' : ''} ${tiles.count > MANY_TILES ? 'many' : ''}`}
      role="dialog"
      aria-label="Overview"
      data-testid="overview"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        drag.current = {
          pointerId: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          from: cam,
          cam,
          moved: false,
        };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.pointerId !== e.pointerId || leaving.current) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (!d.moved && Math.hypot(dx, dy) < DRAG_PX) return;
        if (!d.moved) {
          d.moved = true;
          setDragging(true);
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }
        // Straight to the DOM while dragging; React state catches up when the drag ends.
        d.cam = orbit(d.from, dx, dy);
        if (sceneRef.current) sceneRef.current.style.transform = sceneTransform(d.cam, vp);
      }}
      onPointerUp={() => {
        const d = drag.current;
        if (d?.moved) setCam(d.cam);
        // Cleared after the click event that follows pointerup, which checks `moved`.
        setTimeout(() => (drag.current = null));
        setDragging(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
      }}
    >
      <div className="ov-scene" ref={sceneRef} style={{ transform: sceneTransform(cam, vp) }}>
        {tiles.labels}
        {tiles.buttons}
      </div>
      <div className="ov-hint">Drag to look around · click a slide to fly to it · Esc to close</div>
    </div>
  );
}
