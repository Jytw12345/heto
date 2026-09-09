import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

const NAV = [
  { to: '/', label: '概览', end: true, show: () => true },
  { to: '/contracts', label: '合同', end: false, show: () => true },
  { to: '/reminders', label: '到期提醒', end: false, show: () => true },
  { to: '/admin', label: '门店与账号', end: false, show: (ctx: { isHq: boolean }) => ctx.isHq },
  { to: '/audit', label: '审计日志', end: false, show: (ctx: { can: (k: any) => boolean }) => ctx.can('audit.view') },
  { to: '/settings', label: '设置', end: false, show: () => true },
]

export default function Layout() {
  const { profile, isHq, signOut, user, can } = useAuth()
  const navigate = useNavigate()
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    if (!user) return
    const load = async () => {
      const { count } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .is('read_at', null)
      setUnread(count ?? 0)
    }
    load()
    const ch = supabase
      .channel('notif')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        load,
      )
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [user])

  const items = NAV.filter((n) => n.show({ isHq, can }))

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <Link to="/" className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-600 text-sm font-medium text-white">
              合
            </div>
            <span className="text-sm font-medium text-slate-900">合同云</span>
          </Link>

          <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
            {items.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `relative shrink-0 rounded-lg px-3 py-1.5 text-sm transition ${
                    isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'
                  }`
                }
              >
                {n.label}
                {n.to === '/reminders' && unread > 0 && (
                  <span className="ml-1.5 inline-block min-w-[18px] rounded-full bg-red-500 px-1 text-center text-[11px] leading-[18px] text-white">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-xs font-medium text-slate-800">
                {profile?.full_name || user?.email}
              </div>
              <div className="text-[11px] text-slate-400">
                {isHq ? '总部 · 全部门店' : (profile?.store_id ? '门店账号' : '待分配门店')}
              </div>
            </div>
            <button
              onClick={async () => {
                await supabase.rpc('write_audit', { p_action: 'logout' })
                await signOut()
                navigate('/login')
              }}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
            >
              退出
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}