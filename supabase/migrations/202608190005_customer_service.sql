alter table product_faqs add column if not exists sku_code text;
create index if not exists product_faqs_user_code_idx on product_faqs(user_id,sku_code,verified);
