import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { createViewUrl, downloadFile, removeFile } from '../lib/storage'
import { useAuth } from '../hooks/useAuth'
import { useStores } from '../hooks/useStores'
import { Button, Card, Empty, FileGlyph, Modal, Pill, StatusBadge } from '../components/ui'
import { useToast } from '../components/Toast'
import FileUploader from '../components/FileUploader'
import ContractForm from './ContractForm'
import { daysLeft, dueLevel, formatBytes, formatDate, formatMoney } from '../lib/format'
import { STATUS_LABEL, type Contract, type ContractFile } from '../types'

export default function ContractDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { isHq, can } = useAuth()
  const stores = useStores()
  const { push } = useToast()

  const [c, setC] = useState<Contract | null>(null)
  const [files, setFiles] = useState<ContractFile[]>([])
  const [history, setHistory] = useState<{ from_status: string | null; to_status: string; changed_at: string; actor_email: string | null; reason: string | null }[]>([])
  const [editOpen, setEditOpen] = useState(false)
  const [renewOpen, setRenewOpen] = useState(false)
  const [preview, setPreview] = useState<{ url: string; name: string; mime: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const loadFiles = useCallback(async () => {
    const { data } = await supabase
      .from('contract_files')
      .select('*')
      .eq('contract_id', id!)
      .order('created_at', { ascending: true })
    setFiles((data as ContractFile[]) ?? [])
  }, [id])

  const load = useCallback(async () => {
    const [{ data }, { data: h }] = await Promise.all([
      supabase.from('v_contracts').select('*').eq('id', id!).maybeSingle(),
      supabase.from('contract_status_history').select('from_status, to_status, changed_at, reason').eq('contract_id', id!).order('changed_at', { ascending: false }).limit(50),
    ])
    setC((data as Contract) ?? null)
    // 补 actor email
    if (h && h.length) {
      const uids = Array.from(new Set((h as any[]).map(x => x.actor_id).filter(Boolean)))
      let emails: Record<string, string> = {}
      if (uids.length) {
        const { data: users } = await supabase.from('profiles').select('id, full_name').in('id', uids)
        emails = Object.fromEntries((users ?? []).map((u: any) => [u.id, u.full_name || u.id.slice(0, 8)]))
      }
      setHistory(
        (h as any[]).map((x) => ({
          from_status: x.from_status,
          to_status: x.to_status,
          changed_at: x.changed_at,
          actor_email: emails[(x as any).actor_id] ?? null,
          reason: x.reason,
        })),
      )
    } else {
      setHistory([])
    }
    await loadFiles()
  }, [id, loadFiles])

  useEffect(() => {
    load()
  }, [load])

  if (!c) return <Empty text="加载中…" />

  const d = daysLeft(c.end_at)
  const lv = dueLevel(d)

  async function openPreview(f: ContractFile) {
    setBusyId(f.id)
    try {
      const url = await createViewUrl(f.file_path)
      // 关掉前一个 blob URL，避免内存泄漏（同一 Modal 一次只显示一个文件）
      setPreview((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url)
        return { url, name: f.file_name, mime: f.mime_type || 'application/pdf' }
      })
    } catch (e) {
      push(e instanceof Error ? e.message : '预览失败', 'err')
    } finally {
      setBusyId(null)
    }
  }

  async function handleDownload(f: ContractFile) {
    setBusyId(f.id)
    try {
      await downloadFile(f.file_path, f.file_name)
      await supabase.rpc('write_audit', {
        p_action: 'file.download',
        p_resource: 'file',
        p_resource_id: f.id,
        p_store_id: c!.store_id,
      })
    } catch (e) {
      push(e instanceof Error ? e.message : '下载失败', 'err')
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(f: ContractFile) {
    if (!confirm(`确定删除「${f.file_name}」？COS 上的原文件也会一并删除，无法恢复。`)) return
    setBusyId(f.id)
    try {
      await removeFile(f.file_path)
      const { error } = await supabase.from('contract_files').delete().eq('id', f.id)
      if (error) throw error
      await supabase.rpc('write_audit', {
        p_action: 'file.delete',
        p_resource: 'file',
        p_resource_id: f.id,
        p_store_id: c!.store_id,
        p_payload: { path: f.file_path },
      })
      push('已删除', 'ok')
      await loadFiles()
    } catch (e) {
      push(e instanceof Error ? e.message : '删除失败', 'err')
    } finally {
      setBusyId(null)
    }
  }

  async function downloadAll() {
    if (files.length === 0) return push('没有附件可下载', 'err')
    push(`开始打包下载 ${files.length} 个文件…`, 'ok')
    for (const f of files) {
      // 错开发起，避免 COS 签名 URL 集中签发触发限流
      await new Promise((r) => setTimeout(r, 200))
      try {
        await downloadFile(f.file_path, f.file_name)
      } catch (e) {
        // ignore 后续
      }
    }
  }

  const totalSize = files.reduce((s, f) => s + f.size_bytes, 0)
  const showAmount = can('amount.view')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            onClick={() => navigate(-1)}
            className="mb-1 text-xs text-slate-500 hover:text-slate-800"
          >
            ← 返回
          </button>
          <h1 className="truncate text-lg font-medium text-slate-900">{c.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            {isHq && <span>{c.store_name}</span>}
            <StatusBadge status={c.status} />
            {c.status === 'active' && (
              <Pill className={lv.className}>{lv.label}</Pill>
            )}
            {c.tags?.map((t) => (
              <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                #{t}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('contract.renew') && c.status !== 'cancelled' && (
            <Button onClick={() => setRenewOpen(true)}>🔁 一键续签</Button>
          )}
          {can('contract.edit') && (
            <Button variant="primary" onClick={() => setEditOpen(true)}>编辑</Button>
          )}
        </div>
      </div>

      {c.renewed_from && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
          本合同由原合同续签而来{' '}
          <Link to={`/contracts/${c.renewed_from}`} className="font-medium underline">
            查看原合同
          </Link>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="合同信息" className="lg:col-span-1">
          <dl className="space-y-3 text-sm">
            <Row k="合同编号" v={c.contract_no || '—'} />
            <Row k="类别" v={c.category || '—'} />
            <Row k="对方公司" v={c.counterparty || '—'} />
            <Row k="我方主体" v={c.our_entity || '—'} />
            <Row k="合同金额" v={showAmount ? formatMoney(c.amount) : '🔒 无权限'} />
            <Row k="签订日期" v={formatDate(c.signed_at)} />
            <Row k="生效日期" v={formatDate(c.start_at)} />
            <Row k="到期日期" v={formatDate(c.end_at)} />
            <Row k="自动续约" v={c.auto_renew ? '是' : '否'} />
            <Row k="提前提醒" v={c.remind_days?.length ? c.remind_days.map((n) => `${n}天`).join(' / ') : '未设置'} />
            <Row k="创建人" v={c.created_by?.slice(0, 8) ?? '—'} />
          </dl>
          {c.note && (
            <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
              {c.note}
            </div>
          )}
        </Card>

        <Card
          title="扫描件与附件"
          extra={
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400">
                {files.length} 个 · {formatBytes(totalSize)}
              </span>
              {files.length > 0 && (
                <button
                  onClick={downloadAll}
                  className="text-xs text-slate-600 hover:underline"
                >
                  一键下载全部
                </button>
              )}
            </div>
          }
          className="lg:col-span-2"
        >
          <FileUploader storeId={c.store_id} contractId={c.id} onUploaded={loadFiles} />

          <div className="mt-4">
            {files.length === 0 ? (
              <Empty text="还没有上传扫描件" />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {files.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 transition hover:border-indigo-300 hover:bg-indigo-50/40"
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
                      <Button variant="ghost" onClick={() => openPreview(f)} disabled={busyId === f.id}>
                        预览
                      </Button>
                      <Button variant="ghost" onClick={() => handleDownload(f)} disabled={busyId === f.id}>
                        下载
                      </Button>
                      {can('file.delete') && (
                        <Button variant="danger" onClick={() => handleDelete(f)} disabled={busyId === f.id}>
                          删除
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      {history.length > 0 && (
        <Card title="状态历史">
          <ul className="space-y-2 text-xs">
            {history.map((h, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="font-mono text-slate-400">{formatDate(h.changed_at, true)}</span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">
                  {h.from_status ? `${STATUS_LABEL[h.from_status as keyof typeof STATUS_LABEL] ?? h.from_status} → ` : ''}
                  {STATUS_LABEL[h.to_status as keyof typeof STATUS_LABEL] ?? h.to_status}
                </span>
                <span className="text-slate-500">
                  操作人：{h.actor_email || 'system'}
                  {h.reason && ` · 备注：${h.reason}`}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ContractForm
        open={editOpen}
        contract={c}
        stores={stores}
        onClose={() => setEditOpen(false)}
        onSaved={load}
      />

      <ContractForm
        open={renewOpen}
        contract={null}
        renewFrom={c}
        stores={stores}
        onClose={() => setRenewOpen(false)}
        onSaved={() => {
          setRenewOpen(false)
          load()
        }}
        onAfterCreate={(id) => { setRenewOpen(false); navigate(`/contracts/${id}`) }}
      />

      <Modal
        open={!!preview}
        title={preview?.name ?? ''}
        onClose={() => {
          if (preview?.url) URL.revokeObjectURL(preview.url)
          setPreview(null)
        }}
        wide
      >
        {preview && (
          <div className="space-y-3">
            {preview.mime.startsWith('image/') ? (
              <img src={preview.url} alt={preview.name} className="mx-auto max-h-[70vh] rounded-lg" />
            ) : (
              <iframe src={preview.url} className="h-[70vh] w-full rounded-lg border border-slate-200" />
            )}
            <p className="text-center text-xs text-slate-400">
              临时签名 URL，1 小时后失效；原文件始终保存在 COS 私有桶中
            </p>
          </div>
        )}
      </Modal>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-slate-500">{k}</dt>
      <dd className="truncate text-right text-slate-800">{v}</dd>
    </div>
  )
}