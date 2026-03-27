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

## State persistence

The app saves state to browser `localStorage` under the key `helix.app.state.v1` and restores it on reload. The Journal "Reset preferences" action clears this persisted state and reverts to defaults.

## Known limitations

- **Dashboard data is heuristic**: range metrics are modeled from current inputs, not historical executed trades.
- **Journal data is synthetic**: entries are generated from current Position + Compound state and projection assumptions, not a persisted trade log.
- **Share view data is snapshot-based**: it reflects current in-memory/persisted inputs rather than server-backed history.
