# AGENTS.md

## Cursor Cloud specific instructions

This repo is a single full-stack product (**Система учёта автомобильных взвешиваний** / Vehicle Weighing System): a React + Vite frontend (`src/`) talking to a Flask API (`server/app.py`) that persists to SQLite (`BD/weighing.db`) and `config.ini`. Standard commands live in `README.md` (`## Установка` / `## Запуск`) and `package.json` scripts; the notes below only cover non-obvious setup caveats.

### Python environment
- Python dependencies are installed into a virtualenv at `~/.venv`, which is auto-activated in interactive shells via `~/.bashrc`. The npm scripts `dev:api` and `start` invoke a bare `python` (not `python3`), which only resolves once this venv is active — so run backend/test commands from a login shell (`bash -lc '...'`) or after `source ~/.venv/bin/activate`.
- The update script recreates `~/.venv` and reinstalls `server/requirements.txt` + `server/requirements-dev.txt`. `python3-venv` (apt) is required to create the venv and is baked into the VM snapshot.
- `fdb` and `pypxlib` install fine but are only used for the optional Vescom/Metra/WA import integrations, which need external Firebird/Paradox databases and are not exercised here.

### Running the app (development)
- Two processes are needed. Backend: `OPEN_BROWSER=0 npm run dev:api` (Flask on `http://127.0.0.1:5001`). Frontend: `npm run dev` (Vite on `http://localhost:5173`, proxies `/api` → `:5001`). Use `http://localhost:5173` for the UI in dev.
- In dev the Flask log says `Frontend not found at .../dist — API-only mode`. This is expected and fine: Vite serves the UI, Flask only serves `/api`. Only run `npm run build` first if you want Flask itself to serve the UI at `:5001`.
- Default login: `admin` / `admin123`.
- Persisted data (`config.ini`, `BD/`) is git-ignored and stored at the repo root.

### Tests, lint, build
- Frontend tests: `npm test` (Vitest). Backend tests: `npm run test:server` (pytest, uses Flask test client + temp dirs — no running server needed). Lint: `npm run lint`; types: `npm run typecheck`.
- `npm run lint` currently reports pre-existing errors in `src/` (unrelated to environment setup); do not treat these as environment breakage.

### Manual GUI testing gotcha
- Weighing form free-text fields (vehicle, driver, cargo, shipper/receiver/carrier) accept Latin input; the vehicle plate is auto-normalized to Cyrillic on save. When driving the UI programmatically, prefer Latin text to avoid flaky Cyrillic keyboard input.
