import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Button, Field, Modal, inputCls } from '../components/ui'
import { useToast } from '../components/Toast'
import { useAuth } from '../hooks/useAuth'
import {
  CATEGORIES,
  STATUS_LABEL,
  type Contract,
  type ContractStatus,
  type ContractTag,
  type ContractTemplate,
  type Store,
} from '../types'

const LEAD_OPTIONS = [90, 60, 30, 15, 7, 3, 1]

interface Props {
  open: boolean
  contract: Contract | null
  stores: Store[]
  onClose: () => void
  onSaved: () => void
  /** 一键续签：传入父合同，提交时自动 copy 字段并写 renewed_from */
  renewFrom?: Contract | null
  /** 新建/续签成功后，用新合同 id 导航到详情页（由调用方传入） */
  onAfterCreate?: (id: string) => void
}

export default function ContractForm({ open, contract, stores, onClose, onSaved, renewFrom, onAfterCreate }: Props) {
  const { profile, isHq, user, can } = useAuth()
  const { push } = useToast()
  const [form, setForm] = useState({
    store_id: '',
    title: '',
    contract_no: '',
    counterparty: '',
    our_entity: '',
    category: '租赁',
    tags: [] as string[],
    amount: '',
    signed_at: '',
    start_at: '',
    end_at: '',
    remind_days: [30, 7, 1] as number[],
    auto_renew: false,
    status: 'active' as ContractStatus,
    note: '',
  })
  const [busy, setBusy] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<ContractTag[]>([])
  const [templates, setTemplates] = useState<ContractTemplate[]>([])

  useEffect(() => {
    if (!open) return
    supabase.from('contract_tags').select('*').order('name').then(({ data }) => {
      setTags((data as ContractTag[]) ?? [])
    })
    if (can('template.manage') || !isHq) {
      // 模板只对总部可写但所有人都可读
      supabase.from('contract_templates').select('*').eq('active', true).order('name').then(({ data }) => {
        setTemplates((data as ContractTemplate[]) ?? [])
      })
    }
  }, [open, isHq, can])

  useEffect(() => {
    if (!open) return
    if (renewFrom) {
      // 续签模式：复制父合同字段，标题加「（续签）」，清空日期，重置状态
      setForm({
        store_id: renewFrom.store_id,
        title: `${renewFrom.title}（续签）`,
        contract_no: '',
        counterparty: renewFrom.counterparty ?? '',
        our_entity: renewFrom.our_entity ?? '',
        category: renewFrom.category ?? '其他',
        tags: renewFrom.tags ?? [],
        amount: renewFrom.amount === null ? '' : String(renewFrom.amount),
        signed_at: '',
        start_at: '',
        end_at: '',
        remind_days: renewFrom.remind_days?.length ? renewFrom.remind_days : [30, 7, 1],
        auto_renew: renewFrom.auto_renew,
        status: 'draft',
        note: renewFrom.note ?? '',
      })
    } else if (contract) {
      setForm({
        store_id: contract.store_id,
        title: contract.title,
        contract_no: contract.contract_no ?? '',
        counterparty: contract.counterparty ?? '',
        our_entity: contract.our_entity ?? '',
        category: contract.category ?? '其他',
        tags: contract.tags ?? [],
        amount: contract.amount === null ? '' : String(contract.amount),
        signed_at: contract.signed_at ?? '',
        start_at: contract.start_at ?? '',
        end_at: contract.end_at ?? '',
        remind_days: contract.remind_days?.length ? contract.remind_days : [30, 7, 1],
        auto_renew: contract.auto_renew,
        status: contract.status,
        note: contract.note ?? '',
      })
    } else {
      setForm({
        store_id: isHq ? (stores[0]?.id ?? '') : (profile?.store_id ?? ''),
        title: '',
        contract_no: '',
        counterparty: '',
        our_entity: '',
        category: '租赁',
        tags: [],
        amount: '',
        signed_at: '',
        start_at: '',
        end_at: '',
        remind_days: [30, 7, 1],
        auto_renew: false,
        status: 'active',
        note: '',
      })
    }
    setTagInput('')
  }, [open, contract, renewFrom, isHq, profile, stores])

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((p) => ({ ...p, [k]: v }))

  function applyTemplate(tplId: string) {
    const tpl = templates.find((t) => t.id === tplId)
    if (!tpl) return
    setForm((p) => ({
      ...p,
      title: p.title || tpl.name,
      category: tpl.category ?? p.category,
      our_entity: tpl.our_entity ?? p.our_entity,
      remind_days: tpl.default_remind_days,
      note: p.note || tpl.note || '',
    }))
    push('已套用模板字段', 'ok')
  }

  function addTag(name: string) {
    const t = name.trim()
    if (!t || form.tags.includes(t)) return
    set('tags', [...form.tags, t])
    if (!tags.find((x) => x.name === t)) {
      // 前端乐观加一条（实际库里有专门接口建标签；这里先选已有）
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.title.trim()) return push('合同名称不能为空', 'err')
    if (!form.store_id) return push('请选择所属门店', 'err')

    // 日期兜底：<input type="date"> 在某些浏览器/输入法下会拿到 'YYYY/MM/DD'
    // Postgres date 类型只认 'YYYY-MM-DD'，必须统一为 ISO 格式
    const normDate = (s: string) => {
      const t = (s || '').trim()
      if (!t) return null
      const m = t.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/)
      if (!m) return t // 兜不住就让 Supabase 报错更精准
      return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
    }

    setBusy(true)
    let createdId: string | undefined
    try {
      const payload = {
        store_id: form.store_id,
        title: form.title.trim(),
        contract_no: form.contract_no.trim() || null,
        counterparty: form.counterparty.trim() || null,
        our_entity: form.our_entity.trim() || null,
        category: form.category || null,
        tags: form.tags,
        amount: form.amount === '' ? null : Number(form.amount),
        signed_at: normDate(form.signed_at),
        start_at: normDate(form.start_at),
        end_at: normDate(form.end_at),
        remind_days: form.remind_days,
        auto_renew: form.auto_renew,
        status: form.status,
        note: form.note.trim() || null,
      }

      if (renewFrom) {
        // 续签：新建合同，关联到父合同
        const { data, error } = await supabase
          .from('contracts')
          .insert({
            ...payload,
            created_by: user?.id,
            renewed_from: renewFrom.id,
          })
          .select('id')
          .single()
        if (error) throw error
        // 父合同自动转「已续签」
        await supabase.from('contracts').update({ status: 'renewed' }).eq('id', renewFrom.id)
        await supabase.rpc('write_audit', {
          p_action: 'contract.renew',
          p_resource: 'contract',
          p_resource_id: data?.id,
          p_store_id: form.store_id,
          p_payload: { from: renewFrom.id },
        })
        createdId = data?.id ?? undefined
        push('已创建续签合同，正在打开上传页…', 'ok')
      } else if (contract) {
        const { error } = await supabase.from('contracts').update(payload).eq('id', contract.id)
        if (error) throw error
        await supabase.rpc('write_audit', {
          p_action: 'contract.update',
          p_resource: 'contract',
          p_resource_id: contract.id,
          p_store_id: form.store_id,
        })
        push('已保存', 'ok')
      } else {
        const { data, error } = await supabase
          .from('contracts')
          .insert({ ...payload, created_by: user?.id })
          .select('id')
          .single()
        if (error) throw error
        await supabase.rpc('write_audit', {
          p_action: 'contract.create',
          p_resource: 'contract',
          p_resource_id: data?.id ?? undefined,
          p_store_id: form.store_id,
          p_payload: { title: payload.title },
        })
        createdId = data?.id ?? undefined
        push('合同已创建，正在打开上传页…', 'ok')
      }
      onSaved()
      if (createdId && onAfterCreate) onAfterCreate(createdId)
      else onClose()
    } catch (e) {
      // 展开错误对象：Supabase PostgrestError 含 message/code/hint/details；避免吞掉根因
      let msg = '保存失败'
      if (e instanceof Error) msg = e.message
      else if (e && typeof e === 'object') {
        const anyE = e as { message?: string; code?: string; hint?: string; details?: string }
        msg = anyE.message || anyE.hint || anyE.details || JSON.stringify(e)
        if (anyE.code) msg = `[${anyE.code}] ${msg}`
      } else if (typeof e === 'string') msg = e
      console.error('[ContractForm] 保存失败：', e)
      push(msg, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title={renewFrom ? `续签 · ${renewFrom.title}` : contract ? '编辑合同' : '新建合同'}
      onClose={onClose}
      wide
    >
      <form onSubmit={submit} className="space-y-4">
        {templates.length > 0 && !contract && !renewFrom && (
          <Field label="套用模板">
            <div className="flex flex-wrap gap-2">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => applyTemplate(t.id)}
                  className="rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                >
                  📋 {t.name}
                </button>
              ))}
            </div>
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="合同名称 *">
            <input
              className={inputCls}
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="如：万达广场商铺租赁合同"
            />
          </Field>
          <Field label="合同编号">
            <input
              className={inputCls}
              value={form.contract_no}
              onChange={(e) => set('contract_no', e.target.value)}
            />
          </Field>

          {isHq && (
            <Field label="所属门店 *">
              <select
                className={inputCls}
                value={form.store_id}
                onChange={(e) => set('store_id', e.target.value)}
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label="类别">
            <select
              className={inputCls}
              value={form.category}
              onChange={(e) => set('category', e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>

          <Field label="对方公司">
            <input
              className={inputCls}
              value={form.counterparty}
              onChange={(e) => set('counterparty', e.target.value)}
            />
          </Field>
          <Field label="我方主体">
            <input
              className={inputCls}
              value={form.our_entity}
              onChange={(e) => set('our_entity', e.target.value)}
            />
          </Field>

          <Field label="合同金额（元）">
            <input
              type="number"
              step="0.01"
              className={inputCls}
              value={form.amount}
              onChange={(e) => set('amount', e.target.value)}
              disabled={!can('amount.edit')}
              placeholder={can('amount.edit') ? '' : '无权修改'}
            />
          </Field>
          <Field label="状态">
            <select
              className={inputCls}
              value={form.status}
              onChange={(e) => set('status', e.target.value as ContractStatus)}
            >
              {(Object.keys(STATUS_LABEL) as ContractStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="签订日期">
            <input
              type="date"
              className={inputCls}
              value={form.signed_at}
              onChange={(e) => set('signed_at', e.target.value)}
            />
          </Field>
          <Field label="生效日期">
            <input
              type="date"
              className={inputCls}
              value={form.start_at}
              onChange={(e) => set('start_at', e.target.value)}
            />
          </Field>
          <Field label="到期日期" hint="到期提醒以这个日期为准">
            <input
              type="date"
              className={inputCls}
              value={form.end_at}
              onChange={(e) => set('end_at', e.target.value)}
            />
          </Field>
          <Field label="自动续约">
            <select
              className={inputCls}
              value={form.auto_renew ? '1' : '0'}
              onChange={(e) => set('auto_renew', e.target.value === '1')}
            >
              <option value="0">否</option>
              <option value="1">是</option>
            </select>
          </Field>
        </div>

        <Field label="标签" hint="Enter 添加">
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 px-2 py-1.5">
            {form.tags.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
              >
                {t}
                <button
                  type="button"
                  onClick={() => set('tags', form.tags.filter((x) => x !== t))}
                  className="text-slate-400 hover:text-red-500"
                >
                  ×
                </button>
              </span>
            ))}
            <input
              className="flex-1 bg-transparent text-sm outline-none"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addTag(tagInput)
                  setTagInput('')
                }
              }}
              placeholder={form.tags.length === 0 ? '如：续签 / 重要 / 已审' : ''}
            />
            {tags.length > 0 && (
              <select
                className="bg-transparent text-xs text-slate-500 outline-none"
                value=""
                onChange={(e) => { if (e.target.value) { addTag(e.target.value); setTagInput('') } }}
              >
                <option value="">从已有选择…</option>
                {tags.filter((t) => !form.tags.includes(t.name)).map((t) => (
                  <option key={t.id} value={t.name}>{t.name}</option>
                ))}
              </select>
            )}
          </div>
        </Field>

        <Field label="提前提醒" hint="到期前这几天各推一次，站内 + 邮件 + 推送渠道">
          <div className="flex flex-wrap gap-2">
            {LEAD_OPTIONS.map((d) => {
              const on = form.remind_days.includes(d)
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() =>
                    set(
                      'remind_days',
                      on ? form.remind_days.filter((x) => x !== d) : [...form.remind_days, d],
                    )
                  }
                  className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                    on
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  提前 {d} 天
                </button>
              )
            })}
          </div>
        </Field>

        <Field label="备注">
          <textarea
            rows={3}
            className={inputCls}
            value={form.note}
            onChange={(e) => set('note', e.target.value)}
          />
        </Field>

        <div className="flex justify-end gap-2 pt-1">
          <Button onClick={onClose}>取消</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? '保存中…' : renewFrom ? '创建续签合同' : '保存'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}