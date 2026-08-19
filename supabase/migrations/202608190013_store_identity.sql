alter table public.store_profiles
  add column if not exists store_name text not null default '猫居研究所',
  add column if not exists target_customer text not null default '以养猫家庭为核心，兼顾少量猫狗通用用品';
