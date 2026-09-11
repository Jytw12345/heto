-- ============================================================
-- 012 合同模板：新增「正文」，支持编辑与生成合同电子版
-- ------------------------------------------------------------
-- 复用既有 contract_templates 表（004_extensions.sql 第 9 节）：
--   原本只存「字段预设」（category / our_entity / default_remind_days /
--   fields / note），本次追加正文 body，使同一张模板同时承担
--   “套用表单字段” 与 “生成合同正文文档” 两个职责。
--
-- 正文中可用占位符（{{字段}}），生成时按合同数据替换：
--   {{合同名称}} {{合同编号}} {{类别}} {{门店}} {{我方主体}} {{对方公司}}
--   {{合同金额}} {{金额大写}} {{签订日期}} {{生效日期}} {{到期日期}}
--   {{提前提醒}} {{备注}} {{今日日期}}
--
-- 注意：本项目 supabase/ 目录不自动执行迁移，需在 Supabase
-- SQL Editor 手动跑一次本文件。
-- ============================================================

alter table public.contract_templates
  add column if not exists body text not null default '',
  add column if not exists updated_at timestamptz not null default now();

comment on column public.contract_templates.body is '合同正文模板（HTML），支持 {{占位符}}';

-- 读取仍对所有登录用户开放；写入仍限总部（沿用 004 的 tpl_* 策略，无需改动）

-- 本文件只做结构变更，正文模板见 013_contract_templates_seed.sql
