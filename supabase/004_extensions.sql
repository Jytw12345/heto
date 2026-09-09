-- ============================================================
-- 004 扩展：审计日志 / 推送渠道 / 自定义提醒 / 标签 / 状态历史 / 合同模板
-- ------------------------------------------------------------
-- 保持幂等：全部用 if not exists / add column if not exists / or replace
-- 可在 001 / 002 / 003 之后任意时刻重跑，不会破坏已有数据
-- ============================================================

-- ============================================================
-- 1. profiles 字段扩展
-- ============================================================
alter table public.profiles
  add column if not exists phone         text,
  add column if not exists wechat        text,
  add column if not exists permissions   jsonb not null default '{}'::jsonb,
  add column if not exists last_login_at timestamptz,
  add column if not exists password_changed_at timestamptz default now();

comment on column public.profiles.permissions is '细粒度权限位覆盖：{ upload, download, delete, edit, export, manage_users, manage_stores, view_audit }';

-- 收紧：本人只能改 full_name / phone / wechat；role / store_id / active / permissions 必须总部改
drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- 上面这一条允许改全字段，配合 trigger 限制 role/store_id/active/permissions 不允许本人改
create or replace function public.profiles_self_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() = new.id and not public.is_hq() then
    -- 自己是本人 且 不是总部 → 这些字段必须保持不变
    if new.role is distinct from old.role then
      raise exception '本人不可修改 role';
    end if;
    if new.store_id is distinct from old.store_id then
      raise exception '本人不可修改 store_id';
    end if;
    if new.active is distinct from old.active then
      raise exception '本人不可修改 active';
    end if;
    if new.permissions is distinct from old.permissions then
      raise exception '本人不可修改 permissions';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_self_guard on public.profiles;
create trigger trg_profiles_self_guard
  before update on public.profiles
  for each row execute function public.profiles_self_guard();

-- ============================================================
-- 2. contracts 字段扩展（标签 / 模板引用 / 续签来源）
-- ============================================================
alter table public.contracts
  add column if not exists tags          text[] not null default '{}',
  add column if not exists template_id   uuid,
  add column if not exists renewed_from  uuid references public.contracts(id),
  add column if not exists our_entity    text,
  add column if not exists reminder_channels text[] not null default array['inapp','email'];

-- 状态机扩展：增加 draft（草稿）/ renewed（已续签）/ cancelled（已作废）
-- 已有的 status check 约束需要更新
alter table public.contracts drop constraint if exists contracts_status_check;
alter table public.contracts add constraint contracts_status_check
  check (status in ('draft','active','renewed','expired','cancelled'));

-- ============================================================
-- 3. contract_files 增加 kind 字段
--    原 schema 已有 kind='scan'，这里补充：
--    scan: 合同扫描件
--    attachment: 附件（如补充协议、发票照片）
--    template: 从模板填充生成的文件（暂未用，预留）
-- ============================================================
alter table public.contract_files
  add column if not exists uploaded_by   uuid references auth.users(id),
  add column if not exists kind          text not null default 'scan'
    check (kind in ('scan','attachment','template'));

-- ============================================================
-- 4. 合同标签字典（按门店隔离，HQ 可建全局标签）
-- ============================================================
create table if not exists public.contract_tags (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid references public.stores(id) on delete cascade, -- null = 全局
  name        text not null,
  color       text default '#94a3b8',
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  unique (store_id, name)
);

alter table public.contract_tags enable row level security;

drop policy if exists "contract_tags_read" on public.contract_tags;
create policy "contract_tags_read" on public.contract_tags for select to authenticated
  using (public.is_hq() or store_id = public.current_store_id() or store_id is null);

drop policy if exists "contract_tags_write" on public.contract_tags;
create policy "contract_tags_write" on public.contract_tags for all to authenticated
  using (public.is_hq() or (store_id = public.current_store_id() and public.is_hq()))
  with check (public.is_hq() or (store_id = public.current_store_id() and public.is_hq()));

-- ============================================================
-- 5. 状态历史（合同每次状态变更留下一行）
-- ============================================================
create table if not exists public.contract_status_history (
  id            uuid primary key default gen_random_uuid(),
  contract_id   uuid not null references public.contracts(id) on delete cascade,
  from_status   text,
  to_status     text not null,
  changed_by    uuid references auth.users(id),
  reason        text,
  changed_at    timestamptz not null default now()
);
create index if not exists idx_csh_contract on public.contract_status_history(contract_id, changed_at desc);

alter table public.contract_status_history enable row level security;
drop policy if exists "csh_read" on public.contract_status_history;
create policy "csh_read" on public.contract_status_history for select to authenticated
  using (exists (
    select 1 from public.contracts c
    where c.id = contract_id and (public.is_hq() or c.store_id = public.current_store_id())
  ));
drop policy if exists "csh_insert" on public.contract_status_history;
create policy "csh_insert" on public.contract_status_history for insert to authenticated
  with check (exists (
    select 1 from public.contracts c
    where c.id = contract_id and (public.is_hq() or c.store_id = public.current_store_id())
  ));

