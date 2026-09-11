import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

type ToastKind = 'ok' | 'err' | 'info'
interface ToastItem {
  id: number
  kind: ToastKind
  msg: string
}

const ToastCtx = createContext<{ push: (msg: string, kind?: ToastKind) => void }>({
  push: () => {},
})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const push = useCallback((msg: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.random()
    setItems((prev) => [...prev, { id, kind, msg }])
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3600)
  }, [])

  const value = useMemo(() => ({ push }), [push])

  const bg: Record<ToastKind, string> = {
    ok: 'bg-emerald-600',
    err: 'bg-red-600',
    info: 'bg-slate-800',
  }

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2 md:bottom-[max(1.5rem,env(safe-area-inset-bottom))]">
        {items.map((t) => (
          <div
            key={t.id}
            className={`${bg[t.kind]} max-w-[86vw] rounded-lg px-4 py-2.5 text-sm text-white shadow-lg`}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx)
