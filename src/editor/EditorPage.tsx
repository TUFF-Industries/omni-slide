import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { filesFromDrop, hasFiles, IMPORT_ACCEPT, importFiles, type Progress } from '../import';
import {
  insertColumn,
  insertRow,
  key,
  layerCount,
  moveSlide,
  neighbor,
  posOf,
  removeSlide,
  samePos,
  setStart,
  step,
} from '../model/grid';
import {
  canRedo,
  canUndo,
  createHistory,
  record,
  redo,
  seal,
  snapshots,
  undo,
  type History,
} from '../model/history';
import type { Deck, Dir, Pos, SlideId } from '../model/types';
import { startPresenting } from '../present/start';
import { emptyTrash, syncAssets } from '../storage/assetTrash';
import { getDeck, saveDeck } from '../storage/db';
import { download, exportDeck, safeFilename } from '../storage/file';
import ImportProgress from '../ui/ImportProgress';
import GridCanvas from './GridCanvas';

const ARROWS: Record<string, Dir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};
/** Same keys as present mode: Z goes in (a layer deeper), X comes back out. */
const DEPTH_KEYS: Record<string, Dir> = { z: 'in', x: 'out' };

const ZOOM_KEY = 'omni.cellWidth';

const MOD = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl+';

function loadZoom(): number {
  try {
    return Number(localStorage.getItem(ZOOM_KEY)) || 220;
  } catch {
    return 220;
  }
}

