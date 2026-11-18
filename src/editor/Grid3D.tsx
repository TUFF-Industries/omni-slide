import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { bounds, key, layerCount, pos, samePos, slideAt } from '../model/grid';
import type { Deck, Pos, SlideId } from '../model/types';
import {
  GAP,
  orbit,
  overviewCamera,
  sceneTransform,
  TILE_H,
  TILE_W,
  tileOrigin,
  type Camera,
  type Viewport,
} from '../present/camera';
import SlideImage from '../ui/SlideImage';
import SlideCell from './SlideCell';
import { cellAtPoint3D, useCellDrag } from './useCellDrag';

interface Props {
  deck: Deck;
  /** The layer being worked on; the others are dimmed. */
  layer: number;
  selected: SlideId | null;
  onSelect: (id: SlideId | null) => void;
  onMove: (from: Pos, to: Pos) => void;
  onOpen: (pos: Pos) => void;
}

/** Layers sit further apart than in present mode's overview, so slides can be dropped between them. */
export const EDITOR_LAYER_GAP = 520;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 4;
/** Wheel `deltaMode` units (pixels, lines, pages) in pixels. */
const WHEEL_UNIT = [1, 16, 400];
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
const ORBIT_PX = 4;
const GHOST_W = 200;
const GHOST_H = (GHOST_W * 9) / 16;

/** A tilt that shows depth but keeps rows and columns easy to read. */
export function editorAngles(layers: number): { pitch: number; yaw: number } {
  return layers > 1 ? { pitch: 34, yaw: -18 } : { pitch: 30, yaw: -10 };
}

interface Orbit {
  pointerId: number;
  x: number;
  y: number;
  from: Camera;
  cam: Camera;
  moved: boolean;
}

