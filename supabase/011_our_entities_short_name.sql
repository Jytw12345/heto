-- ============================================================
-- 11. 我方主体增加「简写名」字段
-- ============================================================
-- 合同列表「我方主体」列原先靠前端自动简写（剥离行政区划+后缀），
-- 多主体混用时不稳定。改为在 our_entities 存一份手动维护的 short_name，
-- 列表优先用 short_name，未维护时回退自动简写。
-- 请在 Supabase SQL Editor 执行本文件（本项目 supabase/ 不自动迁移）。

alter table public.our_entities
  add column if not exists short_name text;

-- 注释
comment on column public.our_entities.short_name is '手动维护的简写名；为空时前端回退自动简写';

-- 视图 v_contracts 不依赖 short_name（合同表只存名称字符串），无需改动。
