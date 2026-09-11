import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { STATUS_LABEL, STATUS_TONE, type ContractStatus } from '../types'

export function Card({
  title,
  extra,
  children,
  className = '',
}: {
  title?: ReactNode
  extra?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-2xl border border-slate-200/70 bg-white shadow-sm ${className}`}>
      {(title || extra) && (
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-medium text-slate-800">{title}</h2>
          {extra}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

export function Modal({
  open,
  title,
  onClose,
  children,
  wide = false,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm sm:items-center">
      <div
        className={`w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} rounded-xl bg-white shadow-xl`}
      >
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h3 className="text-base font-medium text-slate-900">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="关闭"
          >
            ✕
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}

/**
 * 可拖动 / 可缩放 / 可最大化的浮层弹窗。
 * - 拖动：按住标题栏移动（双击标题栏切换最大化）
 * - 缩放：拖右下角手柄（带最小尺寸限制）
 * - 关闭：右上角 ✕ 或 Esc
 * 打开时会自动居中并按视口收敛初始尺寸。
 */
export function FloatingModal({
  open,
  title,
  onClose,
  children,
  initialWidth = 920,
  initialHeight = 660,
  minWidth = 400,
  minHeight = 320,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  initialWidth?: number
  initialHeight?: number
  minWidth?: number
  minHeight?: number
}) {
  const [size, setSize] = useState({ w: initialWidth, h: initialHeight })
  const [pos, setPos] = useState({ x: 40, y: 40 })
  const [maximized, setMaximized] = useState(false)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)
  const resizeRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)

  // 打开时居中 + 按视口收敛尺寸
  useEffect(() => {
    if (!open) return
    const w = Math.min(initialWidth, window.innerWidth - 32)
    const h = Math.min(initialHeight, window.innerHeight - 32)
    setSize({ w, h })
    setPos({
      x: Math.max(16, (window.innerWidth - w) / 2),
      y: Math.max(16, (window.innerHeight - h) / 2),
    })
    setMaximized(false)
  }, [open, initialWidth, initialHeight])

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  function startDrag(e: ReactPointerEvent) {
    if (maximized) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }
  }
  function moveDrag(e: ReactPointerEvent) {
    if (!dragRef.current) return
    const x = Math.min(Math.max(-size.w + 120, e.clientX - dragRef.current.dx), window.innerWidth - 80)
    const y = Math.min(Math.max(0, e.clientY - dragRef.current.dy), window.innerHeight - 44)
    setPos({ x, y })
  }
  function endDrag(e: ReactPointerEvent) {
    dragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* 忽略：指针可能已释放 */
    }
  }

  function startResize(e: ReactPointerEvent) {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    resizeRef.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h }
  }
  function moveResize(e: ReactPointerEvent) {
    if (!resizeRef.current) return
    const w = Math.max(minWidth, Math.min(window.innerWidth, resizeRef.current.w + (e.clientX - resizeRef.current.x)))
    const h = Math.max(minHeight, Math.min(window.innerHeight, resizeRef.current.h + (e.clientY - resizeRef.current.y)))
    setSize({ w, h })
  }
  function endResize(e: ReactPointerEvent) {
    resizeRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* 忽略 */
    }
  }

  if (!open) return null

  const box = maximized
    ? { left: 12, top: 12, width: window.innerWidth - 24, height: window.innerHeight - 24 }
    : { left: pos.x, top: pos.y, width: size.w, height: size.h }

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div
        className="absolute flex flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/5"
        style={box}
      >
        <header
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onDoubleClick={() => setMaximized((m) => !m)}
          className="flex shrink-0 cursor-move touch-none select-none items-center justify-between border-b border-slate-100 px-4 py-2.5"
        >
          <h3 className="truncate pr-3 text-sm font-medium text-slate-900">{title}</h3>
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => setMaximized((m) => !m)}
              className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              title={maximized ? '还原' : '最大化'}
              aria-label={maximized ? '还原' : '最大化'}
            >
              {maximized ? '❐' : '⛶'}
            </button>
            <button
              onClick={onClose}
              className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="关闭"
            >
              ✕
            </button>
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        {!maximized && (
          <div
            onPointerDown={startResize}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            className="absolute bottom-0 right-0 z-10 h-4 w-4 cursor-nwse-resize touch-none"
            title="拖动调整大小"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4 text-slate-300">
              <path d="M15 6 L6 15 M15 11 L11 15" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          </div>
        )}
      </div>
    </div>
  )
}

export function Field({
  label,
  children,
  hint,
  className,
}: {
  label: string
  children: ReactNode
  hint?: string
  className?: string
}) {
  return (
    <label className={`block ${className || ''}`}>
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  )
}

export const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-ring)]'

/** 同行内联版（去掉 w-full），用于 flex 行里的 <select>/<input>，让它们按内容自适应宽度而不是各占一行 */
export const inputClsInline =
  'rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[var(--brand)] focus:ring-2 focus:ring-[var(--brand-ring)]'

export function Button({
  children,
  onClick,
  variant = 'default',
  type = 'button',
  disabled,
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'default' | 'primary' | 'danger' | 'ghost'
  type?: 'button' | 'submit'
  disabled?: boolean
  className?: string
}) {
  const styles: Record<string, string> = {
    default: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-400',
    primary: 'bg-[var(--brand)] text-white shadow-sm shadow-[var(--brand-soft)] hover:bg-[var(--brand-strong)]',
    danger: 'border border-red-200 bg-white text-red-600 hover:bg-red-50',
    ghost: 'text-slate-600 hover:bg-slate-100',
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-3.5 py-2 text-sm font-medium transition active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-ring)] ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  )
}

export function Empty({ text, icon, compact = false }: { text: string; icon?: ReactNode; compact?: boolean }) {
  // 紧凑态：单行矮占位，用于卡片本身高度有限、不想被空态撑高的场景
  if (compact) {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-center text-sm text-slate-400">
        {icon}
        <span>{text}</span>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      {icon ?? <DefaultEmptyArt />}
      <p className="text-sm text-slate-400">{text}</p>
    </div>
  )
}

/** 空数据默认插画：文件夹/合同文档 + 一个放大镜未果的小圆 */
function DefaultEmptyArt() {
  return (
    <svg viewBox="0 0 120 120" className="h-28 w-28 text-slate-300" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="22" y="32" width="76" height="60" rx="9" />
      <path d="M22 50h76" />
      <path d="M40 42h32" />
      <path d="M36 64h30" />
      <path d="M36 76h20" />
      <circle cx="86" cy="86" r="15" />
      <path d="M97 97l8 8" />
    </svg>
  )
}

const STATUS_ICON: Record<ContractStatus, ReactNode> = {
  draft: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
      <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  ),
  active: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="m9 11 3 3L22 4" />
    </svg>
  ),
  renewed: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M3 21v-5h5" />
    </svg>
  ),
  expired: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  ),
  cancelled: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
      <circle cx="12" cy="12" r="9" /><path d="m15 9-6 6" /><path d="m9 9 6 6" />
    </svg>
  ),
}

export function StatusBadge({ status }: { status: ContractStatus }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[status]}`}>
      {STATUS_ICON[status]}
      {STATUS_LABEL[status]}
    </span>
  )
}

