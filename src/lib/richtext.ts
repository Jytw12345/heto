/**
 * 富文本编辑内核：给 contentEditable 提供「像 Word 一样」的字体 / 段落 / 表格操作。
 *
 * 设计说明：
 * - 字体名/字号/颜色/高亮 走 document.execCommand（浏览器原生、保持光标与撤销栈）；
 *   其中字号用业界通用做法：先 execCommand('fontSize', 7) 打标记，再把标记元素换成
 *   指定 pt 的 <span>，从而突破 execCommand 只支持 1~7 档的限制。
 * - 行高/缩进/段距/单元格对齐/表格增删行列/合并拆分/框线 这些 execCommand 不管的能力，
 *   直接操作 DOM（先算表格网格再改，改完把光标放回第一个单元格）。
 */

export const FONT_FAMILIES: { label: string; value: string }[] = [
  { label: '默认', value: '' },
  { label: '宋体', value: 'SimSun, 宋体, serif' },
  { label: '仿宋', value: 'FangSong, 仿宋, serif' },
  { label: '黑体', value: 'SimHei, 黑体, sans-serif' },
  { label: '楷体', value: 'KaiTi, 楷体, serif' },
  { label: '微软雅黑', value: '"Microsoft YaHei", 微软雅黑, sans-serif' },
  { label: '思源黑体', value: '"Source Han Sans SC", "Noto Sans SC", sans-serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
]

export const FONT_SIZES = ['9pt', '10.5pt', '11pt', '12pt', '14pt', '15pt', '16pt', '18pt', '20pt', '22pt', '24pt', '28pt', '32pt']

export const LINE_HEIGHTS = [
  { label: '单倍行距', value: '1' },
  { label: '1.15', value: '1.15' },
  { label: '1.5 倍行距', value: '1.5' },
  { label: '1.75', value: '1.75' },
  { label: '2 倍行距', value: '2' },
  { label: '2.5 倍行距', value: '2.5' },
  { label: '3 倍行距', value: '3' },
]

export const SPACINGS = [
  { label: '无间距', value: '0' },
  { label: '紧凑（4pt）', value: '4pt' },
  { label: '常规（8pt）', value: '8pt' },
  { label: '宽松（12pt）', value: '12pt' },
  { label: '很宽（18pt）', value: '18pt' },
  { label: '超宽（24pt）', value: '24pt' },
]

const BLOCK_SEL = 'p,h1,h2,h3,h4,h5,h6,li,div'
const CELL_SEL = 'td,th'

/* ───────────── 选区与定位 ───────────── */

function sel(): Selection | null {
  return window.getSelection()
}

/** 从节点向上找最近的块级元素（限定在 root 内） */
export function closestBlock(node: Node | null, root: HTMLElement): HTMLElement | null {
  let el: Node | null = node
  while (el && el !== root) {
    if (el.nodeType === 1) {
      const e = el as HTMLElement
      if (e.matches(BLOCK_SEL)) return e
      if (e.matches(CELL_SEL)) return e // 单元格内没有 p 时，直接作用在单元格上
    }
    el = el.parentNode
  }
  return null
}

/** 当前选区覆盖到的所有块级元素（光标折叠时返回光标所在块） */
export function liveBlocks(root: HTMLElement): HTMLElement[] {
  const s = sel()
  if (!s || s.rangeCount === 0) return []
  const range = s.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return []
  if (range.collapsed) {
    const b = closestBlock(s.anchorNode, root)
    return b ? [b] : []
  }
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SEL)).filter((el) =>
    range.intersectsNode(el),
  )
  // 有嵌套（如 div 套 p）时只保留最内层，避免同一段被设置两次
  return blocks.filter((el) => !blocks.some((o) => o !== el && el.contains(o)))
}

export function currentCell(root: HTMLElement): HTMLTableCellElement | null {
  const s = sel()
  if (!s || s.rangeCount === 0) return null
  const b = closestBlock(s.anchorNode, root)
  if (!b) return null
  const cell = b.matches(CELL_SEL) ? b : b.closest(CELL_SEL)
  return cell && root.contains(cell) ? (cell as HTMLTableCellElement) : null
}

export function currentTable(root: HTMLElement): HTMLTableElement | null {
  const cell = currentCell(root)
  return cell ? (cell.closest('table') as HTMLTableElement | null) : null
}

