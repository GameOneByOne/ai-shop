create table store_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stage text not null default 'startup' check(stage in ('startup','growth','profit')),
  category text not null default '猫咪居家用品',
  monthly_revenue_target numeric(12,2) not null default 10000,
  target_gross_margin numeric(5,4) not null default 0.45,
  target_sku_min integer not null default 15,
  target_sku_max integer not null default 25,
  max_purchase_price numeric(12,2) not null default 30,
  max_inventory_days integer not null default 30,
  risk_preference integer not null default 30 check(risk_preference between 0 and 100),
  new_product_frequency integer not null default 50 check(new_product_frequency between 0 and 100),
  price_strategy text not null default 'profit' check(price_strategy in ('profit','balanced','volume')),
  updated_at timestamptz not null default now()
);

create table manager_cycles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  state_snapshot jsonb not null,
  observations jsonb not null default '[]'::jsonb,
  summary text,
  status text not null default 'running' check(status in ('running','completed','failed')),
  model text,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table action_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  manager_cycle_id uuid not null references manager_cycles(id) on delete cascade,
  type text not null check(type in ('sourcing','content','analytics','inventory','pricing','experiment','marketing','supplier')),
  title text not null,
  evidence jsonb not null default '[]'::jsonb,
  diagnosis text not null,
  recommended_action text not null,
  priority text not null check(priority in ('P0','P1','P2','P3')),
  permission_mode text not null default 'approval' check(permission_mode in ('auto','approval','manual_only')),
  approval_status text not null default 'pending' check(approval_status in ('pending','accepted','rejected')),
  target_route text,
  expected_metric text,
  task_id uuid references tasks(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table tasks
  add column if not exists action_proposal_id uuid references action_proposals(id) on delete set null,
  add column if not exists creation_reason text,
  add column if not exists steps jsonb not null default '[]'::jsonb,
  add column if not exists expected_metric text,
  add column if not exists approval_required boolean not null default false;

create index manager_cycles_user_created_idx on manager_cycles(user_id,created_at desc);
create index action_proposals_user_status_idx on action_proposals(user_id,approval_status,created_at desc);
alter table store_profiles enable row level security;
alter table manager_cycles enable row level security;
alter table action_proposals enable row level security;
create policy "own store profile" on store_profiles for all using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "own manager cycles" on manager_cycles for all using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy "own action proposals" on action_proposals for all using(user_id=auth.uid()) with check(user_id=auth.uid());
