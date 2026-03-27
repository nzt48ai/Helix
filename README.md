# Helix

Helix is a single-page trading helper app with five tabs: **Position**, **Compound**, **Share**, **Dashboard**, and **Journal**. It lets you model risk/reward and compounding scenarios, then persists your current inputs in the browser.

## Install

```bash
npm install
```

## Run locally

```bash
npm run dev
```

Then open the local Vite URL shown in the terminal (usually `http://localhost:5173`).

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
