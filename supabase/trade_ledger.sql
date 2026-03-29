-- Minimal normalized trade ledger table for Helix cloud sync.
-- Apply in Supabase SQL editor for projects that already use `user_profiles`.

create table if not exists public.trade_ledger (
  id text not null,
  user_id uuid not null,
  dedupe_key text not null,
  account_id text,
  source text not null default 'manual',
  import_source text,
  provider_trade_id text,
  symbol text not null,
  side text,
  entry_price double precision,
  exit_price double precision,
  quantity double precision,
  opened_at timestamptz,
  closed_at timestamptz,
  executed_at timestamptz,
  pnl double precision not null default 0,
  commission double precision not null default 0,
  fees double precision not null default 0,
  net_pnl double precision not null default 0,
  trade_type text not null default 'live',
  rule_violation boolean not null default false,
  rule_violation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create unique index if not exists trade_ledger_user_dedupe_idx on public.trade_ledger (user_id, dedupe_key);
create index if not exists trade_ledger_user_updated_idx on public.trade_ledger (user_id, updated_at desc);

alter table public.trade_ledger enable row level security;

create policy if not exists "trade_ledger_select_own"
  on public.trade_ledger
  for select
  using (auth.uid() = user_id);

create policy if not exists "trade_ledger_insert_own"
  on public.trade_ledger
  for insert
  with check (auth.uid() = user_id);

create policy if not exists "trade_ledger_update_own"
  on public.trade_ledger
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
