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
