alter table public.source_products
  add column if not exists one_piece_delivery boolean,
  add column if not exists blind_shipping boolean,
  add column if not exists no_reason_return boolean,
  add column if not exists shop_age integer,
  add column if not exists quality_rate numeric(5,2),
  add column if not exists delivery_rate numeric(5,2),
  add column if not exists stock bigint,
  add column if not exists image_count integer,
  add column if not exists has_video boolean,
  add column if not exists inspection boolean,
  add column if not exists offer_status text not null default 'RISK'
    check (offer_status in ('PASS','RISK','REJECT')),
  add column if not exists offer_reasons jsonb not null default '[]'::jsonb,
  add column if not exists offer_facts_captured_at timestamptz;

create index if not exists source_products_run_offer_status_idx
  on public.source_products(sourcing_run_id, offer_status);
