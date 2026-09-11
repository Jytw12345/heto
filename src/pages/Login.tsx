import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Button, Field, inputCls } from '../components/ui'
import { useToast } from '../components/Toast'
import { checkPassword } from '../lib/password'

export default function Login() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const { push } = useToast()

  const pwCheck = mode === 'signup' ? checkPassword(password) : null

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        // 校验账号是否停用（profiles.active）
        const { data: me } = await supabase.auth.getUser()
        const { data: prof } = await supabase
          .from('profiles')
          .select('active')
          .eq('id', me.user?.id ?? '')
          .maybeSingle()
        if (!prof || prof.active === false) {
          await supabase.auth.signOut()
          push('账号已停用，请联系总部', 'err')
          setBusy(false)
          return
        }
        navigate('/')
      } else {
        if (!fullName.trim()) {
          push('请填写姓名', 'err')
          setBusy(false)
          return
        }
        const check = checkPassword(password)
        if (!check.ok) {
          push(check.msg, 'err')
          setBusy(false)
          return
        }
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName.trim() } },
        })
        if (error) throw error
        push('注册成功，请联系总部分配门店后再登录', 'ok')
        setMode('signin')
      }
    } catch (e) {
      push(e instanceof Error ? e.message : '操作失败', 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl bg-slate-900 text-base font-medium text-white">
            合
          </div>
          <h1 className="text-lg font-medium text-slate-900">合同云</h1>
          <p className="mt-1 text-xs text-slate-500">连锁门店合同管理与到期提醒</p>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
          <Field label="邮箱">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </Field>
          {mode === 'signup' && (
            <Field label="姓名">
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className={inputCls}
                placeholder="请输入您的姓名"
                autoComplete="name"
              />
            </Field>
          )}
          <Field label="密码">
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${inputCls} pr-10`}
                placeholder={mode === 'signup' ? '大写+小写+数字，数字不重复不连续' : '请输入密码'}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-0 flex items-center justify-center px-3 text-slate-400 hover:text-slate-600 focus:outline-none"
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
                tabIndex={-1}
              >
                {showPassword ? <EyeOpen /> : <EyeClosed />}
              </button>
            </div>
            {mode === 'signup' && password.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 text-[11px]">
                <Req ok={pwCheck!.items.len}>至少 8 位</Req>
                <Req ok={pwCheck!.items.upper}>含大写字母（A-Z）</Req>
                <Req ok={pwCheck!.items.lower}>含小写字母（a-z）</Req>
                <Req ok={pwCheck!.items.digit}>含数字（0-9）</Req>
                <Req ok={pwCheck!.items.digitUnique}>数字不重复（如 11、22 不行）</Req>
                <Req ok={pwCheck!.items.digitNoSeq}>数字不连续（如 12、21 不行）</Req>
              </ul>
            )}
          </Field>
          <Button type="submit" variant="primary" disabled={busy} className="w-full">
            {busy ? '处理中…' : mode === 'signin' ? '登录' : '注册'}
          </Button>

          <button
            type="button"
            onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
            className="w-full text-center text-xs text-slate-500 hover:text-slate-800"
          >
            {mode === 'signin' ? '没有账号？注册一个' : '已有账号？返回登录'}
          </button>
        </form>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-400">
          账号由总部统一开通并分配门店。
          <br />
          未分配门店的账号登录后将看不到任何数据。
        </p>
      </div>
    </div>
  )
}

function Req({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className={ok ? 'text-emerald-600' : 'text-slate-400'}>
      <span className="mr-1 inline-block w-3">{ok ? '✓' : '○'}</span>
      {children}
    </li>
  )
}

function EyeOpen({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeClosed({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  )
}
