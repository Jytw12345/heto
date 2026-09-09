-- ============================================================
-- 001 表结构 / RLS / 辅助函数
-- 在 Supabase 控制台 -> SQL Editor 全选执行
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- 1. 门店 ----------
create table if not exists public.stores (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  code       text unique,
  address    text,
  manager    text,
  phone      text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- 2. 用户档案（关联 auth.users） ----------
-- role: hq = 总部（看全部） / store = 门店（只看本店）
-- 总部账号 store_id 允许为空；门店账号必须绑定 store_id
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  store_id   uuid references public.stores(id) on delete set null,
  full_name  text,
  role       text not null default 'store' check (role in ('hq', 'store')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- 注册后自动建档案，默认未分配门店（此时看不到任何数据，等总部指派）
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 3. 合同 ----------
create table if not exists public.contracts (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null references public.stores(id) on delete restrict,
  title        text not null,
  contract_no  text,
  counterparty text,                       -- 对方公司
  our_entity   text,                       -- 我方主体（签约公司）
  category     text default '其他',         -- 租赁 / 采购 / 服务 / 劳务 / 装修 / 其他
  amount       numeric(14, 2),             -- 合同金额（元）
  signed_at    date,                       -- 签订日期
  start_at     date,                       -- 生效日期
  end_at       date,                       -- 到期日期（提醒依据）
  remind_days  int[] not null default '{30,7,1}',  -- 提前多少天提醒
  auto_renew   boolean not null default false,     -- 是否自动续约
  status       text not null default 'active'
                 check (status in ('active', 'expired', 'terminated')),
  note         text,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_contracts_store  on public.contracts(store_id);
create index if not exists idx_contracts_end    on public.contracts(end_at) where end_at is not null;
create index if not exists idx_contracts_status on public.contracts(status);

-- ---------- 4. 附件（扫描件） ----------
-- 只存路径与元信息，二进制本体在 Storage 私有桶
create table if not exists public.contract_files (
  id          uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  store_id    uuid not null references public.stores(id) on delete restrict,
  file_path   text not null unique,   -- 形如 {store_id}/{contract_id}/{uuid}.pdf
  file_name   text not null,          -- 原始文件名，下载时还原
  mime_type   text,
  size_bytes  bigint not null default 0,
  sha256      text,                   -- 完整性校验用
  kind        text not null default 'scan' check (kind in ('scan', 'attachment')),
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_files_contract on public.contract_files(contract_id);
create index if not exists idx_files_store    on public.contract_files(store_id);

-- ---------- 5. 提醒记录（防重复推送） ----------
create table if not exists public.reminders (
  id          uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  due_date    date not null,
  lead_days   int  not null,
  channel     text not null check (channel in ('in_app', 'email', 'webhook')),
  recipient   text,
  sent_at     timestamptz not null default now(),
  unique (contract_id, due_date, lead_days, channel, recipient)
);

-- ---------- 6. 站内消息 ----------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  contract_id uuid references public.contracts(id) on delete cascade,
  title       text not null,
  body        text,
  level       text not null default 'info' check (level in ('info', 'warning', 'urgent')),
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists idx_notif_user on public.notifications(user_id, read_at);

-- ============================================================
-- 辅助函数：全部 security definer，避免 RLS 递归死循环
-- ============================================================
create or replace function public.current_store_id()
returns uuid language sql stable security definer set search_path = public as $$
  select store_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_hq()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'hq' and active
  );
$$;

-- 判断某个门店 id 当前用户是否有权访问
create or replace function public.can_access_store(p_store_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_hq()
      or exists (
           select 1 from public.profiles
           where id = auth.uid() and active and store_id = p_store_id
         );
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_contracts_touch on public.contracts;
create trigger trg_contracts_touch before update on public.contracts
  for each row execute function public.touch_updated_at();

-- ============================================================
-- RLS
-- ============================================================
alter table public.stores          enable row level security;
alter table public.profiles        enable row level security;
alter table public.contracts       enable row level security;
alter table public.contract_files  enable row level security;
alter table public.reminders       enable row level security;
alter table public.notifications   enable row level security;

-- stores：总部看全部并维护；门店看自己
drop policy if exists stores_select on public.stores;
create policy stores_select on public.stores for select to authenticated
  using (public.is_hq() or id = public.current_store_id());

drop policy if exists stores_write on public.stores;
create policy stores_write on public.stores for all to authenticated
  using (public.is_hq()) with check (public.is_hq());

-- profiles：总部看全部；本人看自己
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (public.is_hq() or id = auth.uid());

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_admin on public.profiles;
create policy profiles_admin on public.profiles for all to authenticated
  using (public.is_hq()) with check (public.is_hq());

-- contracts：总部全权；门店仅本店
drop policy if exists contracts_select on public.contracts;
create policy contracts_select on public.contracts for select to authenticated
  using (public.can_access_store(store_id));

drop policy if exists contracts_insert on public.contracts;
create policy contracts_insert on public.contracts for insert to authenticated
  with check (public.can_access_store(store_id));

drop policy if exists contracts_update on public.contracts;
create policy contracts_update on public.contracts for update to authenticated
  using (public.can_access_store(store_id)) with check (public.can_access_store(store_id));

-- 删除收敛到总部，门店误删会连带删掉扫描件
drop policy if exists contracts_delete on public.contracts;
create policy contracts_delete on public.contracts for delete to authenticated
  using (public.is_hq());

-- contract_files：与合同一致
drop policy if exists files_select on public.contract_files;
create policy files_select on public.contract_files for select to authenticated
  using (public.can_access_store(store_id));

drop policy if exists files_insert on public.contract_files;
create policy files_insert on public.contract_files for insert to authenticated
  with check (public.can_access_store(store_id));

drop policy if exists files_update on public.contract_files;
create policy files_update on public.contract_files for update to authenticated
  using (public.can_access_store(store_id)) with check (public.can_access_store(store_id));

drop policy if exists files_delete on public.contract_files;
create policy files_delete on public.contract_files for delete to authenticated
  using (public.is_hq() or (public.can_access_store(store_id) and uploaded_by = auth.uid()));

-- reminders / notifications
drop policy if exists reminders_select on public.reminders;
create policy reminders_select on public.reminders for select to authenticated
  using (exists (select 1 from public.contracts c
                 where c.id = contract_id and public.can_access_store(c.store_id)));

drop policy if exists reminders_admin on public.reminders;
create policy reminders_admin on public.reminders for all to authenticated
  using (public.is_hq()) with check (public.is_hq());

drop policy if exists notif_self on public.notifications;
create policy notif_self on public.notifications for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================
-- 视图与 RPC
-- ============================================================
-- 主视图（security_invoker 让底层 RLS 继续生效）
drop view if exists public.v_contracts;
create view public.v_contracts with (security_invoker = true) as
select c.*,
       s.name as store_name,
       (c.end_at - current_date)::int as days_left,
       (select count(*) from public.contract_files f where f.contract_id = c.id) as file_count
from public.contracts c
join public.stores s on s.id = c.store_id;

drop view if exists public.v_contracts_due;
create view public.v_contracts_due with (security_invoker = true) as
select * from public.v_contracts
where end_at is not null and status = 'active';

-- 供提醒 Edge Function 调用（service_role 绕过 RLS）
create or replace function public.due_contracts(p_today date default current_date,
                                                p_max_lead int default 60)
returns table (contract_id uuid, store_id uuid, store_name text, title text,
               contract_no text, end_at date, days_left int, remind_days int[])
language sql stable security definer set search_path = public as $$
  select c.id, c.store_id, s.name, c.title, c.contract_no, c.end_at,
         (c.end_at - p_today)::int, c.remind_days
  from public.contracts c
  join public.stores s on s.id = c.store_id
  where c.status = 'active'
    and c.end_at is not null
    and (c.end_at - p_today) between 0 and p_max_lead
  order by c.end_at asc;
$$;

-- 到期后自动标记过期（由提醒函数在服务端调用）
create or replace function public.mark_expired_contracts()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.contracts
     set status = 'expired'
   where status = 'active' and end_at is not null and end_at < current_date;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- 总部用来列出账号邮箱（auth.users 默认不可读，这里做权限收敛）
create or replace function public.admin_list_users()
returns table (id uuid, email text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_hq() then
    raise exception '仅总部可查看账号列表';
  end if;
  return query
    select u.id, u.email::text, u.created_at
    from auth.users u
    order by u.created_at desc;
end;
$$;

-- 收紧调用权限：这两个函数绕过 RLS，只允许服务端角色调，
-- 否则任意登录用户都能一次性拉走全部门店的合同数据
revoke execute on function public.due_contracts(date, int) from anon, authenticated;
grant  execute on function public.due_contracts(date, int) to service_role;

revoke execute on function public.mark_expired_contracts() from anon, authenticated;
grant  execute on function public.mark_expired_contracts() to service_role;
