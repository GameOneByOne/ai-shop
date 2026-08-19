alter table public.skus
  add column if not exists lifecycle_status text not null default 'TESTING'
  check (lifecycle_status in ('DISCOVERED','SOURCING','CANDIDATE','READY','TESTING','GROWING','STABLE','DECLINING','CLEARANCE','STOPPED'));

update public.skus set lifecycle_status = case status::text
  when 'testing' then 'TESTING'
  when 'watching' then 'DECLINING'
  when 'potential' then 'GROWING'
  when 'core' then 'STABLE'
  when 'eliminate' then 'STOPPED'
  when 'archived' then 'STOPPED'
  else 'TESTING' end;

create table public.sku_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sku_id uuid not null references public.skus(id) on delete cascade,
  from_status text,
  to_status text not null check (to_status in ('DISCOVERED','SOURCING','CANDIDATE','READY','TESTING','GROWING','STABLE','DECLINING','CLEARANCE','STOPPED')),
  trigger_source text not null default 'manual' check (trigger_source in ('manual','ai','rule','import')),
  trigger_reason text not null,
  ai_reasoning text,
  recommended_action text,
  approval_required boolean not null default false,
  approval_status text not null default 'not_required' check (approval_status in ('not_required','pending','approved','rejected')),
  execution_result text,
  created_at timestamptz not null default now()
);

create index sku_lifecycle_events_sku_created_idx on public.sku_lifecycle_events(sku_id,created_at desc);
alter table public.sku_lifecycle_events enable row level security;
create policy "own sku lifecycle events" on public.sku_lifecycle_events for all using(user_id=auth.uid()) with check(user_id=auth.uid());
