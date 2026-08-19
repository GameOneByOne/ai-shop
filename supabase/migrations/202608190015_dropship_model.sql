alter table public.store_profiles
  add column if not exists fulfillment_model text not null default '1688代采购/一件代发',
  add column if not exists human_responsibility text not null default '审核关键经营动作，并负责在1688完成采购下单';

update public.store_profiles
set target_customer = '养猫家庭', category = '猫咪玩具与居家生活用品',
    fulfillment_model = '1688代采购/一件代发',
    human_responsibility = '审核关键经营动作，并负责在1688完成采购下单', updated_at = now();
