alter table public.store_profiles
  add column if not exists min_purchase_price numeric(12,2) not null default 2,
  add column if not exists default_moq_max integer not null default 5,
  add column if not exists require_dropshipping boolean not null default true,
  add column if not exists min_supplier_repurchase_rate numeric(5,2) not null default 20,
  add column if not exists prefer_factory boolean not null default true,
  add column if not exists require_return_shipping boolean not null default false,
  add column if not exists prefer_credit_purchase boolean not null default true,
  add column if not exists abnormal_price_policy text not null default 'manual_review',
  add column if not exists unresolved_data_policy text not null default 'manual_review',
  add column if not exists default_shipping_cost numeric(12,2) not null default 3,
  add column if not exists default_packaging_cost numeric(12,2) not null default 0.5,
  add column if not exists ai_auto_permissions jsonb not null default '["read_data","analyze","source_search","score","draft_content","create_tasks","create_reports"]'::jsonb,
  add column if not exists ai_approval_permissions jsonb not null default '["publish_product","change_price","change_ad_budget","contact_supplier","delist_product","purchase_1688"]'::jsonb;

alter table public.store_profiles
  add constraint store_profiles_purchase_range check (max_purchase_price >= min_purchase_price),
  add constraint store_profiles_moq_positive check (default_moq_max > 0),
  add constraint store_profiles_supplier_rate check (min_supplier_repurchase_rate between 0 and 100),
  add constraint store_profiles_abnormal_price_policy check (abnormal_price_policy in ('manual_review','reject','conservative')),
  add constraint store_profiles_unresolved_data_policy check (unresolved_data_policy in ('manual_review','reject'));
