-- Phase 1 procurement-decision fields. Keep normalized_attributes as the canonical
-- signature while exposing frequently queried attributes directly.
alter table public.product_variants
  add column if not exists color text,
  add column if not exists size text,
  add column if not exists material text,
  add column if not exists style text,
  add column if not exists purchase_price numeric(12,2),
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null,
  add column if not exists confidence numeric(5,2);

alter table public.source_skus
  add column if not exists variant_id uuid references public.product_variants(id) on delete set null;

create index if not exists source_skus_variant_idx on public.source_skus(variant_id);
