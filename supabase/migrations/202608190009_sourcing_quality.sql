alter table source_products
  add column if not exists data_status text not null default 'valid'
    check (data_status in ('valid','needs_review','data_error','rejected')),
  add column if not exists data_issues jsonb not null default '[]'::jsonb,
  add column if not exists sku_hint text,
  add column if not exists newcomer_price numeric(12,2),
  add column if not exists original_price numeric(12,2),
  add column if not exists sales_count integer,
  add column if not exists repurchase_rate numeric(5,2),
  add column if not exists return_shipping boolean,
  add column if not exists pay_later boolean,
  add column if not exists dropshipping boolean,
  add column if not exists shipping_fee numeric(12,2),
  add column if not exists cluster_key text,
  add column if not exists cluster_rank integer,
  add column if not exists score_breakdown jsonb not null default '{}'::jsonb,
  add column if not exists estimated_sale_price_min numeric(12,2),
  add column if not exists estimated_sale_price_max numeric(12,2),
  add column if not exists estimated_unit_profit_min numeric(12,2),
  add column if not exists estimated_unit_profit_max numeric(12,2),
  add column if not exists decision_status text not null default 'pending'
    check (decision_status in ('pending','candidate','ignored'));

alter table source_products
  drop constraint if exists source_products_user_id_provider_source_url_key;
alter table source_products
  add constraint source_products_run_url_key unique(sourcing_run_id,source_url);

create index if not exists source_products_run_cluster_idx
  on source_products(sourcing_run_id,cluster_key,cluster_rank);
