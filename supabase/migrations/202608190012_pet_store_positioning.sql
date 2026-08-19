alter table public.store_profiles
  alter column category set default '宠物玩具与宠物用品';

update public.store_profiles
set category = '宠物玩具与宠物用品', updated_at = now()
where category = '猫咪居家用品';
