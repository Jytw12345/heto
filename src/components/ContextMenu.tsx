import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

export type MenuItem =
  | { type: 'separator' }
  | {
      type?: 'item'
      label: string
      onSelect: () => void
      /** 危险操作：红色显示 */
      danger?: boolean
      disabled?: boolean
    }

type Pos = { x: number; y: number }

const Ctx = createContext<(items: MenuItem[], pos: Pos) => void>(() => {})

/** 长按计时器与「刚长按过」标记：同一时刻只可能有一处按压，模块级变量足够 */
let pressTimer: number | undefined
let longPressed = false
const LONG_PRESS_MS = 480

/**
 * 全局右键/长按菜单宿主。放在应用根部，任意组件用 `useContextMenu()` 绑定即可。
 * - 桌面：鼠标右键（contextmenu）
 * - 移动端：长按 480ms（同时抑制系统「复制/搜索」气泡与长按后的误点击）
 */
export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<{ items: MenuItem[]; x: number; y: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const open = useCallback((items: MenuItem[], pos: Pos) => {
    if (items.length === 0) return
    setMenu({ items, x: pos.x, y: pos.y })
  }, [])

  const close = useCallback(() => setMenu(null), [])

  // 渲染后按实际尺寸把菜单收进视口
  useLayoutEffect(() => {
    const el = ref.current
    if (!menu || !el) return
    const x = Math.max(8, Math.min(menu.x, window.innerWidth - el.offsetWidth - 8))
    const y = Math.max(8, Math.min(menu.y, window.innerHeight - el.offsetHeight - 8))
    el.style.left = `${x}px`
    el.style.top = `${y}px`
  }, [menu])

  /**
   * 全局抑制浏览器原生右键菜单：空白处、卡片、表头等一律不弹系统菜单。
   * 例外：输入框 / 文本域 / 可编辑区域保留原生菜单（粘贴、全选、拼写检查要用）。
   * 已绑定自定义菜单的元素由自身 handler 处理（它们会 stopPropagation）。
   */
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      const t = e.target
      if (t instanceof Element && t.closest('input, textarea, [contenteditable="true"]')) return
      e.preventDefault()
    }
    document.addEventListener('contextmenu', onContextMenu)
    return () => document.removeEventListener('contextmenu', onContextMenu)
  }, [])

  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    // 点击菜单内部时不能关闭：否则 pointerdown 先把菜单卸载，click 永远不触发
    const onPointerDown = (e: PointerEvent) => {
      const el = ref.current
      if (el && e.target instanceof Node && el.contains(e.target)) return
      close()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu, close])

  return (
    <Ctx.Provider value={open}>
      {children}
      {menu &&
        createPortal(
          <div
            ref={ref}
            role="menu"
            className="fixed z-[200] min-w-[176px] max-w-[264px] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-2xl"
            style={{ left: menu.x, top: menu.y }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {menu.items.map((it, i) =>
              it.type === 'separator' ? (
                <div key={`sep-${i}`} className="my-1 h-px bg-slate-100" />
              ) : (
                <button
                  key={`${it.label}-${i}`}
                  type="button"
                  role="menuitem"
                  disabled={it.disabled}
                  onClick={() => {
                    if (it.disabled) return
                    close()
                    it.onSelect()
                  }}
                  className={`block w-full px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    it.danger
                      ? 'text-red-600 hover:bg-red-50'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {it.label}
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </Ctx.Provider>
  )
}

/**
 * 在任意元素上绑定右键/长按菜单：
 * ```tsx
 * const ctx = useContextMenu()
 * <tr {...ctx([{ label: '编辑', onSelect: () => ... }])}>
 * ```
 */
export function useContextMenu() {
  const open = useContext(Ctx)
  return (items: MenuItem[]) => ({
    'data-ctx-menu': '',
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      open(items, { x: e.clientX, y: e.clientY })
    },
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0]
      if (!t) return
      const pos = { x: t.clientX, y: t.clientY }
      longPressed = false
      window.clearTimeout(pressTimer)
      pressTimer = window.setTimeout(() => {
        longPressed = true
        open(items, pos)
      }, LONG_PRESS_MS)
    },
    onTouchMove: () => window.clearTimeout(pressTimer),
    onTouchEnd: () => window.clearTimeout(pressTimer),
    onTouchCancel: () => window.clearTimeout(pressTimer),
    // 长按抬起后会补发一次 click，这里拦掉，避免误触发行跳转/打开详情
    onClickCapture: (e: React.MouseEvent) => {
      if (!longPressed) return
      e.preventDefault()
      e.stopPropagation()
      longPressed = false
    },
  })
}

/** 复制文本到剪贴板，返回是否成功（调用方负责 toast） */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
