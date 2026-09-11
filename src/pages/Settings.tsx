import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Button, Card, Empty, Field, Modal, inputCls } from '../components/ui'
import { useToast } from '../components/Toast'
import { useAuth } from '../hooks/useAuth'
import { checkPassword } from '../lib/password'
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
    const { error } = await supabase.from('our_entities').insert({ name: n })
    if (error) return push(error.message, 'err')
    setEntityName('')
    load()
  }
  async function delEntity(id: string) {
    const { error } = await supabase.from('our_entities').delete().eq('id', id)
    if (error) return push(error.message, 'err')
    load()
  }

  return (
    <div className="space-y-4">
      <Card title="个人资料">
        <form onSubmit={saveProfile} className="grid max-w-xl sm:max-w-4xl gap-4 grid-cols-2 sm:grid-cols-5">
          <Field label="登录邮箱">
            <input className={inputCls} value={user?.email ?? ''} disabled />
          </Field>
          <Field label="姓名">
            <input
              className={inputCls}
              value={profileForm.full_name}
              onChange={(e) => setProfileForm({ ...profileForm, full_name: e.target.value })}
            />
          </Field>
          <Field label="手机">
            <input
              className={inputCls}
              value={profileForm.phone}
              onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
            />
          </Field>
          <Field label="微信">
            <input
              className={inputCls}
              value={profileForm.wechat}
              onChange={(e) => setProfileForm({ ...profileForm, wechat: e.target.value })}
            />
          </Field>
          <div className="col-span-2 sm:col-span-1 flex flex-wrap items-end justify-end gap-2">
            <Button onClick={() => setPasswordOpen(true)}>修改密码</Button>
            <Button type="submit" variant="primary">保存</Button>
          </div>
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
                <li key={c.id} className="flex items-center gap-3 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm text-slate-800">
                      {c.name}
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
                        {CHANNEL_LABEL[c.kind]}
                      </span>
                      {!c.active && (
                        <span className="text-xs text-slate-400">已停用</span>
                      )}
                    </div>
                    <div className="truncate text-xs text-slate-400">
                      {c.store_id ? '门店专用' : '全公司'} ·{' '}
                      <span className="font-mono">{c.url.slice(0, 60)}{c.url.length > 60 && '…'}</span>
                    </div>
                  </div>
                  <Button variant="ghost" onClick={() => setChannelModal(c)}>
                    编辑
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate-400">
            到期提醒会按合同「提醒渠道」+ 此处渠道配置推送，门店专用渠道只推本店，全公司渠道推全店。
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
                <li key={r.id} className="flex items-center gap-3 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-slate-800">
                      {r.store_id ? '门店规则' : '全公司'} · {r.category || '全类别'}
                    </div>
                    <div className="text-xs text-slate-400">
                      提前 {r.lead_days.join(' / ')} 天 · 渠道 {r.channels.join(' / ')}
                      {!r.active && ' · 已停用'}
                    </div>
                  </div>
                  <Button variant="ghost" onClick={() => setRuleModal(r)}>
                    编辑
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate-400">
            优先级：合同自身设置 → 门店+类别规则 → 全公司+类别规则 → 合同默认 [30,7,1]。
          </p>
        </Card>
      )}

      {isHq && (
        <Card title="我方主体" extra={<span className="text-xs text-slate-400">合同「我方主体」可选列表，可增删</span>}>
          {entities.length === 0 ? (
          <Empty text="还没有我方主体" />
        ) : (
          <div className="flex flex-wrap gap-2">
            {entities.map((o) => (
              <span
                key={o.id}
                className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700"
              >
                {o.name}
                <button
                  type="button"
                  onClick={() => delEntity(o.id)}
                  className="text-slate-400 hover:text-red-500"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <input
            className={inputCls}
            value={entityName}
            onChange={(e) => setEntityName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addEntity()
              }
            }}
            placeholder="新增我方主体，如：济宁市万紫千红文化传媒有限公司"
          />
          <Button variant="primary" onClick={addEntity}>添加</Button>
        </div>
      </Card>
      )}

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

        <Field label="推送渠道">
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
                  {c === 'inapp' ? '站内' : c === 'email' ? '邮件' : c === 'wecom' ? '企业微信' : c === 'dingtalk' ? '钉钉' : '飞书'}
                </button>
              )
            })}
          </div>
        </Field>

        <Field label="提醒文案模板" hint="支持变量：{{title}} {{counterparty}} {{days}} {{store}} {{end_at}}">
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