export function Pill({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}>
      {children}
    </span>
  )
}

/**
 * 顶部统计卡。强调"漂浮感"：大圆角、阴影、淡渐变 + 右上角图标徽章。
 * tone: indigo(总数) / emerald(履行中) / amber(30天内到期) / red(已逾期)
 */
export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'indigo',
  trend,
}: {
  label: string
  value: number | string
  hint?: ReactNode
  icon: ReactNode
  tone?: 'indigo' | 'emerald' | 'amber' | 'red' | 'slate'
  /** 趋势文本（如 "+2 本月" 或 "30% 占比"），右侧以 chip 形式展示 */
  trend?: string
}) {
  const palette: Record<string, { bg: string; ring: string; text: string; icon: string }> = {
    indigo:  { bg: 'from-[var(--brand)]/10 to-white',  ring: 'ring-[var(--brand)]/15',  text: 'text-[var(--brand-darkest)]',  icon: 'bg-[var(--brand)]/12 text-[var(--brand-strong)]' },
    emerald: { bg: 'from-emerald-50/70 to-white', ring: 'ring-emerald-100', text: 'text-emerald-700', icon: 'bg-emerald-100 text-emerald-600' },
    amber:   { bg: 'from-amber-50/70 to-white',   ring: 'ring-amber-100',   text: 'text-amber-700',   icon: 'bg-amber-100 text-amber-600' },
    red:     { bg: 'from-red-50/70 to-white',     ring: 'ring-red-100',     text: 'text-red-700',     icon: 'bg-red-100 text-red-600' },
    slate:   { bg: 'from-slate-50/70 to-white',   ring: 'ring-slate-100',   text: 'text-slate-700',   icon: 'bg-slate-100 text-slate-600' },
  }
  const p = palette[tone]
  return (
    <div className={`group relative overflow-hidden rounded-2xl border border-slate-200/70 bg-gradient-to-br ${p.bg} p-4 shadow-sm transition hover:shadow-md`}>
      <div className={`absolute -right-4 -top-4 grid h-16 w-16 place-items-center rounded-full ${p.icon} opacity-90 transition group-hover:scale-110`}>
        {icon}
      </div>
      <div className="relative">
        <div className="text-xs font-medium text-slate-500">{label}</div>
        <div className={`mt-1.5 text-3xl font-semibold tabular-nums ${p.text}`}>
          {value}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
          {hint}
          {trend && (
            <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ${p.ring} ${p.text}`}>
              {trend}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-20" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function FileGlyph({ mime }: { mime?: string | null }) {
  const m = mime ?? ''
  const isImg = m.startsWith('image/')
  const label = isImg ? 'IMG' : m.includes('pdf') ? 'PDF' : m.includes('word') || m.includes('doc') ? 'DOC' : 'FILE'
  const color = isImg
    ? 'bg-[var(--brand)]/10 text-[var(--brand-strong)]'
    : m.includes('pdf')
      ? 'bg-red-50 text-red-600'
      : 'bg-slate-100 text-slate-500'
  return <div className={`grid h-full w-full place-items-center text-[10px] font-medium ${color}`}>{label}</div>
}
