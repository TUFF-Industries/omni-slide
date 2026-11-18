import { appendRow } from '../model/grid';
import type { Deck, Slide } from '../model/types';
import { saveDeck } from '../storage/db';

export interface Progress {
  file: string;
  /** 1-based index of the page/slide being rendered; 0 while the file is still being read. */
  page: number;
  pages: number;
  unit: 'Page' | 'Slide';
}

/** File picker `accept` value for everything importFiles understands. */
export const IMPORT_ACCEPT =
  'application/pdf,.pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,.pptx';

export function isPdf(f: File): boolean {
  return f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
}

export function isPptx(f: File): boolean {
  return (
    f.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    f.name.toLowerCase().endsWith('.pptx')
  );
}

export function isImportable(f: File): boolean {
  return isPdf(f) || isPptx(f);
}

/** File name without its .pdf/.pptx extension, e.g. for naming a new deck. */
export function baseName(name: string): string {
  return name.replace(/\.(pdf|pptx)$/i, '');
}

/**
 * Throw a readable error for formats people commonly try that we can't read, so a drop doesn't
 * silently do nothing.
 */
export function checkUnsupported(files: File[]): void {
  const old = files.find((f) => /\.(ppt|pps|key|odp)$/i.test(f.name));
  if (old) {
    throw new Error(
      `${old.name} isn't supported. Save it as .pptx or PDF from PowerPoint, Keynote or LibreOffice first.`,
    );
  }
}

/** Receives each imported slide, in order, right after its image is stored. */
export type SlideSink = (slide: Slide) => void | Promise<void>;

/** How many new slides to collect between saves while a file imports. */
export const SAVE_EVERY = 10;

export interface ImportOptions {
  onProgress?: (p: Progress) => void;
  /** Called with the deck each time it's saved during the import, so the UI can show slides early. */
  onSaved?: (deck: Deck) => void;
}

/**
 * Import each PDF/PPTX as its own new row at the bottom of the deck. The deck is saved every
 * SAVE_EVERY slides, so a big file shows up as it imports, and if the import fails (or the tab is
 * closed) the slides done so far are kept rather than lost with their stored images.
 */
export async function importFiles(
  deck: Deck,
  files: File[],
  { onProgress, onSaved }: ImportOptions = {},
): Promise<Deck> {
  const usable = files.filter(isImportable);
  if (usable.length === 0) {
    checkUnsupported(files);
    return deck;
  }
  for (const f of usable) {
    const base = deck;
    const row: Slide[] = [];
    let saved = 0;
    const save = async () => {
      if (row.length === saved) return;
      saved = row.length;
      deck = await saveDeck(appendRow(base, row));
      onSaved?.(deck);
    };
    const onSlide: SlideSink = async (slide) => {
      row.push(slide);
      if (row.length - saved >= SAVE_EVERY) await save();
    };
    try {
      // The PDF and PPTX renderers are large; only load the one a file actually needs.
      if (isPptx(f)) {
        const { importPptx } = await import('./pptx');
        await importPptx(f, onSlide, onProgress);
      } else {
        const { importPdf } = await import('./pdf');
        await importPdf(f, onSlide, onProgress);
      }
    } catch (e) {
      // Keep what was imported. If even that save fails (e.g. storage full), report the original
      // error, which is the one that explains what happened.
      await save().catch(() => {});
      const msg = e instanceof Error ? e.message : String(e);
      const kept = row.length > 0 ? ` (kept the first ${row.length} from ${f.name})` : '';
      throw new Error(msg + kept, { cause: e });
    }
    await save();
  }
  return deck;
}

/** Files from a drop that importFiles might handle (including ones it will explain it can't). */
export function filesFromDrop(e: React.DragEvent): File[] {
  return Array.from(e.dataTransfer.files);
}

export function hasFiles(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes('Files');
}
