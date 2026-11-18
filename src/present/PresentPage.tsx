import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ALL_DIRS,
  DEPTH_DIRS,
  DIRS,
  key,
  layerCount,
  neighbor,
  occupied,
  pos,
  samePos,
  slideAt,
} from '../model/grid';
import type { Deck, Dir, Pos } from '../model/types';
import { assetUrl } from '../storage/assetUrl';
import { getDeck } from '../storage/db';
import SlideImage from '../ui/SlideImage';
import Overview3D from './Overview3D';

const KEYS: Record<string, Dir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  // Presentation clickers usually send PageUp / PageDown.
  PageDown: 'right',
  PageUp: 'left',
  ' ': 'right',
  // Layers: Z dives in (one layer deeper), X comes back out.
  z: 'in',
  Z: 'in',
  x: 'out',
  X: 'out',
};

const CHEVRON: Record<Dir, string> = {
  up: '⌃',
  down: '⌄',
  left: '‹',
  right: '›',
  in: '⤓ In',
  out: '⤒ Out',
};
const SWIPE_PX = 50;
const IDLE_MS = 2500;

interface View {
  pos: Pos;
  prev: Pos | null;
  dir: Dir | null;
  n: number;
}

export default function PresentPage() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [deck, setDeck] = useState<Deck | null | undefined>(undefined);
  const [view, setView] = useState<View | null>(null);
  const [overview, setOverview] = useState(false);
  const [idle, setIdle] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    getDeck(id!).then((d) => {
      setDeck(d ?? null);
      if (!d) return;
      const q = pos(Number(params.get('x')), Number(params.get('y')), Number(params.get('z')));
      const start = params.has('x') && d.cells[key(q)] ? q : d.start;
      setView({ pos: start, prev: null, dir: null, n: 0 });
    });
    // Only on load; later position changes are written to the URL by go().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const go = useCallback(
    (to: Pos, dir: Dir | null) => {
      setView((v) => (v ? { pos: to, prev: v.pos, dir, n: v.n + 1 } : v));
      setParams({ x: String(to.x), y: String(to.y), z: String(to.z) }, { replace: true });
    },
    [setParams],
  );

  const move = useCallback(
    (dir: Dir) => {
      if (!deck || !view) return;
      const n = neighbor(deck, view.pos, dir);
      if (n) go(n, dir);
    },
    [deck, view, go],
  );

  const exit = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    navigate(`/deck/${id}`);
  }, [id, navigate]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const dir = KEYS[e.key];
      if (dir) {
        e.preventDefault();
        move(dir);
      } else if (e.key === 'Home' && deck) {
        go(deck.start, null);
      } else if ((e.key === 'm' || e.key === 'M') && deck && occupied(deck).length > 0) {
        // Closing is handled by the overview itself, so it can fly back first.
        setOverview(true);
      } else if (e.key === 'f' || e.key === 'F') {
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        else document.documentElement.requestFullscreen?.().catch(() => {});
      } else if (e.key === 'Escape' && !document.fullscreenElement) {
        exit();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move, go, exit, deck]);

  // Preload the neighbours (including in/out) so moving is instant.
  useEffect(() => {
    if (!deck || !view) return;
    for (const d of ALL_DIRS) {
      const n = neighbor(deck, view.pos, d);
      const s = n && slideAt(deck, n);
      if (s)
        assetUrl(s.assetId).then((u) => {
          if (u) new Image().src = u;
        });
    }
  }, [deck, view]);

  // Hide the cursor and chrome when the mouse is still.
  useEffect(() => {
    let t = setTimeout(() => setIdle(true), IDLE_MS);
    const wake = () => {
      setIdle(false);
      clearTimeout(t);
      t = setTimeout(() => setIdle(true), IDLE_MS);
    };
    window.addEventListener('mousemove', wake);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousemove', wake);
    };
  }, []);

  if (deck === undefined || (deck && !view)) return <div className="present" />;
  if (deck === null || !view)
    return (
      <div className="present message">
        Deck not found. <button onClick={() => navigate('/')}>Back</button>
      </div>
    );

  const current = slideAt(deck, view.pos);
  const layers = layerCount(deck);
  const previous = view.prev ? slideAt(deck, view.prev) : undefined;

  return (
    <div
      className={`present ${idle ? 'idle' : ''}`}
      data-testid="present"
      data-pos={key(view.pos)}
      onTouchStart={(e) => {
        const t = e.touches[0];
        touch.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(e) => {
        const s = touch.current;
        touch.current = null;
        if (!s) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - s.x;
        const dy = t.clientY - s.y;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return;
        // Swiping content left reveals the slide to the right, like a carousel.
        if (Math.abs(dx) > Math.abs(dy)) move(dx < 0 ? 'right' : 'left');
        else move(dy < 0 ? 'down' : 'up');
      }}
    >
      {/* Slides are faces of a cube: moving turns it, going in/out moves through depth. */}
      <div className="scene3d">
        {previous && view.dir && (
          <div key={`out-${view.n}`} className={`stage out out-${view.dir}`} aria-hidden>
            <SlideImage slide={previous} />
          </div>
        )}
        <div
          key={`in-${view.n}`}
          className={`stage ${view.dir ? `in in-${view.dir}` : ''}`}
          data-testid="current-slide"
          data-slide={current?.id}
          data-source={current?.source}
        >
          <SlideImage slide={current} />
        </div>
      </div>

      {[...DIRS, ...DEPTH_DIRS].map((d) =>
        neighbor(deck, view.pos, d) ? (
          <button
            key={d}
            className={`chevron chevron-${d}`}
            aria-label={`Go ${d}`}
            onClick={() => move(d)}
          >
            {CHEVRON[d]}
          </button>
        ) : null,
      )}

      {layers > 1 && (
        <div className="layer-pill" data-testid="layer-pill">
          Layer {view.pos.z + 1} of {layers}
        </div>
      )}

      <div className="present-chrome">
        <button onClick={() => setOverview(true)} title="3D overview (M)">
          Overview
        </button>
        <button onClick={exit} title="Exit (Esc)">
          Exit
        </button>
      </div>

      {overview && current && (
        <Overview3D
          deck={deck}
          pos={view.pos}
          onPick={(p) => {
            setOverview(false);
            if (!samePos(p, view.pos)) go(p, null);
          }}
          onClose={() => setOverview(false)}
        />
      )}
    </div>
  );
}
