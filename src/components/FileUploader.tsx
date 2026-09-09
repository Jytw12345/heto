import { useEffect, useRef, useState } from 'react'
import {
  MAX_FILE_SIZE,
  StorageError,
  uploadFile,
  validateFile,
  extOf,
  type UploadResult,
} from '../lib/storage'
import { supabase } from '../lib/supabase'
import { useToast } from './Toast'
import { FileGlyph } from './ui'
import { formatBytes } from '../lib/format'
import { FILE_KIND_LABEL, FILE_KIND_ORDER, type FileKind } from '../types'

interface Task {
  id: number
  file: File
  name: string
  size: number
  kind: FileKind
  thumb?: string
  pct: number
  status: 'uploading' | 'saving' | 'done' | 'error'
  /** 失败发生在哪个阶段：upload=上传 COS 失败，save=写库失败（COS 已成功） */
  phase?: 'upload' | 'save'
  /** COS 上传成功后的结果，save 阶段失败重试时复用，避免重复传 COS 产生孤儿文件 */
  result?: UploadResult
  error?: string
}

// 同时上传的最大并发数：避免一次选多个大文件时打爆网络 / 触发 STS 限流
const MAX_CONCURRENT = 3

/**
 * 读取 JPEG 的 EXIF Orientation 标签（仅取 0x0112 方向值）。
 * 只解析前 256KB 足够找到 APP1/EXIF；非 JPEG 或解析失败一律返回 1（正常方向）。
 */
async function getJpegOrientation(file: File): Promise<number> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const view = new DataView(reader.result as ArrayBuffer)
        if (view.getUint16(0) !== 0xffd8) return resolve(1) // 非 JPEG
        const len = view.byteLength
        let offset = 2
        while (offset < len) {
          const marker = view.getUint16(offset)
          offset += 2
          if (marker === 0xffe1) {
            // APP1 / EXIF
            const exifStart = offset + 2
            if (view.getUint32(exifStart) === 0x45786966) {
              // "Exif"
              const tiff = exifStart + 6
              const little = view.getUint16(tiff) === 0x4949
              const ifd0 = tiff + view.getUint32(tiff + 4, little)
              const entries = view.getUint16(ifd0, little)
              for (let i = 0; i < entries; i++) {
                const eo = ifd0 + 2 + i * 12
                if (view.getUint16(eo, little) === 0x0112) {
                  const val = view.getUint16(eo + 8, little)
                  return resolve(val || 1)
                }
              }
            }
            return resolve(1)
          } else if ((marker & 0xff00) !== 0xff00) {
            break
          } else if (marker === 0xffda) {
            break // 图像数据开始
          } else {
            offset += view.getUint16(offset)
          }
        }
        resolve(1)
      } catch {
        resolve(1)
      }
    }
    reader.onerror = () => resolve(1)
    reader.readAsArrayBuffer(file.slice(0, 256 * 1024))
  })
}

/**
 * 生成缩略图：图片类优先用 canvas 按 EXIF 方向旋转（解决手机拍合同方向错乱）；
 * HEIC 等浏览器无法解码时降级为原始 object URL；非图片返回 undefined。
 */
