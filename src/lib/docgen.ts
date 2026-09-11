/**
 * 合同文档生成：占位符替换 + Word(.doc) 下载 + 打印为 PDF。
 *
 * 设计取舍：
 * - 不引入 docx / jszip 依赖。合同电子版走「Word 兼容 HTML」方案
 *   （带 Office 命名空间头的 HTML，扩展名 .doc），Word / WPS 可直接打开并继续编辑；
 *   PDF 走浏览器打印（另存为 PDF），排版由 @page 控制，A4 边距固定。
 * - 模板正文存 HTML，占位符写法 {{字段}}，替换时对值做 HTML 转义，避免破坏标签。
 */
import { formatDate, formatMoney, shortEntity } from './format'
import type { Contract, ContractTemplate } from '../types'

/** 模板里可用的占位符：key 用于 {{key}}，label 用于界面展示 */
export const TEMPLATE_TOKENS: { key: string; label: string }[] = [
  { key: '合同名称', label: '合同名称' },
  { key: '合同编号', label: '合同编号' },
  { key: '类别', label: '类别' },
  { key: '门店', label: '门店' },
  { key: '我方主体', label: '我方主体（全称）' },
  { key: '我方主体简称', label: '我方主体（简称）' },
  { key: '对方公司', label: '对方公司' },
  { key: '合同金额', label: '合同金额（¥ 格式）' },
  { key: '金额大写', label: '金额大写（人民币）' },
  { key: '签订日期', label: '签订日期' },
  { key: '生效日期', label: '生效日期' },
  { key: '到期日期', label: '到期日期' },
  { key: '提前提醒', label: '提前提醒天数' },
  { key: '备注', label: '备注' },
  { key: '今日日期', label: '今日日期（生成日）' },
]

const DIGITS = '零壹贰叁肆伍陆柒捌玖'
const UNITS = ['', '拾', '佰', '仟']
const SECTIONS = ['', '万', '亿', '万亿']

function intToUpper(n: number): string {
  if (n === 0) return '零'
  const groups: number[] = []
  let x = n
  while (x > 0) {
    groups.push(x % 10000)
    x = Math.floor(x / 10000)
  }
  let out = ''
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]
    if (g === 0) {
      if (out && !out.endsWith('零')) out += '零'
      continue
    }
    // 低一节不足四位（如 1亿0001万）需要补「零」
    if (out && g < 1000 && !out.endsWith('零')) out += '零'
    let sec = ''
    let zero = false
    const str = String(g)
    for (let j = 0; j < str.length; j++) {
      const d = Number(str[j])
      const unit = UNITS[str.length - 1 - j]
      if (d === 0) {
        zero = true
        continue
      }
      if (zero && sec) sec += '零'
      zero = false
      sec += DIGITS[d] + unit
    }
    out += sec + SECTIONS[i]
  }
  return out.replace(/零+$/, '')
}

/** 数字金额 → 人民币大写，如 1234.5 → 壹仟贰佰叁拾肆元伍角 */
export function rmbUpper(input: number | string | null | undefined): string {
  if (input === null || input === undefined || input === '') return ''
  const num = typeof input === 'string' ? Number(input) : input
  if (!Number.isFinite(num)) return ''
  const neg = num < 0
  const cents = Math.round(Math.abs(num) * 100)
  if (cents === 0) return '零元整'
  const yuan = Math.floor(cents / 100)
  const jiao = Math.floor((cents % 100) / 10)
  const fen = cents % 10
  let s = ''
  if (yuan > 0) s += intToUpper(yuan) + '元'
  if (jiao === 0 && fen === 0) {
    s += '整'
  } else {
    if (yuan > 0 && jiao === 0 && fen > 0) s += '零'
    if (jiao > 0) s += DIGITS[jiao] + '角'
    if (fen > 0) s += DIGITS[fen] + '分'
  }
  return (neg ? '负' : '') + s
}

