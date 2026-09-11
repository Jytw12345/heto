import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { ThemeSwitcher } from './ThemeSwitcher'

type Ctx = { isHq: boolean; can: (k: any) => boolean }

const ICONS: Record<string, ReactNode> = {
  overview: (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  contract: (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
      <path d="M16 13H8" /><path d="M16 17H8" /><path d="M10 9H8" />
    </svg>
  ),
  bell: (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  ),
  users: (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  audit: (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  menu: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12h18" /><path d="M3 6h18" /><path d="M3 18h18" />
    </svg>
  ),
  logout: (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" />
    </svg>
  ),
}

const NAV: {
  to: string
  label: string
  title: string
  desc: string
  end?: boolean
  icon: ReactNode
  show: (c: Ctx) => boolean
}[] = [
  { to: '/', label: '概览', title: '概览', desc: '合同全局视图与统计', end: true, icon: ICONS.overview, show: () => true },
  { to: '/contracts', label: '合同', title: '合同', desc: '全部合同与多维筛选', icon: ICONS.contract, show: () => true },
  { to: '/reminders', label: '到期提醒', title: '到期提醒', desc: '即将到期与已逾期', icon: ICONS.bell, show: () => true },
  { to: '/admin', label: '门店与账号', title: '门店与账号', desc: '门店与成员管理', icon: ICONS.users, show: (c) => c.isHq },
  { to: '/audit', label: '审计日志', title: '审计日志', desc: '关键操作留痕', icon: ICONS.audit, show: (c) => c.can('audit.view') },
  { to: '/settings', label: '设置', title: '设置', desc: '个人与系统设置', icon: ICONS.settings, show: () => true },
]

export default function Layout() {
  const { profile, isHq, signOut, user, can, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [unread, setUnread] = useState(0)
  const [drawer, setDrawer] = useState(false)

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
  const active =
    items.find((n) => (n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to))) ??
    items[0]

  // 未分配：profile 不存在、角色未设置、或非总部账号但没有 store_id。
  const isUnassigned = !loading && (!profile || !profile.role || (profile.role !== 'hq' && !profile.store_id))

  const doSignOut = async () => {
    await supabase.rpc('write_audit', { p_action: 'logout' })
    await signOut()
    navigate('/login')
  }

  const sidebar = (
    <Sidebar
      items={isUnassigned ? [] : items}
      activePath={location.pathname}
      unread={unread}
      user={user}
      profile={profile}
      isHq={isHq}
      onNavigate={() => setDrawer(false)}
      onSignOut={doSignOut}
    />
  )

  return (
    <div className="min-h-screen app-bg">
      {/* 桌面端：固定左侧栏 */}
      <div className="hidden md:fixed md:inset-y-0 md:left-0 md:z-40 md:block">{sidebar}</div>

      {/* 移动端：顶部条 + 抽屉 */}
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur md:hidden">
        <button
          onClick={() => setDrawer(true)}
          className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
          aria-label="打开菜单"
        >
          {ICONS.menu}
        </button>
        <Brand compact onClick={() => setDrawer(false)} />
      </div>

      {drawer && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 w-64 shadow-xl">{sidebar}</div>
        </div>
      )}

      {/* 主区域 */}
      <div className="md:pl-64">
        {isUnassigned ? (
          <main className="px-4 py-10">
            <UnassignedPage email={user?.email} />
          </main>
        ) : (
          <>
            <header className="md:sticky md:top-0 z-20 border-b border-slate-200/70 bg-white/80 px-4 py-3.5 backdrop-blur sm:px-6">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="truncate text-base font-semibold text-slate-900">{active?.title}</h1>
                  {active?.desc && <p className="truncate text-xs text-slate-400">{active.desc}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <ThemeSwitcher />
                  <Link
                    to="/reminders"
                    className="relative grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                    aria-label="到期提醒"
                  >
                  {ICONS.bell}
                  {unread > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-[18px] -translate-y-0 translate-x-0 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-medium leading-[18px] text-white ring-2 ring-white">
                      {unread > 99 ? '99+' : unread}
                    </span>
                  )}
                </Link>
                </div>
              </div>
            </header>
            <main className="px-4 py-6 sm:px-6">
              <Outlet />
            </main>
          </>
        )}
      </div>
    </div>
  )
}

function Brand({ compact, dark, onClick }: { compact?: boolean; dark?: boolean; onClick?: () => void }) {
  return (
    <Link to="/" onClick={onClick} className="flex items-center gap-2.5">
      <div className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--brand)] text-base font-semibold text-white shadow-sm">
        合
      </div>
      <div className="leading-tight">
        <div className={`text-sm font-semibold ${dark ? 'text-white' : 'text-slate-900'}`}>合同云</div>
        {!compact && <div className={`text-[11px] ${dark ? 'text-stone-400' : 'text-slate-400'}`}>连锁合同管理</div>}
      </div>
    </Link>
  )
}