/** 选区横跨的所有单元格（用于合并 / 批量对齐） */
export function selectedCells(root: HTMLElement): HTMLTableCellElement[] {
  const s = sel()
  if (!s || s.rangeCount === 0) return []
  const range = s.getRangeAt(0)
  const one = currentCell(root)
  if (range.collapsed) return one ? [one] : []
  return Array.from(root.querySelectorAll<HTMLTableCellElement>(CELL_SEL)).filter((c) =>
    range.intersectsNode(c),
  )
}

export function caretInto(el: HTMLElement) {
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(true)
  const s = sel()
  if (!s) return
  s.removeAllRanges()
  s.addRange(range)
}

/* ───────────── 通用命令 ───────────── */

export function exec(cmd: string, value?: string) {
  document.execCommand(cmd, false, value)
}

export function insertHtml(html: string) {
  document.execCommand('insertHTML', false, html)
}

function withStyleCss(on: boolean) {
  try {
    document.execCommand('styleWithCSS', false, on ? 'true' : 'false')
  } catch {
    /* 部分浏览器不支持，忽略 */
  }
}

export function applyToBlocks(root: HTMLElement, fn: (el: HTMLElement) => void) {
  for (const b of liveBlocks(root)) fn(b)
}

/* ───────────── 字体 ───────────── */

export function setFontFamily(root: HTMLElement, family: string) {
  if (!family) {
    // 「默认」= 去掉字体，回到继承
    applyToBlocks(root, (el) => {
      el.style.fontFamily = ''
      el.querySelectorAll<HTMLElement>('[style*="font-family"]').forEach((n) => {
        n.style.fontFamily = ''
      })
    })
    return
  }
  withStyleCss(true)
  document.execCommand('fontName', false, family)
}

/** 突破 execCommand 只有 1~7 档：先打 size=7 标记，再替换成目标 pt */
export function setFontSize(root: HTMLElement, pt: string) {
  if (!pt) return
  withStyleCss(false)
  document.execCommand('fontSize', false, '7')
  withStyleCss(true)
  root.querySelectorAll<HTMLElement>('font[size="7"]').forEach((f) => {
    const span = document.createElement('span')
    span.style.fontSize = pt
    span.innerHTML = f.innerHTML
    f.replaceWith(span)
  })
  // 个别浏览器会生成 xx-large 的 span，一并对齐
  root.querySelectorAll<HTMLElement>('span[style*="xx-large"]').forEach((sp) => {
    if (sp.style.fontSize.includes('xx-large')) sp.style.fontSize = pt
  })
}

export function setColor(color: string) {
  withStyleCss(true)
  document.execCommand('foreColor', false, color)
}

export function setHighlight(color: string) {
  withStyleCss(true)
  try {
    document.execCommand('hiliteColor', false, color)
  } catch {
    document.execCommand('backColor', false, color)
  }
}

export function clearInlineFormat(root: HTMLElement) {
  withStyleCss(false)
  document.execCommand('removeFormat')
  applyToBlocks(root, (el) => {
    el.removeAttribute('style')
  })
  root.querySelectorAll<HTMLElement>('span[style]').forEach((sp) => {
    if (!sp.getAttribute('style')?.trim()) sp.replaceWith(...Array.from(sp.childNodes))
  })
}

/* ───────────── 段落 ───────────── */

export function setAlign(cmd: 'justifyLeft' | 'justifyCenter' | 'justifyRight' | 'justifyFull') {
  withStyleCss(true)
  document.execCommand(cmd)
}

export function setLineHeight(root: HTMLElement, value: string) {
  applyToBlocks(root, (el) => {
    el.style.lineHeight = value
  })
}

export function setTextIndent(root: HTMLElement, em: number) {
  applyToBlocks(root, (el) => {
    el.style.textIndent = em ? `${em}em` : ''
  })
}

export function setBlockSpacing(root: HTMLElement, before: string, after: string) {
  applyToBlocks(root, (el) => {
    el.style.marginTop = before
    el.style.marginBottom = after
  })
}

/* ───────────── 表格 ───────────── */

type Grid = {
  /** matrix[r][c] = 占据该格子的单元格（合并时同一单元格出现多次） */
  matrix: (HTMLTableCellElement | null)[][]
  pos: Map<HTMLTableCellElement, { r: number; c: number }>
  rows: HTMLTableRowElement[]
}

