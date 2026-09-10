-- ============================================================
-- 008 修复：contract 状态历史 trigger 的 tg_status typo + 兜底补列
-- 在 Supabase 控制台 -> SQL Editor 全选执行
-- ------------------------------------------------------------
-- 根因：004_extensions.sql 的 record_contract_status_change() 写了
--   if (tg_status = 'AFTER' and old.status is distinct from new.status)
-- PL/pgSQL 不存在 tg_status 这个变量（应为 TG_OP / TG_WHEN）。
-- 由于 plpgsql 是运行期绑定，每条 UPDATE 触发器一进来就抛
--   column "tg_status" does not exist
-- 导致 PostgREST 把整条 UPDATE 退回 400 Bad Request。
-- 本脚本：drop trigger -> 修正函数 -> 重建 trigger
-- 顺带补 reminder_channels 等 004 里定义的列，避免漏跑 004
-- ============================================================

-- ---------- A. 重建 trigger（必须 drop + create 一起，不能只 replace） ----------
drop trigger if exists trg_contract_status on public.contracts;

create or replace function public.record_contract_status_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- TG_OP 是内置 trigger 元数据；AFTER UPDATE 触发器里 TG_OP 必然 = 'UPDATE'
  -- 同时即便状态未变更也安全跳过
  if (tg_op = 'UPDATE' and old.status is distinct from new.status) then
    insert into public.contract_status_history(contract_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end;
$$;

create trigger trg_contract_status
  after update on public.contracts
  for each row execute function public.record_contract_status_change();

-- ---------- B. 兜底：004_extensions.sql 里其它契约字段（防止漏跑 004） ----------
alter table public.contracts
  add column if not exists reminder_channels text[] not null default array['inapp','email'];

-- 兼容老库缺 our_entity（001 schema 已建，但若历史表是更早的脚本可能没有）
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'contracts' and column_name = 'our_entity'
  ) then
    alter table public.contracts add column our_entity text;
  end if;
end $$;

-- ---------- C. 兜底：004 的写审计函数 + audit_logs 表（前端多处调用 write_audit） ----------
create table if not exists public.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  actor_id      uuid references auth.users(id),
  actor_email   text,
  action        text not null,
  resource      text,
  resource_id   text,
  store_id      uuid references public.stores(id),
  payload       jsonb,
  ip            text,
  user_agent    text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_audit_created on public.audit_logs(created_at desc);
create index if not exists idx_audit_actor on public.audit_logs(actor_id, created_at desc);
create index if not exists idx_audit_action on public.audit_logs(action, created_at desc);

alter table public.audit_logs enable row level security;

drop policy if exists "audit_read" on public.audit_logs;
create policy "audit_read" on public.audit_logs for select to authenticated
  using (public.is_hq());

drop policy if exists "audit_insert" on public.audit_logs;
create policy "audit_insert" on public.audit_logs for insert to authenticated
  with check (actor_id = auth.uid());

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

-- ---------- D. 验证（执行完看到 1 行才算修复成功） ----------
-- select tgname, tgenabled from pg_trigger where tgname = 'trg_contract_status';
-- 应返回 1 行 tgenabled = 'O'（orig=enabled）