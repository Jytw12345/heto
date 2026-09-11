import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { Button, Card, Empty, Field, FloatingModal, inputCls, Spinner } from '../components/ui'
import { useToast } from '../components/Toast'
import { RichEditor } from '../components/RichEditor'
import {
  docFilename,
  printHtml,
  renderTemplate,
  buildDocData,
  unknownTokens,
} from '../lib/docgen'
import { IMPORT_ACCEPT, importDocFile } from '../lib/docimport'
import { downloadDocx } from '../lib/docx'
import { formatDate } from '../lib/format'
import { CATEGORIES, type Contract, type ContractTemplate, type OurEntity } from '../types'

/** 新建模板时的正文骨架，省得从空白开始 */
const BLANK_BODY = `<h1 style="text-align:center">合同标题</h1>
<p>甲方：{{对方公司}}</p>
<p>乙方：{{我方主体}}</p>
<p>签订日期：{{签订日期}}</p>
<h3>第一条　约定事项</h3>
<p>在此填写条款内容，可用上方的「插入字段」把合同数据自动填进来。</p>
<p style="margin-top:32px">甲方（盖章）：________________　　</p>
<p>乙方（盖章）：________________　　</p>`

/** 预览/下载用的示例数据（未选合同时使用） */
const SAMPLE: Partial<Contract> = {
  title: '示例合同',
  contract_no: 'HT-2026-0001',
  category: '租赁',
  counterparty: '示例科技有限公司',
  our_entity: '济宁市万紫千红文化传媒有限公司',
  amount: 500,
  signed_at: '2026-01-01',
  start_at: '2026-01-01',
  end_at: '2027-01-01',
  remind_days: [30, 7, 1],
  note: '示例备注：合同终止后 5 个工作日内退还押金。',
  store_name: '总店',
}

type Form = {
  name: string
  category: string
  our_entity: string
  reminderDays: string
  note: string
  active: boolean
  body: string
}

const EMPTY_FORM: Form = {
  name: '',
  category: '租赁',
  our_entity: '',
  reminderDays: '30, 7, 1',
  note: '',
  active: true,
  body: BLANK_BODY,
}

