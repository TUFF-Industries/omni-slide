# Omni Slide

Presentations you can navigate in four directions. Slides sit on a 2D grid: when presenting,
← → move along a row and ↑ ↓ move along a column.

Live at **[omni.salken.dev](https://omni.salken.dev)**.

## Status

Done:

- Import PDFs — each page becomes a slide (rendered in the browser with pdf.js).
- Import PowerPoint (.pptx) — each slide is redrawn in the browser and stored as an image. Text,
  shapes, pictures, tables, groups and common charts (bar, line, area, pie) are supported; fonts
  that aren't installed fall back to similar ones, and video/audio show as a placeholder. Old
  `.ppt` files need saving as `.pptx` first.
- Arrange slides on a grid by dragging (or select + Shift+arrows). Insert rows/columns, delete, set the start slide.
- Undo/redo every edit in the editor (⌘Z / ⌘⇧Z, or Ctrl+Z / Ctrl+Y), including deleted slides.
- Present mode: arrow keys (plus PageUp/PageDown/Space for clickers), swipe on touch, `M` for a minimap, `F` fullscreen, `Home` back to start, `Esc` to exit.
- Everything is stored locally in the browser (IndexedDB). Decks can be exported/imported as `.omni` files (a zip of `deck.json` + images).

Planned: a native slide editor.

## Development

```sh
npm install
npm run dev        # dev server
npm test           # unit tests (vitest)
npm run e2e        # end-to-end tests (playwright)
npm run lint
npm run build      # static site in dist/
```

The e2e tests use the Chromium at `/opt/pw-browsers/chromium` if it exists (or `PW_CHROMIUM_PATH`),
otherwise Playwright's own browser (`npx playwright install chromium`).

## Deploying

`npm run build` produces a fully static site in `dist/` with relative asset paths and hash-based
routing, so it can be served from any static host with no rewrite rules.

Production runs on Cloudflare as a static-assets Worker (`wrangler.jsonc`) on the custom domain
omni.salken.dev. Security headers (CSP etc.) live in `public/_headers`.

```sh
npx wrangler login   # once
npm run deploy       # build + wrangler deploy
E2E_BASE_URL=https://omni.salken.dev npm run e2e   # smoke-test the live site
```

## Layout

```
src/model/      Deck types and pure grid logic (navigation, move/swap, insert, normalize)
src/storage/    IndexedDB access and .omni export/import
src/import/     PDF / PPTX → slide images
src/home/       Deck list
src/editor/     Grid editor
src/present/    Present mode
e2e/            Playwright tests
```
