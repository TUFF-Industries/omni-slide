export type SlideId = string;

export interface ImageSlide {
  id: SlideId;
  kind: 'image';
  assetId: string;
  width: number;
  height: number;
  /** Where the slide came from, e.g. "talk.pdf p3". */
  source?: string;
}

// Future slide kinds (pptx, native editor) get added to this union.
export type Slide = ImageSlide;

/**
 * A cell in the deck: `x` is the column, `y` the row, `z` the layer (0 = front; higher numbers sit
 * behind, at the same x/y). Moving "in" goes one layer deeper, "out" one layer closer.
 */
export interface Pos {
  x: number;
  y: number;
  z: number;
}

export type CellKey = `${number},${number},${number}`;

export interface Deck {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  slides: Record<SlideId, Slide>;
  cells: Record<CellKey, SlideId>;
  start: Pos;
}

export type Dir = 'up' | 'down' | 'left' | 'right' | 'in' | 'out';