export default function Templates() {
  const { can } = useAuth()
  const { push } = useToast()
  const editable = can('template.manage')

  const [list, setList] = useState<ContractTemplate[]>([])
  const [entities, setEntities] = useState<OurEntity[]>([])
  const [loading, setLoading] = useState(true)
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [form, setForm] = useState<Form>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<{ html: string; filename: string } | null>(null)

  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('contract_templates')
      .select('*')
      .order('created_at', { ascending: true })
    if (error) {
      push(error.message, 'err')
      setList([])
    } else {
      setList((data as ContractTemplate[]) ?? [])
    }
    setLoading(false)
  }, [push])

  useEffect(() => {
    load()
    supabase
      .from('our_entities')
      .select('*')
      .order('name')
      .then(({ data }) => setEntities((data as OurEntity[]) ?? []))
  }, [load])

  // 切换模板：同步表单 + 写入编辑器 DOM（只在切换时写，避免光标跳动）
  useEffect(() => {
    const tpl = list.find((t) => t.id === currentId)
    const next: Form = tpl
      ? {
          name: tpl.name,
          category: tpl.category ?? '其他',
          our_entity: tpl.our_entity ?? '',
          reminderDays: (tpl.default_remind_days ?? []).join(', '),
          note: tpl.note ?? '',
          active: tpl.active,
          body: tpl.body ?? '',
        }
      : EMPTY_FORM
    setForm(next)
    if (editorRef.current) editorRef.current.innerHTML = next.body
  }, [currentId, list])

  function currentBody(): string {
    return editorRef.current?.innerHTML ?? form.body
  }

  function parseDays(s: string): number[] {
    return s
      .split(/[,，\s]+/)
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => b - a)
  }

  async function save() {
    if (!editable) return
    if (!form.name.trim()) return push('模板名称不能为空', 'err')
    const body = currentBody()
    const unknown = unknownTokens(body)
    if (unknown.length) {
      push(`有未识别的占位符会被原样保留：${unknown.join('、')}`, 'err')
    }
    setSaving(true)
    const payload = {
      name: form.name.trim(),
      category: form.category || null,
      our_entity: form.our_entity || null,
      default_remind_days: parseDays(form.reminderDays).length ? parseDays(form.reminderDays) : [30, 7, 1],
      note: form.note || null,
      active: form.active,
      body,
      updated_at: new Date().toISOString(),
    }
    const { data, error } = currentId
      ? await supabase.from('contract_templates').update(payload).eq('id', currentId).select('*').maybeSingle()
      : await supabase.from('contract_templates').insert(payload).select('*').maybeSingle()
    setSaving(false)
    if (error) return push(error.message, 'err')
    await supabase.rpc('write_audit', {
      p_action: currentId ? 'template.update' : 'template.create',
      p_resource: 'contract_template',
      p_resource_id: currentId ?? (data as ContractTemplate | null)?.id ?? null,
    })
    push('已保存', 'ok')
    await load()
    if (!currentId && data) setCurrentId((data as ContractTemplate).id)
  }

  async function remove(tpl: ContractTemplate) {
    if (!editable) return
    if (!confirm(`确定删除模板「${tpl.name}」？不可恢复。`)) return
    const { error } = await supabase.from('contract_templates').delete().eq('id', tpl.id)
    if (error) return push(error.message, 'err')
    await supabase.rpc('write_audit', {
      p_action: 'template.delete',
      p_resource: 'contract_template',
      p_resource_id: tpl.id,
    })
    push('已删除', 'ok')
    if (currentId === tpl.id) setCurrentId(null)
    await load()
  }

  /** 导入已有合同文件（.docx / .html / .txt）作为模板正文 */
  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!editable) return push('当前账号没有模板管理权限', 'err')
    setImporting(true)
    try {
      const { html, warnings } = await importDocFile(f, {
        ourEntities: entities.map((x) => x.name),
        toPlaceholder: true,
      })
      if (editorRef.current) editorRef.current.innerHTML = html
      if (!form.name.trim()) {
        setForm((p) => ({ ...p, name: f.name.replace(/\.[^.]+$/, '') }))
      }
      for (const w of warnings) push(w, 'err')
      push('已导入正文，请检查排版后点「保存」', 'ok')
    } catch (err) {
      push(err instanceof Error ? err.message : '导入失败', 'err')
    } finally {
      setImporting(false)
    }
  }

  /** 用示例数据预览（也可直接从预览里下载/打印） */
  function previewTemplate() {
    const body = currentBody()
    if (!body.trim()) return push('正文还是空的', 'err')
    const html = renderTemplate(body, buildDocData(SAMPLE, { storeName: '总店' }))
    setPreview({ html, filename: docFilename(SAMPLE.title ?? '示例合同', form.name || '未命名模板') })
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      {/* 左：模板列表 */}
      <div className="xl:col-span-4">
        <Card
          title="合同模板"
          extra={
            editable ? (
              <Button variant="primary" onClick={() => setCurrentId(null)}>
                + 新建模板
              </Button>
            ) : (
              <span className="text-xs text-slate-400">只读</span>
            )
          }
        >
          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : list.length === 0 ? (
            <Empty text="还没有模板" compact />
          ) : (
            <ul className="space-y-1.5">
              {list.map((t) => {
                const active = t.id === currentId
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setCurrentId(t.id)}
                      className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                        active
                          ? 'border-[var(--brand)] bg-[var(--brand-soft)]'
                          : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                          {t.name}
                        </span>
                        {!t.active && (
                          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
                            已停用
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400">
                        <span>{t.category || '未分类'}</span>
                        <span>·</span>
                        <span className="truncate">
                          {(t.body ?? '').trim() ? `${(t.body ?? '').replace(/<[^>]+>/g, '').length} 字` : '无正文'}
                        </span>
                        {t.updated_at && (
                          <>
                            <span>·</span>
                            <span className="truncate">{formatDate(t.updated_at)} 更新</span>
                          </>
                        )}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="mt-3 text-xs leading-relaxed text-slate-400">
            模板同时承担两件事：① 新建合同时「套用模板」自动填字段；② 按模板生成合同电子版（Word / PDF）。
            {!editable && ' 当前账号没有「合同模板」管理权限，只能查看和使用。'}
          </p>
        </Card>
      </div>

      {/* 右：编辑器 */}
      <div className="space-y-4 xl:col-span-8">
        <Card
          title={currentId ? '编辑模板' : '新建模板'}
          extra={
            <div className="flex flex-wrap items-center justify-end gap-2">
              {editable && (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    accept={IMPORT_ACCEPT}
                    className="hidden"
                    onChange={onPickFile}
                  />
                  <Button disabled={importing} onClick={() => fileRef.current?.click()}>
                    {importing ? '解析中…' : '导入合同文件'}
                  </Button>
                </>
              )}
              <Button onClick={previewTemplate}>预览效果</Button>
              {editable && (
                <Button variant="primary" disabled={saving} onClick={save}>
                  {saving ? '保存中…' : '保存'}
                </Button>
              )}
              {editable && currentId && (
                <Button
                  variant="danger"
                  onClick={() => {
                    const tpl = list.find((t) => t.id === currentId)
                    if (tpl) remove(tpl)
                  }}
                >
                  删除
                </Button>
              )}
            </div>
          }
        >
          {/* 四个元数据字段一行排开：名称/我方主体给较宽，类别/提醒天数收窄 */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.5fr_0.9fr_1.4fr_0.9fr]">
            <Field label="模板名称 *">
              <input
                className={inputCls}
                value={form.name}
                disabled={!editable}
                placeholder="如：设备租赁合同（通用）"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="默认类别">
              <select
                className={inputCls}
                value={form.category}
                disabled={!editable}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="默认我方主体">
              <select
                className={inputCls}
                value={form.our_entity}
                disabled={!editable}
                onChange={(e) => setForm({ ...form, our_entity: e.target.value })}
              >
                <option value="">不预设</option>
                {entities.map((o) => (
                  <option key={o.id} value={o.name}>
                    {o.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="默认提醒天数">
              <input
                className={inputCls}
                value={form.reminderDays}
                disabled={!editable}
                placeholder="30, 7, 1"
                title="英文逗号分隔，如 30, 7, 1"
                onChange={(e) => setForm({ ...form, reminderDays: e.target.value })}
              />
            </Field>
          </div>

          <div className="mt-4">
            <RichEditor
              editorRef={editorRef}
              readOnly={!editable}
              onMessage={(m) => push(m, 'err')}
            />
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              提示：占位符形如 <code className="rounded bg-slate-100 px-1">{'{{对方公司}}'}</code>，
              生成文档时会自动替换成实际合同数据。「预览效果」用的是示例数据。
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              导入支持 <b>.docx</b>（Word 2007+，会保留标题/加粗/表格）、<b>.html</b>、<b>.txt</b>；
              旧版 <b>.doc</b> 是二进制格式无法解析，请先用 Word/WPS「另存为 .docx」。
              导入时会把你已登记的我方主体全称自动换成 {'{{我方主体}}'} 占位符。
            </p>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={form.active}
                disabled={!editable}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              启用（停用后新建合同时不再出现在「套用模板」里）
            </label>
          </div>
        </Card>
      </div>

      {/* 预览 / 下载 */}
      <FloatingModal
        open={!!preview}
        title={`预览 · ${preview?.filename ?? ''}`}
        onClose={() => setPreview(null)}
      >
        {preview && (
          <div className="flex min-h-0 flex-1 flex-col bg-slate-100">
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-b border-slate-200 bg-white px-3 py-2">
              <Button
                variant="primary"
                onClick={async () => {
                  try {
                    await downloadDocx(preview.html, preview.filename, preview.filename)
                  } catch (e) {
                    push(e instanceof Error ? e.message : '生成 Word 失败', 'err')
                  }
                }}
              >
                下载 Word（.docx）
              </Button>
              <Button onClick={() => printHtml(preview.html, preview.filename)}>打印 / 存为 PDF</Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <div
                className="mx-auto max-w-[820px] rounded-lg bg-white px-10 py-8 shadow-sm [&_h1]:mb-4 [&_h1]:text-center [&_h1]:text-xl [&_h1]:font-semibold [&_h3]:my-2 [&_h3]:font-semibold [&_p]:my-1.5 [&_p]:text-sm [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-slate-300 [&_td]:px-2 [&_td]:py-1 [&_td]:text-sm [&_th]:border [&_th]:border-slate-300 [&_th]:bg-slate-50 [&_th]:px-2 [&_th]:py-1 [&_th]:text-sm"
                // 模板正文由总部维护，属可信内容；占位符替换值已做 HTML 转义
                dangerouslySetInnerHTML={{ __html: preview.html }}
              />
            </div>
          </div>
        )}
      </FloatingModal>
    </div>
  )
}
