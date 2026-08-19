create type ai_run_status as enum ('running','success','error');
create table ai_runs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  type text not null, sku_id uuid references skus(id) on delete set null, model text not null,
  input_json jsonb not null, output_json jsonb, status ai_run_status not null default 'running',
  latency_ms integer, error text, input_tokens integer, output_tokens integer,
  adopted boolean, created_at timestamptz not null default now()
);
create table ai_analyses (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  sku_id uuid references skus(id) on delete cascade, ai_run_id uuid not null references ai_runs(id) on delete cascade,
  analysis_type text not null, result jsonb not null, adopted boolean, created_at timestamptz not null default now()
);
create index ai_runs_user_created_idx on ai_runs(user_id,created_at desc);
create index ai_analyses_sku_created_idx on ai_analyses(sku_id,created_at desc);
alter table ai_runs enable row level security; alter table ai_analyses enable row level security;
create policy "own ai runs" on ai_runs for all using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "own ai analyses" on ai_analyses for all using(user_id=auth.uid()) with check(user_id=auth.uid());
