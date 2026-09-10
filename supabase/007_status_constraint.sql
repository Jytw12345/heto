-- 007: 对齐 contracts.status 的 CHECK 约束与前端取值
-- 前端 ContractStatus = 'draft' | 'active' | 'renewed' | 'expired' | 'cancelled'
-- 原约束只允许 'active' | 'expired' | 'terminated'，导致「草稿 / 续签 / 作废」保存报 23514

-- 1) 历史数据：'terminated' 合并进 'cancelled'
update public.contracts
  set status = 'cancelled'
  where status = 'terminated';

-- 2) 删除旧约束（Postgres 自动命名为 contracts_status_check）
alter table public.contracts
  drop constraint if exists contracts_status_check;

-- 3) 新增与前端对齐的约束
alter table public.contracts
  add constraint contracts_status_check
  check (status in ('draft', 'active', 'renewed', 'expired', 'cancelled'));

comment on column public.contracts.status is
  '合同状态：draft 草稿 / active 履行中 / renewed 已续签 / expired 已到期 / cancelled 已作废';