export default function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  // The deck being edited is always history.present; every change goes through update().
  const [history, setHistory] = useState<History<Deck> | null | undefined>(undefined);
  const [selected, setSelected] = useState<SlideId | null>(null);
  // Layer shown when nothing is selected; with a selection the view follows the selected slide.
  const [layer, setLayer] = useState(0);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cellWidth, setCellWidth] = useState(loadZoom);
  const [dragOver, setDragOver] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);
  const historyRef = useRef<History<Deck> | null>(null);
  const deck = history === undefined ? undefined : (history?.present ?? null);

  useEffect(() => {
    getDeck(id!).then((d) => {
      const h = d ? createHistory(d) : null;
      historyRef.current = h;
      setHistory(h);
    });
    // Leaving the editor ends undo history, so deleted slides' images can go for good.
    return () => {
      emptyTrash();
    };
  }, [id]);

  useEffect(() => {
    try {
      localStorage.setItem(ZOOM_KEY, String(cellWidth));
    } catch {
      /* per-viewer convenience only */
    }
  }, [cellWidth]);

  /** Switch to a new history state, persisting the deck and its assets if the deck changed. */
  const update = useCallback((h: History<Deck>, save = true) => {
    const prev = historyRef.current;
    historyRef.current = h;
    setHistory(h);
    if (!prev || prev.present === h.present) return;
    if (save) saveDeck(h.present);
    syncAssets(prev.present, h.present);
    // Drop images of deleted slides that no remaining undo/redo step can bring back.
    emptyTrash(snapshots(h));
  }, []);

  /** Record a change. Changes sharing a `tag` in a row (e.g. typing the name) undo as one. */
  const commit = useCallback(
    (next: Deck, tag: string | null = null) => {
      const h = historyRef.current;
      if (h) update(record(h, next, tag));
    },
    [update],
  );

  const busy = progress !== null;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const undoLast = useCallback(() => {
    if (historyRef.current && !busy) update(undo(historyRef.current));
  }, [update, busy]);
  const redoNext = useCallback(() => {
    if (historyRef.current && !busy) update(redo(historyRef.current));
  }, [update, busy]);

  const selPos: Pos | null = deck && selected ? posOf(deck, selected) : null;
  const layers = deck ? layerCount(deck) : 1;
  const isEmpty = !deck || Object.keys(deck.cells).length === 0;
  // One past the last layer is a new, empty layer (see "+" in the layer tabs).
  const viewLayer = selPos ? selPos.z : isEmpty ? 0 : Math.min(layer, layers);

  /** Change the selection; when clearing it, stay on the layer that was being shown. */
  const select = useCallback((id: SlideId | null, from: Pos | null) => {
    if (!id && from) setLayer(from.z);
    setSelected(id);
  }, []);

  const showLayer = (z: number) => {
    setSelected(null);
    setLayer(z);
  };

  const remove = useCallback(
    (p: Pos) => {
      const d = historyRef.current?.present;
      if (!d) return;
      commit(removeSlide(d, p));
      select(null, p);
    },
    [commit, select],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const d = historyRef.current?.present;
      // While importing, the import saves the deck itself as it goes; an edit made now would be
      // overwritten by its next save.
      if (!d || busyRef.current) return;
      const target = e.target as HTMLElement;
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (k === 'z' || k === 'y')) {
        // In the name field, leave it to the browser's own text undo.
        if (target.closest('textarea, input:not([type="range"])')) return;
        e.preventDefault();
        if (k === 'y' || e.shiftKey) redoNext();
        else undoLast();
        return;
      }
      if (target.closest('input, textarea')) return;
      const p = selected ? posOf(d, selected) : null;
      const dir = ARROWS[e.key];
      const depth = e.metaKey || e.ctrlKey || e.altKey ? undefined : DEPTH_KEYS[k];
      if (dir) {
        e.preventDefault();
        if (!p) {
          setSelected(d.cells[key(d.start)] ?? null);
        } else if (e.shiftKey) {
          commit(moveSlide(d, p, step(p, dir)));
        } else {
          const n = neighbor(d, p, dir);
          if (n) setSelected(d.cells[key(n)]);
        }
      } else if (depth) {
        e.preventDefault();
        if (!p) {
          // Nothing selected: flip through the layers.
          setLayer((l) => Math.max(0, Math.min(layerCount(d) - 1, l + (depth === 'in' ? 1 : -1))));
        } else if (e.shiftKey) {
          // Push the slide one layer deeper / pull it one closer (swapping with any slide there).
          commit(moveSlide(d, p, step(p, depth)));
        } else {
          const n = neighbor(d, p, depth);
          if (n) setSelected(d.cells[key(n)]);
        }
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && p) {
        e.preventDefault();
        remove(p);
      } else if (e.key === 'Enter' && p) {
        startPresenting(navigate, d.id, p);
      } else if (e.key === 'Escape') {
        select(null, p);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, commit, remove, navigate, undoLast, redoNext, select]);

  async function addFiles(files: File[]) {
    const h = historyRef.current;
    if (!h || files.length === 0) return;
    setError(null);
    // importFiles saves the deck itself as slides arrive; show each save, and undo the whole
    // import as one step (same tag).
    const tag = `import:${Date.now()}`;
    const show = (d: Deck) => update(record(historyRef.current ?? h, d, tag), false);
    try {
      show(
        await importFiles(h.present, files, {
          onProgress: setProgress,
          onSaved: show,
          layer: viewLayer,
        }),
      );
    } catch (e) {
      setError(`Could not import: ${(e as Error).message}`);
      // Whatever was imported before the failure is already saved; pick up the latest copy so the
      // next edit doesn't save over it.
      const saved = await getDeck(h.present.id);
      if (saved && saved.updatedAt !== historyRef.current?.present.updatedAt) show(saved);
    } finally {
      setProgress(null);
    }
  }

  if (deck === undefined) return <div className="loading">Loading…</div>;
  if (deck === null)
    return (
      <div className="loading">
        Deck not found. <Link to="/">Back to decks</Link>
      </div>
    );

  return (
    <div
      className={`editor ${dragOver ? 'drag-over' : ''}`}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        addFiles(filesFromDrop(e));
      }}
    >
      <header className="topbar">
        <Link to="/" className="back" aria-label="All decks">
          ←
        </Link>
        <input
          className="deck-title"
          aria-label="Deck name"
          value={deck.name}
          onChange={(e) => commit({ ...deck, name: e.target.value }, 'name')}
          onBlur={() => historyRef.current && update(seal(historyRef.current))}
        />
        <div className="spacer" />
        <div className="undo-redo">
          <button
            aria-label="Undo"
            title={`Undo (${MOD}Z)`}
            disabled={busy || !history || !canUndo(history)}
            onClick={undoLast}
          >
            ↶
          </button>
          <button
            aria-label="Redo"
            title={`Redo (${MOD}Shift+Z)`}
            disabled={busy || !history || !canRedo(history)}
            onClick={redoNext}
          >
            ↷
          </button>
        </div>
        <label className="zoom">
          <span className="muted small">Zoom</span>
          <input
            type="range"
            min={100}
            max={480}
            step={10}
            value={cellWidth}
            onChange={(e) => setCellWidth(Number(e.target.value))}
          />
        </label>
        <button onClick={() => importInput.current?.click()}>Import PDF / PPTX</button>
        <button
          onClick={async () => download(await exportDeck(deck), `${safeFilename(deck.name)}.omni`)}
        >
          Export
        </button>
        <button
          className="primary"
          disabled={isEmpty}
          onClick={() => startPresenting(navigate, deck.id)}
        >
          ▶ Present
        </button>
        <input
          ref={importInput}
          type="file"
          accept={IMPORT_ACCEPT}
          multiple
          hidden
          data-testid="import-input"
          onChange={(e) => {
            const fs = Array.from(e.target.files ?? []);
            e.target.value = '';
            addFiles(fs);
          }}
        />
      </header>

      <div className="toolbar" aria-label="Slide actions">
        {!isEmpty && (
          <div className="layer-tabs" role="tablist" aria-label="Layers">
            <span className="muted small">Layer</span>
            {Array.from({ length: Math.max(layers, viewLayer + 1) }, (_, z) => (
              <button
                key={z}
                role="tab"
                aria-selected={z === viewLayer}
                className={z >= layers ? 'new-layer' : undefined}
                title={z === 0 ? 'Front layer' : `Layer ${z + 1}: behind layer ${z}`}
                onClick={() => showLayer(z)}
              >
                {z + 1}
              </button>
            ))}
            {viewLayer < layers && (
              <button
                aria-label="New layer"
                title="Add a layer behind. Import into it, or move slides there with Shift+Z."
                onClick={() => showLayer(layers)}
              >
                +
              </button>
            )}
          </div>
        )}
        {selPos ? (
          <>
            <button
              disabled={samePos(selPos, deck.start)}
              onClick={() => commit(setStart(deck, selPos))}
            >
              Set as start
            </button>
            <button onClick={() => startPresenting(navigate, deck.id, selPos)}>
              Present from here
            </button>
            <span className="sep" />
            <button onClick={() => commit(insertRow(deck, selPos.y))}>+ Row above</button>
            <button onClick={() => commit(insertRow(deck, selPos.y + 1))}>+ Row below</button>
            <button onClick={() => commit(insertColumn(deck, selPos.x))}>+ Column left</button>
            <button onClick={() => commit(insertColumn(deck, selPos.x + 1))}>+ Column right</button>
            <span className="sep" />
            <button
              title="Move this slide one layer deeper (Shift+Z)"
              onClick={() => commit(moveSlide(deck, selPos, step(selPos, 'in')))}
            >
              Move behind
            </button>
            <button
              title="Move this slide one layer closer (Shift+X)"
              onClick={() => commit(moveSlide(deck, selPos, step(selPos, 'out')))}
            >
              Move in front
            </button>
            <span className="sep" />
            <button className="danger" onClick={() => remove(selPos)}>
              Delete
            </button>
          </>
        ) : (
          <span className="muted small">
            Drag slides to arrange them. ← → move along a row, ↑ ↓ along a column, Z / X in and out
            of layers. Select a slide for more options; Shift + arrows (or Shift + Z / X) moves it.
          </span>
        )}
      </div>

      {error && <div className="error">{error}</div>}

      <main className="canvas">
        {isEmpty ? (
          <div className="empty-state">
            <h2>No slides yet</h2>
            <p className="muted">
              Drop a PDF or PowerPoint (.pptx) here, or import one. Each page becomes a slide.
            </p>
            <button className="primary" onClick={() => importInput.current?.click()}>
              Import PDF / PPTX
            </button>
          </div>
        ) : (
          <GridCanvas
            deck={deck}
            layer={viewLayer}
            cellWidth={cellWidth}
            selected={selected}
            onSelect={(id) => select(id, selPos)}
            onMove={(from, to) => commit(moveSlide(deck, from, to))}
            onOpen={(p) => startPresenting(navigate, deck.id, p)}
          />
        )}
      </main>
      <ImportProgress progress={progress} />
    </div>
  );
}
