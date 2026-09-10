import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { uploadFile, validateFile } from '../lib/storage'
import { formatBytes } from '../lib/format'
import { Button, Field, Modal, inputCls } from '../components/ui'
import { useToast } from '../components/Toast'
import { useAuth } from '../hooks/useAuth'
import {
  CATEGORIES,
  STATUS_LABEL,
  FILE_KIND_LABEL,
  FILE_KIND_ORDER,
  type Contract,
  type ContractStatus,
  type ContractTag,
  type ContractTemplate,
  type FileKind,
  type OurEntity,
  type Store,
} from '../types'

const LEAD_OPTIONS = [90, 60, 30, 15, 7, 3, 1]

// 新建/续签时暂存的待上传附件（保存时先建合同拿到 id 再批量上传）
interface PendingFile {
  id: number
  file: File
  kind: FileKind
  name: string
  size: number
  status: 'pending' | 'uploading' | 'done' | 'error'
  pct: number
  error?: string
}

// 日期工具：今天 / 加 N 年
function todayISO() {
  return new Date().toISOString().slice(0, 10)
}
function addYears(iso: string, n: number) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return ''
  const d = new Date(iso)
  d.setFullYear(d.getFullYear() + n)
  return d.toISOString().slice(0, 10)
}
function fmtDate(iso: string) {
  if (!iso) return ''
  // '2025-09-10' → '2025年9月10日'（更直观，规避浏览器原生 date 的"年/月/日"占位）
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return iso
  return `${m[1]}年${parseInt(m[2], 10)}月${parseInt(m[3], 10)}日`
}

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
  const [ourEntities, setOurEntities] = useState<OurEntity[]>([])
  // 新建/续签时暂存的附件
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [fileKind, setFileKind] = useState<FileKind>('original')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileSeq = useRef(0)

  useEffect(() => {
    if (!open) return
    supabase.from('contract_tags').select('*').order('name').then(({ data }) => {
      setTags((data as ContractTag[]) ?? [])
    })
    supabase.from('our_entities').select('*').order('name').then(({ data }) => {
      setOurEntities((data as OurEntity[]) ?? [])
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
      // 新建：填好合理默认值，减少点日历
      const t = todayISO()
      setForm({
        store_id: isHq ? (stores[0]?.id ?? '') : (profile?.store_id ?? ''),
        title: '',
        contract_no: '',
        counterparty: '',
        our_entity: '',
        category: '租赁',
        tags: [],
        amount: '',
        signed_at: t,                    // 签于今日
        start_at: t,                     // 生效今日
        end_at: addYears(t, 1),          // 到期 +1 年（最常见周期）
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

  // 新建/续签：合同创建成功后，批量上传暂存附件（串行，逐个更新进度）
  async function uploadPending(contractId: string, files: PendingFile[]) {
    for (const pf of files) {
      setPendingFiles((p) => p.map((x) => (x.id === pf.id ? { ...x, status: 'uploading', pct: 0 } : x)))
      try {
        const res = await uploadFile(pf.file, {
          storeId: form.store_id,
          contractId,
          onProgress: (pct) => setPendingFiles((p) => p.map((x) => (x.id === pf.id ? { ...x, pct } : x))),
        })
        const { error } = await supabase.from('contract_files').insert({
          contract_id: contractId,
          store_id: form.store_id,
          file_path: res.path,
          file_name: res.name,
          mime_type: res.mime,
          size_bytes: res.size,
          sha256: res.sha256,
          kind: pf.kind,
        })
        if (error) throw error
        setPendingFiles((p) => p.map((x) => (x.id === pf.id ? { ...x, status: 'done', pct: 1 } : x)))
        push(`「${pf.name}」上传完成`, 'ok')
      } catch (e) {
        const msg = e instanceof Error ? e.message : '上传失败'
        setPendingFiles((p) => p.map((x) => (x.id === pf.id ? { ...x, status: 'error', error: msg } : x)))
        push(`附件「${pf.name}」上传失败：${msg}`, 'err')
      }
    }
  }

  function addFiles(files: FileList | File[]) {
    const list = Array.from(files)
    if (!list.length) return
    for (const f of list) {
      const err = validateFile(f)
      if (err) {
        push(err, 'err')
        continue
      }
      setPendingFiles((p) => [
        ...p,
        { id: ++fileSeq.current, file: f, kind: fileKind, name: f.name, size: f.size, status: 'pending', pct: 0 },
      ])
    }
  }

  function removePending(id: number) {
    setPendingFiles((p) => p.filter((x) => x.id !== id))
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
      // 我方主体：输入了字典里没有的新值时，先写入字典表（下次可直接选）。
      // 失败忽略（并发唯一冲突等），不影响合同保存；name 唯一约束保证不重复。
      if (form.our_entity.trim()) {
        const exists = ourEntities.some((o) => o.name === form.our_entity.trim())
        if (!exists) {
          await supabase.from('our_entities').insert({ name: form.our_entity.trim() }).then(() => {})
        }
      }
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
      // 新建/续签创建成功后，若有待上传附件，先批量上传再继续
      if (createdId && pendingFiles.length > 0) {
        await uploadPending(createdId, pendingFiles)
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
      <form onSubmit={submit} className="space-y-3">
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

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
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
          <Field label="我方主体" hint="可从下拉选，也可直接输入新主体（保存后自动加入列表）">
            <input
              list="our-entities-list"
              className={inputCls}
              value={form.our_entity}
              onChange={(e) => set('our_entity', e.target.value)}
              placeholder="选择或输入我方主体"
            />
            <datalist id="our-entities-list">
              {ourEntities.map((o) => (
                <option key={o.id} value={o.name} />
              ))}
            </datalist>
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

          <Field label="签订日期">
            <DateField
                value={form.signed_at}
                onChange={(v) => set('signed_at', v)}
            />
          </Field>
          <Field label="生效日期">
            <DateField
                value={form.start_at}
                onChange={(v) => set('start_at', v)}
            />
          </Field>
          <Field label="到期日期" hint="到期提醒以这个日期为准">
            <DateField value={form.end_at} onChange={(v) => set('end_at', v)} />
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
        </div>

        <div className="grid grid-cols-1 gap-x-3 gap-y-3 lg:grid-cols-2">
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
                className="min-w-[60px] max-w-[140px] flex-1 bg-transparent text-sm outline-none"
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

          <Field label="提前提醒" hint="到期前几天各推一次">
            <div className="flex flex-wrap gap-1.5">
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
                    className={`rounded border px-2 py-0.5 text-[11px] transition ${
                      on
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {d}天
                  </button>
                )
              })}
            </div>
          </Field>
        </div>

        {!contract && (
          <Field label="附件（可选）" hint="保存时一并上传，可多选">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <select
                  value={fileKind}
                  onChange={(e) => setFileKind(e.target.value as FileKind)}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 outline-none focus:border-indigo-400"
                >
                  {FILE_KIND_ORDER.map((k) => (
                    <option key={k} value={k}>
                      {FILE_KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
                <span>本次选择的文件归为此类</span>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="ml-auto rounded border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-50"
                >
                  选择文件
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.doc,.docx,.zip,.rar"
                  onChange={(e) => {
                    if (e.target.files) addFiles(e.target.files)
                    e.target.value = ''
                  }}
                />
              </div>
              {pendingFiles.length > 0 && (
                <ul className="space-y-1.5">
                  {pendingFiles.map((pf) => (
                    <li
                      key={pf.id}
                      className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                    >
                      <span className="min-w-0 flex-1 truncate text-slate-700">{pf.name}</span>
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                        {FILE_KIND_LABEL[pf.kind]}
                      </span>
                      <span className="shrink-0 text-slate-400">{formatBytes(pf.size)}</span>
                      <span className="shrink-0 text-slate-400">
                        {pf.status === 'done' ? (
                          <span className="text-emerald-600">✓</span>
                        ) : pf.status === 'error' ? (
                          <span className="text-red-500" title={pf.error}>
                            ✗
                          </span>
                        ) : pf.status === 'uploading' ? (
                          `${Math.round(pf.pct * 100)}%`
                        ) : (
                          <button
                            type="button"
                            onClick={() => removePending(pf.id)}
                            className="text-slate-400 hover:text-red-500"
                          >
                            ×
                          </button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Field>
        )}

        <Field label="备注">
          <textarea
            rows={2}
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

/**
 * 自定义紧凑日期选择器：
 * - 显示"2025年9月10日"，没有时显示"选择日期"占位符（替代原生的"年/月/日"）
 * - 点击触发原生 showPicker() 弹出日历（Chrome/Edge/Safari 14+），不支持的浏览器回退到 focus
 * - 附带"×"清除按钮
 * - 隐藏的 <input type="date"> 提供原生日历/键盘输入支持
 */
function DateField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const open = () => {
    const el = inputRef.current
    if (!el) return
    // 原生 showPicker：现代浏览器都支持；旧浏览器回退
    const sp = (el as HTMLInputElement & { showPicker?: () => void }).showPicker
    if (typeof sp === 'function') {
      try {
        sp.call(el)
        return
      } catch {
        /* ignore */
      }
    }
    el.focus()
  }
  return (
    <div className="relative">
      <button
        type="button"
        onClick={open}
        className={`flex w-full items-center justify-between rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-left text-sm transition hover:border-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 focus:outline-none ${
          value ? 'text-slate-800' : 'text-slate-400'
        }`}
      >
        <span className="inline-flex items-center gap-2">
          <svg
            className="h-4 w-4 text-slate-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
          {value ? fmtDate(value) : '选择日期'}
        </span>
        {value && (
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation()
              onChange('')
            }}
            className="ml-2 text-slate-300 hover:text-red-500"
            aria-label="清除"
          >
            ×
          </span>
        )}
      </button>
      {/* 隐藏的原生 date input：负责日历选择与键盘输入 */}
      <input
        ref={inputRef}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
        tabIndex={-1}
        aria-hidden
      />
    </div>
  )
}