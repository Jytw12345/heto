/**
 * 真· .docx 导出（OOXML），零依赖：
 * 1) 把编辑器里的 HTML 映射成 WordprocessingML（段落/标题/行内格式/对齐/行距/缩进/表格/合并列）
 * 2) 用 CompressionStream('deflate-raw') 压缩，手写 ZIP 容器（含 CRC32），产出标准 .docx
 *
 * 与旧方案的差别：旧的是「HTML 伪装成 .doc」（Word 可能提示格式不符）；
 * 这里产出的是标准 OOXML 包（[Content_Types].xml + _rels/.rels + word/document.xml），
 * Word / WPS 打开无提示，可正常继续编辑。
 *
 * 说明：段落格式使用行内属性（w:rPr / w:pPr），不依赖 styles.xml —— 自建样式表反而更容易出错。
 */
import { formatDate } from './format'

/* ───────────────── ZIP 写入 ───────────────── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** deflate-raw 压缩；不支持或压不小就原样返回（ZIP 允许 store） */
async function deflateIfSmaller(data: Uint8Array): Promise<{ bytes: Uint8Array; method: number }> {
  const CS = (globalThis as unknown as { CompressionStream?: typeof CompressionStream }).CompressionStream
  if (!CS || data.length < 256) return { bytes: data, method: 0 }
  try {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CS('deflate-raw'))
    const packed = new Uint8Array(await new Response(stream).arrayBuffer())
    return packed.length < data.length ? { bytes: packed, method: 8 } : { bytes: data, method: 0 }
  } catch {
    return { bytes: data, method: 0 }
  }
}

async function zipFiles(entries: { name: string; data: Uint8Array }[]): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  const now = new Date()
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff

  for (const e of entries) {
    const nameBytes = enc.encode(e.name)
    const raw = e.data
    const { bytes: comp, method } = await deflateIfSmaller(raw)
    const crc = crc32(raw)

    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0x0800, true) // 文件名 UTF-8
    lv.setUint16(8, method, true)
    lv.setUint16(10, dosTime, true)
    lv.setUint16(12, dosDate, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, comp.length, true)
    lv.setUint32(22, raw.length, true)
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true)
    local.set(nameBytes, 30)
    locals.push(local, comp)

    const cd = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(cd.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, method, true)
    cv.setUint16(12, dosTime, true)
    cv.setUint16(14, dosDate, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, comp.length, true)
    cv.setUint32(24, raw.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint32(42, offset, true)
    cd.set(nameBytes, 46)
    centrals.push(cd)

    offset += local.length + comp.length
  }

  const cdSize = centrals.reduce((s, c) => s + c.length, 0)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, offset, true)

  const total = offset + cdSize + 22
  const out = new Uint8Array(total)
  let p = 0
  for (const part of [...locals, ...centrals, eocd]) {
    out.set(part, p)
    p += part.length
  }
  return out
}

/* ───────────────── HTML → WordprocessingML ───────────────── */

const PAGE_W = 11906 // A4 宽（twips）
const PAGE_H = 16838
const MARGIN = { top: 1440, right: 1797, bottom: 1440, left: 1797 }
const CONTENT_W = PAGE_W - MARGIN.left - MARGIN.right

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 取子元素（不用 .children / querySelector，保证纯 DOM 遍历，任何 DOM 实现都可用） */
function kids(el: Element): Element[] {
  const list: Element[] = []
  for (const n of Array.from(el.childNodes)) if (n.nodeType === 1) list.push(n as Element)
  return list
}

function tagOf(el: Element): string {
  return (el.tagName || el.nodeName || '').toUpperCase()
}

function styleOf(el: Element): Record<string, string> {
  const out: Record<string, string> = {}
  const s = el.getAttribute('style') ?? ''
  for (const decl of s.split(';')) {
    const idx = decl.indexOf(':')
    if (idx < 0) continue
    const k = decl.slice(0, idx).trim().toLowerCase()
    const v = decl.slice(idx + 1).trim()
    if (k && v) out[k] = v
  }
  // 兼容旧式属性
  const align = el.getAttribute('align')
  if (align) out['text-align'] = align
  const bg = el.getAttribute('bgcolor')
  if (bg) out['background-color'] = bg
  const color = el.getAttribute('color')
  if (color) out.color = color
  const face = el.getAttribute('face')
  if (face) out['font-family'] = face
  return out
}

