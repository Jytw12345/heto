import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Permissions, PositionTemplate, Profile } from '../types'
import { resolvePerms } from '../lib/permissions'

interface AuthCtx {
  session: Session | null
  user: User | null
  profile: Profile | null
  loading: boolean
  isHq: boolean
  perms: Record<string, boolean>
  can: (key: keyof Permissions) => boolean
  canAny: (keys: (keyof Permissions)[]) => boolean
  positionTemplates: PositionTemplate[]
  refreshPositionTemplates: () => Promise<void>
  refreshProfile: () => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthCtx>({
  session: null,
  user: null,
  profile: null,
  loading: true,
  isHq: false,
  perms: {},
  can: () => false,
  canAny: () => false,
  positionTemplates: [],
  refreshPositionTemplates: async () => {},
  refreshProfile: async () => {},
  signOut: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [positionTemplates, setPositionTemplates] = useState<PositionTemplate[]>([])

  const loadProfile = async (uid: string) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle()
    const p = (data as Profile) ?? null
    // 已停用账号：强制登出，防止通过刷新 / 仍有效的 token 绕过登录拦截
    if (p && p.active === false) {
      await supabase.auth.signOut()
      setProfile(null)
      return
    }
    setProfile(p)
  }

  const loadTemplates = useCallback(async () => {
    // 表不存在/无权限时静默降级，账号回落到 role 默认权限
    const { data, error } = await supabase.from('position_templates').select('*')
    if (!error) setPositionTemplates((data as PositionTemplate[]) ?? [])
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) loadProfile(data.session.user.id).finally(() => setLoading(false))
      else setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      if (s?.user) loadProfile(s.user.id)
      else setProfile(null)
    })
    loadTemplates()
    return () => sub.subscription.unsubscribe()
  }, [loadTemplates])

  const templatesById = useMemo(() => {
    const m: Record<string, PositionTemplate> = {}
    for (const t of positionTemplates) m[t.id] = t
    return m
  }, [positionTemplates])

  const perms = useMemo<Record<string, boolean>>(
    () =>
      resolvePerms(
        profile,
        profile?.position_template_id ? templatesById[profile.position_template_id]?.permissions : undefined,
      ),
    [profile, templatesById],
  )

  const value = useMemo<AuthCtx>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      isHq: profile?.role === 'hq',
      perms,
      can: (k) => !!perms[k],
      canAny: (ks) => ks.some((k) => perms[k]),
      positionTemplates,
      refreshPositionTemplates: loadTemplates,
      refreshProfile: async () => {
        if (session?.user) await loadProfile(session.user.id)
      },
      signOut: async () => {
        await supabase.auth.signOut()
        setProfile(null)
      },
    }),
    [session, profile, loading, perms, positionTemplates, templatesById],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)
