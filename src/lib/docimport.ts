/**
 * 合同文件导入：把已有合同转成可编辑的模板正文（HTML）。
 *
 * 支持情况（零依赖，全部在浏览器内完成）：
 * - .docx  ✅ Word 2007+（本质是 ZIP+XML）—— 用 DecompressionStream 解包
 *           word/document.xml，再转成 HTML（段落/标题/加粗斜体下划线/对齐/表格/colspan）
 * - .html / .htm ✅ 直接取正文（会剔除 script/style/事件属性）
 * - .txt  ✅ 按段落转 HTML
 * - .doc  ❌ Word 97-2003 是 OLE 复合二进制格式，浏览器里无法可靠解析
 *            → 给出明确指引：用 Word/WPS「另存为 .docx」
 * - .rtf  ❌ 同上，建议另存为 .docx
 * - .pdf  ❌ 无法还原排版与结构；PDF 更适合作为「附件」而不是模板
 */
export type ImportResult = { html: string; warnings: string[] }

const OLE = [0xd0, 0xcf, 0x11, 0xe0]
const ZIP = [0x50, 0x4b, 0x03, 0x04]

function startsWithBytes(buf: Uint8Array, sig: number[]): boolean {
  if (buf.length < sig.length) return false
  return sig.every((b, i) => buf[i] === b)
}