function gridOf(tbl: HTMLTableElement): Grid {
  const rows = Array.from(tbl.rows)
  const matrix: (HTMLTableCellElement | null)[][] = []
  const pos = new Map<HTMLTableCellElement, { r: number; c: number }>()
  rows.forEach((tr, r) => {
    if (!matrix[r]) matrix[r] = []
    let c = 0
    for (const cell of Array.from(tr.cells)) {
      while (matrix[r][c]) c++
      const rs = cell.rowSpan || 1
      const cs = cell.colSpan || 1
      pos.set(cell, { r, c })
      for (let i = 0; i < rs; i++) {
        for (let j = 0; j < cs; j++) {
          if (!matrix[r + i]) matrix[r + i] = []
          matrix[r + i][c + j] = cell
        }
      }
      c += cs
    }
  })
  return { matrix, pos, rows }
}

/**
 * 生成一个新单元格：样式跟随参考单元格，避免新增格子是黑白默认样式。
 * @param keepColSpan 插行时保留参考单元格的 colspan，保证新行与旧行的列对齐
 */
function newCell(tag: 'td' | 'th', ref?: HTMLTableCellElement, keepColSpan = false): HTMLTableCellElement {
  const cell = document.createElement(tag)
  if (ref?.getAttribute('style')) cell.setAttribute('style', ref.getAttribute('style') as string)
  if (ref) cell.style.textAlign = ref.style.textAlign
  if (keepColSpan && ref && ref.colSpan > 1) cell.colSpan = ref.colSpan
  return cell
}

export function insertRow(root: HTMLElement, where: 'before' | 'after') {
  const { table, cell } = ctx(root)
  if (!table || !cell) return
  const tr = cell.parentElement as HTMLTableRowElement
  const isHeader = !!tr.closest('thead')
  const count = tr.cells.length
  const newTr = document.createElement('tr')
  for (let i = 0; i < count; i++) newTr.appendChild(newCell(isHeader ? 'th' : 'td', tr.cells[i], true))
  const ref = where === 'before' ? tr : tr.nextSibling
  tr.parentElement?.insertBefore(newTr, ref)
  caretInto(newTr.cells[0] as HTMLElement)
}

export function insertCol(root: HTMLElement, where: 'before' | 'after') {
  const { table, cell, grid } = ctx(root)
  if (!table || !cell || !grid) return
  const p = grid.pos.get(cell)
  if (!p) return
  const insertAt = where === 'before' ? p.c : p.c + 1
  for (const tr of grid.rows) {
    const target = (Array.from(tr.cells) as HTMLTableCellElement[]).find((c) => {
      const q = grid.pos.get(c)
      return q && q.c >= insertAt
    })
    const isHeader = !!tr.closest('thead')
    const fresh = newCell(isHeader ? 'th' : 'td', cell)
    tr.insertBefore(fresh, target ?? null)
  }
  caretInto(cell)
}

export function deleteRow(root: HTMLElement) {
  const { cell } = ctx(root)
  if (!cell) return
  const tr = cell.parentElement as HTMLTableRowElement
  const parent = tr.parentElement as HTMLElement
  const next = (tr.nextElementSibling ?? tr.previousElementSibling) as HTMLTableRowElement | null
  tr.remove()
  const anchor = next?.cells[0] as HTMLElement | undefined
  if (anchor) caretInto(anchor)
  else if (parent && parent.querySelectorAll('tr').length === 0) parent.remove()
}

export function deleteCol(root: HTMLElement) {
  const { cell, grid } = ctx(root)
  if (!cell || !grid) return
  const p = grid.pos.get(cell)
  if (!p) return
  const target = cell
  for (const tr of grid.rows) {
    const hit = (Array.from(tr.cells) as HTMLTableCellElement[]).find((c) => {
      const q = grid.pos.get(c)
      return q && q.c === p.c
    })
    hit?.remove()
  }
  const anchor = grid.rows[0]?.cells[0] as HTMLElement | undefined
  if (anchor) caretInto(anchor)
  else target.closest('table')?.remove()
}

export function deleteTable(root: HTMLElement) {
  const { table } = ctx(root)
  table?.remove()
}