function Sidebar({
  items,
  activePath,
  unread,
  user,
  profile,
  isHq,
  onNavigate,
  onSignOut,
}: {
  items: typeof NAV
  activePath: string
  unread: number
  user: { email?: string | null } | null
  profile: { full_name?: string | null; store_id?: string | null; role?: string | null } | null
  isHq: boolean
  onNavigate: () => void
  onSignOut: () => void
}) {
  const name = profile?.full_name || user?.email || ''
  const initials = name.trim().slice(0, 1).toUpperCase() || '?'

  return (
    <div className="flex h-full w-64 flex-col border-r border-white/10 bg-gradient-to-b from-stone-900 to-[#15130f]">
      <div className="flex h-16 items-center px-5">
        <Brand dark />
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {items.length === 0 ? (
          <div className="px-3 py-2 text-sm text-stone-500">账号待分配</div>
        ) : (
          items.map((n) => {
            const isActive = n.to === '/' ? activePath === '/' : activePath.startsWith(n.to)
            return (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                onClick={onNavigate}
                className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  isActive ? 'bg-white/[0.08] text-white shadow-[inset_2px_0_0_0_var(--brand)]' : 'text-stone-400 hover:bg-white/5 hover:text-stone-200'
                }`}
              >
                <span className={isActive ? 'text-[var(--brand)]' : 'text-stone-400 transition group-hover:text-stone-300'}>
                  {n.icon}
                </span>
                <span className="flex-1">{n.label}</span>
                {n.to === '/reminders' && unread > 0 && (
                  <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-center text-[11px] font-medium leading-[18px] text-white">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </NavLink>
            )
          })
        )}
      </nav>

      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-3 rounded-xl px-2 py-2">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--brand)] text-sm font-medium text-white">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-stone-100">{profile?.full_name || user?.email}</div>
            <div className="truncate text-[11px] text-stone-400">
              {isHq ? '总部 · 全部门店' : profile?.store_id ? '门店账号' : '待分配门店'}
            </div>
          </div>
          <button
            onClick={onSignOut}
            className="rounded-lg p-2 text-stone-400 transition hover:bg-white/10 hover:text-white"
            aria-label="退出登录"
            title="退出登录"
          >
            {ICONS.logout}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 新注册 / 未分配权限账号看到的占位页 */
function UnassignedPage({ email }: { email?: string | null }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
      <div className="mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-slate-100 text-slate-400">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" strokeLinecap="round" />
        </svg>
      </div>
      <h1 className="text-lg font-semibold text-slate-800">账号待分配</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">
        你的账号已成功登录，但还没有被分配门店与系统权限，暂无法使用业务功能。
        <br />
        请联系管理员（总部）完成账号分配后，即可正常使用。
      </p>
      {email && (
        <div className="mt-4 rounded-lg bg-slate-50 px-4 py-2 text-xs text-slate-400">当前登录：{email}</div>
      )}
    </div>
  )
}
