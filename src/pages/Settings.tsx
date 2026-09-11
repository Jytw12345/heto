import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Button, Card, Empty, Field, Modal, inputCls, inputClsInline } from '../components/ui'
import { useToast } from '../components/Toast'
import { useAuth } from '../hooks/useAuth'
import { checkPassword } from '../lib/password'
import { checkForUpdate } from '../lib/pwa'
import { ThemePicker } from '../components/ThemeSwitcher'
import { shortEntity } from '../lib/format'
import type {
  NotifChannel,
  NotifChannelConfig,
  OurEntity,
  ReminderRule,
} from '../types'
import { CATEGORIES } from '../types'

const CHANNEL_LABEL: Record<NotifChannelConfig['kind'], string> = {
  wecom: '企业微信',
  dingtalk: '钉钉',
  feishu: '飞书',
  webhook: '通用 Webhook',
  email: '邮件',
}

const CHANNEL_DOC: Record<NotifChannelConfig['kind'], string> = {
  wecom: '群机器人 webhook，URL 形如 https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx',
  dingtalk: '群机器人 webhook，URL 形如 https://oapi.dingtalk.com/robot/send?access_token=xxx',
  feishu: '群机器人 webhook，URL 形如 https://open.feishu.cn/open-apis/bot/v2/hook/xxx',
  webhook: '通用 Webhook，POST 一段 JSON，body 见各渠道文档',
  email: '邮件提醒（需在 Edge Function 配置 RESEND_API_KEY）',
}

// 提醒规则「渠道」枚举（NotifChannel）→ 中文名
const REMIND_CH_LABEL: Record<string, string> = {
  inapp: '站内',
  email: '邮件',
  wecom: '企业微信',
  dingtalk: '钉钉',
  feishu: '飞书',
}

