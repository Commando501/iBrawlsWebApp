# iBrawls Desktop Build (single-player vs AI)

Lets friends play **single-player vs the AI** without cloning the repo. The app is
packaged as a standalone Windows folder containing `iBrawls.exe`. Single-player is
100% client-side, so no server, account, or internet connection is required.

## How it works

`electron/main.cjs` starts a tiny localhost-only static server that serves the
built `dist/` and points an Electron window at it. We serve over `http://127.0.0.1`
(not `file://`) because the client fetches absolute-path assets at runtime — the
service worker, neural-net weights (`brains/*.bin`), audio, and the PWA manifest.

## Build it

```bash
npm install        # first time only (installs electron + packager)
npm run app:pack   # cleans, builds the client, and packages the app
```

Output: `release/iBrawls-win32-x64/`. The `app:pack` script runs `npm run clean`
first on purpose — `vite.config.ts` uses `emptyOutDir: false`, so without a clean
the content-hashed bundles in `dist/assets` pile up across builds (this once grew
to ~700 MB of stale files). A clean build's `dist` is only ~50 MB.

## Share it with friends

1. Zip the `release/iBrawls-win32-x64/` folder (or run the command below).
2. Send the zip (~120 MB) via Google Drive / Discord / etc.
3. Friend unzips anywhere and double-clicks **`iBrawls.exe`**.

```powershell
Compress-Archive -Path release\iBrawls-win32-x64\* -DestinationPath release\iBrawls-win64.zip -Force
```

### Windows SmartScreen note

The build is **unsigned**, so on first launch Windows may show a blue
"Windows protected your PC" dialog. Friends click **More info → Run anyway**.
(Signing requires a paid code-signing certificate — not worth it for a test build.)

## Optional: a real installer instead of a folder

`npm run app:dist` uses electron-builder to produce an NSIS installer + portable
exe. On Windows it needs to extract a code-signing toolkit whose archive contains
symlinks, which fails unless you **enable Windows Developer Mode** (Settings →
Privacy & security → For developers) or run the terminal as Administrator. The
`app:pack` folder route above avoids this entirely and is the recommended path.

## macOS / Linux friends

Change the `--platform`/`--arch` in `scripts/pack-desktop.mjs` (or run
electron-packager for `darwin`/`linux`). Building macOS apps that run without
Gatekeeper warnings additionally requires signing/notarization.
