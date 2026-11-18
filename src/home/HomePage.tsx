import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  baseName,
  checkUnsupported,
  filesFromDrop,
  hasFiles,
  IMPORT_ACCEPT,
  importFiles,
  isImportable,
  type Progress,
} from '../import';
import { slideAt } from '../model/grid';
import type { Deck } from '../model/types';
import { startPresenting } from '../present/start';
import { createDeck, deleteDeck, listDecks, saveDeck } from '../storage/db';
import { download, exportDeck, importDeckFile, safeFilename } from '../storage/file';
import ImportProgress from '../ui/ImportProgress';
import SlideImage from '../ui/SlideImage';

export default function HomePage() {
  const navigate = useNavigate();
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const omniInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const refresh = () => listDecks().then(setDecks);
  useEffect(() => {
    refresh();
  }, []);

  async function newDeck() {
    const d = await createDeck('Untitled deck');
    navigate(`/deck/${d.id}`);
  }

  async function newDeckFromFiles(files: File[]) {
    setError(null);
    const usable = files.filter(isImportable);
    if (usable.length === 0) {
      try {
        checkUnsupported(files);
      } catch (e) {
        setError((e as Error).message);
      }
      return;
    }
    let d = await createDeck(baseName(usable[0].name));
    try {
      d = await importFiles(d, files, { onProgress: setProgress });
      navigate(`/deck/${d.id}`);
    } catch (e) {
      setError(`Could not import: ${(e as Error).message}`);
      refresh();
    } finally {
      setProgress(null);
    }
  }

  async function importOmni(file: File) {
    setError(null);
    try {
      await importDeckFile(file);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function rename(d: Deck) {
    const name = prompt('Rename deck', d.name)?.trim();
    if (!name || name === d.name) return;
    await saveDeck({ ...d, name });
    refresh();
  }

  async function remove(d: Deck) {
    if (!confirm(`Delete "${d.name}"? This cannot be undone.`)) return;
    await deleteDeck(d);
    refresh();
  }

  async function exportOne(d: Deck) {
    download(await exportDeck(d), `${safeFilename(d.name)}.omni`);
  }

  return (
    <div
      className={`home ${dragOver ? 'drag-over' : ''}`}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const omni = Array.from(e.dataTransfer.files).find((f) => f.name.endsWith('.omni'));
        if (omni) importOmni(omni);
        else newDeckFromFiles(filesFromDrop(e));
      }}
    >
      <header className="topbar">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={22} height={22} />
          Omni Slide
        </div>
        <div className="spacer" />
        <button onClick={() => omniInput.current?.click()}>Open .omni file</button>
        <button onClick={() => importInput.current?.click()}>New from PDF / PPTX</button>
        <button className="primary" onClick={newDeck}>
          New deck
        </button>
        <input
          ref={omniInput}
          type="file"
          accept=".omni,application/zip"
          hidden
          data-testid="omni-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) importOmni(f);
          }}
        />
        <input
          ref={importInput}
          type="file"
          accept={IMPORT_ACCEPT}
          multiple
          hidden
          data-testid="home-import-input"
          onChange={(e) => {
            const fs = Array.from(e.target.files ?? []);
            e.target.value = '';
            newDeckFromFiles(fs);
          }}
        />
      </header>

      <main className="home-main">
        {error && <div className="error">{error}</div>}
        {decks && decks.length === 0 && (
          <div className="empty-state">
            <h1>Presentations that move in four directions</h1>
            <p className="muted">
              Lay slides out on a grid. When presenting, ← → move along a row and ↑ ↓ move along a
              column. Drop a PDF or PowerPoint (.pptx) anywhere on this page to get started.
            </p>
            <button className="primary" onClick={() => importInput.current?.click()}>
              Import PDF or PPTX
            </button>
          </div>
        )}
        <ul className="deck-list">
          {decks?.map((d) => (
            <li key={d.id} className="deck-card">
              <Link to={`/deck/${d.id}`} className="deck-thumb" aria-label={`Open ${d.name}`}>
                <SlideImage slide={slideAt(d, d.start)} size="thumb" />
              </Link>
              <div className="deck-meta">
                <Link to={`/deck/${d.id}`} className="deck-name">
                  {d.name}
                </Link>
                <div className="muted small">
                  {Object.keys(d.slides).length} slides · {new Date(d.updatedAt).toLocaleString()}
                </div>
              </div>
              <div className="deck-actions">
                <button
                  className="primary"
                  disabled={Object.keys(d.slides).length === 0}
                  onClick={() => startPresenting(navigate, d.id)}
                >
                  Present
                </button>
                <button onClick={() => rename(d)}>Rename</button>
                <button onClick={() => exportOne(d)}>Export</button>
                <button className="danger" onClick={() => remove(d)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </main>
      <ImportProgress progress={progress} />
    </div>
  );
}
