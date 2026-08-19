alter table public.store_profiles
  alter column store_name set default 'AI 猫咪居家生活用品店';

update public.store_profiles
set store_name = 'AI 猫咪居家生活用品店', updated_at = now()
where store_name = '猫居研究所';
