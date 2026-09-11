import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Card, Empty, inputClsInline } from '../components/ui'
import { useStores } from '../hooks/useStores'
import { formatDate } from '../lib/format'
import type { AuditLog } from '../types'

// label 用于列表分组标题；short 用于筛选下拉，尽量短以省空间
const ACTION_GROUPS: { label: string; short: string; match: RegExp }[] = [
  { label: '登录 / 账号', short: '账号', match: /^(login|logout|profile\.|password|position)/ },
  { label: '合同', short: '合同', match: /^contract\./ },
  { label: '文件', short: '文件', match: /^(file|cos)/ },
  { label: '门店 / 渠道 / 提醒', short: '门店渠道', match: /^(store|channel|reminder)/ },
  { label: '审计 / 系统', short: '系统', match: /^audit\.|\.system/ },
]

// 动作类型 → 中文名
const ACTION_LABEL: Record<string, string> = {
  login: '登录',
  logout: '登出',
  'profile.update': '更新账号',
  'profile.update.self': '更新本人资料',
  'profile.create': '创建账号',
  'profile.delete': '删除账号',
  'position_template.create': '创建职务模板',
  'position_template.update': '更新职务模板',
  'position_template.delete': '删除职务模板',
  'password.change': '修改密码',
  'password.reset': '重置密码',
  'contract.create': '创建合同',
  'contract.update': '更新合同',
  'contract.delete': '删除合同',
  'contract.renew': '续签合同',
  'contract.status_change': '合同状态变更',
  'contract.export': '导出合同',
  'file.upload': '上传文件',
  'file.download': '下载文件',
  'file.delete': '删除文件',
  'file.preview': '预览文件',
  'cos.sts': '获取上传凭证',
  'cos.signed_url': '生成下载链接',
  'store.create': '创建门店',
  'store.update': '更新门店',
  'store.delete': '删除门店',
  'channel.create': '创建通知渠道',
  'channel.update': '更新通知渠道',
  'channel.delete': '删除通知渠道',
  'channel.test': '测试通知渠道',
  'reminder.create': '创建提醒规则',
  'reminder_rule.create': '创建提醒规则',
  'reminder.update': '更新提醒规则',
  'reminder_rule.update': '更新提醒规则',
  'reminder.delete': '删除提醒规则',
  'reminder_rule.delete': '删除提醒规则',
  'reminder.fire': '触发提醒',
  'audit.export': '导出审计日志',
  'system.cleanup': '系统清理',
  'system.migration': '系统迁移',
  'login.success': '登录成功',
  'login.fail': '登录失败',
  'profile.password.reset': '重置密码',
}

// 资源类型 → 中文名
const RESOURCE_LABEL: Record<string, string> = {
  profile: '账号',
  contract: '合同',
  file: '文件',
  store: '门店',
  channel: '通知渠道',
  reminder: '提醒规则',
  reminder_rule: '提醒规则',
  position_template: '职务模板',
  audit: '审计日志',
  cos: '对象存储',
  system: '系统',
}

function translateAction(action: string): string {
  return ACTION_LABEL[action] ?? action
}

function translateResource(resource: string | null): string {
  if (!resource) return ''
  return RESOURCE_LABEL[resource] ?? resource
}

function actorLabel(log: AuditLog, actorMap: Record<string, string>): string {
  if (!log.actor_id && !log.actor_email) return 'system'
  if (log.actor_id && actorMap[log.actor_id]) return actorMap[log.actor_id]
  return log.actor_email ?? '未知用户'
}

// 资源 ID → 可读名称的 key
function resKey(resource: string | null, id: string | null): string {
  return `${resource ?? ''}:${id ?? ''}`
}

// 日期分隔条：把跨多天的日志按"今天 / 昨天 / 年月日"分段，避免混成一段难扫读
function dayKey(d: string): string {
  const dt = new Date(d)
  return `${dt.getFullYear()}-${dt.getMonth() + 1}-${dt.getDate()}`
}
function dayLabel(d: string): string {
  const dt = new Date(d)
  const now = new Date()
  const yest = new Date()
  yest.setDate(now.getDate() - 1)
  const k = dayKey(d)
  if (k === dayKey(now.toISOString())) return '今天'
  if (k === dayKey(yest.toISOString())) return '昨天'
  return `${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日`
}

