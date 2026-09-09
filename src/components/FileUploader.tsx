import { useEffect, useRef, useState } from 'react'
import {
  MAX_FILE_SIZE,
  StorageError,
  uploadFile,
  validateFile,
  type UploadResult,
} from '../lib/storage'
import { supabase } from '../lib/supabase'
import { useToast } from './Toast'
import { FileGlyph } from './ui'
import { formatBytes } from '../lib/format'

interface Task {
  id: number
  file: File
  name: string
  size: number
  thumb?: string
  pct: number
  status: 'uploading' | 'saving' | 'done' | 'error'
  error?: string
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
  const { push } = useToast()
  const seq = useRef(0)
  const tasksRef = useRef<Task[]>([])

  useEffect(() => {
    tasksRef.current = tasks
  }, [tasks])

  // 卸载时释放所有缩略图 object URL，避免内存泄漏
  useEffect(() => {
    return () => tasksRef.current.forEach((t) => t.thumb && URL.revokeObjectURL(t.thumb))
  }, [])

  const remove = (id: number) => {
    setTasks((p) => {
      const t = p.find((x) => x.id === id)
      if (t?.thumb) URL.revokeObjectURL(t.thumb)
      return p.filter((x) => x.id !== id)
    })
  }

  async function run(task: Task) {
    const patch = (t: Partial<Task>) => setTasks((p) => p.map((x) => (x.id === task.id ? { ...x, ...t } : x)))
    try {
      const res: UploadResult = await uploadFile(task.file, {
        storeId,
        contractId,
        onProgress: (pct) => patch({ pct }),
      })

      patch({ status: 'saving', pct: 1 })
      const { error } = await supabase.from('contract_files').insert({
        contract_id: contractId,
        store_id: storeId,
        file_path: res.path,
        file_name: res.name,
        mime_type: res.mime,
        size_bytes: res.size,
        sha256: res.sha256,
        kind: 'scan',
      })
      if (error) throw new StorageError(error.message)

      patch({ status: 'done' })
      push(`${task.name} 上传完成`, 'ok')
      onUploaded()
      setTimeout(() => remove(task.id), 1500)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '上传失败'
      patch({ status: 'error', error: msg })
      push(msg, 'err')
    }
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
      const id = ++seq.current
      const thumb = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
      const task: Task = { id, file, name: file.name, size: file.size, thumb, pct: 0, status: 'uploading' }
      setTasks((p) => [...p, task])
      void run(task)
    }
  }

  return (
    <div>
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
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx"
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
                <div className="truncate text-xs text-slate-700">{t.name}</div>
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
                    重试
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
