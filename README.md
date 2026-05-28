# iBrawls Web App

iBrawls is a React, Vite, Three.js browser game with a local Node/WebSocket relay for development and a Cloudflare Worker Durable Object relay for deployment.

## Local Development

1. Install root dependencies:
   `npm install`
2. Start the local app and relay:
   `npm run dev`
3. Open `http://localhost:3000`.

The root dev server runs `server.ts`, which hosts Vite in middleware mode and provides the local WebSocket matchmaking/gameplay relay.

## Worker Relay

The Cloudflare Worker implementation lives in `worker/`.

Useful commands:

- `npm run typecheck:worker` from the repo root
- `cd worker && npm run dev`
- `cd worker && npm run deploy`

## Checks

- `npm run lint`: frontend/root TypeScript check
- `npm run typecheck:worker`: Worker TypeScript check
- `npm run typecheck:all`: frontend and Worker checks
- `npm test`: Node test runner for extracted pure TypeScript modules
- `npm run build`: production frontend build plus bundled Node server

## Build Note

This workspace has previously had Windows `EPERM` locks on stale files under `dist\assets`. Vite is configured with `build.emptyOutDir: false` so `npm run build` can still produce a fresh `index.html`, CSS bundle, JS bundle, and server bundle. Run `npm run clean` when no process is holding `dist` files open.
