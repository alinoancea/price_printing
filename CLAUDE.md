# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Electron + React + TypeScript desktop app ("Imprimare Preturi") that syncs a product/barcode list from a central HTTP API into a local SQLite DB and prints price labels to a Zebra printer via ZPL. The app lives in `app/` (the repo root only contains that folder). Not a git repo; no tests or linter are configured.

## Commands (run from `app/`)

- `npm run dev` — runs Vite (port 5173, strict), `tsc --watch` for `electron/`, then launches Electron against the dev server.
- `npm run build` — `vite build` (renderer → `dist/`) + `tsc -p tsconfig.electron.json` (main/preload → `dist-electron/`).
- `npm run dist` — build + `electron-builder` (Windows NSIS installer).
- `npm run dist:publish` — build + publish to GitHub Releases (`alinoancea/price_printing`) using `GH_TOKEN` from `.env`.
- `npm run rebuild:electron` — rebuilds `better-sqlite3` for Electron's ABI; runs automatically on `postinstall`. Re-run if you see native-module version errors.

## Architecture

Three layers, wired through IPC:

- **Main process** (`electron/main.ts`, compiled to `dist-electron/main.js`, the package `main`): creates the window, owns all IPC handlers (`ipcMain.handle('<area>:<action>')`), `electron-store` settings (`apiBaseUrl`, `printerName`, `zebraIp`, `zebraPort`), auto-update via `electron-updater`, and printing. Enforces a single app instance.
- **Preload** (`electron/preload.ts`): exposes `window.api` through `contextBridge`, one thin `ipcRenderer.invoke` wrapper per handler. Typings for the renderer are in `electron/preload.d.ts`. **Adding an IPC call requires touching all three: handler in `main.ts`, wrapper in `preload.ts`, type in `preload.d.ts`.**
- **Renderer** (`src/App.tsx`, single ~1100-line component file, plus `app.css`; Bootstrap 5): UI, label layout, and ZPL generation. It only talks to the main process via `window.api`.

Data flow: `ApiClient` (`electron/api/client.ts`) GETs a JSON array of `{barcode, name, um, price, quantity}` from `apiBaseUrl` (default `http://central/barcodes`) → `BarcodeRepository` (`electron/db/repo.ts`, better-sqlite3, schema in `electron/db/schema.sql`: `barcodes` + single-row `app_meta` holding `last_sync`) → renderer lists/edits/deletes rows via `db:*` IPC.

Printing: the renderer builds ZPL for a 58×35 mm label (203 dpi, `^PW464 ^LL280`; diacritics are stripped because the Zebra doesn't render them). `printers:printZpl` in `main.ts` sends it either to a Windows printer by name (spawns PowerShell that P/Invokes `winspool.drv` for RAW output, trying a few name variants) or, when configured, over TCP to the Zebra IP/port (default 9100).

## Gotchas

- `electron/main.js` and `electron/preload.js` are placeholder stubs next to the `.ts` sources; real output goes to `dist-electron/` (tsc `rootDir: electron`). Edit the `.ts` files only.
- `electron/entry.cjs` is an alternate dev entry that forces `VITE_DEV_SERVER_URL=http://127.0.0.1:5173` and loads `dist-electron/main.js`.
- Auto-update config is in `package.json` `build.publish` and `dev-app-update.yml`. `.env` holds a real `GH_TOKEN` — never print or commit it.
- UI strings and code comments are in Romanian.
