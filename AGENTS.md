# AGENTS.md

## Cursor Cloud specific instructions

Product: a single web app — **Vehicle Weighing Accounting System** (Система учёта автомобильных взвешиваний). React 18 + TypeScript + Vite frontend (`src/`) and a Python **Flask** backend (`server/app.py`) that persists to a local **SQLite** file (`BD/weighing.db`, auto-created on first write). No external database/service is required; Vescom (Firebird), Metra (Paradox), and РЭО are optional integrations that are disabled by default. The `supabase/` SQL is legacy/unused — the app talks only to the Flask `/api` endpoints.

Standard commands live in `package.json` scripts and `README.md`; use those. Key ones: `npm run dev` (Vite, serves on `localhost:5173`), `npm run dev:api` (Flask API on `:5001`), `npm start` (Flask serves built `dist/` + API on `:5001`), `npm run build`, `npm run lint`, `npm run typecheck`.

Non-obvious caveats:
- The npm scripts invoke `python` (not `python3`). A `python -> python3` symlink is provided in the environment; if `python` is missing, run `sudo ln -sf "$(command -v python3)" /usr/local/bin/python`.
- Dev mode = two processes: start `npm run dev:api` (backend on `:5001`) AND `npm run dev` (Vite on `:5173`). Vite proxies `/api` to `:5001` (see `vite.config.ts`); the UI shows "Backend не отвечает" if the backend is not running.
- Vite binds to `localhost`; probe it via `http://localhost:5173`, not `127.0.0.1:5173`.
- `localStorage` differs per origin, so data entered at `localhost:5173` vs `127.0.0.1:5001` looks separate in the browser, but both sync to the same backend/SQLite via `/api/storage`.
- Default login: `admin` / `admin123`.
- `npm run lint` currently reports pre-existing errors in the repo source (mostly `@typescript-eslint/no-explicit-any`); these are code issues, not environment breakage. `npm run typecheck` passes clean.
- There is no automated test framework configured (no `test` script); end-to-end verification is manual through the running app.
- `npm run build:win` / `build:win:exe` are Windows/PowerShell + Inno Setup only and do not run on this Linux VM.