/** 合并选区内的单元格（要求构成矩形；取左上角单元格承载内容） */
export function mergeCells(root: HTMLElement): string | null {
  const table = currentTable(root)
  const cells = selectedCells(root)
  if (!table || cells.length < 2) return '请先跨多个单元格选中（拖动或按住 Shift 点选）再合并'
  const grid = gridOf(table)
  const ps = cells.map((c) => grid.pos.get(c)).filter(Boolean) as { r: number; c: number }[]
  if (ps.length < 2) return '选中的单元格不在同一表格内'
  const r1 = Math.min(...ps.map((p) => p.r))
  const r2 = Math.max(...ps.map((p) => p.r))
  const c1 = Math.min(...ps.map((p) => p.c))
  const c2 = Math.max(...ps.map((p) => p.c))
  const inBox = new Set<HTMLTableCellElement>()
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) inBox.add(grid.matrix[r][c] as HTMLTableCellElement)
  if (inBox.size !== cells.length) return '只能合并连续的矩形区域，请重新选择'
  const first = grid.matrix[r1][c1] as HTMLTableCellElement
  // 内容依次拼接，避免丢文字
  const merged = cells
    .filter((c) => c !== first)
    .map((c) => c.innerHTML.trim())
    .filter(Boolean)
    .join('<br>')
  if (merged) first.innerHTML = `${first.innerHTML.trim()}${first.innerHTML.trim() ? '<br>' : ''}${merged}`
  for (const c of cells) if (c !== first) c.remove()
  first.rowSpan = r2 - r1 + 1
  first.colSpan = c2 - c1 + 1
  caretInto(first)
  return null
}

/** 拆分当前单元格（把合并的格子还原成普通网格） */
export function splitCell(root: HTMLElement): string | null {
  const table = currentTable(root)
  const cell = currentCell(root)
  if (!table || !cell) return '请先把光标放到要拆分的单元格里'
  const rs = cell.rowSpan || 1
  const cs = cell.colSpan || 1
  if (rs === 1 && cs === 1) return '该单元格没有被合并，无需拆分'
  const grid = gridOf(table)
  const p = grid.pos.get(cell)
  if (!p) return null
  const tr = cell.parentElement as HTMLTableRowElement

  // 补列
  for (let i = 1; i < cs; i++) {
    tr.insertBefore(newCell(cell.tagName.toLowerCase() as 'td', cell), cell.nextSibling)
  }
  // 补行（在下方各行对应列位置插入）
  for (let i = 1; i < rs; i++) {
    const rowIdx = p.r + i
    const tr2 = grid.rows[rowIdx]
    if (!tr2) continue
    const target = (Array.from(tr2.cells) as HTMLTableCellElement[]).find((c) => {
      const q = grid.pos.get(c)
      return q && q.r >= rowIdx && q.c > p.c
    })
    tr2.insertBefore(newCell(cell.tagName.toLowerCase() as 'td', cell), target ?? null)
  }
  cell.rowSpan = 1
  cell.colSpan = 1
  caretInto(cell)
  return null
}

export function setCellAlign(root: HTMLElement, h: 'left' | 'center' | 'right', v?: 'top' | 'middle' | 'bottom') {
  const cells = selectedCells(root)
  const one = currentCell(root)
  const list = cells.length ? cells : one ? [one] : []
  for (const c of list) {
    c.style.textAlign = h
    if (v) c.style.verticalAlign = v
  }
}

export type BorderMode = 'all' | 'outer' | 'none'

export function setTableBorder(root: HTMLElement, mode: BorderMode) {
  const table = currentTable(root)
  if (!table) return
  table.style.borderCollapse = 'collapse'
  const rows = Array.from(table.rows)
  const clear = (c: HTMLTableCellElement) => {
    c.style.border = 'none'
  }
  rows.forEach((tr) => Array.from(tr.cells).forEach((c) => clear(c as HTMLTableCellElement)))
  if (mode === 'none') {
    table.style.border = 'none'
    return
  }
  table.style.border = '1px solid #000'
  if (mode === 'all') {
    rows.forEach((tr) =>
      Array.from(tr.cells).forEach((c) => {
        ;(c as HTMLTableCellElement).style.border = '1px solid #000'
      }),
    )
    return
  }
  // 仅外框：首末行 + 首末格各补一条边
  const last = rows.length - 1
  rows.forEach((tr, ri) => {
    const cells = Array.from(tr.cells) as HTMLTableCellElement[]
    cells.forEach((c, ci) => {
      const parts: string[] = []
      if (ri === 0) parts.push('border-top:1px solid #000')
      if (ri === last) parts.push('border-bottom:1px solid #000')
      if (ci === 0) parts.push('border-left:1px solid #000')
      if (ci === cells.length - 1) parts.push('border-right:1px solid #000')
      c.style.cssText += `;${parts.join(';')}`
    })
  })
}