async function makeThumb(file: File): Promise<string | undefined> {
  if (!file.type.startsWith('image/')) return undefined
  try {
    const isJpeg = /jpe?g$/i.test(extOf(file.name)) || file.type.includes('jpeg')
    let bitmap: ImageBitmap
    try {
      bitmap = await createImageBitmap(file)
    } catch {
      return URL.createObjectURL(file) // 浏览器无法解码（如 HEIC）→ 降级
    }
    const { width, height } = bitmap
    const orient = isJpeg ? await getJpegOrientation(file) : 1
    const swap = orient === 6 || orient === 8
    const cw = swap ? height : width
    const ch = swap ? width : height
    const max = 320
    const scale = Math.min(1, max / Math.max(cw, ch))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(cw * scale))
    canvas.height = Math.max(1, Math.round(ch * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return URL.createObjectURL(file)
    ctx.translate(canvas.width / 2, canvas.height / 2)
    switch (orient) {
      case 2: ctx.scale(-1, 1); break
      case 3: ctx.rotate(Math.PI); break
      case 4: ctx.scale(1, -1); break
      case 5: ctx.rotate(Math.PI / 2); ctx.scale(-1, 1); break
      case 6: ctx.rotate(Math.PI / 2); break
      case 7: ctx.rotate(Math.PI / 2); ctx.scale(1, -1); break
      case 8: ctx.rotate(-Math.PI / 2); break
    }
    ctx.drawImage(bitmap, -width / 2, -height / 2, width, height)
    return canvas.toDataURL('image/jpeg', 0.8)
  } catch {
    return undefined
  }
}

export default function FileUploader({
  storeId,
  contractId,
  onUploaded,
}: {
  storeId: string
  contractId: string
  onUploaded: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [dragging, setDragging] = useState(false)
  const [kind, setKind] = useState<FileKind>('scan')
  const { push } = useToast()
  const seq = useRef(0)
  const tasksRef = useRef<Task[]>([])
  // 并发信号量：running=正在上传数，queue=等待队列
  const sem = useRef({ running: 0, queue: [] as Task[] })

  useEffect(() => {
    tasksRef.current = tasks
  }, [tasks])

  // 卸载时释放所有缩略图 object URL，避免内存泄漏
  useEffect(() => {
    return () => tasksRef.current.forEach((t) => t.thumb && URL.revokeObjectURL(t.thumb))
  }, [])

  const patch = (id: number, t: Partial<Task>) =>
    setTasks((p) => p.map((x) => (x.id === id ? { ...x, ...t } : x)))

  const remove = (id: number) => {
    setTasks((p) => {
      const t = p.find((x) => x.id === id)
      if (t?.thumb) URL.revokeObjectURL(t.thumb)
      return p.filter((x) => x.id !== id)
    })
  }

  async function run(task: Task) {
    const id = task.id
    try {
      let res = task.result
      if (!res) {
        // 阶段一：上传到 COS
        res = await uploadFile(task.file, {
          storeId,
          contractId,
          onProgress: (pct) => patch(id, { pct }),
        })
        // 上传成功，进入写库阶段；记录 result 供 save 失败重试时复用
        patch(id, { status: 'saving', pct: 1, result: res, phase: 'save' })
      } else {
        // 重试且 COS 已成功：仅重跑 DB 写入，不再传 COS（防孤儿文件）
        patch(id, { status: 'saving', phase: 'save' })
      }

      const { error } = await supabase.from('contract_files').insert({
        contract_id: contractId,
        store_id: storeId,
        file_path: res.path,
        file_name: res.name,
        mime_type: res.mime,
        size_bytes: res.size,
        sha256: res.sha256,
        kind: task.kind,
      })
      if (error) throw new StorageError(error.message)

      patch(id, { status: 'done' })
      push(`${task.name} 上传完成`, 'ok')
      onUploaded()
      setTimeout(() => remove(id), 1500)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '上传失败'
      // 标记失败阶段：若 res 已有值说明上传成功、失败在写库
      const phase = task.result ? 'save' : task.phase ?? 'upload'
      patch(id, { status: 'error', error: msg, phase })
      push(msg, 'err')
    }
  }

  // 并发调度：最多 MAX_CONCURRENT 个同时上传，其余排队
  function pump() {
    while (sem.current.running < MAX_CONCURRENT && sem.current.queue.length) {
      const t = sem.current.queue.shift()!
      sem.current.running++
      run(t).finally(() => {
        sem.current.running--
        pump()
      })
    }
  }

  async function enqueue(file: File, k: FileKind) {
    const id = ++seq.current
    const thumb = await makeThumb(file)
    const task: Task = { id, file, name: file.name, size: file.size, kind: k, thumb, pct: 0, status: 'uploading' }
    setTasks((p) => [...p, task])
    sem.current.queue.push(task)
    pump()
  }

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files)
    if (!list.length) return

    const rejected = list.map((f) => validateFile(f)).filter(Boolean) as string[]
    if (rejected.length) {
      push(rejected[0], 'err')
      return
    }

    for (const file of list) {
      void enqueue(file, kind)
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-xs text-slate-500">
        <span>文件类型</span>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as FileKind)}
          className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 outline-none focus:border-indigo-400"
        >
          {FILE_KIND_ORDER.map((k) => (
            <option key={k} value={k}>
              {FILE_KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <span className="text-slate-400">（本次上传的文件都归为此类）</span>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          handleFiles(e.dataTransfer.files)
        }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-8 text-center transition ${
          dragging ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300'
        }`}
      >
        <p className="text-sm text-slate-700">点击选择，或把扫描件拖进来</p>
        <p className="mt-1 text-xs text-slate-400">
          PDF / JPG / PNG / Word，单个最大 {MAX_FILE_SIZE / 1024 / 1024}MB，支持多选
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.doc,.docx,.zip,.rar"
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {tasks.length > 0 && (
        <ul className="mt-3 space-y-2">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2">
              <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md bg-slate-100">
                {t.thumb ? (
                  <img src={t.thumb} alt="" className="h-full w-full object-cover" />
                ) : (
                  <FileGlyph mime={t.file.type} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs text-slate-700">{t.name}</span>
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                    {FILE_KIND_LABEL[t.kind]}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full transition-all ${
                      t.status === 'error' ? 'bg-red-500' : t.status === 'done' ? 'bg-emerald-500' : 'bg-indigo-600'
                    }`}
                    style={{ width: `${Math.round(t.pct * 100)}%` }}
                  />
                </div>
              </div>
              <div className="shrink-0 text-right text-[11px] text-slate-400">
                {t.status === 'done' ? (
                  '完成'
                ) : t.status === 'error' ? (
                  <button onClick={() => run(t)} className="font-medium text-indigo-600 hover:underline">
                    {t.phase === 'save' ? '重试写入' : '重试'}
                  </button>
                ) : t.status === 'saving' ? (
                  '写入中…'
                ) : (
                  `${Math.round(t.pct * 100)}%`
                )}
              </div>
              <div className="shrink-0 text-[11px] text-slate-400">{formatBytes(t.size)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
