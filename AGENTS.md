# AGENTS.md

Guide for AI coding agents (and humans) working on Omni Slide. More than one agent works on this
repo, so keep changes focused and go through PRs.

## What this is

A static web app (to be hosted at omni.salken.dev) for presentations navigable in four directions.
Slides sit on a 2D grid: in present mode ← → move along a row, ↑ ↓ move along a column. Moving
toward an empty cell does nothing.

Roadmap:

1. **Done:** PDF import, arrange on grid, present mode, `.omni` export/import, undo/redo.
2. **Done:** PPTX import (rendered to image slides).
3. **Next:** native slide editor (text/images/shapes).

No backend. All data lives in the browser (IndexedDB). Production is a Cloudflare static-assets
Worker on omni.salken.dev (`wrangler.jsonc`, `npm run deploy`).

## Commands

```sh
npm install
npm run dev      # Vite dev server
npm test         # vitest unit tests (src/**/*.test.ts)
npm run e2e      # Playwright; builds and serves on :4173 itself
npm run lint     # eslint
npx tsc -b       # typecheck (also part of npm run build)
npm run format   # prettier
npm run build    # static output in dist/
npm run deploy   # build + wrangler deploy to omni.salken.dev (needs `wrangler login`)
```

Before pushing, run: `npx tsc -b && npm run lint && npm test && npm run e2e`. Run `npm run format`
on changed files.

## Stack

React 19, Vite 8, TypeScript 5.9, react-router (HashRouter), `idb`, `fflate`, `pdfjs-dist`,
`pptxtojson` (parses .pptx). Playwright + `pdf-lib` / `pptxgenjs` (generate test files) for e2e.

## Layout

```
src/model/types.ts    Deck / Slide / Pos types
src/model/grid.ts     Pure grid logic: neighbor, moveSlide (swaps), insertRow/Column,
                      removeSlide, appendRow, normalize, setStart, posOf. Unit-tested.
src/model/history.ts  Generic pure undo/redo stack (record/undo/redo, tag-based merging). Unit-tested.
src/storage/db.ts     IndexedDB: `decks` store (Deck JSON) and `assets` store (image Blobs)
src/storage/assetUrl.ts  Cached object URLs for assets + useAssetUrl hook
src/storage/assetTrash.ts  syncAssets(prev, next): deletes/restores assets as slides leave/return
src/storage/file.ts   .omni export/import (zip: deck.json + assets/<assetId>)
src/import/index.ts   importFiles(): one new row per PDF/PPTX; lazy-loads pdf.ts / pptx.ts
src/import/pdf.ts     pdf.js renders pages to WebP/PNG (~1920px long edge)
src/import/pptx.ts    pptxtojson parses slides; each is laid out as HTML and rasterized
src/import/pptxHtml.ts  Pure slide JSON → HTML (in pt). Unit-tested. pptxChart.ts draws charts.
src/import/raster.ts  Shared canvas encoding + HTML→image via SVG foreignObject
src/home/             Deck list
src/editor/           Grid editor (GridCanvas does pointer-based drag & drop)
src/present/          Present mode, Minimap, startPresenting() helper
src/ui/               Shared components (SlideImage, ImportProgress)
src/styles.css        All styles, one global sheet, CSS variables on :root
e2e/basic.spec.ts     End-to-end flow
e2e/pptx.spec.ts      PPTX import (checks rendered pixels)
public/_headers       Production security headers (CSP); applied by Cloudflare, not vite preview
```

## Data model rules

- `Deck.cells` maps `"x,y"` → slide id; `Deck.slides` maps id → `Slide`. Image bytes are **not** in
  the deck, they're in the `assets` store keyed by `slide.assetId`.
- Grid functions are pure and return a new Deck. Mutating functions call `normalize()`, which
  shifts coordinates so the top-left occupied cell is (0,0) and keeps `start` on a real slide.
  Because coordinates can shift, the editor tracks selection by **slide id**, not position. Do the
  same for any new per-slide UI state.
