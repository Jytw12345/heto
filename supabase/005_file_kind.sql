-- ============================================================
-- 005 文件角色扩展 + OCR 文本检索预留
-- 在 Supabase 控制台 -> SQL Editor 全选执行
-- ============================================================

-- 1) contract_files.kind 扩展：正本 / 附件 / 扫描件 / 发票
--    原约束只允许 ('scan','attachment')，上传端已支持选择更多角色，需放开校验
alter table public.contract_files
  drop constraint if exists contract_files_kind_check,
  add constraint contract_files_kind_check
    check (kind in ('original', 'attachment', 'scan', 'invoice', 'template'));

comment on column public.contract_files.kind is
  '文件角色：original=合同正本, attachment=附件, scan=扫描件, invoice=发票, template=模板';

-- 2) OCR 全文检索预留（独立轮次由 Edge Function 异步回填 extracted_text）
alter table public.contract_files add column if not exists extracted_text text;

create index if not exists idx_files_text on public.contract_files
  using gin (to_tsvector('simple', coalesce(extracted_text, '')));

comment on column public.contract_files.extracted_text is
  'OCR 提取的合同文本，供全文检索；独立轮次由 Edge Function 异步回填';
