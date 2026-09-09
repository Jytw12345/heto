-- ============================================================
-- 003 初始化示例数据
-- 顺序：先建门店 -> 注册账号 -> 把账号提为总部
-- ============================================================

-- 1) 建门店（改成你自己的门店）
insert into public.stores (name, code, manager, phone) values
  ('济宁万达店',   'JNWD', '张店长', '13800000001'),
  ('济宁吾悦店',   'JNYY', '李店长', '13800000002'),
  ('兖州店',       'YZ01', '王店长', '13800000003')
on conflict (code) do nothing;

-- 2) 在 Authentication -> Users 里手动创建第一个账号后，把它提为总部：
-- update public.profiles
--    set role = 'hq', full_name = '总部管理员'
--  where id = (select id from auth.users where email = '309953160@qq.com');

-- 3) 把门店账号绑定到门店（新注册账号默认看不到任何数据，必须指派）
-- update public.profiles p
--    set store_id = s.id, full_name = '张店长'
--   from public.stores s
--  where s.code = 'JNWD'
--    and p.id = (select id from auth.users where email = 'zhang@example.com');

-- 4) 示例合同（可选，先看效果用）
-- 注意把 store_id 换成上面 insert 实际生成的 uuid
-- insert into public.contracts
--   (store_id, title, contract_no, counterparty, our_entity, category,
--    amount, signed_at, start_at, end_at, remind_days)
-- values
--   ((select id from public.stores where code='JNWD'),
--    '万达广场商铺租赁合同', 'WD-2026-001', '济宁万达广场商业管理有限公司',
--    '济宁市万紫千红文化传媒有限公司', '租赁', 120000,
--    '2025-01-01', '2025-01-01', '2026-12-31', '{60,30,7,1}');
