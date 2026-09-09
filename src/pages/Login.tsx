import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Button, Field, inputCls } from '../components/ui'
import { useToast } from '../components/Toast'

export default function Login() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const { push } = useToast()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        navigate('/')
      } else {
        const { error } = await supabase.auth.signUp({ email, password })
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
          <Field label="密码">
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputCls}
              placeholder="至少 6 位"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
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