export default function Settings() {
  const { user, profile, refreshProfile, can, isHq } = useAuth()
  const { push } = useToast()

  const [profileForm, setProfileForm] = useState({
    full_name: '',
    phone: '',
    wechat: '',
  })
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [channels, setChannels] = useState<NotifChannelConfig[]>([])
  const [channelModal, setChannelModal] = useState<NotifChannelConfig | 'new' | null>(null)
  const [rules, setRules] = useState<ReminderRule[]>([])
  const [ruleModal, setRuleModal] = useState<ReminderRule | 'new' | null>(null)
  const [entities, setEntities] = useState<OurEntity[]>([])
  const [entityName, setEntityName] = useState('')
  const [entityShort, setEntityShort] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editShort, setEditShort] = useState('')
  const [checkingUpdate, setCheckingUpdate] = useState(false)

  const load = useCallback(async () => {
    const [{ data: c }, { data: r }] = await Promise.all([
      supabase.from('notification_channels').select('*').order('created_at', { ascending: false }),
      supabase.from('reminder_rules').select('*').order('created_at', { ascending: false }),
    ])
    setChannels((c as NotifChannelConfig[]) ?? [])
    setRules((r as ReminderRule[]) ?? [])
    if (isHq) {
      const { data: e } = await supabase.from('our_entities').select('*').order('name')
      setEntities((e as OurEntity[]) ?? [])
    }
  }, [isHq])

  useEffect(() => {
    setProfileForm({
      full_name: profile?.full_name ?? '',
      phone: profile?.phone ?? '',
      wechat: profile?.wechat ?? '',
    })
  }, [profile])

  useEffect(() => {
    load()
  }, [load])

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: profileForm.full_name.trim() || null,
        phone: profileForm.phone.trim() || null,
        wechat: profileForm.wechat.trim() || null,
      })
      .eq('id', user.id)
    if (error) return push(error.message, 'err')
    await supabase.rpc('write_audit', { p_action: 'profile.update.self', p_resource: 'profile', p_resource_id: user.id })
    push('已保存', 'ok')
    refreshProfile()
  }

  async function addEntity() {
    const n = entityName.trim()
    if (!n) return
    const { error } = await supabase
      .from('our_entities')
      .insert({ name: n, short_name: entityShort.trim() || null })
    if (error) return push(error.message, 'err')
    setEntityName('')
    setEntityShort('')
    load()
  }
  async function delEntity(id: string) {
    const { error } = await supabase.from('our_entities').delete().eq('id', id)
    if (error) return push(error.message, 'err')
    load()
  }
  async function saveEntityShort(id: string) {
    const { error } = await supabase
      .from('our_entities')
      .update({ short_name: editShort.trim() || null })
      .eq('id', id)
    if (error) return push(error.message, 'err')
    setEditingId(null)
    load()
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      {/* 左栏：核心设置 */}
      <div className="space-y-4 xl:col-span-7">
        <Card title="个人资料">
          <form onSubmit={saveProfile} className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <label className="flex min-w-0 flex-1 items-center gap-2">
              <span className="shrink-0 text-sm text-slate-500">登录邮箱</span>
              <input className={inputClsInline + ' min-w-0 flex-1'} value={user?.email ?? ''} disabled />
            </label>
            <label className="flex items-center gap-2">
              <span className="shrink-0 text-sm text-slate-500">姓名</span>
              <input
                className={inputClsInline + ' w-28'}
                value={profileForm.full_name}
                onChange={(e) => setProfileForm({ ...profileForm, full_name: e.target.value })}
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="shrink-0 text-sm text-slate-500">手机</span>
              <input
                className={inputClsInline + ' w-36'}
                value={profileForm.phone}
                onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
              />
            </label>
            <Button type="button" variant="ghost" onClick={() => setPasswordOpen(true)}>
              修改密码
            </Button>
            <Button type="submit" variant="primary">
              保存
            </Button>
          </form>
        </Card>

        {can('channel.manage') && (
          <Card
            title="推送渠道"
            extra={
              <Button variant="primary" onClick={() => setChannelModal('new')}>
                + 新增渠道
              </Button>
            }
          >
            {channels.length === 0 ? (
              <Empty text="还没有配置推送渠道" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {channels.map((c) => (
                  <li key={c.id} className="group flex items-center gap-3 py-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-slate-800">
                      <span className="shrink-0">{c.name}</span>
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
                        {CHANNEL_LABEL[c.kind]}
                      </span>
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
                        {c.store_id ? '门店专用' : '全公司'}
                      </span>
                      {!c.active && (
                        <span className="shrink-0 text-xs text-slate-400">已停用</span>
                      )}
                      <span className="ml-auto min-w-0 truncate font-mono text-xs text-slate-400" title={c.url}>
                        {c.url}
                      </span>
                    </div>
                    <Button variant="ghost" className="shrink-0 md:opacity-60 md:group-hover:opacity-100" onClick={() => setChannelModal(c)}>
                      编辑
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              全公司渠道推所有门店，门店专用渠道只推本店。是否推送、走哪些渠道、提前几天，由「提醒规则」决定。
            </p>
          </Card>
        )}

        {can('reminder.manage') && (
          <Card
            title="提醒规则"
            extra={
              <Button variant="primary" onClick={() => setRuleModal('new')}>
                + 新增规则
              </Button>
            }
          >
            {rules.length === 0 ? (
              <Empty text="暂无自定义规则，按合同本身的提前天数提醒" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {rules.map((r) => (
                  <li key={r.id} className="group flex items-center gap-3 py-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-slate-800">
                      <span className="shrink-0">
                        {r.store_id ? '门店规则' : '全公司'} · {r.category || '全类别'}
                      </span>
                      <span className="min-w-0 truncate text-xs text-slate-400">
                        提前 {r.lead_days.join(' / ')} 天 · 渠道{' '}
                        {r.channels.map((c) => REMIND_CH_LABEL[c] ?? c).join(' / ')}
                      </span>
                      {!r.active && <span className="shrink-0 text-xs text-slate-400">· 已停用</span>}
                    </div>
                    <Button variant="ghost" className="shrink-0 md:opacity-60 md:group-hover:opacity-100" onClick={() => setRuleModal(r)}>
                      编辑
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              命中规则时按规则的天数与渠道推送，越具体越优先：门店+类别 → 门店 → 全公司+类别 → 全公司。
              都没命中时按合同自带的提前天数，渠道走站内 + 邮件。
            </p>
          </Card>
        )}
      </div>

      {/* 右栏：辅助信息 */}
      <div className="space-y-4 xl:col-span-5">
        {isHq && (
          <Card
            title="我方主体"
            extra={<span className="text-xs text-slate-400">简写用于合同列表紧凑展示</span>}
          >
            {entities.length === 0 ? (
              <Empty text="还没有我方主体" />
            ) : (
              <div className="flex flex-wrap gap-2">
                {entities.map((o) => (
                  <span
                    key={o.id}
                    className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700"
                  >
                    {editingId === o.id ? (
                      <>
                        <input
                          autoFocus
                          value={editShort}
                          onChange={(e) => setEditShort(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEntityShort(o.id)
                            if (e.key === 'Escape') setEditingId(null)
                          }}
                          className="w-16 rounded bg-white px-1 py-0.5 text-xs outline-none ring-1 ring-[var(--brand)]"
                        />
                        <button
                          type="button"
                          onClick={() => saveEntityShort(o.id)}
                          className="text-[var(--brand-strong)] hover:underline"
                        >
                          存
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="text-slate-400 hover:text-slate-600"
                        >
                          ×
                        </button>
                      </>
                    ) : (
                      <>
                        <span
                          className="cursor-pointer hover:text-[var(--brand-strong)]"
                          title={`${o.name}（点击编辑简写）`}
                          onClick={() => {
                            setEditingId(o.id)
                            setEditShort(o.short_name ?? shortEntity(o.name))
                          }}
                        >
                          {o.short_name ? o.short_name : shortEntity(o.name)}
                        </span>
                        <button
                          type="button"
                          onClick={() => delEntity(o.id)}
                          className="text-slate-400 hover:text-red-500"
                          title="删除该主体"
                        >
                          ×
                        </button>
                      </>
                    )}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                className={inputCls + ' flex-1 min-w-[180px]'}
                value={entityName}
                onChange={(e) => setEntityName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addEntity()
                  }
                }}
                placeholder="全称，如：济宁市万紫千红文化传媒有限公司"
              />
              <input
                className={inputClsInline + ' w-28'}
                value={entityShort}
                onChange={(e) => setEntityShort(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addEntity()
                  }
                }}
                placeholder="简写（可选）"
              />
              <Button variant="primary" onClick={addEntity}>
                添加
              </Button>
            </div>
          </Card>
        )}

        <Card
          title="主题配色"
          extra={<span className="text-xs text-slate-400">仅影响当前浏览器</span>}
        >
          <ThemePicker />
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            品牌色会同步应用到侧栏高亮、按钮、统计卡与图表，刷新后保持。
          </p>
        </Card>

        <Card title="关于" extra={<span className="text-xs text-slate-400">PWA 版本与更新</span>}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-600">
              当前版本：<span className="font-mono text-slate-900">{__APP_VERSION__}</span>
              <span className="ml-2 text-xs text-slate-400">（新版本会右下角提示）</span>
            </div>
            <Button
              variant="primary"
              disabled={checkingUpdate}
              onClick={async () => {
                setCheckingUpdate(true)
                try {
                  await checkForUpdate()
                  push('已检查更新，若有新版本会自动提示', 'ok')
                } catch (e) {
                  push(e instanceof Error ? e.message : '检查失败', 'err')
                } finally {
                  setCheckingUpdate(false)
                }
              }}
            >
              {checkingUpdate ? '检查中…' : '检查更新'}
            </Button>
          </div>
        </Card>
      </div>

      {passwordOpen && <PasswordModal onClose={() => setPasswordOpen(false)} />}
      {channelModal && (
        <ChannelModal
          channel={channelModal === 'new' ? null : channelModal}
          onClose={() => setChannelModal(null)}
          onSaved={() => {
            setChannelModal(null)
            load()
          }}
        />
      )}
      {ruleModal && (
        <RuleModal
          rule={ruleModal === 'new' ? null : ruleModal}
          onClose={() => setRuleModal(null)}
          onSaved={() => {
            setRuleModal(null)
            load()
          }}
        />
      )}
    </div>
  )
}

function PasswordModal({ onClose }: { onClose: () => void }) {
  const { push } = useToast()
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const check = checkPassword(p1)
    if (!check.ok) return push(check.msg, 'err')
    if (p1 !== p2) return push('两次密码不一致', 'err')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: p1 })
    setBusy(false)
    if (error) return push(error.message, 'err')
    await supabase.rpc('write_audit', { p_action: 'profile.password.change' })
    push('密码已修改', 'ok')
    onClose()
  }

  const pw = checkPassword(p1)

  return (
    <Modal open={true} title="修改密码" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="新密码">
          <input type="password" className={inputCls} value={p1} onChange={(e) => setP1(e.target.value)} placeholder="大写+小写+数字，数字不重复不连续" />
          {p1.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-[11px]">
              <Req ok={pw.items.len}>至少 8 位</Req>
              <Req ok={pw.items.upper}>含大写字母（A-Z）</Req>
              <Req ok={pw.items.lower}>含小写字母（a-z）</Req>
              <Req ok={pw.items.digit}>含数字（0-9）</Req>
              <Req ok={pw.items.digitUnique}>数字不重复（如 11、22 不行）</Req>
              <Req ok={pw.items.digitNoSeq}>数字不连续（如 12、21 不行）</Req>
            </ul>
          )}
        </Field>
        <Field label="再次输入">
          <input type="password" className={inputCls} value={p2} onChange={(e) => setP2(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>取消</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? '提交中…' : '提交'}
          </Button>
        </div>
      </form>
    </Modal>
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

function ChannelModal({
  channel,
  onClose,
  onSaved,
}: {
  channel: NotifChannelConfig | null
  onClose: () => void
  onSaved: () => void
}) {
  const { push } = useToast()
  const { isHq, profile } = useAuth()
  const [form, setForm] = useState({
    name: '',
    kind: 'wecom' as NotifChannelConfig['kind'],
    url: '',
    active: true,
    store_scope: 'global' as 'global' | 'mine',
  })

  useEffect(() => {
    if (!channel) return
    setForm({
      name: channel.name,
      kind: channel.kind,
      url: channel.url,
      active: channel.active,
      store_scope: channel.store_id ? 'mine' : 'global',
    })
  }, [channel])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return push('渠道名称不能为空', 'err')
    if (!form.url.trim()) return push('URL 不能为空', 'err')
    const payload = {
      name: form.name.trim(),
      kind: form.kind,
      url: form.url.trim(),
      active: form.active,
      store_id: form.store_scope === 'mine' ? profile?.store_id : null,
    }
    const { error } = channel
      ? await supabase.from('notification_channels').update(payload).eq('id', channel.id)
      : await supabase.from('notification_channels').insert(payload)
    if (error) return push(error.message, 'err')
    await supabase.rpc('write_audit', {
      p_action: channel ? 'channel.update' : 'channel.create',
      p_resource: 'channel',
      p_resource_id: channel?.id ?? null,
      p_payload: payload,
    })
    push('已保存', 'ok')
    onSaved()
  }

  return (
    <Modal open={true} title={channel ? '编辑渠道' : '新增渠道'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="名称 *">
            <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="渠道类型">
            <select
              className={inputCls}
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value as NotifChannelConfig['kind'] })}
            >
              <option value="wecom">{CHANNEL_LABEL.wecom}</option>
              <option value="dingtalk">{CHANNEL_LABEL.dingtalk}</option>
              <option value="feishu">{CHANNEL_LABEL.feishu}</option>
              <option value="webhook">{CHANNEL_LABEL.webhook}</option>
              <option value="email">{CHANNEL_LABEL.email}</option>
            </select>
          </Field>
        </div>
        <Field label="接入说明">
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
              {CHANNEL_DOC[form.kind]}
            </div>
          </Field>
        <Field label="URL / Token *">
          <input
            className={inputCls}
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
            placeholder={form.kind === 'email' ? 'your@email.com' : 'https://...'}
          />
        </Field>
        {isHq && (
          <Field label="作用域">
            <div className="flex gap-2">
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  checked={form.store_scope === 'global'}
                  onChange={() => setForm({ ...form, store_scope: 'global' })}
                />
                全公司
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  checked={form.store_scope === 'mine'}
                  onChange={() => setForm({ ...form, store_scope: 'mine' })}
                />
                仅我所在门店
              </label>
            </div>
          </Field>
        )}
        <Field label="启用">
          <select
            className={inputCls}
            value={form.active ? '1' : '0'}
            onChange={(e) => setForm({ ...form, active: e.target.value === '1' })}
          >
            <option value="1">启用</option>
            <option value="0">停用</option>
          </select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>取消</Button>
          <Button type="submit" variant="primary">保存</Button>
        </div>
      </form>
    </Modal>
  )
}

function RuleModal({
  rule,
  onClose,
  onSaved,
}: {
  rule: ReminderRule | null
  onClose: () => void
  onSaved: () => void
}) {
  const { push } = useToast()
  const { isHq, profile } = useAuth()
  const LEAD_OPTIONS = [90, 60, 45, 30, 15, 7, 3, 1]
  const CH_OPTIONS: NotifChannel[] = ['inapp', 'email', 'wecom', 'dingtalk', 'feishu']

  const [form, setForm] = useState({
    category: '',
    lead_days: [30, 7, 1] as number[],
    channels: ['inapp', 'email'] as NotifChannel[],
    template: '',
    active: true,
    store_scope: 'global' as 'global' | 'mine',
  })

  useEffect(() => {
    if (!rule) return
    setForm({
      category: rule.category ?? '',
      lead_days: rule.lead_days,
      channels: rule.channels,
      template: rule.template ?? '',
      active: rule.active,
      store_scope: rule.store_id ? 'mine' : 'global',
    })
  }, [rule])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const payload = {
      store_id: form.store_scope === 'mine' ? profile?.store_id : null,
      category: form.category || null,
      lead_days: form.lead_days,
      channels: form.channels,
      template: form.template.trim() || null,
      active: form.active,
    }
    const { error } = rule
      ? await supabase.from('reminder_rules').update(payload).eq('id', rule.id)
      : await supabase.from('reminder_rules').insert(payload)
    if (error) return push(error.message, 'err')
    await supabase.rpc('write_audit', {
      p_action: rule ? 'reminder_rule.update' : 'reminder_rule.create',
      p_resource: 'reminder_rule',
      p_resource_id: rule?.id ?? null,
      p_payload: payload,
    })
    push('已保存', 'ok')
    onSaved()
  }

  return (
    <Modal open={true} title={rule ? '编辑规则' : '新增规则'} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="合同类别">
            <select
              className={inputCls}
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            >
              <option value="">全类别</option>
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          {isHq && (
            <Field label="作用域">
              <div className="flex gap-2 pt-2">
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    checked={form.store_scope === 'global'}
                    onChange={() => setForm({ ...form, store_scope: 'global' })}
                  />
                  全公司
                </label>
                <label className="flex items-center gap-1.5 text-sm">
                  <input
                    type="radio"
                    checked={form.store_scope === 'mine'}
                    onChange={() => setForm({ ...form, store_scope: 'mine' })}
                  />
                  仅我所在门店
                </label>
              </div>
            </Field>
          )}
        </div>

        <Field label="提前天数">
          <div className="flex flex-wrap gap-2">
            {LEAD_OPTIONS.map((d) => {
              const on = form.lead_days.includes(d)
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() =>
                    setForm({
                      ...form,
                      lead_days: on
                        ? form.lead_days.filter((x) => x !== d)
                        : [...form.lead_days, d].sort((a, b) => b - a),
                    })
                  }
                  className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                    on
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {d} 天
                </button>
              )
            })}
          </div>
        </Field>

        <Field
          label="推送渠道"
          hint="勾选「企业微信 / 钉钉 / 飞书」才会推到上方「推送渠道」里配置的群"
        >
          <div className="flex flex-wrap gap-2">
            {CH_OPTIONS.map((c) => {
              const on = form.channels.includes(c)
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() =>
                    setForm({
                      ...form,
                      channels: on ? form.channels.filter((x) => x !== c) : [...form.channels, c],
                    })
                  }
                  className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                    on
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {REMIND_CH_LABEL[c] ?? c}
                </button>
              )
            })}
          </div>
        </Field>

        <Field
          label="提醒文案模板"
          hint="支持变量：{{title}} {{counterparty}} {{days}} {{store}} {{end_at}} {{contract_no}}"
        >
          <textarea
            rows={3}
            className={inputCls}
            value={form.template}
            onChange={(e) => setForm({ ...form, template: e.target.value })}
            placeholder="合同「{{title}}」还有 {{days}} 天到期，请及时处理。"
          />
        </Field>

        <Field label="启用">
          <select
            className={inputCls}
            value={form.active ? '1' : '0'}
            onChange={(e) => setForm({ ...form, active: e.target.value === '1' })}
          >
            <option value="1">启用</option>
            <option value="0">停用</option>
          </select>
        </Field>

        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>取消</Button>
          <Button type="submit" variant="primary">保存</Button>
        </div>
      </form>
    </Modal>
  )
}