function ptOf(v: string | undefined, fallback: number): number {
  if (!v) return fallback
  const m = /([\d.]+)\s*(pt|px)?/.exec(v)
  if (!m) return fallback
  const n = Number(m[1])
  if (!Number.isFinite(n)) return fallback
  return m[2] === 'px' ? (n * 72) / 96 : n
}

function hexOf(v: string | undefined): string | null {
  if (!v) return null
  const m = /#([0-9a-f]{6}|[0-9a-f]{3})\b/i.exec(v)
  if (m) {
    const h = m[1]
    return (h.length === 3 ? h.split('').map((c) => c + c).join('') : h).toUpperCase()
  }
  const rgb = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(v)
  if (rgb) {
    return [rgb[1], rgb[2], rgb[3]]
      .map((n) => Number(n).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  }
  return null
}

type Inline = {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  color?: string | null
  size?: number // pt
  font?: string
  highlight?: string | null
}

const TAG_INLINE: Record<string, (i: Inline) => Inline> = {
  B: (i) => ({ ...i, bold: true }),
  STRONG: (i) => ({ ...i, bold: true }),
  I: (i) => ({ ...i, italic: true }),
  EM: (i) => ({ ...i, italic: true }),
  U: (i) => ({ ...i, underline: true }),
  S: (i) => ({ ...i, strike: true }),
  STRIKE: (i) => ({ ...i, strike: true }),
  DEL: (i) => ({ ...i, strike: true }),
  SUP: (i) => i,
  SUB: (i) => i,
  SPAN: (i) => i,
  A: (i) => i,
  FONT: (i) => i,
}

/** 收集段落内的行内文本（按格式切成多个 run） */
function collectRuns(node: Node, inherited: Inline, out: Inline[]) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      const text = (child.textContent ?? '').replace(/\s+/g, ' ')
      if (text) out.push({ ...inherited, text })
      continue
    }
    if (child.nodeType !== 1) continue
    const el = child as Element
    const tag = tagOf(el)
    if (tag === 'BR') {
      out.push({ ...inherited, text: '\n' })
      continue
    }
    const st = styleOf(el)
    let next: Inline = { ...inherited }
    const wrap = TAG_INLINE[tag]
    if (wrap) next = wrap(next)
    if (st['font-weight'] && /^(bold|[6-9]00)$/.test(st['font-weight'])) next.bold = true
    if (st['font-style'] === 'italic') next.italic = true
    if (st['text-decoration']?.includes('underline')) next.underline = true
    if (st['text-decoration']?.includes('line-through')) next.strike = true
    if (st.color) next.color = hexOf(st.color)
    if (st['background-color']) next.highlight = hexOf(st['background-color'])
    if (st['font-size']) next.size = ptOf(st['font-size'], next.size ?? 12)
    if (st['font-family']) next.font = st['font-family'].split(',')[0].replace(/["']/g, '').trim()

    if (tag === 'IMG') {
      out.push({ ...next, text: '［图片］' })
      continue
    }
    collectRuns(el, next, out)
  }
}

function runsToXml(runs: Inline[]): string {
  return runs
    .map((r) => {
      const parts = String(r.text).split('\n')
      const body = parts.map((seg, i) => `${i > 0 ? '<w:br/>' : ''}<w:t xml:space="preserve">${esc(seg)}</w:t>`).join('')
      // w:rPr 内的元素顺序在 OOXML 里有严格规定：rFonts → b → i → strike → color → sz → highlight → u
      const rPr = [
        `<w:rFonts w:ascii="宋体" w:eastAsia="宋体" w:hAnsi="宋体"${r.font ? ` w:cs="${esc(r.font)}"` : ''}/>`,
        r.bold ? '<w:b/>' : '',
        r.italic ? '<w:i/>' : '',
        r.strike ? '<w:strike/>' : '',
        r.color ? `<w:color w:val="${r.color}"/>` : '',
        r.size ? `<w:sz w:val="${Math.round(r.size * 2)}"/><w:szCs w:val="${Math.round(r.size * 2)}"/>` : '',
        r.highlight ? `<w:highlight w:val="yellow"/>` : '',
        r.underline ? '<w:u w:val="single"/>' : '',
      ].join('')
      return `<w:r><w:rPr>${rPr}</w:rPr>${body}</w:r>`
    })
    .join('')
}

