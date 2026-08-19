alter table sourcing_runs
  add column if not exists keywords jsonb not null default '[]'::jsonb,
  add column if not exists pages_fetched integer not null default 0,
  add column if not exists unique_count integer not null default 0,
  add column if not exists eligible_count integer not null default 0,
  add column if not exists cluster_count integer not null default 0,
  add column if not exists collection_stats jsonb not null default '{}'::jsonb;
