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

/** Import each PDF/PPTX as its own new row at the bottom of the deck, saving after every file. */
export async function importFiles(
  deck: Deck,
  files: File[],
  onProgress?: (p: Progress) => void,
): Promise<Deck> {
  const usable = files.filter(isImportable);
  if (usable.length === 0) {
    checkUnsupported(files);
    return deck;
  }
  for (const f of usable) {
    // The PDF and PPTX renderers are large; only load the one a file actually needs.
    let slides: Slide[];
    if (isPptx(f)) {
      const { importPptx } = await import('./pptx');
      slides = await importPptx(f, onProgress);
    } else {
      const { importPdf } = await import('./pdf');
      slides = await importPdf(f, onProgress);
    }
    if (slides.length > 0) deck = await saveDeck(appendRow(deck, slides));
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