export function toggleHeaderRow(root: HTMLElement): string | null {
  const table = currentTable(root)
  if (!table) return '请先把光标放到表格里'
  const thead = table.querySelector('thead')
  if (thead) {
    // 取消表头：把 thead 的行移回 tbody 并换成 td
    const tbody = table.querySelector('tbody') ?? table.appendChild(document.createElement('tbody'))
    Array.from(thead.rows).forEach((tr, i) => {
      Array.from(tr.cells).forEach((c) => {
        const td = document.createElement('td')
        td.innerHTML = c.innerHTML
        td.setAttribute('style', c.getAttribute('style') ?? '')
        c.replaceWith(td)
      })
      tbody.insertBefore(tr, i === 0 ? tbody.firstChild : null)
    })
    thead.remove()
    return null
  }
  const firstRow = table.rows[0]
  if (!firstRow) return '表格还没有行'
  let t = table.querySelector('thead')
  if (!t) {
    t = document.createElement('thead')
    let tb = table.querySelector('tbody')
    if (!tb) {
      tb = document.createElement('tbody')
      while (table.rows.length) tb.appendChild(table.rows[0])
      table.appendChild(tb)
    }
    table.insertBefore(t, tb)
  }
  t.appendChild(firstRow)
  Array.from(firstRow.cells).forEach((c) => {
    const th = document.createElement('th')
    th.innerHTML = c.innerHTML
    th.setAttribute('style', c.getAttribute('style') ?? '')
    if (!th.style.background && !th.style.backgroundColor) th.style.background = '#f2f2f2'
    th.style.fontWeight = 'bold'
    th.style.textAlign = th.style.textAlign || 'center'
    c.replaceWith(th)
  })
  return null
}

/** 表格宽度 100% / 自适应 + 列宽平均分布 */
export function fitTable(root: HTMLElement, full = true) {
  const table = currentTable(root)
  if (!table) return
  table.style.width = full ? '100%' : 'auto'
  table.style.tableLayout = 'fixed'
  const cols = Array.from(table.rows).reduce((m, r) => Math.max(m, r.cells.length), 1)
  const w = `${(100 / cols).toFixed(2)}%`
  Array.from(table.rows).forEach((tr) =>
    Array.from(tr.cells).forEach((c) => {
      ;(c as HTMLTableCellElement).style.width = w
    }),
  )
}

/**
 * 把光标所在列的列宽设为指定百分比（1~100）。
 * 在 table-layout:fixed 下，给每行的「该列主单元格」写入 width: X%，
 * 其余列不显式设宽 → 自动均分剩余空间。可逐列分别设置不同宽度。
 */
export function setColWidth(root: HTMLElement, percent: number): string | null {
  const table = currentTable(root)
  const cell = currentCell(root)
  if (!table || !cell) return '请先把光标放进表格里'
  const grid = gridOf(table)
  const p = grid.pos.get(cell)
  if (!p) return null
  const col = p.c
  percent = Math.min(100, Math.max(1, Math.round(percent)))
  table.style.width = '100%'
  table.style.tableLayout = 'fixed'
  for (const tr of grid.rows) {
    const target = (Array.from(tr.cells) as HTMLTableCellElement[]).find((c) => {
      const q = grid.pos.get(c)
      return q && q.c === col
    })
    if (target) target.style.width = `${percent}%`
  }
  return null
}

/** 读取光标所在列已设的宽度（百分比），未设宽返回 null */
export function getColWidth(root: HTMLElement): number | null {
  const table = currentTable(root)
  const cell = currentCell(root)
  if (!table || !cell) return null
  const grid = gridOf(table)
  const p = grid.pos.get(cell)
  if (!p) return null
  const target = (Array.from(grid.rows[0]?.cells ?? []) as HTMLTableCellElement[]).find((c) => {
    const q = grid.pos.get(c)
    return q && q.c === p.c
  })
  if (!target) return null
  const w = target.style.width
  if (!w) return null
  const m = w.match(/([\d.]+)\s*%/)
  return m ? parseFloat(m[1]) : null
}

/**
 * 设置行高（最小值，内容变多时行仍会自动撑高）。px 单位。
 * allRows=true 时应用到整表所有行；false 只设光标所在行。
 * tr 的 height 在 HTML 表格语义里就是「最小行高」，与 Word 的 atLeast 规则一致。
 */
export function setRowHeight(root: HTMLElement, px: number, allRows = false): string | null {
  const table = currentTable(root)
  const cell = currentCell(root)
  if (!table || !cell) return '请先把光标放进表格里'
  const h = Math.min(400, Math.max(20, Math.round(px)))
  const targets = allRows
    ? Array.from(table.rows)
    : [cell.closest('tr')].filter((tr): tr is HTMLTableRowElement => tr instanceof HTMLTableRowElement)
  for (const tr of targets) tr.style.height = `${h}px`
  return null
}

