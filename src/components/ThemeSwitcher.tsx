import { useEffect, useState } from 'react'

export type ThemeKey = 'orange' | 'violet' | 'blue' | 'emerald' | 'slate'

const THEMES: { key: ThemeKey; label: string; color: string; strong: string }[] = [
  { key: 'orange',  label: '橘橙',  color: '#F97316', strong: '#EA580C' },
  { key: 'violet',  label: '紫罗兰', color: '#7C3AED', strong: '#6D28D9' },
  { key: 'blue',    label: '蓝',    color: '#2563EB', strong: '#1D4ED8' },
  { key: 'emerald', label: '绿',    color: '#059669', strong: '#047857' },
  { key: 'slate',   label: '石墨',  color: '#475569', strong: '#334155' },
]

const STORAGE_KEY = 'app-theme'

export function getStoredTheme(): ThemeKey {
  const raw = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
  if (raw && THEMES.some((t) => t.key === raw)) return raw as ThemeKey
  return 'orange'
}

export function applyTheme(key: ThemeKey) {
  document.documentElement.dataset.theme = key
  const meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null
  const theme = THEMES.find((t) => t.key === key)
  if (meta && theme) meta.content = theme.color
  if (theme) localStorage.setItem(STORAGE_KEY, key)
}

/** 提前注入：在 index.html 用内联脚本调用，避免首屏闪烁 */
export function initThemeInlineScript(): string {
  return `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}')||'orange';var ok=['orange','violet','blue','emerald','slate'];if(!ok.includes(t))t='orange';document.documentElement.dataset.theme=t;var m=document.querySelector('meta[name="theme-color"]');if(m){var c={orange:'#F97316',violet:'#7C3AED',blue:'#2563EB',emerald:'#059669',slate:'#475569'}[t];m.content=c;}}catch(e){}})();`
}

export function ThemeSwitcher({ className = '' }: { className?: string }) {
  const [active, setActive] = useState<ThemeKey>(() => getStoredTheme())

  useEffect(() => {
    applyTheme(active)
  }, [active])

  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`} aria-label="主题配色">
      {THEMES.map((t) => {
        const isActive = active === t.key
        return (
          <button
            key={t.key}
            type="button"
            title={t.label}
            onClick={() => setActive(t.key)}
            className={`grid h-6 w-6 place-items-center rounded-full transition ${
              isActive ? 'ring-2 ring-offset-1' : 'hover:scale-110'
            }`}
            style={{
              backgroundColor: t.color,
              '--tw-ring-color': isActive ? t.strong : undefined,
            } as React.CSSProperties}
            aria-pressed={isActive}
          >
            {isActive && (
              <svg className="h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>
        )
      })}
    </div>
  )
}
