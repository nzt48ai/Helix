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

### Supabase Auth scaffold (Profile tab gate)

Profile authentication uses Supabase Auth endpoints from the frontend. Add these frontend variables in your Vite environment:

```bash
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-supabase-anon-key>
```

Without these variables, the app still runs in local-first mode, but Profile login is disabled and the locked state explains how to enable it.

### Supabase Profile sync (logged-in Profile tab only)

This pass syncs **Profile-only** settings for logged-in users. All non-Profile domains (trades, insights, calendar, replay, etc.) remain local-only.

Create this table in Supabase SQL editor:

```sql
create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  profile_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create or replace function public.set_user_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_user_profiles_updated_at on public.user_profiles;
create trigger trg_user_profiles_updated_at
before update on public.user_profiles
for each row execute function public.set_user_profiles_updated_at();

alter table public.user_profiles enable row level security;

drop policy if exists "user_profiles_select_own" on public.user_profiles;
create policy "user_profiles_select_own"
on public.user_profiles for select
using (auth.uid() = user_id);

drop policy if exists "user_profiles_insert_own" on public.user_profiles;
create policy "user_profiles_insert_own"
on public.user_profiles for insert
with check (auth.uid() = user_id);

drop policy if exists "user_profiles_update_own" on public.user_profiles;
create policy "user_profiles_update_own"
on public.user_profiles for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

The app stores one row per user (`user_profiles.user_id`) and writes sanitized profile JSON into `profile_data` so the existing local profile shape can be reused with minimal changes.

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
