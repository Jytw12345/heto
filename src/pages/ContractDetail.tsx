import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { createViewUrl, downloadFile, removeFile, uploadFile } from '../lib/storage'
import { useAuth } from '../hooks/useAuth'
import { useStores } from '../hooks/useStores'
import { Button, Card, Empty, FileGlyph, FloatingModal, Modal, Pill, Spinner, StatusBadge } from '../components/ui'
import { useToast } from '../components/Toast'
import { copyText, useContextMenu, type MenuItem } from '../components/ContextMenu'
import FileUploader from '../components/FileUploader'
import ContractForm from './ContractForm'
import { daysLeft, dueLevel, formatBytes, formatDate, formatMoney } from '../lib/format'
import { docFilename, printHtml, renderTemplate, buildDocData } from '../lib/docgen'
import { buildDocx, downloadDocx } from '../lib/docx'
import { RichEditor } from '../components/RichEditor'
import { STATUS_LABEL, type Contract, type ContractFile, type ContractTemplate } from '../types'

export default function ContractDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { isHq, can } = useAuth()
  const stores = useStores()
  const { push } = useToast()

  const [c, setC] = useState<Contract | null>(null)
  const [creatorLabel, setCreatorLabel] = useState<string>('—')
  const [files, setFiles] = useState<ContractFile[]>([])
  const [history, setHistory] = useState<{ from_status: string | null; to_status: string; changed_at: string; actor_email: string | null; reason: string | null }[]>([])
  const [editOpen, setEditOpen] = useState(false)
  const [renewOpen, setRenewOpen] = useState(false)
  const [preview, setPreview] = useState<{ url: string; name: string; mime: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [docOpen, setDocOpen] = useState(false)
  const [docLoading, setDocLoading] = useState(false)
  const [templates, setTemplates] = useState<ContractTemplate[]>([])
  const [docPreview, setDocPreview] = useState<{ html: string; filename: string } | null>(null)
  const docEditorRef = useRef<HTMLDivElement>(null)
  const [savingDoc, setSavingDoc] = useState(false)

  // 生成新文档时把 HTML 写进可编辑区（只在源变化时写，避免打字时光标跳动）
  useEffect(() => {
    if (docPreview && docEditorRef.current) docEditorRef.current.innerHTML = docPreview.html
  }, [docPreview])

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
    const contract = (data as Contract) ?? null
    setC(contract)

    // 补 creator 显示名（profiles.full_name > email 用户名 > UUID 前8位 兜底）
    if (contract?.created_by) {
      const { data: creator } = await supabase
        .from('profiles')
        .select('full_name, email')
        .eq('id', contract.created_by)
        .maybeSingle()
      const name = creator?.full_name?.trim()
        || (creator?.email ? creator.email.split('@')[0] : '')
        || contract.created_by.slice(0, 8)
      setCreatorLabel(name)
    } else {
      setCreatorLabel('—')
    }

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

  const ctx = useContextMenu()

  /** 生成合同电子版：选模板 → 预览 → 下载 Word / 打印为 PDF */
  async function openDocPicker() {
    setDocOpen(true)
    if (templates.length) return
    setDocLoading(true)
    const { data } = await supabase
      .from('contract_templates')
      .select('*')
      .eq('active', true)
      .order('name')
    setTemplates(((data as ContractTemplate[]) ?? []).filter((t) => (t.body ?? '').trim() !== ''))
    setDocLoading(false)
  }

  function genFromTemplate(tpl: ContractTemplate) {
    if (!c) return
    const html = renderTemplate(tpl.body, buildDocData(c, { storeName: c.store_name }))
    setDocPreview({ html, filename: docFilename(c.title, tpl.name) })
    setDocOpen(false)
  }

  /** 取当前编辑区内容（用户可在预览弹窗里直接改），兜底用生成时的 HTML */
  function currentDocHtml(): string {
    return docEditorRef.current?.innerHTML ?? docPreview?.html ?? ''
  }

  /** 下载合同文档（.docx）并留痕 */
  async function downloadDoc() {
    if (!docPreview || !c) return
    try {
      await downloadDocx(currentDocHtml(), docPreview.filename, docPreview.filename)
      await supabase.rpc('write_audit', {
        p_action: 'contract.doc_generate',
        p_resource: 'contract',
        p_resource_id: c.id,
        p_store_id: c.store_id,
      })
    } catch (e) {
      push(e instanceof Error ? e.message : '生成 Word 失败', 'err')
    }
  }

  /**
   * 把当前编辑好的合同文档直接存为该合同的附件（上传 COS + 写 contract_files）。
   * 免去「先下载再手动上传」两步。kind 用 attachment（不新增枚举值，无需再跑迁移）。
   */
  async function saveDocAsAttachment() {
    if (!docPreview || !c) return
    setSavingDoc(true)
    try {
      const name = `${docPreview.filename.replace(/\.docx$/i, '')}（系统生成）.docx`
      const bytes = await buildDocx(currentDocHtml(), name)
      const file = new File([bytes as BlobPart], name, {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
      const res = await uploadFile(file, { storeId: c.store_id, contractId: c.id })
      const { error } = await supabase.from('contract_files').insert({
        contract_id: c.id,
        store_id: c.store_id,
        file_path: res.path,
        file_name: res.name,
        mime_type: res.mime,
        size_bytes: res.size,
        sha256: res.sha256,
        kind: 'attachment',
      })
      if (error) throw new Error(error.message)
      await supabase.rpc('write_audit', {
        p_action: 'file.upload',
        p_resource: 'file',
        p_resource_id: c.id,
        p_store_id: c.store_id,
        p_payload: { source: 'generated_docx', name },
      })
      push('已存为该合同的附件', 'ok')
      await loadFiles()
    } catch (e) {
      push(e instanceof Error ? e.message : '保存失败', 'err')
    } finally {
      setSavingDoc(false)
    }
  }

  /** 右键 / 长按「附件条目」的菜单 */
  function fileMenu(f: ContractFile): MenuItem[] {
    const items: MenuItem[] = [
      { label: '预览', onSelect: () => openPreview(f) },
      { label: '下载', onSelect: () => handleDownload(f) },
      { type: 'separator' },
      {
        label: '复制文件名',
        onSelect: async () => {
          const ok = await copyText(f.file_name)
          push(ok ? '已复制文件名' : '复制失败', ok ? 'ok' : 'err')
        },
      },
    ]
    if (can('file.delete')) {
      items.push({ type: 'separator' })
      items.push({ label: '删除附件', danger: true, onSelect: () => handleDelete(f) })
    }
    return items
  }

  const totalSize = files.reduce((s, f) => s + f.size_bytes, 0)
  const showAmount = can('amount.view')

  return (
    <div className="space-y-4">
      {/* B2 面包屑 */}
      <nav className="flex items-center gap-1 text-xs text-slate-500 print:hidden">
        <Link to="/contracts" className="hover:text-slate-800 hover:underline">合同管理</Link>
        {isHq && c.store_name && (
          <>
            <span className="text-slate-300">/</span>
            <span className="truncate">{c.store_name}</span>
          </>
        )}
        <span className="text-slate-300">/</span>
        <span className="truncate text-slate-700">{c.title}</span>
      </nav>

      {/* 顶部 Hero 概览卡：标题 + 元数据条 + 金额 hero + 操作 */}
      <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm print:border-slate-300 print:shadow-none">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold text-slate-900">{c.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              {isHq && <span>📍 {c.store_name}</span>}
              <StatusBadge status={c.status} />
              {c.status === 'active' && <Pill className={lv.className}>{lv.label}</Pill>}
              {c.tags?.map((t) => (
                <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                  #{t}
                </span>
              ))}
            </div>
          </div>
          {/* 金额 hero + 操作按钮：手机纵向堆叠、左对齐、按钮全宽 */}
          <div className="flex flex-col gap-3 sm:items-end">
            {showAmount && c.amount != null && (
              <div className="text-left leading-none sm:text-right">
                <div className="text-[11px] uppercase tracking-wide text-slate-400">合同金额</div>
                <div className="mt-1 text-3xl font-semibold text-[var(--brand)] tabular-nums">
                  {formatMoney(c.amount)}
                </div>
              </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end print:hidden">
              <Button onClick={() => window.print()} className="hidden sm:inline-flex">🖨 打印</Button>
              <Button className="w-full sm:w-auto" onClick={openDocPicker}>📄 合同文档</Button>
              {can('contract.renew') && c.status !== 'cancelled' && (
                <Button className="w-full sm:w-auto" onClick={() => setRenewOpen(true)}>🔁 一键续签</Button>
              )}
              {can('contract.edit') && (
                <Button variant="primary" className="w-full sm:w-auto" onClick={() => setEditOpen(true)}>编辑</Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {c.renewed_from && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 print:border-slate-300 print:bg-transparent print:text-slate-700">
          本合同由原合同续签而来{' '}
          <Link to={`/contracts/${c.renewed_from}`} className="font-medium underline">
            查看原合同
          </Link>
        </div>
      )}

      {/* 主体双栏：左右各占一半 —— 左「基本信息 + 状态历史」，右「扫描件与附件」吸顶 */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-4">
          {/* 基本信息：标签在左、值在右的紧凑两列（合同金额已在 hero 顶部，不重复） */}
          <Card title="基本信息" className="print:break-inside-avoid">
            <dl className="grid grid-cols-1 gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
              <Field k="合同编号">{c.contract_no || '—'}</Field>
              <Field k="类别">{c.category || '—'}</Field>
              <Field k="对方公司">{c.counterparty || '—'}</Field>
              <Field k="我方主体">{c.our_entity || '—'}</Field>
              <Field k="签订日期">{formatDate(c.signed_at)}</Field>
              <Field k="生效日期">{formatDate(c.start_at)}</Field>
              <Field k="到期日期">{formatDate(c.end_at)}</Field>
              <Field k="自动续约">{c.auto_renew ? '是' : '否'}</Field>
              <Field k="提前提醒">
                {c.remind_days?.length ? (
                  <span className="flex flex-wrap gap-1.5">
                    {c.remind_days.map((n) => (
                      <span
                        key={n}
                        className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200"
                      >
                        {n}天前
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="text-slate-400">未设置</span>
                )}
              </Field>
              <Field k="创建人">
                <span className="font-medium text-slate-800">{creatorLabel}</span>
              </Field>
            </dl>
            {c.note && (
              <div className="mt-4 border-t border-slate-100 pt-3 print:border-slate-200">
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">备注</div>
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">
                  {c.note}
                </p>
              </div>
            )}
          </Card>

          <Card title="状态历史" className="print:break-inside-avoid">
            {history.length === 0 ? (
              <Empty text="暂无状态变更记录" compact />
            ) : (
              <ol className="relative space-y-3 pl-5 before:absolute before:bottom-1 before:left-1.5 before:top-1 before:w-px before:bg-slate-200">
                {history.map((h, i) => (
                  <li key={i} className="relative">
                    <span className="absolute -left-5 top-1.5 h-2.5 w-2.5 rounded-full bg-white ring-2 ring-[var(--brand)]" />
                    <div className="font-mono text-[11px] text-slate-400">
                      {formatDate(h.changed_at, true)}
                    </div>
                    <div className="mt-0.5 text-sm text-slate-800">
                      {h.from_status
                        ? `${STATUS_LABEL[h.from_status as keyof typeof STATUS_LABEL] ?? h.from_status} → `
                        : ''}
                      <span className="font-medium">
                        {STATUS_LABEL[h.to_status as keyof typeof STATUS_LABEL] ?? h.to_status}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      操作人：{h.actor_email || 'system'}
                      {h.reason && <span className="ml-1">· 备注：{h.reason}</span>}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div>
          <Card
            title="扫描件与附件"
            extra={
              <div className="flex items-center gap-3 print:hidden">
                <span className="text-xs text-slate-400">
                  {files.length} 个 · {formatBytes(totalSize)}
                </span>
                {files.length > 0 && (
                  <button onClick={downloadAll} className="text-xs text-slate-600 hover:underline">
                    一键下载全部
                  </button>
                )}
              </div>
            }
            className="print:break-inside-avoid lg:sticky lg:top-4 print:static"
          >
            <div className="print:hidden">
              <FileUploader storeId={c.store_id} contractId={c.id} onUploaded={loadFiles} />
            </div>

            <div className="mt-3">
              {files.length === 0 ? (
                <Empty text="还没有上传扫描件" compact />
              ) : (
                <ul className="space-y-2">
                  {files.map((f) => (
                    <li
                      key={f.id}
                      {...ctx(fileMenu(f))}
                      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-slate-200 p-2.5 transition hover:border-[var(--brand)]/40 hover:bg-[var(--brand)]/5 print:hover:bg-transparent"
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
                      <div className="flex shrink-0 gap-1 print:hidden">
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
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      </div>

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

      {/* 选择合同模板 */}
      <Modal open={docOpen} title="生成合同文档" onClose={() => setDocOpen(false)}>
        {docLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : templates.length === 0 ? (
          <Empty text="还没有带正文的模板，去「合同模板」新建一个" compact />
        ) : (
          <ul className="space-y-2">
            {templates.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => genFromTemplate(t)}
                  className="flex w-full items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-left transition hover:border-[var(--brand)]/50 hover:bg-[var(--brand)]/5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800">{t.name}</span>
                    <span className="block text-[11px] text-slate-400">
                      {t.category || '未分类'} · 点击生成
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">›</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs leading-relaxed text-slate-400">
          会用本合同的「对方公司 / 金额 / 日期」等数据替换模板里的占位符，生成后可下载 Word 或打印为 PDF。
        </p>
      </Modal>

      {/* 合同文档预览 + 下载 */}
      <FloatingModal
        open={!!docPreview}
        title={`合同文档 · ${docPreview?.filename ?? ''}`}
        onClose={() => setDocPreview(null)}
      >
        {docPreview && (
          <div className="flex min-h-0 flex-1 flex-col bg-slate-100">
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
              <span className="mr-auto text-xs text-slate-400">
                可直接在下方修改内容，改完再下载
              </span>
              <Button variant="primary" onClick={downloadDoc}>
                下载 Word（.docx）
              </Button>
              <Button disabled={savingDoc} onClick={saveDocAsAttachment}>
                {savingDoc ? '保存中…' : '存为合同附件'}
              </Button>
              <Button onClick={() => printHtml(currentDocHtml(), docPreview.filename)}>打印 / 存为 PDF</Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              <RichEditor editorRef={docEditorRef} minHeight={520} onMessage={(m) => push(m, 'err')} />
            </div>
          </div>
        )}
      </FloatingModal>

      <FloatingModal
        open={!!preview}
        title={preview?.name ?? ''}
        onClose={() => {
          if (preview?.url) URL.revokeObjectURL(preview.url)
          setPreview(null)
        }}
      >
        {preview && (
          <div className="flex min-h-0 flex-1 flex-col bg-slate-50">
            {preview.mime.startsWith('image/') ? (
              <div className="min-h-0 flex-1 overflow-auto p-2">
                <img src={preview.url} alt={preview.name} className="mx-auto max-h-full object-contain" />
              </div>
            ) : (
              <iframe src={preview.url} className="h-full w-full border-0 bg-white" />
            )}
            <p className="shrink-0 border-t border-slate-100 bg-white px-3 py-1.5 text-center text-xs text-slate-400">
              临时签名 URL，1 小时后失效；原文件始终保存在 COS 私有桶中
            </p>
          </div>
        )}
      </FloatingModal>
    </div>
  )
}

/** 基本信息行：标签在左固定宽、值在右自适应，单行占高更紧凑 */
function Field({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <dt className="w-16 shrink-0 text-[13px] text-slate-400">{k}</dt>
      <dd className="min-w-0 flex-1 break-words text-[13px] text-slate-800">{children}</dd>
    </div>
  )
}