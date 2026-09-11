import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Button, Card, Empty, Field, Modal, inputCls, inputClsInline } from '../components/ui'
import { useToast } from '../components/Toast'
import { useAuth } from '../hooks/useAuth'
import type { Permissions, PermKey, PositionTemplate, Profile, Role, Store } from '../types'
import { ALL_PERMS, DEFAULT_STORE_PERMS } from '../lib/permissions'

interface AccountRow {
  id: string
  email: string
  profile: Profile | null
}

function EditableName({
  account,
  onSave,
}: {
  account: AccountRow
  onSave: (name: string) => void
}) {
  const [name, setName] = useState(account.profile?.full_name ?? '')
  return (
    <input
      className={`${inputClsInline} w-full py-1 text-xs sm:w-24`}
      placeholder={account.profile?.full_name ? '' : '姓名'}
      value={name}
      onChange={(e) => setName(e.target.value)}
      onBlur={() => {
        const current = account.profile?.full_name ?? ''
        if (name !== current) onSave(name.trim())
      }}
    />
  )
}

export default function Admin() {
  const { positionTemplates, refreshPositionTemplates } = useAuth()
  const { push } = useToast()
  const [stores, setStores] = useState<Store[]>([])
  const [accounts, setAccounts] = useState<AccountRow[]>([])
  const [loading, setLoading] = useState(true)
  const [storeModal, setStoreModal] = useState<Store | 'new' | null>(null)
  const [permModal, setPermModal] = useState<AccountRow | null>(null)
  const [tplModal, setTplModal] = useState<PositionTemplate | 'new' | null>(null)

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

  async function upsertTemplate(tpl: PositionTemplate | null, payload: { name: string; scope: Role; permissions: Permissions }) {
    let error
    if (tpl) {
      ;({ error } = await supabase.from('position_templates').update(payload).eq('id', tpl.id))
    } else {
      ;({ error } = await supabase.from('position_templates').insert(payload))
    }
    if (error) return push(error.message, 'err')
    await supabase.rpc('write_audit', {
      p_action: tpl ? 'position_template.update' : 'position_template.create',
      p_resource: 'position_template',
      p_resource_id: tpl?.id ?? null,
      p_payload: payload,
    })
    push('已保存', 'ok')
    await refreshPositionTemplates()
    load()
  }

  async function deleteTemplate(t: PositionTemplate) {
    if (t.is_system) return push('系统预设职务不可删除，可在「编辑」里自定义权限', 'err')
    if (!window.confirm(`删除职务「${t.name}」？已分配该职务的账号将回落到角色默认权限`)) return
    const { error } = await supabase.from('position_templates').delete().eq('id', t.id)
    if (error) return push(error.message, 'err')
    await supabase.rpc('write_audit', {
      p_action: 'position_template.delete',
      p_resource: 'position_template',
      p_resource_id: t.id,
      p_payload: { name: t.name },
    })
    push('已删除', 'ok')
    await refreshPositionTemplates()
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
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                <div className="min-w-0 flex-1 truncate text-sm text-slate-800">
                  {s.name}
                  <span className="text-xs text-slate-400">
                    {[s.code && `编码 ${s.code}`, s.manager && `店长 ${s.manager}`, s.phone].filter(Boolean).join(' · ')}
                  </span>
                  {!s.active && <span className="ml-2 text-xs text-slate-400">已停用</span>}
                </div>
                <Button variant="ghost" onClick={() => setStoreModal(s)}>
                  编辑
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="职务权限模板"
        extra={
          <Button variant="primary" onClick={() => setTplModal('new')}>
            + 新增职务
          </Button>
        }
      >
        {positionTemplates.length === 0 ? (
          <Empty text="加载中…（若一直为空，可能尚未执行 010 迁移 SQL）" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {positionTemplates.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2">
                <div className="min-w-0 flex-1">
                  <span className="text-sm text-slate-800">{t.name}</span>
                  <span
                    className={`ml-2 rounded-full px-2 py-0.5 text-[11px] ${
                      t.scope === 'hq' ? 'bg-[var(--brand)]/10 text-[var(--brand-strong)]' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {t.scope === 'hq' ? '全门店' : '本门店'}
                  </span>
                  {t.is_system && <span className="ml-1 text-[11px] text-slate-400">系统预设</span>}
                </div>
                <Button variant="ghost" onClick={() => setTplModal(t)}>
                  编辑
                </Button>
                {!t.is_system && (
                  <Button variant="ghost" onClick={() => deleteTemplate(t)}>
                    删除
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs leading-relaxed text-slate-400">
          职务 = 默认权限包 + 数据范围。点「编辑」可改名、改范围、并逐项自定义该职务允许的操作；
          账号分配职务后自动套用，仍可在账号「权限」里逐人覆盖。
        </p>
      </Card>

      <Card title="账号与权限">
        {loading ? (
          <Empty text="加载中…" />
        ) : accounts.length === 0 ? (
          <Empty text="还没有账号" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {accounts.map((a) => (
              <li key={a.id} className="py-2 sm:flex sm:flex-wrap sm:items-center sm:gap-x-2 sm:gap-y-1">
                {/* 邮箱 + 状态：手机上独占一行，电脑上弹性收缩 */}
                <div className="mb-1.5 flex min-w-0 items-center gap-2 sm:mb-0 sm:flex-1">
                  <span className="truncate text-sm text-slate-800">{a.email}</span>
                  {a.profile && !a.profile.active && (
                    <span className="text-xs text-slate-400">已停用</span>
                  )}
                  {/* 手机端：权限/启用停用跟在邮箱后面 */}
                  <div className="ml-auto flex shrink-0 items-center gap-1 sm:hidden">
                    <Button variant="ghost" onClick={() => setPermModal(a)}>
                      权限
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => patchAccount(a.id, { active: !a.profile?.active })}
                    >
                      {a.profile?.active === false ? '启用' : '停用'}
                    </Button>
                  </div>
                </div>

                {/* 手机上 3 列网格，电脑上 inline flex */}
                <div className="grid grid-cols-3 items-center gap-2 sm:flex sm:flex-wrap">
                  <EditableName
                    account={a}
                    onSave={(name) => patchAccount(a.id, { full_name: name || null })}
                  />

                  <select
                    className={`${inputClsInline} w-full py-1 text-xs sm:w-auto`}
                    value={a.profile?.position_template_id ?? ''}
                    onChange={(e) => {
                      const tid = e.target.value || null
                      const tpl = positionTemplates.find((t) => t.id === tid)
                      const payload: Partial<Profile> = { position_template_id: tid }
                      // 职务自带数据范围：选职务时自动设置 role（可后续手动改）
                      if (tpl) payload.role = tpl.scope
                      patchAccount(a.id, payload)
                    }}
                  >
                    <option value="">（按角色默认）</option>
                    {positionTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.scope === 'hq' ? ' · 全门店' : ' · 本门店'}
                      </option>
                    ))}
                  </select>

                  <select
                    className={`${inputClsInline} w-full py-1 text-xs sm:w-auto`}
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

                  {/* 电脑端：权限/启用停用留在行内 */}
                  <div className="hidden shrink-0 items-center gap-1 sm:flex">
                    <Button variant="ghost" onClick={() => setPermModal(a)}>
                      权限
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => patchAccount(a.id, { active: !a.profile?.active })}
                    >
                      {a.profile?.active === false ? '启用' : '停用'}
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs leading-relaxed text-slate-400">
          新账号默认「门店 + 未分配」。先选「职务」套用该职务的默认权限与数据范围，再指定门店即可看到数据；
          「权限」按钮可对该账号逐项覆盖（— 继承职务默认 / ✓ 显式允许 / ✗ 显式收回）。
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
          positionTemplates={positionTemplates}
          onClose={() => setPermModal(null)}
          onSaved={async (payload) => {
            await patchAccount(permModal.id, payload)
            setPermModal(null)
          }}
        />
      )}
      {tplModal !== null && (
        <TemplatePermModal
          tpl={tplModal === 'new' ? null : tplModal}
          onClose={() => setTplModal(null)}
          onSaved={async (payload) => {
            await upsertTemplate(tplModal === 'new' ? null : tplModal, payload)
            setTplModal(null)
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

/** 权限矩阵弹窗：按分组展示，逐位覆盖（— 走职务/角色默认 / ✓ 允许 / ✗ 收回） */
function PermissionModal({
  account,
  positionTemplates,
  onClose,
  onSaved,
}: {
  account: AccountRow
  positionTemplates: PositionTemplate[]
  onClose: () => void
  onSaved: (payload: { permissions: Permissions }) => void
}) {
  const [over, setOver] = useState<Permissions>(account.profile?.permissions ?? {})

  const tpl = positionTemplates.find((t) => t.id === account.profile?.position_template_id)
  const baselineLabel = tpl
    ? `职务「${tpl.name}」`
    : account.profile?.role === 'hq'
      ? '总部角色'
      : '门店角色'

  // 按 group 分组
  const groups: Record<string, typeof ALL_PERMS> = {}
  for (const p of ALL_PERMS) {
    ;(groups[p.group] ||= []).push(p)
  }

  function setBit(k: keyof Permissions, v: boolean | null) {
    // null = 走默认；true/false = 显式覆盖
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
        <span className="ml-2">— 走默认</span>
        <span className="ml-2">·</span>
        <span className="ml-2">⚠️ 显式允许（覆盖默认）</span>
        <span className="ml-2">·</span>
        <span className="ml-2">✗ 显式收回</span>
        <div className="mt-1">
          当前默认基准：<strong className="text-slate-800">{baselineLabel}</strong>
        </div>
      </div>

      <div className="space-y-4">
        {Object.entries(groups).map(([g, items]) => (
          <div key={g}>
            <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {g}
            </div>
            <ul className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              {items.map((p, idx) => {
                const override = over[p.key]
                return (
                  <li
                    key={p.key}
                    className={`flex items-center gap-3 px-3 py-1.5 ${
                      idx > 0 ? 'border-t border-slate-100' : ''
                    } hover:bg-slate-50/60`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-slate-800" title={p.label}>
                        {p.label}
                      </div>
                      <div className="truncate font-mono text-[10px] text-slate-400" title={p.key}>
                        {p.key}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <BitBtn
                        active={override === undefined}
                        title="走默认（清除覆盖）"
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
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-5 flex justify-between gap-2">
        <Button onClick={() => setOver({})}>重置为默认</Button>
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

/** 职务模板权限编辑：二态（允许 / 禁止），定义该职务的默认权限 */
function TemplatePermModal({
  tpl,
  onClose,
  onSaved,
}: {
  tpl: PositionTemplate | null
  onClose: () => void
  onSaved: (payload: { name: string; scope: Role; permissions: Permissions }) => void
}) {
  const { push } = useToast()
  const [name, setName] = useState(tpl?.name ?? '')
  const [scope, setScope] = useState<Role>(tpl?.scope ?? 'store')
  const [perms, setPerms] = useState<Permissions>(() => ({
    ...DEFAULT_STORE_PERMS,
    ...(tpl?.permissions ?? {}),
  }))

  // 按 group 分组
  const groups: Record<string, typeof ALL_PERMS> = {}
  for (const p of ALL_PERMS) {
    ;(groups[p.group] ||= []).push(p)
  }

  function toggle(k: PermKey) {
    setPerms((p) => ({ ...p, [k]: !p[k] }))
  }

  async function save() {
    if (!name.trim()) return push('职务名称不能为空', 'err')
    onSaved({ name: name.trim(), scope, permissions: perms })
    onClose()
  }

  return (
    <Modal open={true} title={tpl ? `编辑职务 · ${tpl.name}` : '新增职务'} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="职务名称 *">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="数据范围">
            <select className={inputCls} value={scope} onChange={(e) => setScope(e.target.value as Role)}>
              <option value="store">本门店（只看所属门店数据）</option>
              <option value="hq">全门店（看所有门店数据）</option>
            </select>
          </Field>
        </div>

        <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          「允许」= 该职务默认可执行此操作；「禁止」= 默认不可执行。保存后分配此职务的账号自动套用。
        </div>

        <div className="space-y-4">
          {Object.entries(groups).map(([g, items]) => (
            <div key={g}>
              <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {g}
              </div>
              <ul className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                {items.map((p, idx) => (
                  <li
                    key={p.key}
                    className={`flex items-center gap-3 px-3 py-1.5 ${
                      idx > 0 ? 'border-t border-slate-100' : ''
                    } hover:bg-slate-50/60`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-slate-800">{p.label}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggle(p.key)}
                      className={`h-9 w-12 rounded-md border text-xs transition md:h-7 ${
                        perms[p.key]
                          ? 'border-emerald-500 bg-emerald-500 text-white'
                          : 'border-red-300 bg-red-50 text-red-600'
                      }`}
                    >
                      {perms[p.key] ? '允许' : '禁止'}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>取消</Button>
        <Button variant="primary" onClick={save}>
          保存
        </Button>
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
      className={`h-9 w-11 rounded-md border text-xs transition md:h-7 md:w-9 ${cls}`}
    >
      {children}
    </button>
  )
}
