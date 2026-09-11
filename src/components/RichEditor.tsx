import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { TEMPLATE_TOKENS } from '../lib/docgen'
import {
  FONT_FAMILIES,
  FONT_SIZES,
  LINE_HEIGHTS,
  SPACINGS,
  cleanPastedHtml,
  clearInlineFormat,
  currentTable,
  deleteCol,
  deleteRow,
  deleteTable,
  exec,
  fitTable,
  getColWidth,
  insertCol,
  setColWidth,
  insertHtml,
  insertRow,
  insertTable,
  mergeCells,
  setAlign,
  setBlockSpacing,
  setCellAlign,
  setColor,
  setFontFamily,
  setFontSize,
  setHighlight,
  setLineHeight,
  setTableBorder,
  setTextIndent,
  splitCell,
  toggleHeaderRow,
  type BorderMode,
} from '../lib/richtext'

/**
 * 类 Word 的富文本编辑器：字体 / 字号 / 颜色 / 高亮 / 段落 / 表格排版。
 * 编辑区由外部传入 ref 控制内容（切换模板时写 innerHTML）。
 */
export function RichEditor({
  editorRef,
  readOnly = false,
  onMessage,
  minHeight = 460,
}: {
  editorRef: RefObject<HTMLDivElement>
  readOnly?: boolean
  onMessage?: (msg: string) => void
  minHeight?: number
}) {
  const [tablePanel, setTablePanel] = useState(false)
  const [fieldPanel, setFieldPanel] = useState(false)
  const [inTable, setInTable] = useState(false)
  const [tblRows, setTblRows] = useState(3)
  const [tblCols, setTblCols] = useState(3)
  const [tblHeader, setTblHeader] = useState(true)
  const [indentOn, setIndentOn] = useState(false)
  const [colW, setColW] = useState(25)
  const colInputFocused = useRef(false)

  const savedRange = useRef<Range | null>(null)

  // 记录选区：点下拉框/颜色选择器会让编辑区失焦，需要恢复
  useEffect(() => {
    const onSel = () => {
      const root = editorRef.current
      if (!root) return
      const s = document.getSelection()
      if (s && s.rangeCount > 0) {
        const r = s.getRangeAt(0)
        if (root.contains(r.commonAncestorContainer)) savedRange.current = r.cloneRange()
      }
      setInTable(!!currentTable(root))
      if (!colInputFocused.current) {
        const w = getColWidth(root)
        if (w != null) setColW(Math.round(w))
      }
    }
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [editorRef])

  function restoreSelection() {
    const root = editorRef.current
    if (!root) return
    root.focus()
    const r = savedRange.current
    if (r && root.contains(r.commonAncestorContainer)) {
      const s = document.getSelection()
      if (s) {
        s.removeAllRanges()
        s.addRange(r)
      }
    }
  }

  /** 统一入口：恢复选区 → 执行 → 提示 + 刷新表格状态 */
  function run(fn: (root: HTMLDivElement) => string | null | void) {
    const root = editorRef.current
    if (!root || readOnly) return
    restoreSelection()
    const msg = fn(root)
    if (typeof msg === 'string' && msg) onMessage?.(msg)
    setInTable(!!currentTable(root))
  }

  function onPaste(e: ReactClipboardEvent<HTMLDivElement>) {
    const html = e.clipboardData.getData('text/html')
    if (!html) return
    e.preventDefault()
    try {
      insertHtml(cleanPastedHtml(html))
    } catch {
      const text = e.clipboardData.getData('text/plain')
      if (text) insertHtml(text.replace(/\n/g, '<br>'))
    }
  }

  const btn =
    'rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40'
  const sel =
    'rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-700 outline-none focus:border-[var(--brand)]'

  /** 工具栏按钮：mousedown 阻止默认，避免光标跳出编辑区 */
  function TB({
    onClick,
    title,
    children,
    disabled,
  }: {
    onClick: () => void
    title: string
    children: ReactNode
    disabled?: boolean
  }) {
    return (
      <button
        type="button"
        title={title}
        disabled={disabled || readOnly}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        className={btn}
      >
        {children}
      </button>
    )
  }

  function Group({ label, children }: { label: string; children: ReactNode }) {
    return (
      <div className="flex items-center gap-1">
        <span className="mr-0.5 hidden text-[10px] font-medium uppercase tracking-wide text-slate-300 lg:inline">
          {label}
        </span>
        {children}
      </div>
    )
  }

  const Sep = () => <span className="mx-1 h-5 w-px bg-slate-200" />

  return (
    <div className="rounded-xl border border-slate-300 bg-white">
      {/* ── 功能区 ── */}
      <div className="space-y-1.5 border-b border-slate-200 bg-slate-50/70 p-2">
        {/* 行 1：撤销 + 字体 */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Group label="编辑">
            <TB title="撤销" onClick={() => run(() => exec('undo'))}>↶</TB>
            <TB title="重做" onClick={() => run(() => exec('redo'))}>↷</TB>
          </Group>
          <Sep />
          <Group label="字体">
            <select
              className={sel}
              title="字体"
              disabled={readOnly}
              value=""
              onChange={(e) => {
                const v = e.target.value
                e.target.value = ''
                run((root) => {
                  setFontFamily(root, v)
                  root.focus()
                })
              }}
            >
              {FONT_FAMILIES.map((f) => (
                <option key={f.label} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            <select
              className={sel}
              title="字号"
              disabled={readOnly}
              value=""
              onChange={(e) => {
                const v = e.target.value
                e.target.value = ''
                run((root) => {
                  setFontSize(root, v)
                  root.focus()
                })
              }}
            >
              <option value="">字号</option>
              {FONT_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s.replace('pt', '')}
                </option>
              ))}
            </select>
            <TB title="加粗" onClick={() => run(() => exec('bold'))}><b>B</b></TB>
            <TB title="斜体" onClick={() => run(() => exec('italic'))}><i>I</i></TB>
            <TB title="下划线" onClick={() => run(() => exec('underline'))}><span className="underline">U</span></TB>
            <TB title="删除线" onClick={() => run(() => exec('strikeThrough'))}><span className="line-through">S</span></TB>
          </Group>
          <Group label="颜色">
            <label className="flex cursor-pointer items-center gap-1 rounded-md border border-slate-200 px-1.5 py-0.5 text-xs text-slate-600" title="字体颜色">
              <span className="font-medium text-[var(--brand-strong)]">A</span>
              <input
                type="color"
                defaultValue="#000000"
                disabled={readOnly}
                className="h-4 w-5 cursor-pointer border-0 bg-transparent p-0"
                onChange={(e) => run(() => setColor(e.target.value))}
              />
            </label>
            <label className="flex cursor-pointer items-center gap-1 rounded-md border border-slate-200 px-1.5 py-0.5 text-xs text-slate-600" title="高亮底色">
              <span className="h-3 w-3 rounded-sm bg-yellow-300" />
              <input
                type="color"
                defaultValue="#ffff00"
                disabled={readOnly}
                className="h-4 w-5 cursor-pointer border-0 bg-transparent p-0"
                onChange={(e) => run(() => setHighlight(e.target.value))}
              />
            </label>
          </Group>
          <Sep />
          <TB title="清除格式" onClick={() => run((root) => clearInlineFormat(root))}>清格式</TB>
        </div>

        {/* 行 2：段落 */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Group label="段落">
            <TB title="左对齐" onClick={() => run(() => setAlign('justifyLeft'))}>左</TB>
            <TB title="居中" onClick={() => run(() => setAlign('justifyCenter'))}>中</TB>
            <TB title="右对齐" onClick={() => run(() => setAlign('justifyRight'))}>右</TB>
            <TB title="两端对齐" onClick={() => run(() => setAlign('justifyFull'))}>两端</TB>
            <select
              className={sel}
              title="行距"
              disabled={readOnly}
              value=""
              onChange={(e) => {
                const v = e.target.value
                e.target.value = ''
                run((root) => setLineHeight(root, v))
              }}
            >
              <option value="">行距</option>
              {LINE_HEIGHTS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
            <select
              className={sel}
              title="段间距（段前/段后）"
              disabled={readOnly}
              value=""
              onChange={(e) => {
                const v = e.target.value
                e.target.value = ''
                run((root) => setBlockSpacing(root, v, v))
              }}
            >
              <option value="">段距</option>
              {SPACINGS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <TB
              title="首行缩进 2 字符"
              onClick={() =>
                run((root) => {
                  const next = !indentOn
                  setIndentOn(next)
                  setTextIndent(root, next ? 2 : 0)
                })
              }
            >
              {indentOn ? '取消缩进' : '首行缩进'}
            </TB>
          </Group>
          <Sep />
          <Group label="样式">
            <TB title="大标题" onClick={() => run(() => exec('formatBlock', 'h1'))}>标题1</TB>
            <TB title="小标题" onClick={() => run(() => exec('formatBlock', 'h3'))}>标题2</TB>
            <TB title="正文段落" onClick={() => run(() => exec('formatBlock', 'p'))}>正文</TB>
            <TB title="无序列表" onClick={() => run(() => exec('insertUnorderedList'))}>• 列表</TB>
            <TB title="有序列表" onClick={() => run(() => exec('insertOrderedList'))}>1. 列表</TB>
          </Group>
        </div>

        {/* 行 3：表格 + 字段 */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={readOnly}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setTablePanel((v) => !v)
              setFieldPanel(false)
            }}
            className={`${btn} ${tablePanel ? 'border-[var(--brand)] text-[var(--brand-strong)]' : ''} ${inTable ? 'font-medium' : ''}`}
          >
            表格 {inTable && '· 光标在表内'} ▾
          </button>
          <button
            type="button"
            disabled={readOnly}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setFieldPanel((v) => !v)
              setTablePanel(false)
            }}
            className={`${btn} ${fieldPanel ? 'border-[var(--brand)] text-[var(--brand-strong)]' : ''}`}
          >
            插入字段 ▾
          </button>
          <span className="text-[11px] text-slate-400">
            支持从 Word 直接粘贴（自动清理 mso 样式）
          </span>
        </div>

        {/* 表格面板 */}
        {tablePanel && (
          <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-2.5">
            <div className="flex flex-wrap items-end gap-2">
              <span className="text-[11px] font-medium text-slate-500">插入表格</span>
              <label className="flex items-center gap-1 text-xs text-slate-600">
                行
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={tblRows}
                  disabled={readOnly}
                  onChange={(e) => setTblRows(Number(e.target.value))}
                  className={`${sel} w-14`}
                />
              </label>
              <label className="flex items-center gap-1 text-xs text-slate-600">
                列
                <input
                  type="number"
                  min={1}
                  max={15}
                  value={tblCols}
                  disabled={readOnly}
                  onChange={(e) => setTblCols(Number(e.target.value))}
                  className={`${sel} w-14`}
                />
              </label>
              <label className="flex items-center gap-1 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={tblHeader}
                  disabled={readOnly}
                  onChange={(e) => setTblHeader(e.target.checked)}
                />
                含表头
              </label>
              <TB
                title="在光标处插入表格"
                onClick={() =>
                  run(() => {
                    insertTable(tblRows, tblCols, tblHeader)
                  })
                }
              >
                插入
              </TB>
              <span className="text-[11px] text-slate-400">（下列操作需先把光标放进表格里）</span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-12 text-[11px] font-medium text-slate-500">行</span>
              <TB title="在上方插入行" disabled={!inTable} onClick={() => run((r) => insertRow(r, 'before'))}>上方插入</TB>
              <TB title="在下方插入行" disabled={!inTable} onClick={() => run((r) => insertRow(r, 'after'))}>下方插入</TB>
              <TB title="删除当前行" disabled={!inTable} onClick={() => run((r) => deleteRow(r))}>删除行</TB>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-12 text-[11px] font-medium text-slate-500">列</span>
              <TB title="在左侧插入列" disabled={!inTable} onClick={() => run((r) => insertCol(r, 'before'))}>左侧插入</TB>
              <TB title="在右侧插入列" disabled={!inTable} onClick={() => run((r) => insertCol(r, 'after'))}>右侧插入</TB>
              <TB title="删除当前列" disabled={!inTable} onClick={() => run((r) => deleteCol(r))}>删除列</TB>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-12 text-[11px] font-medium text-slate-500">合并</span>
              <TB title="合并选中的多个单元格" onClick={() => run((r) => mergeCells(r))}>合并单元格</TB>
              <TB title="拆分当前单元格" disabled={!inTable} onClick={() => run((r) => splitCell(r))}>拆分单元格</TB>
              <TB title="删除整个表格" disabled={!inTable} onClick={() => run((r) => deleteTable(r))}>删除表格</TB>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-12 text-[11px] font-medium text-slate-500">对齐</span>
              <TB disabled={!inTable} title="水平居左" onClick={() => run((r) => setCellAlign(r, 'left'))}>左</TB>
              <TB disabled={!inTable} title="水平居中" onClick={() => run((r) => setCellAlign(r, 'center'))}>中</TB>
              <TB disabled={!inTable} title="水平居右" onClick={() => run((r) => setCellAlign(r, 'right'))}>右</TB>
              <Sep />
              <TB disabled={!inTable} title="垂直靠上" onClick={() => run((r) => setCellAlign(r, 'left', 'top'))}>上</TB>
              <TB disabled={!inTable} title="垂直居中" onClick={() => run((r) => setCellAlign(r, 'left', 'middle'))}>垂直中</TB>
              <TB disabled={!inTable} title="垂直靠下" onClick={() => run((r) => setCellAlign(r, 'left', 'bottom'))}>下</TB>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-12 text-[11px] font-medium text-slate-500">框线</span>
              {(
                [
                  ['all', '全部框线'],
                  ['outer', '仅外框'],
                  ['none', '无框线'],
                ] as [BorderMode, string][]
              ).map(([mode, label]) => (
                <TB key={mode} disabled={!inTable} title={label} onClick={() => run((r) => setTableBorder(r, mode))}>
                  {label}
                </TB>
              ))}
              <Sep />
              <TB disabled={!inTable} title="把首行设为表头（加粗、居中、灰底）" onClick={() => run((r) => toggleHeaderRow(r))}>
                首行设为表头
              </TB>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-12 text-[11px] font-medium text-slate-500">列宽</span>
              <input
                type="number"
                min={5}
                max={100}
                value={colW}
                disabled={readOnly}
                onFocus={() => (colInputFocused.current = true)}
                onBlur={() => (colInputFocused.current = false)}
                onChange={(e) => setColW(Math.max(5, Math.min(100, Number(e.target.value) || 5)))}
                className={`${sel} w-16`}
              />
              <span className="text-[11px] text-slate-400">%（当前列宽）</span>
              <TB title="把光标所在列设为该宽度" disabled={!inTable} onClick={() => run((r) => setColWidth(r, colW))}>
                应用
              </TB>
              <TB
                title="当前列宽度 −5%"
                disabled={!inTable}
                onClick={() =>
                  run((r) => {
                    const nv = Math.max(5, colW - 5)
                    setColW(nv)
                    return setColWidth(r, nv)
                  })
                }
              >
                −5%
              </TB>
              <TB
                title="当前列宽度 +5%"
                disabled={!inTable}
                onClick={() =>
                  run((r) => {
                    const nv = Math.min(100, colW + 5)
                    setColW(nv)
                    return setColWidth(r, nv)
                  })
                }
              >
                +5%
              </TB>
              <Sep />
              <TB disabled={!inTable} title="表格宽度 100% 且各列等宽" onClick={() => run((r) => fitTable(r, true))}>
                列宽均分
              </TB>
            </div>
          </div>
        )}

        {/* 字段面板 */}
        {fieldPanel && <FieldPanel editorRef={editorRef} readOnly={readOnly} onInserted={() => setFieldPanel(false)} />}
      </div>

      {/* ── 编辑区 ── */}
      <div
        ref={editorRef}
        contentEditable={!readOnly}
        suppressContentEditableWarning
        onPaste={onPaste}
        onKeyUp={() => {
          const root = editorRef.current
          if (root) setInTable(!!currentTable(root))
        }}
        onMouseUp={() => {
          const root = editorRef.current
          if (root) setInTable(!!currentTable(root))
        }}
        style={{ minHeight }}
        className={`px-4 py-3 text-sm leading-relaxed text-slate-800 outline-none focus:ring-2 focus:ring-[var(--brand-ring)] [&_h1]:my-3 [&_h1]:text-center [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:my-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:my-2 [&_h3]:font-semibold [&_ol]:ml-5 [&_ol]:list-decimal [&_p]:my-1.5 [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-slate-400 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-slate-400 [&_th]:bg-slate-50 [&_th]:px-2 [&_th]:py-1 [&_ul]:ml-5 [&_ul]:list-disc ${
          readOnly ? 'cursor-not-allowed bg-slate-50' : 'bg-white'
        }`}
      />
    </div>
  )
}

function FieldPanel({
  editorRef,
  readOnly,
  onInserted,
}: {
  editorRef: RefObject<HTMLDivElement>
  readOnly?: boolean
  onInserted: () => void
}) {
  // 单独抽出来，避免每次插字段都重渲染整个工具栏
  return (
    <div className="flex flex-wrap gap-1.5 rounded-lg border border-slate-200 bg-white p-2">
      {TEMPLATE_TOKENS.map(({ key: t }) => (
        <button
          key={t}
          type="button"
          disabled={readOnly}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const root = editorRef.current
            if (!root) return
            root.focus()
            insertHtml(`{{${t}}}`)
            onInserted()
          }}
          title={`插入 {{${t}}}`}
          className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:border-[var(--brand)]/50 hover:text-[var(--brand-strong)] disabled:opacity-40"
        >
          {t}
        </button>
      ))}
    </div>
  )
}
