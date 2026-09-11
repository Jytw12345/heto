-- 015c: 兜底（已验证可用）——把任何残留的旧式「甲方/乙方」三行签名块
-- （每行用全角空格把甲方乙方拼在同一行）改为左右两栏、各占 50%、文字左对齐。
-- 用贪婪 .+ 与 \s*（吸收 LF/CRLF 差异），与 015 的精确 replace 互补。
-- 在已 link 的 heto 项目执行：supabase db query --linked --file supabase/015c_...
update public.contract_templates
set body = regexp_replace(
  body,
  '<p style="margin-top:28px">甲方（盖章）：.+乙方（盖章）：.+</p>\s*<p>授权代表：.+授权代表：.+</p>\s*<p>日期：.+日期：.+</p>',
  '<table style="width:100%; border-collapse:collapse; margin-top:28px"><tbody><tr>' ||
  '<td style="width:50%; text-align:left; vertical-align:top">' ||
  '<p>甲方（盖章）：________________</p>' ||
  '<p>授权代表：____________</p>' ||
  '<p>日期：______年____月____日</p>' ||
  '</td>' ||
  '<td style="width:50%; text-align:left; vertical-align:top">' ||
  '<p>乙方（盖章）：________________</p>' ||
  '<p>授权代表：____________</p>' ||
  '<p>日期：______年____月____日</p>' ||
  '</td>' ||
  '</tr></tbody></table>',
  'g')
where body ~ '甲方（盖章）：.+乙方（盖章）';
