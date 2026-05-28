## Learned User Preferences

- Do not edit attached implementation plan files when executing assigned PR todos from the AI advancement roadmap.
- Keep README.md in parity with the codebase when features are added, changed, or removed.
- Local dev server runs on port 3000 (`npm run dev` / `server.ts`), not port 5000.
- On Windows PowerShell, chain shell commands with `;` rather than `&&`.

## Learned Workspace Facts

- iBrawls is a React/Vite/Three.js browser game with a local Node/WebSocket relay and a Cloudflare Worker Durable Object relay for deployment.
- Combat AI is orchestrated from `GrifballGame.tsx` (FSM states including `PRESSURING`); pure decision logic lives in `src/game/` modules such as `aiCombatDecision.ts`, `aiTuning.ts`, `aiMatchContext.ts`, `aiPlayerModel.ts`, and `aiPressure.ts`.
- Per-match AI memory resets when `aiMatchSessionKey` changes (sandbox or tournament round), via `resetAIMatchContext`.
- Fresh tournament setup exposes sliders for bracket round count (default 3) and kills-to-win (default 25).
- Windows builds may hit `EPERM` locks on stale `dist/assets`; Vite uses `emptyOutDir: false`—run `npm run clean` when files are locked.
- AI advancement work follows the modular PR roadmap described in `ai_advancement_proposal.md`.
- CodeGraph MCP is configured for structural code intelligence queries in this repo.
