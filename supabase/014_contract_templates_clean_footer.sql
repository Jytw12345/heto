-- ============================================================
-- 014 清理模板正文里多余的「生成标注」页脚
-- ------------------------------------------------------------
-- 背景：013 的种子模板在正文末尾带了一行内部标注页脚，例如
--   合同金额：{{合同金额}}（大写：{{金额大写}}）　交付期限：…　模板生成于 {{今日日期}}
-- 问题：这行是「模板自带说明」，不该出现在给客户看的正式合同里；
--       而且当合同金额为空时会渲染成「合同金额：（大写：）」这种空壳。
--
-- 本文件只删除**带「模板生成于 {{今日日期}}」标记的那一段**，
-- 你在界面上改过的其它内容一律不动。可安全重复执行。
--
-- 注意：本项目 supabase/ 目录不自动执行迁移，需在 Supabase
-- SQL Editor 手动跑一次本文件。
-- ============================================================

-- 1) 删除整段标注页脚（该段落内不含其它标签，用 [^<]* 精确匹配）
update public.contract_templates
set
  body = regexp_replace(
    body,
    '<p[^>]*>[^<]*模板生成于[^<]*\{\{今日日期\}\}[^<]*</p>',
    '',
    'g'
  ),
  updated_at = now()
where body like '%模板生成于%';

-- 2) 兼容早期写法：（模板生成于 {{今日日期}}　模板名称：xxx）
update public.contract_templates
set
  body = regexp_replace(body, '（?模板生成于[^<）]*\{\{今日日期\}\}[^<）]*）?', '', 'g'),
  updated_at = now()
where body like '%模板生成于%';

-- 3) 收敛因为删除而产生的连续空行
update public.contract_templates
set
  body = regexp_replace(body, '(<p>&nbsp;</p>\s*){2,}', '<p>&nbsp;</p>', 'g'),
  updated_at = now()
where body like '%<p>&nbsp;</p>%';

-- 核对：应返回 0 行
-- select name from public.contract_templates where body like '%模板生成于%';