/** 读取光标所在行已设的行高（px），未设返回 null */
export function getRowHeight(root: HTMLElement): number | null {
  const cell = currentCell(root)
  const tr = cell?.closest('tr') as HTMLTableRowElement | null
  if (!tr) return null
  const m = tr.style.height.match(/([\d.]+)\s*px/)
  return m ? parseFloat(m[1]) : null
}

/**
 * 清洗「从 Word / 网页粘贴」进来的 HTML：
 * 丢掉 mso-* 私有样式、class/id、脚本与图片，把 <font> 统一成 <span style>，
 * 保留段落、标题、表格、列表等结构，尽量接近 Word 的观感。
 */
export function cleanPastedHtml(raw: string): string {
  const doc = new DOMParser().parseFromString(raw, 'text/html')
  doc.querySelectorAll('script,style,link,meta,xml,o\\:p,iframe,object,embed,img,svg,v\\:shapetype,v\\:shape').forEach((n) => n.remove())

  doc.querySelectorAll('*').forEach((el) => {
    for (const a of Array.from(el.attributes)) {
      const n = a.name.toLowerCase()
      const isMso = n.startsWith('mso-') || a.value.includes('mso-')
      if (n === 'class' || n === 'id' || n === 'lang' || n.startsWith('on') || isMso) {
        el.removeAttribute(a.name)
        continue
      }
      if (n === 'style') {
        // 只保留排版相关声明
        const keep = a.value
          .split(';')
          .map((s) => s.trim())
          .filter((s) => s && !s.toLowerCase().includes('mso-'))
          .filter((s) => /^(color|background(-color)?|font-(family|size|weight|style)|text-(align|indent|decoration)|line-height|margin|padding|border|vertical-align|white-space)/i.test(s))
          .join(';')
        if (keep) el.setAttribute('style', keep)
        else el.removeAttribute('style')
      }
      if (n === 'align') {
        el.setAttribute('style', `${el.getAttribute('style') ?? ''};text-align:${a.value}`)
        el.removeAttribute('align')
      }
    }
    // <font> → span
    if (el.tagName.toLowerCase() === 'font') {
      const span = doc.createElement('span')
      const styles: string[] = []
      if (el.getAttribute('face')) styles.push(`font-family:${el.getAttribute('face')}`)
      if (el.getAttribute('color')) styles.push(`color:${el.getAttribute('color')}`)
      const size = el.getAttribute('size')
      const sizeMap: Record<string, string> = { '1': '8pt', '2': '10pt', '3': '12pt', '4': '14pt', '5': '18pt', '6': '24pt', '7': '36pt' }
      if (size && sizeMap[size]) styles.push(`font-size:${sizeMap[size]}`)
      if (styles.length) span.setAttribute('style', styles.join(';'))
      span.innerHTML = el.innerHTML
      el.replaceWith(span)
    }
  })

  // 空段落清理
  doc.querySelectorAll('p,div').forEach((el) => {
    if (!el.textContent?.trim() && !el.querySelector('br,table,img')) el.innerHTML = '&nbsp;'
  })

  return doc.body.innerHTML.trim()
}

function ctx(root: HTMLElement) {
  const table = currentTable(root)
  const cell = currentCell(root)
  const grid = table ? gridOf(table) : null
  return { table, cell, grid }
}

/** 插入一个带框线的空表格，并把光标放到第一个单元格 */
export function insertTable(rows: number, cols: number, withHeader = true) {
  const r = Math.min(Math.max(rows, 1), 30)
  const c = Math.min(Math.max(cols, 1), 15)
  const border = 'border:1px solid #000'
  let html = `<table style="border-collapse:collapse;width:100%;table-layout:fixed">`
  if (withHeader) {
    html += `<thead><tr style="height:32px">${'<th style="border:1px solid #000;background:#f2f2f2;text-align:center">&nbsp;</th>'.repeat(c)}</tr></thead>`
  }
  html += '<tbody>'
  for (let i = 0; i < (withHeader ? r - 1 : r); i++) {
    html += `<tr style="height:32px">${`<td style="${border}">&nbsp;</td>`.repeat(c)}</tr>`
  }
  html += '</tbody></table><p>&nbsp;</p>'
  insertHtml(html)
}
