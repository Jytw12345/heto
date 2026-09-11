-- ============================================================
-- 9. 我方主体字典（合同「我方主体」可选列表，全局共享）
-- ============================================================
-- 合同表 contracts.our_entity 是 text 字段，存主体名称。
-- 这里维护一个字典表，供「新建/编辑合同」下拉选择；
-- 用户在表单里手动输入的新主体会在保存时自动写入本表，下次即可直接选。
create table if not exists public.our_entities (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  short_name text,  -- 手动维护的简写名；为空时前端回退自动简写
  created_at timestamptz not null default now()
);

alter table public.our_entities enable row level security;

-- 所有人可读（下拉选项）
drop policy if exists "our_entities_read" on public.our_entities;
create policy "our_entities_read" on public.our_entities
  for select to authenticated using (true);

-- 所有人可写（新增 / 删除主体），name 唯一保证不重复
drop policy if exists "our_entities_write" on public.our_entities;
create policy "our_entities_write" on public.our_entities
  for all to authenticated using (true) with check (true);
