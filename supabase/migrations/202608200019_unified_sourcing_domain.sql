-- Unified sourcing domain: raw source -> normalized commerce -> business decision.
-- Existing source_products remains the captured 1688 offer repository; these tables
-- add stable identities without overwriting its raw_data payload.

create type public.data_mode as enum ('DEMO', 'REAL');
create type public.source_sku_role as enum ('MAIN_PRODUCT','ACCESSORY','BUNDLE','REPLACEMENT','IRRELEVANT','UNKNOWN');
create type public.source_mapping_role as enum ('PRIMARY','BACKUP');
create type public.price_verification_status as enum ('PRICE_UNVERIFIED','PARTIALLY_VERIFIED','VARIANT_VERIFIED');

create table public.sourcing_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  store_user_id uuid not null references public.store_profiles(user_id) on delete cascade,
  name text not null,
  query text not null,
  status text not null default 'ACTIVE' check (status in ('DRAFT','ACTIVE','COMPLETED','ARCHIVED')),
  strategy_snapshot jsonb not null default '{}'::jsonb,
  data_mode public.data_mode not null default 'REAL',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sourcing_runs
  add column if not exists sourcing_task_id uuid references public.sourcing_tasks(id) on delete set null,
  add column if not exists data_mode public.data_mode not null default 'REAL';

alter table public.source_products
  add column if not exists data_mode public.data_mode not null default 'REAL';

alter table public.suppliers
  add column if not exists external_supplier_key text,
  add column if not exists data_mode public.data_mode not null default 'REAL';
create unique index suppliers_user_external_key_idx on public.suppliers(user_id,external_supplier_key);

create table public.source_offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sourcing_run_id uuid not null references public.sourcing_runs(id) on delete cascade,
  captured_source_product_id uuid not null unique references public.source_products(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  provider text not null default '1688',
  external_offer_id text,
  source_url text not null,
  raw_title text not null,
  raw_attributes jsonb not null default '{}'::jsonb,
  raw_supplier_data jsonb not null default '{}'::jsonb,
  data_mode public.data_mode not null default 'REAL',
  captured_at timestamptz not null default now()
);

create table public.source_skus (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_offer_id uuid not null references public.source_offers(id) on delete cascade,
  external_sku_id text not null,
  raw_name text not null,
  raw_properties jsonb not null default '{}'::jsonb,
  raw_price numeric(12,2),
  raw_image text,
  inventory integer,
  status text not null default 'ACTIVE' check(status in ('ACTIVE','OUT_OF_STOCK','INVALID','UNKNOWN')),
  data_mode public.data_mode not null default 'REAL',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,source_offer_id,external_sku_id)
);

create table public.normalized_source_skus (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_sku_id uuid not null unique references public.source_skus(id) on delete cascade,
  product_family text,
  structure text,
  raw_size text,
  normalized_dimensions jsonb not null default '{}'::jsonb,
  color text,
  material text,
  function text,
  package jsonb not null default '{}'::jsonb,
  quantity numeric,
  role public.source_sku_role not null default 'UNKNOWN',
  normalized_attributes jsonb not null default '{}'::jsonb,
  normalization_status text not null default 'PENDING' check(normalization_status in ('PENDING','RULE_PARSED','AI_REVIEWED','HUMAN_VERIFIED')),
  confidence numeric(5,2),
  ai_analysis_run_id uuid references public.ai_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_models (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sourcing_task_id uuid references public.sourcing_tasks(id) on delete set null,
  name text not null,
  product_family text not null,
  structure text,
  model_attributes jsonb not null default '{}'::jsonb,
  status text not null default 'PROPOSED' check(status in ('PROPOSED','CONFIRMED','REJECTED')),
  data_mode public.data_mode not null default 'REAL',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,sourcing_task_id,name)
);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_model_id uuid not null references public.product_models(id) on delete cascade,
  name text not null,
  attribute_signature text not null,
  normalized_attributes jsonb not null default '{}'::jsonb,
  price_status public.price_verification_status not null default 'PRICE_UNVERIFIED',
  status text not null default 'PROPOSED' check(status in ('PROPOSED','CONFIRMED','INACTIVE')),
  data_mode public.data_mode not null default 'REAL',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,product_model_id,attribute_signature)
);