export default function Audit() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [actorMap, setActorMap] = useState<Record<string, string>>({})
  const [resourceNames, setResourceNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const stores = useStores()
  const [q, setQ] = useState('')
  const [actionGroup, setActionGroup] = useState('')
  const [resourceFilter, setResourceFilter] = useState('')
  const [actorFilter, setActorFilter] = useState('')
  const [storeFilter, setStoreFilter] = useState('')
  const [range, setRange] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const loadResourceNames = useCallback(async (list: AuditLog[]) => {
    const idsByType: Record<string, string[]> = {}
    for (const l of list) {
      if (!l.resource || !l.resource_id) continue
      ;(idsByType[l.resource] ||= []).push(l.resource_id)
    }
    const names: Record<string, string> = {}

    const fetchInBatches = async <T extends Record<string, unknown>>(
      table: string,
      ids: string[],
      query: string,
      formatter: (row: T) => { key: string; name: string } | null,
    ) => {
      const uniqueIds = Array.from(new Set(ids)).filter(Boolean)
      if (uniqueIds.length === 0) return
      // Supabase .in() 长度无硬性上限，但 500 条以内一次性查更安全
      const { data, error: err } = await supabase.from(table).select(query).in('id', uniqueIds)
      if (err) {
        console.warn(`[Audit] 加载 ${table} 名称失败:`, err.message)
        return
      }
      ;((data ?? []) as unknown as T[]).forEach((row) => {
        const item = formatter(row)
        if (item) {
          names[item.key] = item.name
          // reminder_rules 表同时服务 legacy 'reminder' 与新建 'reminder_rule' 两种 resource 值
          if (table === 'reminder_rules') names[resKey('reminder_rule', row.id as string)] = item.name
        }
      })
    }

    await Promise.all([
      fetchInBatches(
        'profiles',
        idsByType['profile'] ?? [],
        'id, full_name, email',
        (row: { id: string; full_name: string | null; email?: string | null }) => ({
          key: resKey('profile', row.id),
          name: row.full_name || row.email || '未命名账号',
        }),
      ),
      fetchInBatches(
        'contracts',
        idsByType['contract'] ?? [],
        'id, title',
        (row: { id: string; title: string | null }) => ({
          key: resKey('contract', row.id),
          name: row.title || row.id.slice(0, 8),
        }),
      ),
      fetchInBatches(
        'contract_files',
        idsByType['file'] ?? [],
        'id, file_name',
        (row: { id: string; file_name: string | null }) => ({
          key: resKey('file', row.id),
          name: row.file_name || row.id.slice(0, 8),
        }),
      ),
      fetchInBatches(
        'stores',
        idsByType['store'] ?? [],
        'id, name',
        (row: { id: string; name: string | null }) => ({
          key: resKey('store', row.id),
          name: row.name || row.id.slice(0, 8),
        }),
      ),
      fetchInBatches(
        'notification_channels',
        idsByType['channel'] ?? [],
        'id, name',
        (row: { id: string; name: string | null }) => ({
          key: resKey('channel', row.id),
          name: row.name || row.id.slice(0, 8),
        }),
      ),
      fetchInBatches(
        'reminder_rules',
        [...(idsByType['reminder'] ?? []), ...(idsByType['reminder_rule'] ?? [])],
        'id, category, lead_days',
        (row: { id: string; category: string | null; lead_days: number[] | null }) => ({
          key: resKey('reminder', row.id),
          name:
            (row.category ? `${row.category} · ` : '') +
            (row.lead_days?.length ? `${row.lead_days.join('/')}天` : '提醒规则'),
        }),
      ),
      fetchInBatches(
        'position_templates',
        idsByType['position_template'] ?? [],
        'id, name',
        (row: { id: string; name: string | null }) => ({
          key: resKey('position_template', row.id),
          name: row.name || row.id.slice(0, 8),
        }),
      ),
    ])

    setResourceNames(names)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)
    if (err) {
      setError(err.message)
      setLogs([])
      setActorMap({})
      setResourceNames({})
    } else {
      const list = (data as AuditLog[]) ?? []
      setLogs(list)

      // 拉取操作人姓名
      const actorIds = Array.from(new Set(list.map((l) => l.actor_id).filter(Boolean))) as string[]
      if (actorIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', actorIds)
        const map: Record<string, string> = {}
        ;(profiles ?? []).forEach((p: { id: string; full_name: string | null }) => {
          if (p.full_name) map[p.id] = p.full_name
        })
        setActorMap(map)
      } else {
        setActorMap({})
      }

      // 拉取资源可读名称
      await loadResourceNames(list)
    }
    setLoading(false)
  }, [loadResourceNames])

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

  // 时间范围 -> [起, 止] 毫秒区间（含端点）
  const rangeBounds = useMemo((): [number, number] | null => {
    const now = new Date()
    if (range === 'today') {
      const s = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      return [s.getTime(), now.getTime()]
    }
    if (range === '7d') return [now.getTime() - 7 * 864e5, now.getTime()]
    if (range === '30d') return [now.getTime() - 30 * 864e5, now.getTime()]
    if (range === 'custom') {
      const s = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : -Infinity
      const e = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : Infinity
      return [s, e]
    }
    return null
  }, [range, fromDate, toDate])

  // 操作人下拉：从已加载日志里归纳（含"系统"）
  const actorOptions = useMemo(() => {
    const m = new Map<string, string>()
    let hasSystem = false
    for (const l of logs) {
      if (l.actor_id) m.set(l.actor_id, actorMap[l.actor_id] || l.actor_email || '未知用户')
      else hasSystem = true
    }
    const arr = Array.from(m, ([value, label]) => ({ value, label })).sort((a, b) =>
      a.label.localeCompare(b.label, 'zh'),
    )
    if (hasSystem) arr.push({ value: '__system__', label: '系统' })
    return arr
  }, [logs, actorMap])

  // 资源类型下拉：仅列出日志中实际出现过的资源
  const resourceOptions = useMemo(() => {
    const s = new Set<string>()
    for (const l of logs) if (l.resource) s.add(l.resource)
    return Array.from(s)
      .map((v) => ({ value: v, label: translateResource(v) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'zh'))
  }, [logs])

  // 门店下拉：仅列出日志中出现过的门店
  const storeOptions = useMemo(
    () => stores.filter((s) => logs.some((l) => l.store_id === s.id)).map((s) => ({ value: s.id, label: s.name })),
    [stores, logs],
  )

  const hasFilter =
    !!q || !!actionGroup || !!resourceFilter || !!actorFilter || !!storeFilter || range !== 'all'

  function clearAll() {
    setQ('')
    setActionGroup('')
    setResourceFilter('')
    setActorFilter('')
    setStoreFilter('')
    setRange('all')
    setFromDate('')
    setToDate('')
  }

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (actionGroup) {
        const g = ACTION_GROUPS.find((x) => x.label === actionGroup)
        if (!g || !g.match.test(l.action)) return false
      }
      if (resourceFilter && l.resource !== resourceFilter) return false
      if (actorFilter === '__system__') {
        if (l.actor_id) return false
      } else if (actorFilter && l.actor_id !== actorFilter) {
        return false
      }
      if (storeFilter && l.store_id !== storeFilter) return false
      if (rangeBounds) {
        const t = new Date(l.created_at).getTime()
        if (t < rangeBounds[0] || t > rangeBounds[1]) return false
      }
      if (q) {
        const s = q.toLowerCase()
        const actionZh = translateAction(l.action).toLowerCase()
        const resourceZh = translateResource(l.resource).toLowerCase()
        const resourceName = (resourceNames[resKey(l.resource, l.resource_id)] ?? '').toLowerCase()
        const actor = actorLabel(l, actorMap).toLowerCase()
        const email = (l.actor_email ?? '').toLowerCase()
        if (
          !(
            actionZh.includes(s) ||
            l.action.toLowerCase().includes(s) ||
            resourceZh.includes(s) ||
            (l.resource ?? '').toLowerCase().includes(s) ||
            resourceName.includes(s) ||
            actor.includes(s) ||
            email.includes(s) ||
            (l.ip ?? '').toLowerCase().includes(s)
          )
        )
          return false
      }
      return true
    })
  }, [logs, actionGroup, resourceFilter, actorFilter, storeFilter, rangeBounds, q, actorMap, resourceNames])

  // 按 group 分组
  const grouped: Record<string, AuditLog[]> = {}
  for (const l of filtered) {
    const g = ACTION_GROUPS.find((x) => x.match.test(l.action))?.label ?? '其他'
    ;(grouped[g] ||= []).push(l)
  }

  function resourceDisplay(l: AuditLog): string {
    if (!l.resource) return '—'
    const name = resourceNames[resKey(l.resource, l.resource_id)]
    const id = l.resource_id ? l.resource_id.slice(0, 8) : ''
    return `${translateResource(l.resource)} · ${name || id || '—'}`
  }

  async function exportCsv() {
    const rows = [
      ['时间', '操作', '资源', '资源ID', '门店', '操作人', '操作人邮箱', 'IP'].join(','),
      ...filtered.map((l) =>
        [
          new Date(l.created_at).toLocaleString('zh-CN'),
          translateAction(l.action),
          translateResource(l.resource),
          resourceNames[resKey(l.resource, l.resource_id)] || l.resource_id || '',
          l.store_id ?? '',
          actorLabel(l, actorMap),
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
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            className={inputClsInline + ' w-48'}
            placeholder="搜索 操作 / 人名 / 资源 / IP"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            className={inputClsInline + ' w-32'}
            title="动作类型"
            value={actionGroup}
            onChange={(e) => setActionGroup(e.target.value)}
          >
            <option value="">全部动作</option>
            {ACTION_GROUPS.map((g) => (
              <option key={g.label} value={g.label}>
                {g.short}
              </option>
            ))}
          </select>
          <select
            className={inputClsInline + ' w-32'}
            title="资源类型"
            value={resourceFilter}
            onChange={(e) => setResourceFilter(e.target.value)}
          >
            <option value="">全部资源</option>
            {resourceOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            className={inputClsInline + ' w-32'}
            title="操作人"
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
          >
            <option value="">全部操作人</option>
            {actorOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {storeOptions.length > 1 && (
            <select
              className={inputClsInline + ' w-32'}
              title="门店"
              value={storeFilter}
              onChange={(e) => setStoreFilter(e.target.value)}
            >
              <option value="">全部门店</option>
              {storeOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          <select
            className={inputClsInline + ' w-28'}
            title="时间范围"
            value={range}
            onChange={(e) => setRange(e.target.value)}
          >
            <option value="all">全部时间</option>
            <option value="today">今天</option>
            <option value="7d">近7天</option>
            <option value="30d">近30天</option>
            <option value="custom">自定义</option>
          </select>
          {range === 'custom' && (
            <>
              <input
                type="date"
                className={inputClsInline + ' w-36'}
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
              <span className="text-xs text-slate-400">至</span>
              <input
                type="date"
                className={inputClsInline + ' w-36'}
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </>
          )}
          <span className="ml-auto text-xs text-slate-400">
            共 {filtered.length} 条
            {filtered.length !== logs.length && ` / 全部 ${logs.length} 条`}
          </span>
          {hasFilter && (
            <button onClick={clearAll} className="text-xs text-slate-500 hover:text-slate-800 hover:underline">
              清空筛选
            </button>
          )}
        </div>

        {loading ? (
          <Empty text="加载中…" />
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-4 text-center text-sm text-red-600">
            加载失败：{error}
            <button
              onClick={load}
              className="ml-2 rounded border border-red-300 px-2 py-0.5 text-xs hover:bg-red-100"
            >
              重试
            </button>
          </div>
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
                  {items.slice(0, 50).map((l, i) => {
                    const showSep =
                      i === 0 || dayKey(items[i - 1].created_at) !== dayKey(l.created_at)
                    return (
                      <Fragment key={l.id}>
                        {showSep && (
                          <li className="bg-slate-50 px-3 py-1.5 text-[11px] font-medium tracking-wide text-slate-400">
                            {dayLabel(l.created_at)}
                          </li>
                        )}
                        <li className="grid grid-cols-12 items-center gap-2 px-3 py-2 text-xs">
                          <span className="col-span-3 font-mono text-slate-400">
                            {formatDate(l.created_at, true)}
                          </span>
                          <span
                            className="col-span-2 truncate rounded bg-slate-100 px-1.5 py-0.5 text-center text-slate-700"
                            title={l.action}
                          >
                            {translateAction(l.action)}
                          </span>
                          <span
                            className="col-span-3 truncate font-mono text-slate-700"
                            title={l.resource_id ?? undefined}
                          >
                            {resourceDisplay(l)}
                          </span>
                          <span
                            className="col-span-3 truncate text-slate-500"
                            title={l.actor_email ?? undefined}
                          >
                            {actorLabel(l, actorMap)}
                          </span>
                          <span
                            className="col-span-1 truncate text-right text-slate-400"
                            title={l.ip ?? undefined}
                          >
                            {l.ip ?? ''}
                          </span>
                        </li>
                      </Fragment>
                      
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
