import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import * as XLSX from 'xlsx'
import { Button, Card, Empty, Field, FileGlyph, FloatingModal, Modal, Pill, Spinner, StatCard, StatusBadge, inputCls, inputClsInline } from '../components/ui'
import { useToast } from '../components/Toast'
import { useAuth } from '../hooks/useAuth'
import ContractForm from './ContractForm'
import { useStores } from '../hooks/useStores'
import { daysLeft, dueLevel, formatBytes, formatDate, formatMoney, shortEntity } from '../lib/format'
import { CATEGORIES, STATUS_LABEL, type Contract, type ContractFile, type ContractStatus } from '../types'
import { createViewUrl, downloadFile } from '../lib/storage'
import { copyText, useContextMenu, type MenuItem } from '../components/ContextMenu'

const STATUS_OPTIONS: { v: ContractStatus | 'all'; l: string }[] = [
  { v: 'all', l: '全部' },
  { v: 'draft', l: '草稿' },
  { v: 'active', l: '履行中' },
  { v: 'renewed', l: '已续签' },
  { v: 'expired', l: '已到期' },
  { v: 'cancelled', l: '已作废' },
]

export default function Contracts() {
  const { isHq, can } = useAuth()
  const { push } = useToast()
  const navigate = useNavigate()
  const stores = useStores()

  const [rows, setRows] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Contract | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Contract | null>(null)
  const [tags, setTags] = useState<{ name: string }[]>([])
  const [ourEntities, setOurEntities] = useState<{ name: string; short_name: string | null }[]>([])

  // 筛选
  const [q, setQ] = useState('')
  const [storeFilter, setStoreFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<ContractStatus | 'all'>('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [tagFilter, setTagFilter] = useState('all')
  const [ourEntityFilter, setOurEntityFilter] = useState('all')
  const [amountMin, setAmountMin] = useState('')
  const [amountMax, setAmountMax] = useState('')
  const [signedAfter, setSignedAfter] = useState('')
  const [signedBefore, setSignedBefore] = useState('')
  const [startAfter, setStartAfter] = useState('')
  const [startBefore, setStartBefore] = useState('')
  const [endBefore, setEndBefore] = useState('')
  const [endAfter, setEndAfter] = useState('')
  const [autoRenewFilter, setAutoRenewFilter] = useState<'all' | 'yes' | 'no'>('all')
  const [showAdvanced, setShowAdvanced] = useState(false)

  // 批量
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchOpen, setBatchOpen] = useState(false)

  // 行内附件查看
  const [attContract, setAttContract] = useState<Contract | null>(null)
  const [attFiles, setAttFiles] = useState<ContractFile[]>([])
  const [attLoading, setAttLoading] = useState(false)
  const [attBusy, setAttBusy] = useState<string | null>(null)
  const [attPreview, setAttPreview] = useState<{ url: string; name: string; mime: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data }, { data: ts }, { data: oe }] = await Promise.all([
      supabase.from('v_contracts').select('*').order('end_at', { ascending: true, nullsFirst: false }),
      supabase.from('contract_tags').select('name').order('name'),
      supabase.from('our_entities').select('name, short_name').order('name'),
    ])
    setRows((data as Contract[]) ?? [])
    setTags((ts as { name: string }[]) ?? [])
    setOurEntities((oe as { name: string; short_name: string | null }[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (q) {
        const s = q.toLowerCase()
        if (
          !(
            r.title.toLowerCase().includes(s) ||
            (r.contract_no ?? '').toLowerCase().includes(s) ||
            (r.counterparty ?? '').toLowerCase().includes(s) ||
            (r.store_name ?? '').toLowerCase().includes(s)
          )
        )
          return false
      }
      if (storeFilter !== 'all' && r.store_id !== storeFilter) return false
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (categoryFilter !== 'all' && r.category !== categoryFilter) return false
      if (tagFilter !== 'all' && !(r.tags ?? []).includes(tagFilter)) return false
      if (ourEntityFilter !== 'all' && (r.our_entity ?? '') !== ourEntityFilter) return false
      if (amountMin && (r.amount ?? 0) < Number(amountMin)) return false
      if (amountMax && (r.amount ?? 0) > Number(amountMax)) return false
      if (signedAfter && r.signed_at && r.signed_at < signedAfter) return false
      if (signedBefore && r.signed_at && r.signed_at > signedBefore) return false
      if (startAfter && r.start_at && r.start_at < startAfter) return false
      if (startBefore && r.start_at && r.start_at > startBefore) return false
      if (endAfter && r.end_at && r.end_at < endAfter) return false
      if (endBefore && r.end_at && r.end_at > endBefore) return false
      if (autoRenewFilter !== 'all' && r.auto_renew !== (autoRenewFilter === 'yes')) return false
      return true
    })
  }, [rows, q, storeFilter, statusFilter, categoryFilter, tagFilter, ourEntityFilter, amountMin, amountMax, signedAfter, signedBefore, startAfter, startBefore, endBefore, endAfter, autoRenewFilter])

  // 我方主体名称 → 手动简写名 映射，供表格紧凑展示
  const ourEntityShortMap = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const e of ourEntities) m.set(e.name, e.short_name)
    return m
  }, [ourEntities])

  // 表格底部统计条
  const stats = useMemo(() => {
    let total = filtered.length
    let active = 0, expiring = 0, expired = 0
    for (const r of filtered) {
      if (r.status === 'active') {
        active++
        const dl = daysLeft(r.end_at)
        if (dl !== null) {
          if (dl < 0) expired++
          else if (dl <= 30) expiring++
        }
      } else if (r.status === 'expired') {
        expired++
      }
    }
    return { total, active, expiring, expired }
  }, [filtered])

  const hasFilter =
    !!q ||
    statusFilter !== 'all' ||
    storeFilter !== 'all' ||
    categoryFilter !== 'all' ||
    tagFilter !== 'all' ||
    ourEntityFilter !== 'all' ||
    !!amountMin || !!amountMax ||
    !!signedAfter || !!signedBefore ||
    !!startAfter || !!startBefore ||
    !!endAfter || !!endBefore ||
    autoRenewFilter !== 'all'

  function resetFilters() {
    setQ('')
    setStoreFilter('all')
    setStatusFilter('all')
    setCategoryFilter('all')
    setTagFilter('all')
    setOurEntityFilter('all')
    setAmountMin('')
    setAmountMax('')
    setSignedAfter('')
    setSignedBefore('')
    setStartAfter('')
    setStartBefore('')
    setEndAfter('')
    setEndBefore('')
    setAutoRenewFilter('all')
    setShowAdvanced(false)
  }

  function exportExcel() {
    const rows = selected.size > 0 ? filtered.filter((r) => selected.has(r.id)) : filtered
    const ws = XLSX.utils.json_to_sheet(
      rows.map((r) => ({
        合同名称: r.title,
        编号: r.contract_no ?? '',
        门店: r.store_name ?? '',
        类别: r.category ?? '',
        对方公司: r.counterparty ?? '',
        我方主体: r.our_entity ?? '',
        金额: r.amount ?? '',
        签订日期: r.signed_at ?? '',
        生效日期: r.start_at ?? '',
        到期日期: r.end_at ?? '',
        状态: STATUS_LABEL[r.status],
        标签: (r.tags ?? []).join(', '),
        自动续约: r.auto_renew ? '是' : '否',
        提前提醒: (r.remind_days ?? []).join(', ') + ' 天',
        备注: r.note ?? '',
      })),
    )
    ws['!cols'] = [
      { wch: 30 }, { wch: 16 }, { wch: 12 }, { wch: 8 }, { wch: 18 },
      { wch: 18 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
      { wch: 8 }, { wch: 16 }, { wch: 8 }, { wch: 16 }, { wch: 24 },
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '合同清单')
    XLSX.writeFile(wb, `contracts-${new Date().toISOString().slice(0, 10)}.xlsx`)
    push(`已导出 ${rows.length} 条合同`, 'ok')
    supabase.rpc('write_audit', { p_action: 'contract.export', p_resource: 'contract', p_payload: { count: rows.length } })
  }

  async function bulkSetStatus(s: ContractStatus) {
    if (selected.size === 0) return
    const { error } = await supabase.from('contracts').update({ status: s }).in('id', [...selected])
    if (error) return push(error.message, 'err')
    push(`已更新 ${selected.size} 条`, 'ok')
    setSelected(new Set())
    setBatchOpen(false)
    load()
  }

  async function bulkDelete() {
    if (selected.size === 0) return
    if (!confirm(`确认删除 ${selected.size} 条合同？关联扫描件会成孤儿文件，需手动清理。`)) return
    const { error } = await supabase.from('contracts').delete().in('id', [...selected])
    if (error) return push(error.message, 'err')
    push(`已删除 ${selected.size} 条`, 'ok')
    setSelected(new Set())
    load()
  }

  async function deleteOne(c: Contract) {
    const { error } = await supabase.from('contracts').delete().eq('id', c.id)
    if (error) return push(error.message, 'err')
    await supabase.rpc('write_audit', {
      p_action: 'contract.delete',
      p_resource: 'contract',
      p_resource_id: c.id,
      p_store_id: c.store_id,
    })
    push('已删除', 'ok')
    setConfirmDelete(null)
    load()
  }

  async function openAttachments(c: Contract) {
    setAttContract(c)
    setAttFiles([])
    setAttLoading(true)
    try {
      const { data, error } = await supabase
        .from('contract_files')
        .select('id, contract_id, store_id, file_path, file_name, mime_type, size_bytes, kind, created_at')
        .eq('contract_id', c.id)
        .order('created_at', { ascending: true })
      if (error) throw error
      setAttFiles((data as ContractFile[]) ?? [])
    } catch (e) {
      push(e instanceof Error ? e.message : '加载附件失败', 'err')
    } finally {
      setAttLoading(false)
    }
  }

  async function attPreviewFile(f: ContractFile) {
    setAttBusy(f.id)
    try {
      const url = await createViewUrl(f.file_path)
      setAttPreview({ url, name: f.file_name, mime: f.mime_type || 'application/pdf' })
    } catch (e) {
      push(e instanceof Error ? e.message : '预览失败', 'err')
    } finally {
      setAttBusy(null)
    }
  }

  async function attDownload(f: ContractFile) {
    if (!attContract) return
    setAttBusy(f.id)
    try {
      await downloadFile(f.file_path, f.file_name)
      await supabase.rpc('write_audit', {
        p_action: 'file.download',
        p_resource: 'file',
        p_resource_id: f.id,
        p_store_id: attContract.store_id,
      })
    } catch (e) {
      push(e instanceof Error ? e.message : '下载失败', 'err')
    } finally {
      setAttBusy(null)
    }
  }

  const ctx = useContextMenu()

  /** 复制并给出 toast 反馈 */
  async function doCopy(label: string, text: string) {
    const ok = await copyText(text)
    push(ok ? `已复制${label}` : '复制失败', ok ? 'ok' : 'err')
  }

  /** 右键 / 长按「合同行」的菜单：按当前账号权限动态生成 */
  function contractMenu(c: Contract): MenuItem[] {
    const items: MenuItem[] = [
      { label: '打开详情', onSelect: () => navigate(`/contracts/${c.id}`) },
      { label: '编辑合同', onSelect: () => { setEditing(c); setFormOpen(true) } },
      { label: '查看附件', onSelect: () => openAttachments(c) },
      { type: 'separator' },
      {
        label: '复制合同名称',
        onSelect: () => doCopy('合同名称', c.title),
      },
      {
        label: '复制合同编号',
        disabled: !c.contract_no,
        onSelect: () => doCopy('合同编号', c.contract_no ?? ''),
      },
    ]
    if (can('contract.delete')) {
      items.push({ type: 'separator' })
      items.push({ label: '删除合同', danger: true, onSelect: () => setConfirmDelete(c) })
    }
    return items
  }

  /** 右键 / 长按「附件条目」的菜单 */
  function fileMenu(f: ContractFile): MenuItem[] {
    return [
      { label: '预览', onSelect: () => attPreviewFile(f) },
      { label: '下载', onSelect: () => attDownload(f) },
      { type: 'separator' },
      { label: '复制文件名', onSelect: () => doCopy('文件名', f.file_name) },
    ]
  }

  const allChecked = filtered.length > 0 && filtered.every((r) => selected.has(r.id))
  const someChecked = selected.size > 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="合同总数"
          value={stats.total}
          tone="indigo"
          icon={<IcnFile />}
          hint={hasFilter ? '当前筛选范围' : '门店全部合同'}
        />
        <StatCard
          label="履行中"
          value={stats.active}
          tone="emerald"
          icon={<IcnCheck />}
          hint={stats.total > 0 ? `${Math.round((stats.active / Math.max(stats.total, 1)) * 100)}% 占比` : '尚无合同'}
        />
        <StatCard
          label="30天内到期"
          value={stats.expiring}
          tone="amber"
          icon={<IcnClock />}
          hint={stats.expiring > 0 ? '需联系对方续签' : '近 30 天安全'}
        />
        <StatCard
          label="已逾期"
          value={stats.expired}
          tone={stats.expired > 0 ? 'red' : 'slate'}
          icon={<IcnAlert />}
          hint={stats.expired > 0 ? '请尽快处理' : '当前无逾期'}
        />
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200/60">
          <div className="relative w-full sm:w-auto">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
            </svg>
            <input
              className={`${inputCls} !pl-8 w-full sm:w-[170px]`}
              placeholder="名称/编号/对方/门店"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <span className="hidden h-6 w-px bg-slate-200 sm:block" />
          <select className={`${inputClsInline} w-[92px] truncate`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
            {STATUS_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
          <select className={`${inputClsInline} w-[110px] truncate`} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} title="按类别筛选">
            <option value="all">全部类别</option>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
          {isHq && (
            <select className={`${inputClsInline} w-[120px] truncate`} value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} title="按门店筛选">
              <option value="all">全部门店</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
          <select
            className={`${inputClsInline} w-[120px] truncate`}
            value={ourEntityFilter}
            onChange={(e) => setOurEntityFilter(e.target.value)}
            title="按我方主体筛选"
          >
            <option value="all">全部主体</option>
            {ourEntities.map((o) => (
              <option key={o.name} value={o.name}>{o.name}</option>
            ))}
          </select>
          <div className="flex w-full flex-wrap items-center gap-1.5 md:ml-auto md:w-auto md:shrink-0">
            <Button variant="ghost" onClick={() => setShowAdvanced((v) => !v)} className={showAdvanced ? 'text-[var(--brand)]' : ''}>
              {showAdvanced ? '收起筛选' : '高级筛选'}
            </Button>
            {hasFilter && (
              <Button variant="ghost" onClick={resetFilters}>重置</Button>
            )}
            <span className="text-sm text-slate-400">
              共 <b className="tabular-nums text-slate-700">{filtered.length}</b> 条
            </span>
            {can('contract.export') && (
              <Button variant="default" onClick={exportExcel}>
                {selected.size > 0 ? `导出所选 (${selected.size})` : '导出 Excel'}
              </Button>
            )}
            {can('contract.create') && (
              <Button variant="primary" onClick={() => { setEditing(null); setFormOpen(true) }}>+ 新建合同</Button>
            )}
          </div>
        </div>

        {showAdvanced && (
          <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-3 lg:grid-cols-6">
            <Field label="我方主体" className="sm:col-span-2 lg:col-span-2">
              <select className={inputCls} value={ourEntityFilter} onChange={(e) => setOurEntityFilter(e.target.value)}>
                <option value="all">全部主体</option>
                {ourEntities.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
              </select>
            </Field>
            <Field label="标签">
              <select className={`${inputCls} !w-32`} value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
                <option value="all">全部</option>
                {tags.map((t) => <option key={t.name}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="自动续约">
              <select className={`${inputCls} !w-24`} value={autoRenewFilter} onChange={(e) => setAutoRenewFilter(e.target.value as any)}>
                <option value="all">全部</option>
                <option value="yes">是</option>
                <option value="no">否</option>
              </select>
            </Field>
            <Field label="金额区间（元）" className="sm:col-span-2 lg:col-span-2">
              <div className="flex gap-1">
                <input className={`${inputCls} min-w-0`} placeholder="最小" value={amountMin} onChange={(e) => setAmountMin(e.target.value)} />
                <input className={`${inputCls} min-w-0`} placeholder="最大" value={amountMax} onChange={(e) => setAmountMax(e.target.value)} />
              </div>
            </Field>
            <Field label="签订日期" className="sm:col-span-2 lg:col-span-2">
              <div className="flex gap-1">
                <input type="date" className={`${inputCls} min-w-0 px-2`} value={signedAfter} onChange={(e) => setSignedAfter(e.target.value)} />
                <input type="date" className={`${inputCls} min-w-0 px-2`} value={signedBefore} onChange={(e) => setSignedBefore(e.target.value)} />
              </div>
            </Field>
            <Field label="生效日期" className="sm:col-span-2 lg:col-span-2">
              <div className="flex gap-1">
                <input type="date" className={`${inputCls} min-w-0 px-2`} value={startAfter} onChange={(e) => setStartAfter(e.target.value)} />
                <input type="date" className={`${inputCls} min-w-0 px-2`} value={startBefore} onChange={(e) => setStartBefore(e.target.value)} />
              </div>
            </Field>
            <Field label="到期范围" className="sm:col-span-2 lg:col-span-2">
              <div className="flex gap-1">
                <input type="date" className={`${inputCls} min-w-0 px-2`} value={endAfter} onChange={(e) => setEndAfter(e.target.value)} />
                <input type="date" className={`${inputCls} min-w-0 px-2`} value={endBefore} onChange={(e) => setEndBefore(e.target.value)} />
              </div>
            </Field>
          </div>
        )}
      </Card>

      <Card>
        {loading ? (
          <Empty text="加载中…" icon={<Spinner className="h-6 w-6 text-slate-300" />} />
        ) : filtered.length === 0 ? (
          <Empty text="暂无符合条件的合同" />
        ) : (
          <>
          {/* 移动端（< md）：卡片列表，避免 10 列表格横向滚动 */}
          <div className="space-y-2 md:hidden">
            {filtered.map((c) => {
              const lv = c.status === 'active' ? dueLevel(daysLeft(c.end_at)) : null
              return (
                <article
                  key={c.id}
                  {...ctx(contractMenu(c))}
                  className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
                >
                  <div className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0"
                      checked={selected.has(c.id)}
                      onChange={(e) => {
                        const ns = new Set(selected)
                        if (e.target.checked) ns.add(c.id)
                        else ns.delete(c.id)
                        setSelected(ns)
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/contracts/${c.id}`}
                        className="block truncate font-medium text-slate-800"
                      >
                        {c.title}
                      </Link>
                      <div className="mt-0.5 truncate text-[11px] text-slate-400">
                        {c.contract_no ?? ''}
                        {c.tags?.length ? ' · ' + c.tags.join(' · ') : ''}
                      </div>
                    </div>
                    <StatusBadge status={c.status} />
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
                    {isHq && c.store_name && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5">{c.store_name}</span>
                    )}
                    {c.category && <span className="rounded bg-slate-100 px-1.5 py-0.5">{c.category}</span>}
                    <span className="truncate">{c.counterparty ?? '—'}</span>
                    <span className="truncate text-slate-400">
                      我方：{shortEntity(c.our_entity, ourEntityShortMap.get(c.our_entity ?? '') ?? null)}
                    </span>
                  </div>

                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs text-slate-400">到期</div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm text-slate-700">{formatDate(c.end_at)}</span>
                        {lv && <Pill className={`shrink-0 ${lv.className}`}>{lv.label}</Pill>}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-[11px] text-slate-400">金额</div>
                      <div className="text-base font-semibold tabular-nums text-slate-800">
                        {can('amount.view') ? formatMoney(c.amount) : <span className="text-slate-300">—</span>}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-1.5 border-t border-slate-100 pt-2.5">
                    <Button variant="ghost" className="flex-1" onClick={() => openAttachments(c)}>
                      附件
                    </Button>
                    <Button
                      variant="ghost"
                      className="flex-1"
                      onClick={() => { setEditing(c); setFormOpen(true) }}
                    >
                      编辑
                    </Button>
                    {can('contract.delete') && (
                      <Button variant="danger" className="flex-1" onClick={() => setConfirmDelete(c)}>
                        删除
                      </Button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>

          {/* 桌面端（≥ md）：完整表格 */}
          <div className="hidden overflow-x-auto rounded-xl ring-1 ring-slate-200/70 md:block">
            <table className="w-full min-w-[1340px] text-sm table-fixed">
              <colgroup>
                <col className="w-8" />
                <col className="w-[280px]" />
                <col className="w-[96px]" />
                <col className="w-[76px]" />
                <col className="w-[150px]" />
                <col className="w-[120px]" />
                <col className="w-[120px]" />
                <col className="w-[190px]" />
                <col className="w-[88px]" />
                <col className="w-[180px]" />
              </colgroup>
              <thead className="bg-gradient-to-b from-slate-50 to-slate-50/70 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-8 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={(e) =>
                        setSelected(e.target.checked ? new Set(filtered.map((r) => r.id)) : new Set())
                      }
                    />
                  </th>
                  <th className="px-2 py-2 text-left font-medium">合同</th>
                  <th className="px-2 py-2 text-left font-medium">门店</th>
                  <th className="px-2 py-2 text-left font-medium">类别</th>
                  <th className="px-2 py-2 text-left font-medium">对方</th>
                  <th className="px-2 py-2 text-left font-medium">我方主体</th>
                  <th className="pl-2 pr-3 py-2 text-right font-medium">金额</th>
                  <th className="pl-3 pr-2 py-2 text-left font-medium">到期</th>
                  <th className="px-2 py-2 text-left font-medium">状态</th>
                  <th className="px-2 py-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/80">
                {filtered.map((c) => {
                  const lv = c.status === 'active' ? dueLevel(daysLeft(c.end_at)) : null
                  return (
                    <tr key={c.id} {...ctx(contractMenu(c))} className="transition hover:bg-[var(--brand)]/5">
                      <td className="py-2 text-center">
                        <input
                          type="checkbox"
                          checked={selected.has(c.id)}
                          onChange={(e) => {
                            const ns = new Set(selected)
                            if (e.target.checked) ns.add(c.id)
                            else ns.delete(c.id)
                            setSelected(ns)
                          }}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Link
                          to={`/contracts/${c.id}`}
                          className="block truncate font-medium text-slate-800 hover:underline"
                          title={c.title}
                        >
                          {c.title}
                        </Link>
                        <div className="truncate text-[11px] text-slate-400">
                          {c.contract_no ?? ''}
                          {c.tags?.length ? ' · ' + c.tags.join(' · ') : ''}
                        </div>
                      </td>
                      <td className="truncate px-2 py-2 text-slate-600" title={c.store_name ?? ''}>
                        {c.store_name}
                      </td>
                      <td className="truncate px-2 py-2 text-slate-600">{c.category ?? '—'}</td>
                      <td className="truncate px-2 py-2 text-slate-600" title={c.counterparty ?? ''}>
                        {c.counterparty ?? '—'}
                      </td>
                      <td className="truncate px-2 py-2 text-slate-600" title={c.our_entity ?? ''}>
                        {shortEntity(c.our_entity, ourEntityShortMap.get(c.our_entity ?? '') ?? null)}
                      </td>
                      <td className="truncate pl-2 pr-3 py-2 text-right tabular-nums">
                        {can('amount.view') ? formatMoney(c.amount) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="pl-3 pr-2 py-2">
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          <span className="text-slate-700">{formatDate(c.end_at)}</span>
                          {lv && <Pill className={`shrink-0 ${lv.className}`}>{lv.label}</Pill>}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right">
                        <div className="flex flex-nowrap items-center justify-end gap-1">
                          <button
                            onClick={() => openAttachments(c)}
                            className="whitespace-nowrap rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                          >
                            附件
                          </button>
                          <button
                            onClick={() => { setEditing(c); setFormOpen(true) }}
                            className="whitespace-nowrap rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                          >
                            编辑
                          </button>
                          {can('contract.delete') && (
                            <button
                              onClick={() => setConfirmDelete(c)}
                              className="whitespace-nowrap rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                            >
                              删除
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>

      {someChecked && can('contract.edit') && (
        <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-lg md:bottom-[max(1rem,env(safe-area-inset-bottom))]">
          <span className="text-sm text-slate-600">已选 {selected.size} 条</span>
          <div className="flex gap-2">
            <Button onClick={() => setBatchOpen(true)}>批量改状态</Button>
            <Button variant="danger" onClick={bulkDelete}>批量删除</Button>
            <Button variant="ghost" onClick={() => setSelected(new Set())}>取消</Button>
          </div>
        </div>
      )}

      {formOpen && (
        <ContractForm
          open={formOpen}
          contract={editing}
          stores={stores}
          onClose={() => { setFormOpen(false); setEditing(null) }}
          onSaved={load}
          onAfterCreate={(id) => { setFormOpen(false); setEditing(null); navigate(`/contracts/${id}`) }}
        />
      )}

      <Modal open={!!confirmDelete} title="删除合同" onClose={() => setConfirmDelete(null)}>
        <p className="text-sm text-slate-700">
          确认删除「{confirmDelete?.title}」？关联的扫描件会留在 COS 桶里成为孤儿文件，需要从 COS 控制台手动清理。
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => setConfirmDelete(null)}>取消</Button>
          <Button variant="danger" onClick={() => confirmDelete && deleteOne(confirmDelete)}>确认删除</Button>
        </div>
      </Modal>

      <Modal open={batchOpen} title="批量改状态" onClose={() => setBatchOpen(false)}>
        <p className="mb-3 text-sm text-slate-600">将所选 {selected.size} 条合同的状态改为：</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(['draft', 'active', 'renewed', 'expired', 'cancelled'] as ContractStatus[]).map((s) => (
            <Button key={s} onClick={() => bulkSetStatus(s)}>
              {STATUS_LABEL[s]}
            </Button>
          ))}
        </div>
      </Modal>

      {/* 行内附件查看 */}
      <Modal
        open={!!attContract}
        title={`附件 · ${attContract?.title ?? ''}`}
        onClose={() => { setAttContract(null); setAttFiles([]) }}
      >
        {attLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : attFiles.length === 0 ? (
          <Empty text="该合同还没有附件" />
        ) : (
          <ul className="space-y-2">
            {attFiles.map((f) => (
              <li
                key={f.id}
                {...ctx(fileMenu(f))}
                className="flex items-center gap-3 rounded-lg border border-slate-200 p-2.5 transition hover:border-[var(--brand)]/40 hover:bg-[var(--brand)]/5"
              >
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-slate-100">
                  <FileGlyph mime={f.mime_type} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-slate-800">{f.file_name}</div>
                  <div className="text-xs text-slate-400">
                    {formatBytes(f.size_bytes)} · {formatDate(f.created_at)}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" onClick={() => attPreviewFile(f)} disabled={attBusy === f.id}>
                    预览
                  </Button>
                  <Button variant="ghost" onClick={() => attDownload(f)} disabled={attBusy === f.id}>
                    下载
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      {/* 附件预览（可拖动 / 可缩放） */}
      <FloatingModal
        open={!!attPreview}
        title={attPreview?.name ?? '预览'}
        onClose={() => { if (attPreview?.url) URL.revokeObjectURL(attPreview.url); setAttPreview(null) }}
      >
        {attPreview && (
          <div className="flex min-h-0 flex-1 flex-col bg-slate-50 p-2">
            {attPreview.mime.startsWith('image/') ? (
              <div className="min-h-0 flex-1 overflow-auto">
                <img src={attPreview.url} alt={attPreview.name} className="mx-auto max-h-full object-contain" />
              </div>
            ) : (
              <iframe src={attPreview.url} title={attPreview.name} className="h-full w-full rounded border-0 bg-white" />
            )}
          </div>
        )}
      </FloatingModal>
    </div>
  )
}

/* ────── 统计卡图标（heroicons-style 16/16 描边） ────── */

function IcnFile() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8" /><path d="M8 17h5" />
    </svg>
  )
}
function IcnCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="m9 11 3 3L22 4" />
    </svg>
  )
}
function IcnClock() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  )
}
function IcnAlert() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4" /><path d="M12 17h.01" />
    </svg>
  )
}