import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { Button, Empty } from '../components/ui'
import { dueLevel, formatMoney } from '../lib/format'
import type { AppNotification, Contract } from '../types'

export default function Reminders() {
  const { user } = useAuth()
  const [tab, setTab] = useState<'due' | 'inbox'>('due')
  const [rows, setRows] = useState<Contract[]>([])
  const [notifs, setNotifs] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data }, { data: n }] = await Promise.all([
      supabase
        .from('v_contracts')
        .select('*')
        .eq('status', 'active')
        .not('end_at', 'is', null)
        .order('end_at', { ascending: true }),
      supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100),
    ])
    setRows((data as Contract[]) ?? [])
    setNotifs((n as AppNotification[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const groups: { key: string; title: string; items: Contract[] }[] = [
    { key: 'over', title: '已过期', items: rows.filter((r) => (r.days_left ?? 0) < 0) },
    {
      key: 'w1',
      title: '7 天内',
      items: rows.filter((r) => (r.days_left ?? 0) >= 0 && (r.days_left ?? 0) <= 7),
    },
    {
      key: 'm1',
      title: '8–30 天',
      items: rows.filter((r) => (r.days_left ?? 0) > 7 && (r.days_left ?? 0) <= 30),
    },
    {
      key: 'm3',
      title: '31–90 天',
      items: rows.filter((r) => (r.days_left ?? 0) > 30 && (r.days_left ?? 0) <= 90),
    },
  ]

  async function markAllRead() {
    if (!user) return
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', user.id).is('read_at', null)
    load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <TabBtn active={tab === 'due'} onClick={() => setTab('due')}>
          到期清单
        </TabBtn>
        <TabBtn active={tab === 'inbox'} onClick={() => setTab('inbox')}>
          我的提醒
          {notifs.filter((n) => !n.read_at).length > 0 && (
            <span className="ml-1.5 rounded-full bg-red-500 px-1.5 text-[11px] text-white">
              {notifs.filter((n) => !n.read_at).length}
            </span>
          )}
        </TabBtn>
        <div className="flex-1" />
        {tab === 'inbox' && notifs.some((n) => !n.read_at) && (
          <Button onClick={markAllRead}>全部标为已读</Button>
        )}
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white">
          <Empty text="加载中…" />
        </div>
      ) : tab === 'due' ? (
        <div className="space-y-4">
          {groups.every((g) => g.items.length === 0) && (
            <div className="rounded-xl border border-slate-200 bg-white">
              <Empty text="未来 90 天内没有到期的合同" />
            </div>
          )}
          {groups.map(
            (g) =>
              g.items.length > 0 && (
                <div key={g.key} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-600">
                    {g.title} · {g.items.length}
                  </div>
                  <ul className="divide-y divide-slate-100">
                    {g.items.map((c) => {
                      const lv = dueLevel(c.days_left ?? null)
                      return (
                        <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                          <div className="min-w-0 flex-1">
                            <Link
                              to={`/contracts/${c.id}`}
                              className="truncate text-sm text-slate-800 hover:underline"
                            >
                              {c.title}
                            </Link>
                            <div className="text-xs text-slate-400">
                              {c.store_name} · {c.end_at} · {formatMoney(c.amount)}
                            </div>
                          </div>
                          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${lv.className}`}>
                            {lv.label}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ),
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {notifs.length === 0 ? (
            <Empty text="暂无提醒" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {notifs.map((n) => (
                <li key={n.id} className={`px-4 py-3 ${n.read_at ? '' : 'bg-amber-50/40'}`}>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-slate-800">{n.title}</div>
                      {n.body && <div className="mt-0.5 text-xs text-slate-500">{n.body}</div>}
                      <div className="mt-1 text-[11px] text-slate-400">
                        {new Date(n.created_at).toLocaleString('zh-CN')}
                      </div>
                    </div>
                    {n.contract_id && (
                      <Link
                        to={`/contracts/${n.contract_id}`}
                        className="shrink-0 text-xs text-slate-500 hover:text-slate-900"
                      >
                        查看 →
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm transition ${
        active ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600'
      }`}
    >
      {children}
    </button>
  )
}
