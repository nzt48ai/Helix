# Helix

Helix is a single-page trading helper app with five tabs: **Position**, **Compound**, **Share**, **Dashboard**, and **Journal**. It lets you model risk/reward and compounding scenarios, then persists your current inputs in the browser.

## Install

```bash
npm install
```

Create a local env file before running the app:

```bash
cp .env.example .env.local
```

## Run locally

```bash
npm run dev
```

Then open the local Vite URL shown in the terminal (usually `http://localhost:5173`).

### Tradovate OAuth backend (required for Prop → Connect Tradovate)

Tradovate OAuth secrets are handled server-side only. Start the backend in a second terminal:

```bash
npm run dev:tradovate-server
```

Required environment variables for the backend:

```bash
TRADOVATE_CLIENT_ID=...
TRADOVATE_CLIENT_SECRET=...
```

Optional environment variables:

```bash
# Frontend origin allowed by backend CORS and OAuth callback return.
HELIX_FRONTEND_ORIGIN=http://localhost:5173
# Backend listen port.
TRADOVATE_SERVER_PORT=8787
# Backend OAuth callback URI registered with Tradovate.
TRADOVATE_REDIRECT_URI=http://localhost:8787/api/tradovate/oauth/callback
# Tradovate endpoints (override for different environments if needed).
TRADOVATE_AUTH_URL=https://trader.tradovate.com/oauth
TRADOVATE_TOKEN_URL=https://live-api-d.tradovate.com/auth/oauthtoken
TRADOVATE_API_BASE_URL=https://live-api-d.tradovate.com/v1
```

Optional frontend environment variable:

```bash
VITE_TRADOVATE_BACKEND_URL=http://localhost:8787
```

Backend route scaffold implemented:

- `POST /api/tradovate/connect/start`
- `GET /api/tradovate/oauth/callback`
- `GET /api/tradovate/accounts`
- `POST /api/tradovate/disconnect`

## Build for static deployment

```bash
npm run build
```

The production-ready static output is generated in `dist/` and can be deployed to any static host.

## GitHub Pages deployment

This repository includes an automated GitHub Actions workflow at `.github/workflows/deploy-pages.yml`.

- It runs on every merge/push to `main` (and can also be run manually via **workflow_dispatch**).
- The workflow installs dependencies, runs `npm test`, builds with `npm run build`, and deploys `dist/` to GitHub Pages.
- Vite base path is resolved automatically for GitHub Pages:
  - User/organization site repository (`username.github.io`) → `/`
  - Project repository (`repo-name`) → `/repo-name/`

### Deployment URL pattern

- User/organization site repo: `https://<owner>.github.io/`
- Project repo: `https://<owner>.github.io/<repo-name>/`

For this repo name (`Helix`), the project-site URL pattern is:

`https://<owner>.github.io/Helix/`

## State persistence

The app saves state to browser `localStorage` under the key `helix.app.state.v1` and restores it on reload. The Journal "Reset preferences" action clears this persisted state and reverts to defaults.

## Known limitations

- **Dashboard data is heuristic**: range metrics are modeled from current inputs, not historical executed trades.
- **Journal data is synthetic**: entries are generated from current Position + Compound state and projection assumptions, not a persisted trade log.
- **Share view data is snapshot-based**: it reflects current in-memory/persisted inputs rather than server-backed history.
