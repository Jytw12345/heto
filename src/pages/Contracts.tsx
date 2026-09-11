import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import * as XLSX from 'xlsx'
import { Button, Card, Empty, Field, Modal, Pill, Spinner, StatCard, StatusBadge, inputCls, inputClsInline } from '../components/ui'
import { useToast } from '../components/Toast'
import { useAuth } from '../hooks/useAuth'
import ContractForm from './ContractForm'
import { useStores } from '../hooks/useStores'
import { daysLeft, dueLevel, formatDate, formatMoney } from '../lib/format'
import { CATEGORIES, STATUS_LABEL, type Contract, type ContractStatus } from '../types'

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
  const [ourEntities, setOurEntities] = useState<{ name: string }[]>([])

  // 筛选
  const [q, setQ] = useState('')
  const [storeFilter, setStoreFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<ContractStatus | 'all'>('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [tagFilter, setTagFilter] = useState('all')
  const [ourEntityFilter, setOurEntityFilter] = useState('all')
  const [amountMin, setAmountMin] = useState('')
  const [amountMax, setAmountMax] = useState('')
  const [endBefore, setEndBefore] = useState('')
  const [endAfter, setEndAfter] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)

  // 批量
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchOpen, setBatchOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data }, { data: ts }, { data: oe }] = await Promise.all([
      supabase.from('v_contracts').select('*').order('end_at', { ascending: true, nullsFirst: false }),
      supabase.from('contract_tags').select('name').order('name'),
      supabase.from('our_entities').select('name').order('name'),
    ])
    setRows((data as Contract[]) ?? [])
    setTags((ts as { name: string }[]) ?? [])
    setOurEntities((oe as { name: string }[]) ?? [])
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
      if (endBefore && r.end_at && r.end_at > endBefore) return false
      if (endAfter && r.end_at && r.end_at < endAfter) return false
      return true
    })
  }, [rows, q, storeFilter, statusFilter, categoryFilter, tagFilter, ourEntityFilter, amountMin, amountMax, endBefore, endAfter])

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
    !!amountMin || !!amountMax || !!endBefore || !!endAfter

  function resetFilters() {
    setQ('')
    setStoreFilter('all')
    setStatusFilter('all')
    setCategoryFilter('all')
    setTagFilter('all')
    setOurEntityFilter('all')
    setAmountMin('')
    setAmountMax('')
    setEndBefore('')
    setEndAfter('')
    setShowAdvanced(false)
  }

  function exportExcel() {
    const ws = XLSX.utils.json_to_sheet(
      filtered.map((r) => ({
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
    supabase.rpc('write_audit', { p_action: 'contract.export', p_resource: 'contract', p_payload: { count: filtered.length } })
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
          <div className="relative">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
            </svg>
            <input
              className={`${inputCls} !pl-8 w-full sm:w-[220px] sm:shrink-0`}
              placeholder="搜索名称 / 编号 / 对方 / 门店"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <span className="h-6 w-px bg-slate-200" />
          <select className={`${inputClsInline} shrink-0`} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
            {STATUS_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
          {isHq && (
            <select className={`${inputClsInline} shrink-0`} value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)}>
              <option value="all">全部门店</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
          <select
            className={`${inputClsInline} shrink-0 max-w-[180px]`}
            value={ourEntityFilter}
            onChange={(e) => setOurEntityFilter(e.target.value)}
            title="按我方主体筛选"
          >
            <option value="all">全部主体</option>
            {ourEntities.map((o) => (
              <option key={o.name} value={o.name}>{o.name}</option>
            ))}
          </select>
          <span className="h-6 w-px bg-slate-200" />
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="ghost" onClick={() => setShowAdvanced((v) => !v)} className={showAdvanced ? 'text-indigo-600' : ''}>
              {showAdvanced ? '收起筛选' : '高级筛选'}
            </Button>
            {hasFilter && (
              <Button variant="ghost" onClick={resetFilters}>重置</Button>
            )}
            {can('contract.create') && (
              <Button variant="primary" onClick={() => { setEditing(null); setFormOpen(true) }}>+ 新建合同</Button>
            )}
          </div>
        </div>

        {showAdvanced && (
          <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="类别">
              <select className={inputCls} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                <option value="all">全部</option>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="标签">
              <select className={inputCls} value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
                <option value="all">全部</option>
                {tags.map((t) => <option key={t.name}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="金额区间（元）">
              <div className="flex gap-1">
                <input className={inputCls} placeholder="最小" value={amountMin} onChange={(e) => setAmountMin(e.target.value)} />
                <input className={inputCls} placeholder="最大" value={amountMax} onChange={(e) => setAmountMax(e.target.value)} />
              </div>
            </Field>
            <Field label="到期范围">
              <div className="flex gap-1">
                <input type="date" className={inputCls} value={endAfter} onChange={(e) => setEndAfter(e.target.value)} />
                <input type="date" className={inputCls} value={endBefore} onChange={(e) => setEndBefore(e.target.value)} />
              </div>
            </Field>
          </div>
        )}
      </Card>

      <Card
        title={`合同 · ${filtered.length} 条`}
        extra={
          <div className="flex flex-wrap gap-2">
            {can('contract.export') && (
              <Button onClick={exportExcel}>导出 Excel</Button>
            )}
          </div>
        }
      >
        {loading ? (
          <Empty text="加载中…" icon={<Spinner className="h-6 w-6 text-slate-300" />} />
        ) : filtered.length === 0 ? (
          <Empty text="暂无符合条件的合同" />
        ) : (
          <>
          <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200/70">
            <table className="w-full text-sm table-fixed">
              <colgroup>
                <col className="w-8" />
                <col />
                <col className="w-[88px]" />
                <col className="w-[72px]" />
                <col className="w-[140px]" />
                <col className="w-[100px]" />
                <col className="w-[148px]" />
                <col className="w-[88px]" />
                <col className="w-[120px]" />
              </colgroup>
              <thead className="bg-gradient-to-b from-slate-50 to-slate-50/70 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-8 py-2.5">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={(e) =>
                        setSelected(e.target.checked ? new Set(filtered.map((r) => r.id)) : new Set())
                      }
                    />
                  </th>
                  <th className="px-2 py-2.5 text-left font-medium">合同</th>
                  <th className="px-2 py-2.5 text-left font-medium">门店</th>
                  <th className="px-2 py-2.5 text-left font-medium">类别</th>
                  <th className="px-2 py-2.5 text-left font-medium">对方</th>
                  <th className="px-2 py-2.5 text-right font-medium">金额</th>
                  <th className="px-2 py-2.5 text-left font-medium">到期</th>
                  <th className="px-2 py-2.5 text-left font-medium">状态</th>
                  <th className="px-2 py-2.5 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/80">
                {filtered.map((c) => {
                  const lv = c.status === 'active' ? dueLevel(daysLeft(c.end_at)) : null
                  return (
                    <tr key={c.id} className="transition hover:bg-indigo-50/40">
                      <td className="py-1.5">
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
                      <td className="px-2 py-1.5">
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
                      <td className="px-2 py-2 text-right tabular-nums">
                        {can('amount.view') ? formatMoney(c.amount) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="text-slate-700">{formatDate(c.end_at)}</div>
                        {lv && <Pill className={lv.className}>{lv.label}</Pill>}
                      </td>
                      <td className="px-2 py-1.5">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right">
                        <div className="flex flex-nowrap items-center justify-end gap-1">
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
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-xs text-slate-500">
            <span>共 <b className="tabular-nums text-slate-700">{filtered.length}</b> 条</span>
            <span className="text-slate-300">·</span>
            <span>履行中 <b className="tabular-nums text-slate-700">{stats.active}</b></span>
            {stats.expiring > 0 && (
              <>
                <span className="text-slate-300">·</span>
                <span className="text-amber-700">30天内到期 <b className="tabular-nums">{stats.expiring}</b></span>
              </>
            )}
            {stats.expired > 0 && (
              <>
                <span className="text-slate-300">·</span>
                <span className="text-red-600">已逾期 <b className="tabular-nums">{stats.expired}</b></span>
              </>
            )}
          </div>
          </>
        )}
      </Card>

      {someChecked && can('contract.edit') && (
        <div className="sticky bottom-4 z-20 mx-auto flex max-w-3xl items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-lg">
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