/** Size of an element, measured before first paint so the scene doesn't animate in from a guess. */
function useSize(ref: React.RefObject<HTMLElement | null>): Viewport {
  const [size, setSize] = useState<Viewport>({ width: 800, height: 600 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/**
 * The editor in 3D: every layer is a plane of grid cells, stacked back in depth and seen at an
 * angle. Slides are picked and dragged exactly like in the 2D grid, and can be dropped onto any
 * layer, including a new one that appears behind the last while dragging. Drag empty space to
 * orbit, scroll to zoom.
 */
export default function Grid3D({ deck, layer, selected, onSelect, onMove, onOpen }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const vp = useSize(box);
  const layers = layerCount(deck);
  const [angles, setAngles] = useState(() => editorAngles(layers));
  const [zoom, setZoom] = useState(1);
  const orbitRef = useRef<Orbit | null>(null);
  const [orbiting, setOrbiting] = useState(false);

  // Frame every layer plus the drop-only layer behind it, with the ring of empty cells, so the view
  // doesn't jump when that extra layer appears mid-drag.
  const b = bounds(deck) ?? { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
  const fitAt = (a: { pitch: number; yaw: number }) =>
    overviewCamera(
      {
        minX: b.minX - 1,
        maxX: b.maxX + 1,
        minY: b.minY - 1,
        maxY: b.maxY + 1,
        minZ: 0,
        maxZ: layers,
      },
      vp,
      a,
      EDITOR_LAYER_GAP,
    );
  const fit = fitAt(angles);
  const cam: Camera = { ...fit, scale: fit.scale * zoom };

  /**
   * End an orbit: keep the new angles, and keep the on-screen size too (the fit for the new angles
   * has a different scale, so fold the difference into zoom rather than letting the view jump).
   */
  const endOrbit = (o: Orbit) => {
    orbitRef.current = null;
    setOrbiting(false);
    if (!o.moved) return;
    const next = { pitch: o.cam.pitch, yaw: o.cam.yaw };
    setAngles(next);
    setZoom(clampZoom(o.cam.scale / fitAt(next).scale));
  };

  // Wheel / trackpad pinch zooms the view. Native listener: React's is passive, and pinch (sent as
  // ctrl+wheel) must not also zoom the page.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const px = e.deltaY * (WHEEL_UNIT[e.deltaMode] ?? 1) * (e.ctrlKey ? 8 : 1);
      setZoom((z) => clampZoom(z * Math.exp(-px * 0.0015)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const { drag, handlers } = useCellDrag({
    deck,
    cellAt: cellAtPoint3D,
    onSelect,
    onMove,
    onEmptyPointerDown: (e) => {
      // Capture now, so the matching pointerup always arrives here and clears this.
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      orbitRef.current = {
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        from: cam,
        cam,
        moved: false,
      };
    },
  });
  const dragging = !!drag?.active;
  // Compared by value: the drag state changes on every pointer move, the target cell rarely does.
  const overKey = dragging && drag?.over ? key(drag.over) : '';
  const fromKey = dragging && drag ? key(drag.from) : '';

  // The planes only change with the deck, selection and drag; orbiting moves the camera alone.
  const plates = useMemo(() => {
    const cols = b.maxX - b.minX + 3;
    const rows = b.maxY - b.minY + 3;
    const count = dragging ? layers + 1 : layers;
    return Array.from({ length: count }, (_, z) => {
      const o = tileOrigin(pos(b.minX - 1, b.minY - 1, z), EDITOR_LAYER_GAP);
      const cells: Pos[] = [];
      for (let y = b.minY - 1; y <= b.maxY + 1; y++)
        for (let x = b.minX - 1; x <= b.maxX + 1; x++) cells.push(pos(x, y, z));
      const isNew = z >= layers;
      return (
        <div
          key={z}
          className={`plate ${z === layer ? 'active' : ''} ${isNew ? 'new' : ''}`}
          data-layer={z}
          data-testid={`plate-${z}`}
          style={{
            transform: `translate3d(${o.x}px, ${o.y}px, ${o.z}px)`,
            gridTemplateColumns: `repeat(${cols}, ${TILE_W}px)`,
            gridTemplateRows: `repeat(${rows}, ${TILE_H}px)`,
            gap: GAP,
          }}
        >
          <div className="plate-label">{isNew ? 'New layer' : `Layer ${z + 1}`}</div>
          {cells.map((p) => {
            const slide = slideAt(deck, p);
            return (
              <SlideCell
                key={key(p)}
                deck={deck}
                pos={p}
                gridPos={{ x: p.x - b.minX, y: p.y - b.minY }}
                slide={slide}
                selected={!!slide && slide.id === selected}
                isStart={samePos(p, deck.start)}
                dropTarget={overKey === key(p)}
                dragging={fromKey === key(p)}
              />
            );
          })}
        </div>
      );
    });
    // b is derived from deck.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck, layers, layer, selected, dragging, overKey, fromKey]);

  const rect = box.current?.getBoundingClientRect();
  const dragSlide = dragging && drag ? slideAt(deck, drag.from) : undefined;

  return (
    <div
      ref={box}
      className={`grid3d ${dragging ? 'is-dragging' : ''} ${orbiting ? 'orbiting' : ''}`}
      data-testid="grid3d"
      {...handlers}
      onPointerDown={(e) => {
        orbitRef.current = null;
        handlers.onPointerDown(e);
      }}
      onPointerMove={(e) => {
        handlers.onPointerMove(e);
        const o = orbitRef.current;
        if (!o || o.pointerId !== e.pointerId) return;
        const dx = e.clientX - o.x;
        const dy = e.clientY - o.y;
        if (!o.moved && Math.hypot(dx, dy) < ORBIT_PX) return;
        if (!o.moved) {
          o.moved = true;
          setOrbiting(true);
        }
        // Straight to the DOM while orbiting; state catches up when the drag ends.
        o.cam = orbit(o.from, dx, dy);
        if (sceneRef.current) sceneRef.current.style.transform = sceneTransform(o.cam, vp);
      }}
      onPointerUp={(e) => {
        handlers.onPointerUp(e);
        const o = orbitRef.current;
        if (!o || o.pointerId !== e.pointerId) return;
        endOrbit(o);
        if (!o.moved) onSelect(null); // a plain click on empty space
      }}
      onPointerCancel={(e) => {
        handlers.onPointerCancel();
        // Keep wherever the orbit had got to, so the view and state agree.
        const o = orbitRef.current;
        if (o?.pointerId === e.pointerId) endOrbit(o);
      }}
      onDoubleClick={(e) => {
        const p = cellAtPoint3D(e.clientX, e.clientY);
        if (p && slideAt(deck, p)) onOpen(p);
      }}
    >
      <div className="grid3d-scene" ref={sceneRef} style={{ transform: sceneTransform(cam, vp) }}>
        {plates}
      </div>

      <div className="grid3d-hud">
        <span className="muted small">
          Drag a slide to move it, onto any layer · drag empty space to orbit · scroll to zoom
        </span>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            setAngles(editorAngles(layers));
            setZoom(1);
          }}
        >
          Reset view
        </button>
      </div>

      {dragSlide && drag && rect && (
        // `.grid3d` has perspective, which makes it the containing block for this fixed element.
        <div
          className="drag-ghost"
          style={{
            width: GHOST_W,
            height: GHOST_H,
            transform: `translate(${drag.x - rect.left - GHOST_W / 2}px, ${drag.y - rect.top - GHOST_H / 2}px)`,
          }}
        >
          <SlideImage slide={dragSlide} size="thumb" />
        </div>
      )}
    </div>
  );
}
