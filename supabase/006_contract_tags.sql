-- 006: 补齐 contracts 表缺失列，解决「保存失败 / 续签失败」
-- 前端 Contract 类型与表单 payload 实际发送这些字段，但原 001_schema 没有：
--   tags          合同标签（列表筛选/详情展示用）
--   renewed_from  续签来源（续签时 insert）
--   template_id   合同模板来源（预留）

-- 1) 标签
alter table public.contracts
  add column if not exists tags text[] not null default '{}';
create index if not exists idx_contracts_tags on public.contracts using gin (tags);

-- 2) 续签来源
alter table public.contracts
  add column if not exists renewed_from uuid references public.contracts(id) on delete set null;

-- 3) 模板来源（预留，当前表单未发送，先建好对齐类型；不加 FK 以免强依赖 004）
alter table public.contracts
  add column if not exists template_id uuid;

comment on column public.contracts.tags is '合同标签数组';
comment on column public.contracts.renewed_from is '续签来源合同 id';
comment on column public.contracts.template_id is '来源模板 id（预留）';