/* ───────────────────────── ZIP 读取 ───────────────────────── */

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const DS = (globalThis as unknown as { DecompressionStream?: typeof DecompressionStream })
    .DecompressionStream
  if (!DS) {
    throw new Error('当前浏览器不支持解压 .docx，请升级浏览器（Chrome 80+ / Safari 16.4+）或改用 Chrome')
  }
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DS('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** 从 ZIP（docx）里取出指定条目；按中央目录读取，避免「大小写在数据描述符里」的坑 */
async function unzipEntry(
  buf: ArrayBuffer,
  wanted: (name: string) => boolean,
): Promise<{ name: string; data: Uint8Array } | null> {
  const dv = new DataView(buf)
  const u8 = new Uint8Array(buf)
  // 从尾部向前找 EOCD（0x06054b50），最大注释 65535 字节
  let eocd = -1
  const minPos = Math.max(0, buf.byteLength - 65557)
  for (let i = buf.byteLength - 22; i >= minPos; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('文件不是有效的 .docx（找不到 ZIP 结尾记录）')
  const total = dv.getUint16(eocd + 10, true)
  let p = dv.getUint32(eocd + 16, true)

  const decoder = new TextDecoder('utf-8')
  for (let n = 0; n < total; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break
    const method = dv.getUint16(p + 10, true)
    const compSize = dv.getUint32(p + 20, true)
    const nameLen = dv.getUint16(p + 28, true)
    const extraLen = dv.getUint16(p + 30, true)
    const commentLen = dv.getUint16(p + 32, true)
    const localOffset = dv.getUint32(p + 42, true)
    const name = decoder.decode(u8.subarray(p + 46, p + 46 + nameLen))
    // ZIP 规范用正斜杠，但 Windows 自带压缩工具会写成反斜杠，这里统一后再匹配
    const normName = name.replace(/\\/g, '/')

    if (wanted(normName)) {
      if (dv.getUint32(localOffset, true) !== 0x04034b50) throw new Error('docx 内部结构损坏')
      const lNameLen = dv.getUint16(localOffset + 26, true)
      const lExtraLen = dv.getUint16(localOffset + 28, true)
      const dataStart = localOffset + 30 + lNameLen + lExtraLen
      const raw = u8.subarray(dataStart, dataStart + compSize)
      const data = method === 8 ? await inflateRaw(raw) : new Uint8Array(raw)
      return { name, data }
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  return null
}

/* ───────────────────────── docx XML → HTML ───────────────────────── */

function isEl(n: Node | null | undefined): n is Element {
  return !!n && n.nodeType === 1
}

function kids(parent: Element | null, local: string): Element[] {
  if (!parent) return []
  const out: Element[] = []
  for (const c of Array.from(parent.childNodes)) {
    if (isEl(c) && c.localName === local) out.push(c)
  }
  return out
}

function child(parent: Element | null, local: string): Element | null {
  if (!parent) return null
  for (const c of Array.from(parent.childNodes)) {
    if (isEl(c) && c.localName === local) return c
  }
  return null
}

/** 读属性：兼容 w:val / val 两种写法 */
function attr(el: Element | null, local: string): string | null {
  if (!el) return null
  for (const a of Array.from(el.attributes)) {
    if (a.localName === local || a.name === local || a.name === `w:${local}`) return a.value
  }
  return null
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function runToHtml(r: Element): string {
  const rPr = child(r, 'rPr')
  const bold = !!child(rPr, 'b')
  const italic = !!child(rPr, 'i')
  const underline = !!child(rPr, 'u')

  let text = ''
  for (const c of Array.from(r.childNodes)) {
    if (!isEl(c)) continue
    if (c.localName === 't') text += c.textContent ?? ''
    else if (c.localName === 'br') text += '\n'
    else if (c.localName === 'tab') text += '\u3000'
    else if (c.localName === 'noBreakHyphen') text += '-'
  }
  if (!text) return ''
  let html = esc(text)
  if (underline) html = `<u>${html}</u>`
  if (italic) html = `<em>${html}</em>`
  if (bold) html = `<strong>${html}</strong>`
  return html
}

/** 段落内的行内内容：run / hyperlink 内的 run */
function inlineHtml(p: Element): string {
  let out = ''
  const walk = (node: Element) => {
    for (const c of Array.from(node.childNodes)) {
      if (!isEl(c)) continue
      if (c.localName === 'r') out += runToHtml(c)
      else if (c.localName === 'hyperlink' || c.localName === 'sdt' || c.localName === 'sdtContent' || c.localName === 'smartTag')
        walk(c)
      // 其它（proofErr / bookmark / commentRange 等）直接跳过
    }
  }
  walk(p)
  return out
}

const ALIGN: Record<string, string> = {
  center: 'center',
  right: 'right',
  left: 'left',
  both: 'justify',
  distribute: 'justify',
}

function paraToHtml(p: Element): string {
  const pPr = child(p, 'pPr')
  const pStyle = attr(child(pPr, 'pStyle'), 'val') ?? ''
  const outline = attr(child(pPr, 'outlineLvl'), 'val')
  const jc = attr(child(pPr, 'jc'), 'val')
  const style = jc && ALIGN[jc] ? ` style="text-align:${ALIGN[jc]}"` : ''

  // 标题判定：pStyle 含 Heading/标题/纯数字，或 outlineLvl 0/1/2
  let tag = 'p'
  const m = /heading\s*([1-3])/i.exec(pStyle)
  if (m) tag = `h${m[1]}`
  else if (/^[1-3]$/.test(pStyle.trim())) tag = `h${pStyle.trim()}`
  else if (outline != null && ['0', '1', '2'].includes(outline)) tag = `h${Number(outline) + 1}`

  const inner = inlineHtml(p)
  if (!inner.trim()) return `<${tag}${style}>&nbsp;</${tag}>`
  return `<${tag}${style}>${inner}</${tag}>`
}

function tableToHtml(tbl: Element): string {
  const rows = kids(tbl, 'tr')
  if (rows.length === 0) return ''
  const headerRow =
    rows.find((r) => !!child(child(r, 'trPr'), 'tblHeader')) ?? (rows.length > 1 ? rows[0] : null)

  // docx 的框线定义在 w:tblBorders 里，这里不解析，统一补一条 1px 实线，
  // 与 Word 默认网格观感一致；用户之后可用「无框线 / 仅外框」调整
  const cellStyle =
    ' style="border:1px solid #000;padding:2pt 4pt;vertical-align:middle"'
  const headStyle =
    ' style="border:1px solid #000;padding:2pt 4pt;background:#f2f2f2;text-align:center;font-weight:bold"'

  const renderRow = (tr: Element, cellTag: 'th' | 'td') => {
    let html = ''
    for (const tc of kids(tr, 'tc')) {
      const span = Number(attr(child(child(tc, 'tcPr'), 'gridSpan'), 'val') ?? '1')
      const spanAttr = span > 1 ? ` colspan="${span}"` : ''
      const ps = kids(tc, 'p')
      // 单元格只有一段且无对齐要求时直接输出行内内容，避免多余段距把表格撑高
      const plain = ps.length === 1 && !child(child(ps[0], 'pPr'), 'jc')
      const content = plain ? inlineHtml(ps[0]) : ps.map(paraToHtml).join('')
      html += `<${cellTag}${spanAttr}${cellTag === 'th' ? headStyle : cellStyle}>${content || '&nbsp;'}</${cellTag}>`
    }
    return `<tr>${html}</tr>`
  }

  let out = '<table style="border-collapse:collapse;width:100%">'
  let rest = rows
  if (headerRow) {
    out += `<thead>${renderRow(headerRow, 'th')}</thead>`
    rest = rows.filter((r) => r !== headerRow)
  }
  out += `<tbody>${rest.map((r) => renderRow(r, 'td')).join('')}</tbody></table>`
  return out
}

function docxXmlToHtml(xml: string): { html: string; imageCount: number } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('docx 内容解析失败（XML 结构异常）')

  const bodies = Array.from(doc.getElementsByTagName('*')).filter((e) => e.localName === 'body')
  const body = bodies.find((b) => b.namespaceURI?.includes('wordprocessingml')) ?? bodies[0]
  if (!body) throw new Error('docx 里没有找到正文')

  let html = ''
  for (const node of Array.from(body.childNodes)) {
    if (!isEl(node)) continue
    if (node.localName === 'p') html += paraToHtml(node)
    else if (node.localName === 'tbl') html += tableToHtml(node)
    // sectPr 等忽略
  }
  const imageCount = Array.from(doc.getElementsByTagName('*')).filter(
    (e) => e.localName === 'drawing' || e.localName === 'pict',
  ).length
  return { html, imageCount }
}

/* ───────────────────────── 辅助格式 ───────────────────────── */

/** 清洗 HTML 正文：去脚本/样式/事件属性，只保留排版相关标签 */
export function sanitizeHtml(raw: string): string {
  const doc = new DOMParser().parseFromString(raw, 'text/html')
  doc.querySelectorAll('script,style,link,meta,iframe,object,embed,noscript').forEach((n) => n.remove())
  doc.querySelectorAll('*').forEach((el) => {
    for (const a of Array.from(el.attributes)) {
      const n = a.name.toLowerCase()
      const drop =
        n.startsWith('on') ||
        n === 'class' ||
        n === 'id' ||
        (n === 'style' && /position|display\s*:\s*none/i.test(a.value))
      if (drop) el.removeAttribute(a.name)
    }
  })
  const b = doc.body
  return b ? b.innerHTML.trim() : ''
}

function textToHtml(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split('\n').map((l) => esc(l.trim())).filter(Boolean)
      if (lines.length === 0) return ''
      return `<p>${lines.join('<br>')}</p>`
    })
    .filter(Boolean)
    .join('')
}

/* ───────────────────────── 对外接口 ───────────────────────── */

export const IMPORT_ACCEPT = '.docx,.doc,.html,.htm,.txt'

/**
 * 导入合同文件 → 模板正文 HTML。
 * @param ourEntities 已知的我方主体全称，命中时会替换成 {{我方主体}}（方便复用为模板）
 */
export async function importDocFile(
  file: File,
  opts?: { ourEntities?: string[]; toPlaceholder?: boolean },
): Promise<ImportResult> {
  const warnings: string[] = []
  const buf = await file.arrayBuffer()
  const u8 = new Uint8Array(buf)
  const nameLower = file.name.toLowerCase()

  let html = ''

  if (startsWithBytes(u8, OLE)) {
    throw new Error(
      '这是旧版 Word（.doc，97-2003 二进制格式），浏览器无法解析。请用 Word / WPS 打开后「另存为 → .docx」再导入。',
    )
  }

  if (startsWithBytes(u8, ZIP)) {
    const entry = await unzipEntry(buf, (n) => n.toLowerCase() === 'word/document.xml')
    if (!entry) throw new Error('这个 .docx 里没有正文（word/document.xml），可能文件损坏')
    const xml = new TextDecoder('utf-8').decode(entry.data)
    const r = docxXmlToHtml(xml)
    html = r.html
    if (r.imageCount > 0) warnings.push(`文档里有 ${r.imageCount} 处图片/图形未导入，请在编辑器里手动补充`)
  } else {
    // 非 docx：尝试按文本读，判断是 HTML 还是纯文本，或 RTF / 旧 doc
    const text = new TextDecoder('utf-8').decode(u8)
    if (/^\s*\{\\rtf/i.test(text)) {
      throw new Error('这是 RTF 格式，无法直接解析。请用 Word / WPS 打开后「另存为 → .docx」再导入。')
    }
    if (/<html|<body|<p[ >]|<div|<table/i.test(text)) {
      html = sanitizeHtml(text)
      warnings.push('已按 HTML 解析，样式已清理，请检查排版')
    } else if (nameLower.endsWith('.doc')) {
      throw new Error(
        '这个 .doc 不是可解析的格式。请用 Word / WPS 打开后「另存为 → .docx」（或另存为网页 .html）再导入。',
      )
    } else if (text.trim()) {
      html = textToHtml(text)
    } else {
      throw new Error('文件内容为空或不是文本格式，无法导入')
    }
  }

  if (!html.trim()) throw new Error('解析后没有正文内容，请检查文件')

  // 把已知的我方主体全称换成占位符，便于复用为模板
  if (opts?.toPlaceholder !== false && opts?.ourEntities?.length) {
    for (const name of opts.ourEntities) {
      if (!name) continue
      // 正文是 HTML，直接做全量字符串替换即可（公司名不含标签字符）
      const before = html
      html = html.split(esc(name)).join('{{我方主体}}').split(name).join('{{我方主体}}')
      if (before !== html) warnings.push(`已把「${name}」替换为 {{我方主体}} 占位符`)
    }
  }

  return { html, warnings }
}
