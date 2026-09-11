-- 016：合同模板底部「甲方/乙方」签名区表格去掉框线
-- 背景：签名区是排版用两栏表格，不应带数据表格的黑框线。
-- 框线来自 RichEditor 的全局样式（[_td]:border），导出 Word 按内联样式判断（无边框），
-- 只有浏览器预览/打印会显示框线。这里给签名表格写显式 border:none 内联样式，
-- 内联优先级高于编辑器 CSS，预览与打印即恢复无边框；docx 导出逻辑不变（仍无边框）。
-- 可重复执行：replace 未命中时无变化。

update public.contract_templates
set body = replace(
  replace(
    body,
    '<table style="width:100%; border-collapse:collapse; margin-top:28px">',
    '<table style="width:100%; border-collapse:collapse; border:none; margin-top:28px">'
  ),
  '<td style="width:50%; text-align:left; vertical-align:top">',
  '<td style="width:50%; text-align:left; vertical-align:top; border:none">'
);
