export function formatMoney(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  return '¥' + Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatBytes(n: number): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1)
  return (n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i]
}

export function formatDate(d: string | null | undefined, withTime = false): string {
  if (!d) return '—'
  if (withTime) {
    const dt = new Date(d)
    if (Number.isNaN(dt.getTime())) return d.slice(0, 10)
    return dt.toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-')
  }
  return d.slice(0, 10)
}

/** 剩余天数：<0 已过期，null 无到期日 */
export function daysLeft(endAt: string | null): number | null {
  if (!endAt) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const end = new Date(endAt + 'T00:00:00')
  return Math.round((end.getTime() - today.getTime()) / 86400000)
}

/**
 * 我方主体名称简写：优先用数据库手动维护的 shortName（最多 4 字），
 * 未维护时再走自动逻辑——关键词别名表精确匹配或剥离行政区划+后缀词兜底。
 * 例：济宁市万紫千红文化传媒有限公司 → 万紫千红；济宁佳印图文有限公司 → 佳印图文
 * 若简写后为空或超 4 字则截断，保证表格紧凑且不丢关键信息。
 */
const ENTITY_ALIASES: { match: string; alias: string }[] = [
  { match: '佳印图文', alias: '佳印图文' },
  { match: '万紫千红', alias: '万紫千红' },
  { match: '裕昌', alias: '裕昌' },
  // 如需新增主体简写，在此加一行：{ match: '主体名包含的词', alias: '最多4字简写' }
]

export function shortEntity(name?: string | null, shortName?: string | null): string {
  if (!name) return '—'
  // 手动维护的简写优先（仍限 4 字，避免超长破坏表格列宽）
  if (shortName && shortName.trim()) {
    const s = shortName.trim()
    return s.length > 4 ? s.slice(0, 4) : s
  }
  const raw = name.trim()
  // 精确别名优先：命中即返回，避免自动剥离不可控
  for (const a of ENTITY_ALIASES) {
    if (raw.includes(a.match)) return a.alias
  }
  let s = raw.replace(/[（(].*?[)）]/g, '').trim()
  const prefixes = ['中国', '山东省', '济宁市任城区', '济宁市', '任城区', '市中区', '高新区']
  for (const p of prefixes) {
    if (s.startsWith(p)) {
      s = s.slice(p.length)
      break
    }
  }
  const suffixes = [
    '集团有限公司', '股份有限公司', '有限责任公司', '有限公司', '集团',
    '销售中心', '服务中心', '文化传媒', '办公设备', '贸易', '商贸',
    '科技', '实业', '商务', '信息', '咨询', '制造', '设备',
  ]
  let changed = true
  while (changed) {
    changed = false
    for (const suf of suffixes) {
      if (s.endsWith(suf) && s.length > suf.length) {
        s = s.slice(0, -suf.length)
        changed = true
      }
    }
  }
  s = s.trim()
  // 兜底：简写最长 4 个汉字，超出截断
  if (s.length > 4) s = s.slice(0, 4)
  return s || raw
}

export interface DueLevel {
  label: string
  className: string
}

/** 到期紧急度：已过期 / 7 天内 / 30 天内 / 正常 */
export function dueLevel(days: number | null): DueLevel {
  if (days === null) return { label: '无到期日', className: 'bg-slate-100 text-slate-600' }
  if (days < 0) return { label: `已过期 ${-days} 天`, className: 'bg-red-100 text-red-700' }
  if (days === 0) return { label: '今天到期', className: 'bg-red-100 text-red-700' }
  if (days <= 7) return { label: `${days} 天后到期`, className: 'bg-orange-100 text-orange-700' }
  if (days <= 30) return { label: `${days} 天后到期`, className: 'bg-amber-100 text-amber-700' }
  return { label: `${days} 天后到期`, className: 'bg-emerald-100 text-emerald-700' }
}