create table public.cost_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_sku_id uuid not null references public.source_skus(id) on delete cascade,
  sku_price numeric(12,2), one_piece_price numeric(12,2), dropship_price numeric(12,2),
  promotion_price numeric(12,2), new_customer_price numeric(12,2), shipping_cost numeric(12,2),
  service_fee numeric(12,2), package_fee numeric(12,2), other_cost numeric(12,2), landed_cost numeric(12,2),
  currency text not null default 'CNY', price_status public.price_verification_status not null default 'PRICE_UNVERIFIED',
  evidence jsonb not null default '{}'::jsonb, captured_at timestamptz not null default now()
);

create table public.variant_source_mappings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_variant_id uuid not null references public.product_variants(id) on delete cascade,
  source_sku_id uuid not null references public.source_skus(id) on delete cascade,
  mapping_role public.source_mapping_role not null default 'BACKUP',
  status text not null default 'PENDING' check(status in ('PENDING','ACTIVE','OUT_OF_STOCK','INVALID','REJECTED')),
  match_evidence jsonb not null default '{}'::jsonb,
  match_confidence numeric(5,2),
  current_cost_snapshot_id uuid references public.cost_snapshots(id) on delete set null,
  source_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,product_variant_id,source_sku_id)
);
create unique index one_primary_source_per_variant on public.variant_source_mappings(product_variant_id)
  where mapping_role='PRIMARY' and status in ('PENDING','ACTIVE');

alter table public.candidate_products
  add column if not exists product_model_id uuid references public.product_models(id) on delete set null,
  add column if not exists product_variant_id uuid references public.product_variants(id) on delete set null,
  add column if not exists sourcing_task_id uuid references public.sourcing_tasks(id) on delete set null,
  add column if not exists data_mode public.data_mode not null default 'REAL';
create unique index one_candidate_per_variant on public.candidate_products(user_id,product_variant_id);

create table public.supplier_reviews (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  status text not null default 'PENDING' check(status in ('PENDING','APPROVED','RESTRICTED','REJECTED')),
  dropshipping_capabilities jsonb not null default '{}'::jsonb, packaging_risks jsonb not null default '{}'::jsonb,
  fulfillment_evidence jsonb not null default '{}'::jsonb, notes text, reviewed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(user_id,supplier_id)
);

create table public.sourcing_decisions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  sourcing_task_id uuid references public.sourcing_tasks(id) on delete set null,
  product_variant_id uuid not null references public.product_variants(id) on delete cascade,
  decision text not null check(decision in ('ENTER_CANDIDATE','REJECT','HOLD','CHANGE_PRIMARY')),
  primary_mapping_id uuid references public.variant_source_mappings(id) on delete set null,
  rationale text, evidence jsonb not null default '{}'::jsonb, decided_by text not null default 'HUMAN',
  created_at timestamptz not null default now()
);

alter table public.skus add column if not exists product_variant_id uuid references public.product_variants(id) on delete set null;

create index source_skus_offer_idx on public.source_skus(source_offer_id);
create index variant_sources_variant_role_idx on public.variant_source_mappings(product_variant_id,mapping_role,status);
create index candidates_mode_status_idx on public.candidate_products(user_id,data_mode,status);

alter table public.sourcing_tasks enable row level security;
alter table public.source_offers enable row level security;
alter table public.source_skus enable row level security;
alter table public.normalized_source_skus enable row level security;
alter table public.product_models enable row level security;
alter table public.product_variants enable row level security;
alter table public.cost_snapshots enable row level security;
alter table public.variant_source_mappings enable row level security;
alter table public.supplier_reviews enable row level security;
alter table public.sourcing_decisions enable row level security;

create policy "own sourcing tasks" on public.sourcing_tasks for all using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "own source offers" on public.source_offers for all using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "own source skus" on public.source_skus for all using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "own normalized source skus" on public.normalized_source_skus for all using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "own product models" on public.product_models for all using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "own product variants" on public.product_variants for all using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "own cost snapshots" on public.cost_snapshots for all using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "own variant source mappings" on public.variant_source_mappings for all using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "own supplier reviews" on public.supplier_reviews for all using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "own sourcing decisions" on public.sourcing_decisions for all using(user_id=auth.uid()) with check(user_id=auth.uid());
