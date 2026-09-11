import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, Cell, Label, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { Card, Empty, Pill, StatCard } from '../components/ui'
import { dueLevel, formatBytes, formatMoney } from '../lib/format'
import type { Contract } from '../types'

const STATUS_COLORS = ['#64748b', '#059669', '#2563eb', '#dc2626', '#9ca3af']

const S_ICONS = {
  files: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
    </svg>
  ),
  trend: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 7 13.5 15.5 8.5 10.5 2 17" /><path d="M16 7h6v6" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  ),
  alert: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" />
    </svg>
  ),
  card: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="3" /><path d="M2 10h20" /><path d="M6 15h4" />
    </svg>
  ),
}

export default function Dashboard() {
  const { isHq, profile } = useAuth()
  const [rows, setRows] = useState<Contract[]>([])
  const [storeUsage, setStoreUsage] = useState<{ name: string; bytes: number }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      const [{ data }, { data: usage }] = await Promise.all([
        supabase.from('v_contracts').select('*').order('end_at', { ascending: true }),
        supabase.from('contract_files').select('size_bytes, stores(name)'),
      ])
      setRows((data as Contract[]) ?? [])

      const map = new Map<string, number>()
      const uRows = (usage ?? []) as unknown as {
        size_bytes: number
        stores: { name: string } | null
      }[]
      uRows.forEach((r) => {
        const n = r.stores?.name ?? '未知'
        map.set(n, (map.get(n) ?? 0) + r.size_bytes)
      })
      setStoreUsage(
        isHq
          ? [...map.entries()].map(([name, bytes]) => ({ name, bytes })).sort((a, b) => b.bytes - a.bytes)
          : [],
      )
      setLoading(false)
    })()
  }, [isHq])

  const active = rows.filter((r) => r.status === 'active')
  const total = rows.length
  const soon = active.filter((r) => {
    const d = r.days_left
    return d !== null && d !== undefined && d >= 0 && d <= 30
  })
  const overdue = active.filter((r) => {
    const d = r.days_left
    return d !== null && d !== undefined && d < 0
  })
  const amount = active.reduce((s, r) => s + (r.amount ?? 0), 0)
  const upcoming = active
    .filter((r) => r.days_left !== null)
    .sort((a, b) => (a.days_left ?? 0) - (b.days_left ?? 0))
    .slice(0, 8)

  // 近 30 天新增（按录入系统时间 created_at 判断）
  const DAY = 86_400_000
  const recentThreshold = Date.now() - 30 * DAY
  const recentAdded = rows
    .filter((r) => {
      const t = new Date(r.created_at).getTime()
      return !Number.isNaN(t) && t >= recentThreshold
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 8)

  // 状态分布
  const byStatus = ['draft', 'active', 'renewed', 'expired', 'cancelled'].map((s, i) => ({
    name: ({ draft: '草稿', active: '履行中', renewed: '已续签', expired: '已到期', cancelled: '已作废' } as Record<string, string>)[s],
    value: rows.filter((r) => r.status === s).length,
    color: STATUS_COLORS[i] ?? '#64748b',
  }))

  // 类别分布
  const byCategory = (() => {
    const map = new Map<string, number>()
    rows.forEach((r) => {
      const k = r.category || '未分类'
      map.set(k, (map.get(k) ?? 0) + 1)
    })
    return [...map.entries()].map(([name, value]) => ({ name, value }))
  })()

  // 金额区间分布（按 5 万桶）
  const amountBuckets = (() => {
    const buckets = [
      { name: '<1万', min: 0, max: 10_000, n: 0 },
      { name: '1-5万', min: 10_000, max: 50_000, n: 0 },
      { name: '5-10万', min: 50_000, max: 100_000, n: 0 },
      { name: '10-50万', min: 100_000, max: 500_000, n: 0 },
      { name: '50万+', min: 500_000, max: Infinity, n: 0 },
    ]
    active.forEach((r) => {
      const a = r.amount ?? 0
      const b = buckets.find((x) => a >= x.min && a < x.max)
      if (b) b.n++
    })
    return buckets.map(({ name, n }) => ({ name, value: n }))
  })()

  return (
    <div className="space-y-4">
      {!isHq && !profile?.store_id && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          你的账号还没有分配门店，暂时看不到任何合同。请联系总部在「门店与账号」里完成分配。
        </div>
      )}

      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        <StatCard label="合同总数" value={String(total)} icon={S_ICONS.files} tone="indigo" />
        <StatCard
          label="近30天新增"
          value={String(recentAdded.length)}
          icon={S_ICONS.trend}
          tone={recentAdded.length ? 'emerald' : 'slate'}
          trend={recentAdded.length ? `+${recentAdded.length}` : undefined}
        />
        <StatCard label="30 天内到期" value={String(soon.length)} icon={S_ICONS.clock} tone={soon.length ? 'amber' : 'slate'} />
        <StatCard
          label="已过期未处理"
          value={String(overdue.length)}
          icon={S_ICONS.alert}
          tone={overdue.length ? 'red' : 'slate'}
        />
        <StatCard label="在履行金额" value={formatMoney(amount)} icon={S_ICONS.card} tone="slate" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card
          title="即将到期"
          extra={<Link to="/reminders" className="text-xs text-slate-500 hover:text-slate-900">全部 →</Link>}
        >
          {loading ? (
            <Empty text="加载中…" />
          ) : upcoming.length === 0 ? (
            <Empty text="暂无到期压力" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {upcoming.map((c) => {
                const lv = dueLevel(c.days_left ?? null)
                return (
                  <li key={c.id} className="flex items-center gap-3 py-1.5">
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/contracts/${c.id}`}
                        className="truncate text-sm text-slate-800 hover:underline"
                      >
                        {c.title}
                      </Link>
                      <div className="text-xs text-slate-400">
                        {isHq ? `${c.store_name} · ` : ''}
                        {c.end_at}
                      </div>
                    </div>
                    <Pill className={lv.className}>{lv.label}</Pill>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card
          title="近期新增"
          extra={<Link to="/contracts" className="text-xs text-slate-500 hover:text-slate-900">全部 →</Link>}
        >
          {loading ? (
            <Empty text="加载中…" />
          ) : recentAdded.length === 0 ? (
            <Empty text="近 30 天暂无新增" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {recentAdded.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-1.5">
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/contracts/${c.id}`}
                      className="truncate text-sm text-slate-800 hover:underline"
                    >
                      {c.title}
                    </Link>
                    <div className="text-xs text-slate-400">
                      {isHq ? `${c.store_name} · ` : ''}
                      录入 {c.created_at?.slice(0, 10)}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs font-medium text-slate-500">
                    {formatMoney(c.amount ?? 0)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {isHq && (
          <Card title="扫描件占用（按门店）">
            {storeUsage.length === 0 ? (
              <Empty text="还没有上传记录" />
            ) : (
              <ul className="space-y-2">
                {storeUsage.map((s) => (
                  <li key={s.name}>
                    <div className="flex justify-between text-xs text-slate-600">
                      <span>{s.name}</span>
                      <span>{formatBytes(s.bytes)}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full bg-[var(--brand)]"
                        style={{
                          width: `${Math.max(4, (s.bytes / storeUsage[0].bytes) * 100)}%`,
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      {isHq && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="状态分布">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={byStatus}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="45%"
                  innerRadius={42}
                  outerRadius={66}
                  paddingAngle={1}
                >
                  {byStatus.map((d, i) => (
                    <Cell key={i} fill={d.color} />
                  ))}
                  <Label
                    position="center"
                    content={({ viewBox }) => {
                      const { cx, cy } = viewBox as { cx: number; cy: number }
                      return (
                        <g>
                          <text x={cx} y={cy - 6} textAnchor="middle" className="fill-slate-800" style={{ fontSize: 20, fontWeight: 700 }}>
                            {rows.length}
                          </text>
                          <text x={cx} y={cy + 12} textAnchor="middle" className="fill-slate-400" style={{ fontSize: 11 }}>
                            合同总数
                          </text>
                        </g>
                      )
                    }}
                  />
                </Pie>
                <Tooltip />
                <Legend
                  verticalAlign="bottom"
                  height={24}
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 11 }}
                  formatter={(value) => {
                    const rec = byStatus.find((b) => b.name === value)
                    return `${value}  ${rec?.value ?? ''}`
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </Card>
          <Card title="类别分布">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={byCategory}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" fill="var(--brand)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
          <Card title="在履行合同金额分布">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={amountBuckets}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="value" fill="var(--brand)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}
    </div>
  )
}