/** 段落属性：spacing → ind → jc（顺序固定） */
function paraPropsXml(st: Record<string, string>, isHeading: number): string {
  const spacing: string[] = []
  const lh = st['line-height']
  if (lh) {
    const n = Number(/([\d.]+)/.exec(lh)?.[1] ?? '')
    if (Number.isFinite(n) && n > 0) spacing.push(`w:line="${Math.round(n * 240)}" w:lineRule="auto"`)
  }
  if (st['margin-top']) spacing.push(`w:before="${Math.round(ptOf(st['margin-top'], 0) * 20)}"`)
  if (st['margin-bottom']) spacing.push(`w:after="${Math.round(ptOf(st['margin-bottom'], 0) * 20)}"`)
  const spacingXml = spacing.length ? `<w:spacing ${spacing.join(' ')}/>` : ''

  let indXml = ''
  const ti = st['text-indent']
  if (ti && /em/.test(ti)) {
    const em = Number(/([\d.]+)/.exec(ti)?.[1] ?? '0')
    const basePt = ptOf(st['font-size'], isHeading ? 18 : 12)
    if (em > 0) indXml = `<w:ind w:firstLine="${Math.round(em * basePt * 20)}"/>`
  }

  const jcMap: Record<string, string> = {
    center: 'center',
    right: 'right',
    left: 'left',
    justify: 'both',
    start: 'left',
    end: 'right',
  }
  const jc = st['text-align'] ? jcMap[st['text-align']] : undefined
  const jcXml = jc ? `<w:jc w:val="${jc}"/>` : ''

  return spacingXml + indXml + jcXml ? `<w:pPr>${spacingXml}${indXml}${jcXml}</w:pPr>` : ''
}

/**
 * 基础行内格式（标题用「加粗 + 字号 + 居中」内联表达，避开 styles.xml 依赖）。
 * 注意 level=0 是普通段落：绝不能加粗，字号固定 12pt 保证各端一致。
 */
function baseInline(level: number): Inline {
  if (level === 1) return { text: '', bold: true, size: 18 }
  if (level === 2) return { text: '', bold: true, size: 15 }
  if (level >= 3) return { text: '', bold: true, size: 13 }
  return { text: '', size: 12 }
}

function paragraphXml(el: Element, tag: string): string {
  const st = styleOf(el)
  const isHeading = /^H[1-6]$/.test(tag)
  const level = isHeading ? Number(tag[1]) : 0
  const runs: Inline[] = []
  collectRuns(el, baseInline(level), runs)
  const props = paraPropsXml(st, level)
  if (runs.length === 0) return `<w:p>${props}</w:p>`

  // 标题/居中段落补默认对齐
  let extra = ''
  if (isHeading && !st['text-align']) extra = '<w:jc w:val="center"/>'
  const pPr = extra ? (props ? props.replace('</w:pPr>', `${extra}</w:pPr>`) : `<w:pPr>${extra}</w:pPr>`) : props
  return `<w:p>${pPr}${runsToXml(runs)}</w:p>`
}

function cellHasBorder(el: Element): boolean {
  const st = styleOf(el)
  const b = st.border ?? ''
  if (/none|0px/.test(b)) return false
  return !!b || !!st['border-top'] || !!st['border-left'] || !!st['border-bottom'] || !!st['border-right']
}

function tableRows(tbl: Element): Element[] {
  const rows: Element[] = []
  for (const child of kids(tbl)) {
    const t = tagOf(child)
    if (t === 'TR') rows.push(child)
    else if (t === 'THEAD' || t === 'TBODY' || t === 'TFOOT') {
      for (const r of kids(child)) if (tagOf(r) === 'TR') rows.push(r)
    }
  }
  return rows
}

/** 把单元格 width 样式（如 "50%" / "300px"）换算成「占整页内容宽度」的比例（0~1），无则返回 null */
function parseWidthFrac(v: string | undefined): number | null {
  if (!v) return null
  const m = v.trim().match(/([\d.]+)\s*(%|px)?\s*$/)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  if (m[2] === '%') return n / 100
  if (m[2] === 'px') return (n * (1440 / 96)) / CONTENT_W // 1px = 1440/96 twips
  return null
}