function escapeHtml(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 把合同（或示例数据）组装成占位符字典 */
export function buildDocData(
  c: Partial<Contract> | null,
  extra?: { storeName?: string | null; today?: Date },
): Record<string, string> {
  const today = extra?.today ?? new Date()
  const ourEntity = c?.our_entity ?? ''
  return {
    合同名称: c?.title ?? '',
    合同编号: c?.contract_no ?? '',
    类别: c?.category ?? '',
    门店: extra?.storeName ?? c?.store_name ?? '',
    我方主体: ourEntity,
    我方主体简称: ourEntity ? shortEntity(ourEntity) : '',
    对方公司: c?.counterparty ?? '',
    合同金额: c?.amount === null || c?.amount === undefined ? '' : formatMoney(c.amount),
    金额大写: rmbUpper(c?.amount ?? null),
    签订日期: c?.signed_at ? formatDate(c.signed_at) : '',
    生效日期: c?.start_at ? formatDate(c.start_at) : '',
    到期日期: c?.end_at ? formatDate(c.end_at) : '',
    提前提醒: c?.remind_days?.length ? c.remind_days.map((n) => `${n}天`).join(' / ') : '',
    备注: c?.note ?? '',
    今日日期: formatDate(today.toISOString()),
  }
}

/**
 * 渲染模板：把 {{字段}} 替换成值（值做 HTML 转义，换行转 <br>）。
 * 支持默认值写法 {{字段||默认值}}：字段为空时用默认值，
 * 避免「合同金额：」这种只剩标签的空壳（例：{{合同金额||面议}}）。
 */
export function renderTemplate(body: string, data: Record<string, string>): string {
  return (body ?? '').replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_m, rawExpr: string) => {
    const [keyPart, ...rest] = rawExpr.split('||')
    const key = keyPart.trim()
    const fallback = rest.join('||').trim()
    const val = data[key]
    if (val === undefined) return `{{${key}}}` // 未知字段原样保留，方便发现拼写错误
    const out = val === '' && fallback ? fallback : val
    if (out === '') return ''
    return escapeHtml(out).replace(/\n/g, '<br>')
  })
}

/** 统计模板里用到的、但字典中不存在的占位符（用于保存前提示） */
export function unknownTokens(body: string): string[] {
  const known = new Set(TEMPLATE_TOKENS.map((t) => t.key))
  const found = new Set<string>()
  for (const m of (body ?? '').matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
    const k = m[1].trim()
    if (k && !known.has(k)) found.add(k)
  }
  return Array.from(found)
}

const WORD_STYLE = `
@page { size: A4; margin: 2.54cm 3.17cm; }
body { font-family: "宋体", SimSun, "Microsoft YaHei", serif; font-size: 12pt; line-height: 1.75; color: #000; }
h1 { font-size: 18pt; text-align: center; margin: 0 0 18pt; font-weight: bold; }
h2 { font-size: 14pt; margin: 14pt 0 8pt; }
h3 { font-size: 12pt; margin: 12pt 0 6pt; font-weight: bold; }
p { margin: 0 0 8pt; }
table { border-collapse: collapse; width: 100%; margin: 8pt 0; }
td, th { border: 1px solid #000; padding: 4pt 6pt; font-size: 10.5pt; }
th { background: #f2f2f2; font-weight: bold; text-align: center; }
`

/** 把片段包成 Word 可识别的完整 HTML 文档 */
export function toWordHtml(innerHtml: string, title: string): string {
  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>${WORD_STYLE}</style>
</head>
<body>${innerHtml}</body>
</html>`
}

function triggerDownload(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

/** 下载 Word 电子版（.doc，Word/WPS 可直接打开并继续编辑） */
export function downloadWord(innerHtml: string, filename: string, title: string) {
  const html = toWordHtml(innerHtml, title)
  const name = /\.docx?$/i.test(filename) ? filename : `${filename}.doc`
  triggerDownload(new Blob(['\ufeff' + html], { type: 'application/msword' }), name)
}

/** 打印（浏览器里选「另存为 PDF」即可得到 PDF 电子版） */
export function printHtml(innerHtml: string, title: string): boolean {
  const w = window.open('', '_blank', 'width=900,height=1000')
  if (!w) return false
  w.document.open()
  w.document.write(toWordHtml(innerHtml, title))
  w.document.close()
  w.focus()
  // 等样式与字体应用后再唤起打印，避免打出空白页
  setTimeout(() => {
    try {
      w.print()
    } catch {
      /* 用户可能已关闭窗口 */
    }
  }, 350)
  return true
}

/** 生成文件名：合同名称-模板名 */
export function docFilename(contractTitle: string, templateName: string): string {
  const safe = (s: string) => (s || '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
  return `${safe(contractTitle) || '合同'}-${safe(templateName) || '模板'}`
}

/** 便捷方法：用模板 + 数据直接产出片段 HTML */
export function buildDoc(
  template: Pick<ContractTemplate, 'body' | 'name'>,
  contract: Partial<Contract> | null,
  extra?: { storeName?: string | null },
): { html: string; filename: string } {
  const data = buildDocData(contract, extra)
  const html = renderTemplate(template.body, data)
  return { html, filename: docFilename(contract?.title ?? '', template.name) }
}
