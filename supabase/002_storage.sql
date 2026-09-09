-- ============================================================
-- 002 Storage：合同扫描件私有桶 + 行级权限
-- 路径规范：{store_id}/{contract_id}/{file_id}.{ext}
-- 路径第一段就是权限边界，RLS 直接取它比对
-- ============================================================

-- 建私有桶（public = false，任何对象都没有公开直链）
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'contracts',
  'contracts',
  false,
  52428800,   -- 50MB。免费版上限 50MB；Pro 可放宽到 5GB（5242880000）
  array[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ⚠️ 不要写 `alter table storage.objects enable row level security;`
-- 2025 年起 Supabase 收紧权限：storage 系统表的 ALTER TABLE 不再允许（报 42501 must be owner of table objects）。
-- 而且 storage.objects 的 RLS 现在默认就是开启状态，这行既多余又会直接报错中断整个脚本。
-- 直接建策略即可，下面四条策略在 SQL Editor 里可正常创建。

-- 当前用户是否可访问该对象（第一段目录 = 门店 ID）
-- 先确认第一段是合法 uuid 再转换，否则路径写错时会抛出
-- "invalid input syntax for type uuid" 这种看不懂的错，而不是干脆地拒绝
-- ⚠️ 函数必须建在 public 下：SQL Editor 对 storage schema 没有 CREATE 权限
--    （报 42501 permission denied for schema storage），挪到 public 即可正常创建。
--    函数体仍能访问 storage.foldername，因为 security definer + search_path 已带 storage。
create or replace function public.can_access_contract_object(p_name text)
returns boolean language sql stable security definer set search_path = public, storage as $$
  select public.is_hq()
      or (
        coalesce((storage.foldername(p_name))[1], '') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        and (storage.foldername(p_name))[1]::uuid = public.current_store_id()
      );
$$;

-- 上传：只能传进自己门店的目录
drop policy if exists "contracts_insert" on storage.objects;
create policy "contracts_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'contracts'
    and public.can_access_contract_object(name)
  );

-- 读取 / 签发签名链接：总部全部，门店仅本店
drop policy if exists "contracts_select" on storage.objects;
create policy "contracts_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'contracts'
    and public.can_access_contract_object(name)
  );

-- 覆盖写
drop policy if exists "contracts_update" on storage.objects;
create policy "contracts_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'contracts'
    and public.can_access_contract_object(name)
  );

-- 删除：默认允许本门店删除（传错文件时门店能自己处理）。
-- 若想更严格、只让总部删，把下面的 using 换成 public.is_hq() 即可。
-- 注意：Storage 没有回收站，删了就是没了，重要合同建议开启定期备份。
drop policy if exists "contracts_delete" on storage.objects;
create policy "contracts_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'contracts'
    and public.can_access_contract_object(name)
  );

-- ============================================================
-- 运维查询：找出孤儿文件（数据库记录已删、Storage 里还在）
-- 在 SQL Editor 手动跑，确认无误后到 Storage 界面或用脚本清理
-- ============================================================
-- select o.name, o.created_at, (o.metadata->>'size')::bigint as size
-- from storage.objects o
-- where o.bucket_id = 'contracts'
--   and not exists (
--     select 1 from public.contract_files f where f.file_path = o.name
--   )
-- order by o.created_at desc;
