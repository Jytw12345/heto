import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Card, Empty, Field, inputCls } from '../components/ui'
import { formatDate } from '../lib/format'
import type { AuditLog } from '../types'

const ACTION_GROUPS: { label: string; match: RegExp }[] = [
  { label: '登录 / 账号', match: /^(login|logout|profile\.|password)/ },
  { label: '合同', match: /^contract\./ },
  { label: '文件', match: /^(file|cos)/ },
  { label: '门店 / 渠道 / 提醒', match: /^(store|channel|reminder)/ },
  { label: '审计 / 系统', match: /^audit\.|\.system/ },
]

export default function Audit() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [actionFilter, setActionFilter] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)
    setLogs((data as AuditLog[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const ch = supabase
      .channel('audit')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs' }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [load])

  const filtered = logs.filter((l) => {
    if (actionFilter && !l.action.startsWith(actionFilter)) return false
    if (q) {
      const s = q.toLowerCase()
      if (
        !(l.action.toLowerCase().includes(s) ||
          (l.actor_email ?? '').toLowerCase().includes(s) ||
          (l.resource ?? '').toLowerCase().includes(s))
      )
        return false
    }
    return true
  })

  // 按 group 分组
  const grouped: Record<string, AuditLog[]> = {}
  for (const l of filtered) {
    const g =
      ACTION_GROUPS.find((x) => x.match.test(l.action))?.label ?? '其他'
    ;(grouped[g] ||= []).push(l)
  }

  async function exportCsv() {
    const rows = [
      ['时间', '操作', '资源', '资源 ID', '门店', '操作人邮箱', 'IP'].join(','),
      ...filtered.map((l) =>
        [
          new Date(l.created_at).toLocaleString('zh-CN'),
          l.action,
          l.resource ?? '',
          l.resource_id ?? '',
          l.store_id ?? '',
          l.actor_email ?? '',
          l.ip ?? '',
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(','),
      ),
    ].join('\n')
    const blob = new Blob(['\ufeff' + rows], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    await supabase.rpc('write_audit', { p_action: 'audit.export' })
  }

  return (
    <div className="space-y-4">
      <Card
        title="审计日志"
        extra={
          <button
            onClick={exportCsv}
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
          >
            导出 CSV
          </button>
        }
      >
        <div className="mb-3 grid gap-2 sm:grid-cols-3">
          <Field label="搜索">
            <input
              className={inputCls}
              placeholder="操作 / 邮箱 / 资源"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </Field>
          <Field label="动作类型">
            <select
              className={inputCls}
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
            >
              <option value="">全部</option>
              <option value="contract.">合同</option>
              <option value="file.">文件</option>
              <option value="profile.">账号</option>
              <option value="store.">门店</option>
              <option value="channel.">渠道</option>
              <option value="reminder">提醒</option>
              <option value="audit.">审计</option>
            </select>
          </Field>
        </div>

        {loading ? (
          <Empty text="加载中…" />
        ) : filtered.length === 0 ? (
          <Empty text="暂无记录" />
        ) : (
          <div className="space-y-4">
            {Object.entries(grouped).map(([g, items]) => (
              <div key={g}>
                <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
                  {g} · {items.length}
                </div>
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {items.slice(0, 50).map((l) => (
                    <li key={l.id} className="grid grid-cols-12 items-center gap-2 px-3 py-2 text-xs">
                      <span className="col-span-3 font-mono text-slate-400">
                        {formatDate(l.created_at, true)}
                      </span>
                      <span className="col-span-2 rounded bg-slate-100 px-1.5 py-0.5 text-center text-slate-700">
                        {l.action}
                      </span>
                      <span className="col-span-3 truncate text-slate-700">
                        {l.resource ? `${l.resource} · ${l.resource_id ?? ''}` : '—'}
                      </span>
                      <span className="col-span-3 truncate text-slate-500">
                        {l.actor_email ?? 'system'}
                      </span>
                      <span className="col-span-1 text-right text-slate-400">
                        {l.ip ?? ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}