function tableXml(tbl: Element): string {
  const rows = tableRows(tbl)
  if (rows.length === 0) return ''
  const colCount = rows.reduce((m, r) => {
    const n = kids(r).reduce((s, c) => s + (Number(c.getAttribute('colspan') ?? '1') || 1), 0)
    return Math.max(m, n)
  }, 1)

  // 1) 跨所有行按网格读取每列的目标宽度比例（% / px → 0~1）
  const colFrac: (number | null)[] = new Array(colCount).fill(null)
  for (const tr of rows) {
    let c = 0
    for (const tc of kids(tr)) {
      const span = Number(tc.getAttribute('colspan') ?? '1') || 1
      const f = parseWidthFrac(styleOf(tc)['width'])
      if (f != null) {
        const each = f / span
        for (let i = 0; i < span; i++) if (colFrac[c + i] == null) colFrac[c + i] = each
      }
      c += span
    }
  }
  // 2) 未显式设定的列均分剩余宽度
  const setSum = colFrac.reduce<number>((s, x) => s + (x ?? 0), 0)
  const unset = colFrac.filter((x) => x == null).length
  const rest = Math.max(0, 1 - setSum)
  for (let i = 0; i < colCount; i++) if (colFrac[i] == null) colFrac[i] = unset > 0 ? rest / unset : 1 / colCount
  // 3) 归一化到整页内容宽度（twips）
  const sum = colFrac.reduce<number>((s, x) => s + (x ?? 0), 0) || 1
  const colDxa = colFrac.map((f) => Math.round(((f ?? 0) / sum) * CONTENT_W))

  const anyBorder = rows.some((r) => kids(r).some((c) => cellHasBorder(c)))

  const borders = anyBorder
    ? `<w:tblBorders>
        <w:top w:val="single" w:sz="4" w:color="000000"/>
        <w:left w:val="single" w:sz="4" w:color="000000"/>
        <w:bottom w:val="single" w:sz="4" w:color="000000"/>
        <w:right w:val="single" w:sz="4" w:color="000000"/>
        <w:insideH w:val="single" w:sz="4" w:color="000000"/>
        <w:insideV w:val="single" w:sz="4" w:color="000000"/>
      </w:tblBorders>`
    : `<w:tblBorders>
        <w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/>
        <w:right w:val="none"/><w:insideH w:val="none"/><w:insideV w:val="none"/>
      </w:tblBorders>`

  const grid = `<w:tblGrid>${colDxa.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`

  const trs = rows
    .map((tr) => {
      // 行高：tr 的 height（内联样式或 height 属性，px）→ w:trHeight（px→twips ×15），atLeast 规则
      const hpx = parseFloat(styleOf(tr).height ?? tr.getAttribute('height') ?? '')
      const trPr =
        Number.isFinite(hpx) && hpx > 0
          ? `<w:trPr><w:trHeight w:val="${Math.round(hpx * 15)}" w:hRule="atLeast"/></w:trPr>`
          : ''
      const tcs: string[] = []
      let c = 0
      for (const tc of kids(tr)) {
        const tag = tagOf(tc)
        const st = styleOf(tc)
        const span = Number(tc.getAttribute('colspan') ?? '1') || 1
        const tcDxa = colDxa.slice(c, c + span).reduce((s, x) => s + x, 0)
        c += span
        const vAlignMap: Record<string, string> = { middle: 'center', top: 'top', bottom: 'bottom' }
        const vAlign = st['vertical-align'] ? vAlignMap[st['vertical-align']] : undefined
        const fill = hexOf(st['background-color']) ?? (tag === 'TH' ? 'F2F2F2' : null)
        const tcPr = [
          `<w:tcW w:w="${tcDxa}" w:type="dxa"/>`,
          span > 1 ? `<w:gridSpan w:val="${span}"/>` : '',
          fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : '',
          vAlign ? `<w:vAlign w:val="${vAlign}"/>` : '',
        ].join('')

        const inner = kids(tc).filter((c) => /^(P|DIV|H[1-6]|UL|OL|TABLE)$/.test(tagOf(c)))
        let content = inner
          .map((child) => {
            const t = tagOf(child)
            if (t === 'TABLE') return tableXml(child)
            return paragraphXml(child, t)
          })
          .join('')
        if (!content) {
          const text = (tc.textContent ?? '').trim()
          const runs: Inline[] = []
          if (tag === 'TH') runs.push({ text: text || '', bold: true })
          else if (text) runs.push({ text })
          if (text && st['text-align']) {
            const jc = { center: 'center', right: 'right', left: 'left' }[st['text-align']]
            content = `<w:p><w:pPr>${jc ? `<w:jc w:val="${jc}"/>` : ''}</w:pPr>${runsToXml(runs)}</w:p>`
          } else if (text) {
            content = `<w:p>${runsToXml(runs)}</w:p>`
          } else {
            content = '<w:p/>'
          }
        }
        tcs.push(`<w:tc><w:tcPr>${tcPr}</w:tcPr>${content}</w:tc>`)
      }
      return `<w:tr>${trPr}${tcs.join('')}</w:tr>`
    })
    .join('')

  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>${borders}<w:tblLayout w:type="fixed"/></w:tblPr>${grid}${trs}</w:tbl>`
}

/** 有序/无序列表：OOXML 列表要 numbering.xml，这里用文本前缀模拟，避免另一份定义文件 */
function listXml(list: Element, ordered: boolean): string {
  return kids(list)
    .filter((li) => tagOf(li) === 'LI')
    .map((li, i) => {
      const runs: Inline[] = []
      collectRuns(li, { text: '' }, runs)
      const prefix: Inline = { text: `${ordered ? `${i + 1}. ` : '· '}` }
      const st = styleOf(li)
      const props = paraPropsXml({ ...st, 'text-indent': '' }, 0)
      return `<w:p>${props}${runsToXml([prefix, ...runs])}</w:p>`
    })
    .join('')
}

/** 把编辑器 HTML 转成 w:body 内容 */
export function htmlToWordBody(html: string): string {
  const doc = new DOMParser().parseFromString(`<div id="__root">${html}</div>`, 'text/html')
  // 两种 DOM 实现：
  // 浏览器 —— documentElement 是 <html>，包内容的 div 挂在 body 下；
  // 其它实现 —— documentElement 本身就是那个 div。
  const docEl = doc.documentElement
  const root =
    tagOf(docEl) === 'HTML' ? (kids(doc.body as Element)[0] ?? (doc.body as Element)) : docEl
  const out: string[] = []
  for (const child of kids(root)) {
    const tag = tagOf(child)
    if (tag === 'TABLE') out.push(tableXml(child))
    else if (tag === 'UL') out.push(listXml(child, false))
    else if (tag === 'OL') out.push(listXml(child, true))
    else if (/^(P|DIV|H[1-6]|BLOCKQUOTE|PRE|SECTION|ARTICLE)$/.test(tag)) out.push(paragraphXml(child, tag))
    else {
      const runs: Inline[] = []
      collectRuns(child, { text: '' }, runs)
      out.push(runs.length ? `<w:p>${runsToXml(runs)}</w:p>` : '<w:p/>')
    }
  }
  if (out.length === 0) out.push('<w:p/>')
  return out.join('')
}

/* ───────────────── 打包 & 下载 ───────────────── */

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`

const APP_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
<Application>合同云</Application>
</Properties>`

function coreXml(title: string): string {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${esc(title)}</dc:title>
<dc:creator>合同云</dc:creator>
<cp:lastModifiedBy>合同云</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`
}

function documentXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>${body}<w:sectPr><w:pgSz w:w="${PAGE_W}" w:h="${PAGE_H}"/><w:pgMar w:top="${MARGIN.top}" w:right="${MARGIN.right}" w:bottom="${MARGIN.bottom}" w:left="${MARGIN.left}" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr></w:body>
</w:document>`
}

/** 生成 .docx 二进制 */
export async function buildDocx(html: string, title: string): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const body = htmlToWordBody(html)
  return zipFiles([
    { name: '[Content_Types].xml', data: enc.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', data: enc.encode(ROOT_RELS) },
    { name: 'docProps/app.xml', data: enc.encode(APP_XML) },
    { name: 'docProps/core.xml', data: enc.encode(coreXml(title)) },
    { name: 'word/document.xml', data: enc.encode(documentXml(body)) },
  ])
}

/** 下载为 .docx（标准 OOXML，Word / WPS 打开无提示） */
export async function downloadDocx(html: string, filename: string, title: string): Promise<void> {
  const bytes = await buildDocx(html, title)
  const name = /\.docx$/i.test(filename) ? filename : `${filename}.docx`
  const blob = new Blob([bytes as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

/** 文件名：合同名称-模板名（与 docgen 保持一致） */
export function docxFilename(contractTitle: string, templateName: string): string {
  const safe = (s: string) =>
    (s || '合同').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
  return `${safe(contractTitle)}-${safe(templateName)}`
}

/** 今日日期字符串（模板里 {{今日日期}} 用） */
export function todayStr(): string {
  return formatDate(new Date().toISOString())
}
