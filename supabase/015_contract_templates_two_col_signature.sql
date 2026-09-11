-- 015: 合同模板底部「甲方/乙方」签名区改为左右两栏、各占 50%、左对齐、信息对齐
-- 旧结构：三行 <p>，每行用全角空格把甲方乙方拼在同一行；
-- 新结构：两列 <table>，左列甲方、右列乙方，各 50% 宽，单元格文字左对齐。
-- 在已 link 的 heto 项目执行：supabase db query --linked --file supabase/015_...
update public.contract_templates
set body = replace(
  body,
  $$
<p style="margin-top:28px">甲方（盖章）：________________　　乙方（盖章）：________________</p>
<p>授权代表：____________　　授权代表：____________</p>
<p>日期：______年____月____日　　日期：______年____月____日</p>
$$,
  $$
<table style="width:100%; border-collapse:collapse; margin-top:28px"><tbody><tr>
<td style="width:50%; text-align:left; vertical-align:top">
<p>甲方（盖章）：________________</p>
<p>授权代表：____________</p>
<p>日期：______年____月____日</p>
</td>
<td style="width:50%; text-align:left; vertical-align:top">
<p>乙方（盖章）：________________</p>
<p>授权代表：____________</p>
<p>日期：______年____月____日</p>
</td>
</tr></tbody></table>
$$
)
where body like '%甲方（盖章）：________________%';
