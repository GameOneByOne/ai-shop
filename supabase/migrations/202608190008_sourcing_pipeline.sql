create table sourcing_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  query text not null,
  status text not null default 'running' check (status in ('running','completed','failed')),
  criteria jsonb not null default '{}'::jsonb,
  fetched_count integer not null default 0,
  shortlisted_count integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table source_products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sourcing_run_id uuid not null references sourcing_runs(id) on delete cascade,
  provider text not null,
  external_id text,
  source_url text not null,
  title text not null,
  supplier_name text,
  image_url text,
  price_min numeric(12,2),
  price_max numeric(12,2),
  minimum_order_quantity integer,
  sales_hint text,
  location text,
  raw_data jsonb not null default '{}'::jsonb,
  rough_score numeric(5,2) not null default 0,
  rough_reasons jsonb not null default '[]'::jsonb,
  rejected_reasons jsonb not null default '[]'::jsonb,
  ai_score numeric(5,2),
  ai_rank integer,
  ai_reason text,
  ai_risks jsonb not null default '[]'::jsonb,
  selected boolean not null default false,
  candidate_product_id uuid references candidate_products(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(user_id,provider,source_url)
);

create index sourcing_runs_user_created_idx on sourcing_runs(user_id,created_at desc);
create index source_products_run_score_idx on source_products(sourcing_run_id,rough_score desc);
alter table sourcing_runs enable row level security;
alter table source_products enable row level security;
create policy "own sourcing runs" on sourcing_runs for all using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "own source products" on source_products for all using(user_id=auth.uid()) with check(user_id=auth.uid());