- `Slide` is a union on `kind` (currently only `'image'`). Add new slide types (PPTX, native) as new
  union members rather than changing `image`. Anything that renders slides (`SlideImage`, present
  mode, thumbnails) must handle every kind.
- `.omni` has a `version` field (currently 1). Changing the deck shape in an incompatible way means
  bumping it and migrating older files in `importDeckFile`. IndexedDB schema changes go through the
  `openDB` upgrade callback with a version bump.
- Deleting a slide must also delete its asset. In the editor this is automatic: every deck change
  goes through `commit()` (→ undo history → `syncAssets`), which deletes assets of slides that
  disappeared from IndexedDB right away but keeps the blob in memory so undo can put it back.
  Don't call `deleteAsset` yourself there, or undo will restore a slide with no image. Outside the
  editor, call `deleteAsset` + `forgetAsset`.
- In the editor, never set deck state directly: use `commit(next)` so the change is undoable. Pass
  a tag (`commit(next, 'name')`) for rapid-fire edits that should undo as one step.

## Gotchas (learned the hard way)

- **Use pdf.js's legacy build** (`pdfjs-dist/legacy/build/...`). The modern build relies on
  `Map.prototype.getOrInsertComputed`, which many browsers lack, and import silently fails.
- **Global CSS class collisions:** grid cells use `.cell.empty` / `.cell.filled`; the empty-state
  panel is `.empty-state`. Don't add bare generic class names (`.empty`, `.active`, …) at top level,
  scope them to their component class.
- Routing is hash-based and Vite `base` is `'./'` so `dist/` works on any static host. Reference
  public files via `import.meta.env.BASE_URL`, not `/`.
- Fullscreen must be requested inside a user gesture, so go through `startPresenting()` instead of
  navigating to the present route directly.
- TypeScript is pinned to 5.9 because `typescript-eslint` doesn't support TS 6+/7 yet.
- E2E uses `/opt/pw-browsers/chromium` if present (cloud containers), else `PW_CHROMIUM_PATH`,
  else Playwright's own download. Don't run `playwright install` in the cloud container. On a Mac
  with Chrome, point `PW_CHROMIUM_PATH` at `Google Chrome.app/Contents/MacOS/Google Chrome` to run
  e2e without downloading a browser.
- Each Playwright browser context has its own IndexedDB, so tests don't share decks.
- **PPTX rendering** draws HTML through an SVG `<foreignObject>` image. That sandbox can't load
  anything external, so every image in the markup must be a data URL (pptxtojson's
  `imageMode: 'base64'`), and markup must be XHTML (see `toXhtml` in `pptx.ts`). Only fonts
  installed on the user's machine are available; `fontStack()` adds fallbacks.
- Import `pptxtojson` by package name (Vite picks its ESM build). In plain Node its `main` is a UMD
  file, so scripts need `pptxtojson/dist/index.js`.
- The CSP in `public/_headers` only applies on Cloudflare. To e2e-test with it, run
  `npm run build && npx wrangler dev --port 8799` and `E2E_BASE_URL=http://localhost:8799 npm run e2e`.
  A new feature that loads from another origin, uses `eval`, or inline scripts needs a CSP change.

## Conventions

- Match the existing style: function components, small modules, plain CSS, no UI library.
- Keep grid logic in `src/model/grid.ts`, pure and covered by `grid.test.ts`. UI shouldn't
  manipulate `cells` directly.
- New user-facing flows get a Playwright test. Prefer `data-testid` / roles / `data-*` attributes
  (`data-cell`, `data-slide`, `data-source`) over CSS-class selectors.
- Keep heavy dependencies lazy-loaded (see how `importFiles` dynamically imports `pdf.ts`).
- Prettier: single quotes, 100 cols.

## Working alongside other agents

- Work on your own branch and open a PR. Don't push to `main` or to someone else's branch.
- Pull `main` before starting; it moves.
- Keep PRs to one feature. If you touch shared foundations (`types.ts`, `grid.ts`, `db.ts`, the
  `.omni` format), say so clearly in the PR description since other work depends on them.
- Update this file when you learn something the next agent would trip over.
