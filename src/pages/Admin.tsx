import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Button, Card, Empty, Field, Modal, inputCls } from '../components/ui'
import { useToast } from '../components/Toast'
import type { Permissions, Profile, Role, Store } from '../types'
import { ALL_PERMS, ROLE_PRESET, resolvePerms } from '../lib/permissions'

interface AccountRow {
  id: string
  email: string
  profile: Profile | null
}

export default function Admin() {
  const { push } = useToast()
  const [stores, setStores] = useState<Store[]>([])
  const [accounts, setAccounts] = useState<AccountRow[]>([])
  const [loading, setLoading] = useState(true)
  const [storeModal, setStoreModal] = useState<Store | 'new' | null>(null)
  const [permModal, setPermModal] = useState<AccountRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: s }, { data: p }, { data: u }] = await Promise.all([
      supabase.from('stores').select('*').order('name'),
      supabase.from('profiles').select('*'),
      supabase.rpc('admin_list_users'),
    ])
    setStores((s as Store[]) ?? [])
    const profiles = (p as Profile[]) ?? []
    const users = (u as { id: string; email: string }[]) ?? []
    setAccounts(
      users.map((x) => ({
        id: x.id,
        email: x.email,
        profile: profiles.find((pp) => pp.id === x.id) ?? null,
      })),
    )
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function patchAccount(uid: string, payload: Partial<Profile>) {
    const { error } = await supabase.from('profiles').update(payload).eq('id', uid)
    if (error) return push(error.message, 'err')
    await supabase.rpc('write_audit', {
      p_action: 'profile.update',
      p_resource: 'profile',
      p_resource_id: uid,
      p_payload: payload,
    })
    push('已更新', 'ok')
    load()
  }

  return (
    <div className="space-y-4">
      <Card
        title="门店"
        extra={
          <Button variant="primary" onClick={() => setStoreModal('new')}>
            + 新增门店
          </Button>
        }
      >
        {loading ? (
          <Empty text="加载中…" />
        ) : stores.length === 0 ? (
          <Empty text="还没有门店" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {stores.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-800">
                    {s.name}
                    {!s.active && <span className="ml-2 text-xs text-slate-400">已停用</span>}
                  </div>
                  <div className="text-xs text-slate-400">
                    {[s.code, s.manager, s.phone].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>
                <Button variant="ghost" onClick={() => setStoreModal(s)}>
                  编辑
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="账号与权限">
        {loading ? (
          <Empty text="加载中…" />
        ) : accounts.length === 0 ? (
          <Empty text="还没有账号" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {accounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-slate-800">{a.email}</div>
                  <div className="text-xs text-slate-400">
                    {a.profile?.full_name || '未设置姓名'}
                    {a.profile && !a.profile.active && ' · 已停用'}
                  </div>
                </div>

                <select
                  className={`${inputCls} w-auto py-1 text-xs`}
                  value={a.profile?.role ?? 'store'}
                  onChange={(e) => patchAccount(a.id, { role: e.target.value as Role })}
                >
                  <option value="store">{ROLE_PRESET.store.label}</option>
                  <option value="hq">{ROLE_PRESET.hq.label}</option>
                </select>

                <select
                  className={`${inputCls} w-auto py-1 text-xs`}
                  value={a.profile?.store_id ?? ''}
                  onChange={(e) => patchAccount(a.id, { store_id: e.target.value || null })}
                >
                  <option value="">未分配</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>

                <Button variant="ghost" onClick={() => setPermModal(a)}>
                  权限
                </Button>

                <Button
                  variant="ghost"
                  onClick={() => patchAccount(a.id, { active: !a.profile?.active })}
                >
                  {a.profile?.active === false ? '启用' : '停用'}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs leading-relaxed text-slate-400">
          新账号默认「门店 + 未分配」，必须在这里指定门店才能看到数据。
          角色决定默认权限，「权限」按钮可逐项覆盖（true = 额外允许 / false = 收回默认）。
        </p>
      </Card>

      <StoreModal
        open={!!storeModal}
        store={storeModal === 'new' ? null : storeModal}
        onClose={() => setStoreModal(null)}
        onSaved={load}
      />
      {permModal && (
        <PermissionModal
          account={permModal}
          onClose={() => setPermModal(null)}
          onSaved={async (payload) => {
            await patchAccount(permModal.id, payload)
            setPermModal(null)
          }}
        />
      )}
    </div>
  )
}

function StoreModal({
  open,
  store,
  onClose,
  onSaved,
}: {
  open: boolean
  store: Store | null
  onClose: () => void
  onSaved: () => void
}) {
  const { push } = useToast()
  const [form, setForm] = useState({ name: '', code: '', manager: '', phone: '', address: '' })

  useEffect(() => {
    if (!open) return
    setForm({
      name: store?.name ?? '',
      code: store?.code ?? '',
      manager: store?.manager ?? '',
      phone: store?.phone ?? '',
      address: store?.address ?? '',
    })
  }, [open, store])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return push('门店名称不能为空', 'err')
    const payload = {
      name: form.name.trim(),
      code: form.code.trim() || null,
      manager: form.manager.trim() || null,
      phone: form.phone.trim() || null,
      address: form.address.trim() || null,
    }
    const { error } = store
      ? await supabase.from('stores').update(payload).eq('id', store.id)
      : await supabase.from('stores').insert(payload)
    if (error) return push(error.message, 'err')
    await supabase.rpc('write_audit', {
      p_action: store ? 'store.update' : 'store.create',
      p_resource: 'store',
      p_resource_id: store?.id ?? null,
      p_payload: payload,
    })
    push('已保存', 'ok')
    onSaved()
    onClose()
  }

  return (
    <Modal open={open} title={store ? '编辑门店' : '新增门店'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="门店名称 *">
          <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="门店编码">
          <input className={inputCls} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        </Field>
        <Field label="负责人">
          <input className={inputCls} value={form.manager} onChange={(e) => setForm({ ...form, manager: e.target.value })} />
        </Field>
        <Field label="联系电话">
          <input className={inputCls} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
        <Field label="地址">
          <input className={inputCls} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>取消</Button>
          <Button type="submit" variant="primary">保存</Button>
        </div>
      </form>
    </Modal>
  )
}

/** 权限矩阵弹窗：按分组展示，逐位覆盖 */
function PermissionModal({
  account,
  onClose,
  onSaved,
}: {
  account: AccountRow
  onClose: () => void
  onSaved: (payload: { permissions: Permissions }) => void
}) {
  const base = resolvePerms(account.profile)
  const [over, setOver] = useState<Permissions>(account.profile?.permissions ?? {})

  // 按 group 分组
  const groups: Record<string, typeof ALL_PERMS> = {}
  for (const p of ALL_PERMS) {
    ;(groups[p.group] ||= []).push(p)
  }

  function setBit(k: keyof Permissions, v: boolean | null) {
    // null = 走 role 默认；true/false = 显式覆盖
    setOver((p) => {
      const next = { ...p }
      if (v === null) delete next[k]
      else next[k] = v
      return next
    })
  }

  return (
    <Modal open={true} title={`权限矩阵 · ${account.email}`} onClose={onClose} wide>
      <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <strong className="text-slate-800">三态：</strong>
        <span className="ml-2">✓ 允许（默认）</span>
        <span className="ml-2">·</span>
        <span className="ml-2">⚠️ 显式允许（覆盖默认）</span>
        <span className="ml-2">·</span>
        <span className="ml-2">✗ 显式收回</span>
        <span className="ml-2">·</span>
        <span className="ml-2">— 走默认</span>
      </div>

      <div className="space-y-5">
        {Object.entries(groups).map(([g, items]) => (
          <div key={g}>
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
              {g}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {items.map((p) => {
                const override = over[p.key]
                const cur = override === undefined ? base[p.key] : !!override
                return (
                  <div
                    key={p.key}
                    className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2"
                  >
                    <span className="text-sm text-slate-800">{p.label}</span>
                    <div className="flex gap-1">
                      <BitBtn
                        active={override === undefined && cur}
                        title="默认（走 role）"
                        onClick={() => setBit(p.key, null)}
                      >
                        —
                      </BitBtn>
                      <BitBtn
                        active={override === true}
                        title="显式允许"
                        tone="ok"
                        onClick={() => setBit(p.key, true)}
                      >
                        ✓
                      </BitBtn>
                      <BitBtn
                        active={override === false}
                        title="显式收回"
                        tone="err"
                        onClick={() => setBit(p.key, false)}
                      >
                        ✗
                      </BitBtn>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 flex justify-between gap-2">
        <Button
          onClick={() => {
            setOver(
              account.profile?.role === 'hq'
                ? { ...ROLE_PRESET.hq.perms }
                : { ...ROLE_PRESET.store.perms },
            )
          }}
        >
          重置为角色默认
        </Button>
        <div className="flex gap-2">
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={() => onSaved({ permissions: over })}>
            保存
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function BitBtn({
  active,
  title,
  onClick,
  children,
  tone = 'normal',
}: {
  active: boolean
  title: string
  onClick: () => void
  children: React.ReactNode
  tone?: 'normal' | 'ok' | 'err'
}) {
  const cls = active
    ? tone === 'ok'
      ? 'border-emerald-500 bg-emerald-500 text-white'
      : tone === 'err'
        ? 'border-red-500 bg-red-500 text-white'
        : 'border-slate-900 bg-slate-900 text-white'
    : 'border-slate-200 text-slate-500 hover:bg-slate-50'
  return (
    <button
      title={title}
      onClick={onClick}
      type="button"
      className={`h-7 w-9 rounded-md border text-xs transition ${cls}`}
    >
      {children}
    </button>
  )
}