-- 自动记录状态变更
create or replace function public.record_contract_status_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_status = 'AFTER' and old.status is distinct from new.status) then
    insert into public.contract_status_history(contract_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_contract_status on public.contracts;
create trigger trg_contract_status
  after update on public.contracts
  for each row execute function public.record_contract_status_change();

-- ============================================================
-- 6. 操作审计日志（关键操作一律写入）
-- ============================================================
create table if not exists public.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  actor_id      uuid references auth.users(id),
  actor_email   text,
  action        text not null,             -- 'login' / 'contract.create' / 'file.upload' / 'profile.update.role' 等
  resource      text,                      -- 'contract' / 'file' / 'profile' / 'store'
  resource_id   text,                      -- 用 text 兼容多类型 id
  store_id      uuid references public.stores(id),
  payload       jsonb,                     -- 改前/改后关键字段
  ip            text,
  user_agent    text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_audit_created on public.audit_logs(created_at desc);
create index if not exists idx_audit_actor on public.audit_logs(actor_id, created_at desc);
create index if not exists idx_audit_action on public.audit_logs(action, created_at desc);

alter table public.audit_logs enable row level security;

-- 只有总部能看审计日志
drop policy if exists "audit_read" on public.audit_logs;
create policy "audit_read" on public.audit_logs for select to authenticated
  using (public.is_hq());

-- 写入：本人写本人，service_role 全权
drop policy if exists "audit_insert" on public.audit_logs;
create policy "audit_insert" on public.audit_logs for insert to authenticated
  with check (actor_id = auth.uid());

-- ============================================================
-- 7. 推送渠道（企业微信/钉钉 webhook）
-- ============================================================
create table if not exists public.notification_channels (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid references public.stores(id) on delete cascade,
  kind        text not null check (kind in ('wecom','dingtalk','feishu','webhook','email')),
  name        text not null,
  url         text not null,
  active      boolean not null default true,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  -- 全局渠道 store_id 为 null 且 kind='email'，由 daily-reminder 函数读取
  unique (store_id, kind, name)
);

alter table public.notification_channels enable row level security;

drop policy if exists "notif_channels_read" on public.notification_channels;
create policy "notif_channels_read" on public.notification_channels for select to authenticated
  using (public.is_hq() or store_id is null or store_id = public.current_store_id());

drop policy if exists "notif_channels_write" on public.notification_channels;
create policy "notif_channels_write" on public.notification_channels for all to authenticated
  using (public.is_hq() or store_id = public.current_store_id())
  with check (public.is_hq() or store_id = public.current_store_id());

-- ============================================================
-- 8. 自定义提醒模板（按门店/类别定义不同提前天数 + 模板文案）
-- ============================================================
create table if not exists public.reminder_rules (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid references public.stores(id) on delete cascade,
  category     text,                       -- null = 全类别
  lead_days    int[] not null,             -- 提前天数数组
  template     text,                       -- 提醒文案模板（支持 {{title}} {{days}} 等变量）
  channels     text[] not null default array['inapp','email'],
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (store_id, category)
);

alter table public.reminder_rules enable row level security;

drop policy if exists "reminder_rules_read" on public.reminder_rules;
create policy "reminder_rules_read" on public.reminder_rules for select to authenticated
  using (public.is_hq() or store_id is null or store_id = public.current_store_id());

drop policy if exists "reminder_rules_write" on public.reminder_rules;
create policy "reminder_rules_write" on public.reminder_rules for all to authenticated
  using (public.is_hq() or store_id = public.current_store_id())
  with check (public.is_hq() or store_id = public.current_store_id());

-- ============================================================
-- 9. 合同模板库（HQ 创建的合同模板，门店可套用并复制为新合同）
-- ============================================================
create table if not exists public.contract_templates (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  category      text,
  our_entity    text,
  default_remind_days int[] not null default array[30,7,1],
  fields        jsonb not null default '{}'::jsonb,  -- 模板字段默认值
  note          text,
  active        boolean not null default true,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now()
);

alter table public.contract_templates enable row level security;

-- 所有人可读，HQ 才能写
drop policy if exists "tpl_read" on public.contract_templates;
create policy "tpl_read" on public.contract_templates for select to authenticated using (true);

drop policy if exists "tpl_write" on public.contract_templates;
create policy "tpl_write" on public.contract_templates for all to authenticated
  using (public.is_hq()) with check (public.is_hq());

-- ============================================================
-- 10. 工具函数：从 audit_logs 写入（前端调）
-- ============================================================
create or replace function public.write_audit(
  p_action text,
  p_resource text default null,
  p_resource_id text default null,
  p_store_id uuid default null,
  p_payload jsonb default null
) returns void language sql security definer set search_path = public as $$
  insert into public.audit_logs(actor_id, actor_email, action, resource, resource_id, store_id, payload)
  values (
    auth.uid(),
    (select email::text from auth.users where id = auth.uid()),
    p_action, p_resource, p_resource_id, p_store_id, p_payload
  );
$$;

grant execute on function public.write_audit(text, text, text, uuid, jsonb) to authenticated;

-- ============================================================
-- 11. 兼容：原本 contracts 表已带 store_id 外键，续签字段 renewed_from 也是，状态机扩展后视图 v_contracts 不变
-- ============================================================