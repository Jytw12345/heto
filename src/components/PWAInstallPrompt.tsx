import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const STORAGE_KEY = 'pwa-install-dismissed-at'
const COOLDOWN_MS = 1000 * 60 * 60 * 24 * 7 // 7 天内不再主动弹出

function isIos() {
  return /iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase())
}

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // @ts-expect-error iOS 旧属性
    window.navigator.standalone === true
  )
}

export default function PWAInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    if (isStandalone()) {
      setInstalled(true)
      return
    }

    const dismissedAt = Number(localStorage.getItem(STORAGE_KEY) || '0')
    if (dismissedAt && Date.now() - dismissedAt < COOLDOWN_MS) {
      setDismissed(true)
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    const onAppInstalled = () => setInstalled(true)

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [])

  const handleInstall = async () => {
    if (!deferred) return
    await deferred.prompt()
    const { outcome } = await deferred.userChoice
    if (outcome === 'accepted') {
      setInstalled(true)
    } else {
      handleDismiss()
    }
    setDeferred(null)
  }

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, String(Date.now()))
    setDismissed(true)
  }

  // 浏览器未触发 beforeinstallprompt，且不是 iOS：暂不提供 UI
  if (installed) return null
  if (!deferred && !isIos()) return null
  if (dismissed) return null

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-lg rounded-xl border border-indigo-200 bg-white p-4 shadow-lg sm:bottom-6 sm:left-auto sm:right-6 sm:w-80 sm:p-3">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-indigo-600 text-sm font-medium text-white">
          合
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium text-slate-900">安装合同云到桌面</div>
          <div className="mt-0.5 text-xs leading-relaxed text-slate-500">
            {deferred
              ? '像 App 一样从桌面一键打开，离线也能使用。'
              : '点击浏览器底部「分享」按钮，选择「添加到主屏幕」。'}
          </div>
          <div className="mt-2 flex gap-2">
            {deferred && (
              <button
                onClick={handleInstall}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
              >
                立即安装
              </button>
            )}
            <button
              onClick={handleDismiss}
              className="rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100"
            >
              暂不
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
