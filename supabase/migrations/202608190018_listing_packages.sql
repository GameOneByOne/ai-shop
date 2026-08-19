alter table public.skus drop constraint if exists skus_lifecycle_status_check;
alter table public.skus add constraint skus_lifecycle_status_check
  check (lifecycle_status in ('DISCOVERED','SOURCING','CANDIDATE','CONTENT_PREP','READY','TESTING','GROWING','STABLE','DECLINING','CLEARANCE','STOPPED'));

alter table public.sku_lifecycle_events drop constraint if exists sku_lifecycle_events_to_status_check;
alter table public.sku_lifecycle_events add constraint sku_lifecycle_events_to_status_check
  check (to_status in ('DISCOVERED','SOURCING','CANDIDATE','CONTENT_PREP','READY','TESTING','GROWING','STABLE','DECLINING','CLEARANCE','STOPPED'));

alter table public.content_assets
  add column if not exists selected_title text,
  add column if not exists category_path text,
  add column if not exists sku_mapping jsonb not null default '[]'::jsonb,
  add column if not exists hero_image_plan jsonb not null default '[]'::jsonb,
  add column if not exists pricing_plan jsonb not null default '{}'::jsonb,
  add column if not exists fulfillment_copy jsonb not null default '{}'::jsonb,
  add column if not exists image_authorization_status text not null default 'unverified'
    check (image_authorization_status in ('unverified','authorized','self_shot','rejected')),
  add column if not exists compliance_status text not null default 'pending'
    check (compliance_status in ('pending','passed','needs_changes','rejected')),
  add column if not exists review_status text not null default 'draft'
    check (review_status in ('draft','pending_review','approved','rejected')),
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id) on delete set null;

create index if not exists content_assets_sku_created_idx on public.content_assets(sku_id,created_at desc);
