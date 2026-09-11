-- ============================================================
-- 010 职务权限模板（position_templates）
-- ------------------------------------------------------------
-- 职务 = 默认权限包 + 数据范围(scope)。
-- 账号分配职务后，resolvePerms 以职务模板权限为“基础默认”，
-- 再叠加 profile.permissions 的逐人覆盖。
--
-- 注意：本项目 supabase/ 目录不自动执行迁移，需在 Supabase
-- SQL Editor 手动跑一次本文件（或在迁移工具里执行）。
-- ============================================================

create table if not exists public.position_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  scope       text not null default 'store' check (scope in ('hq', 'store')),
  permissions jsonb not null default '{}',
  is_system   boolean not null default false,
  created_at  timestamptz not null default now()
);

-- profiles 增加职务引用（删除职务时置空，账号回落到 role 默认）
alter table public.profiles
  add column if not exists position_template_id uuid
  references public.position_templates(id) on delete set null;

-- RLS：登录用户可读（前端解析权限需要）；仅总部可写
alter table public.position_templates enable row level security;

drop policy if exists pt_select on public.position_templates;
create policy pt_select on public.position_templates
  for select using (auth.uid() is not null);

drop policy if exists pt_write on public.position_templates;
create policy pt_write on public.position_templates
  for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'hq' and p.active
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'hq' and p.active
    )
  );

-- 种子：3 套默认职务（仅当表为空时插入，重复执行不会翻倍）
insert into public.position_templates (name, scope, is_system, permissions)
select
  v.name,
  v.scope,
  v.is_system,
  v.permissions::jsonb
from (values
  ('店长', 'store', true, '{"contract.create":true,"contract.edit":true,"contract.delete":false,"contract.export":true,"contract.renew":true,"file.upload":true,"file.download":true,"file.delete":true,"amount.view":true,"amount.edit":false,"reminder.manage":false,"channel.manage":false,"store.manage":false,"user.manage":false,"audit.view":false,"template.manage":false,"tag.manage":true}'),
  ('财务', 'hq', true, '{"contract.create":false,"contract.edit":false,"contract.delete":false,"contract.export":true,"contract.renew":false,"file.upload":false,"file.download":true,"file.delete":false,"amount.view":true,"amount.edit":true,"reminder.manage":false,"channel.manage":false,"store.manage":false,"user.manage":false,"audit.view":true,"template.manage":false,"tag.manage":false}'),
  ('总部管理员', 'hq', true, '{"contract.create":true,"contract.edit":true,"contract.delete":true,"contract.export":true,"contract.renew":true,"file.upload":true,"file.download":true,"file.delete":true,"amount.view":true,"amount.edit":true,"reminder.manage":true,"channel.manage":true,"store.manage":true,"user.manage":true,"audit.view":true,"template.manage":true,"tag.manage":true}')
) as v(name, scope, is_system, permissions)
where not exists (select 1 from public.position_templates);
