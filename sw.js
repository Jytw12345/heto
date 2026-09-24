/* 零依赖 Service Worker：支持 PWA 安装 + 离线访问。
 * 策略：
 *  - 安装时预缓存核心壳（首页/清单/图标）
 *  - 导航请求：network-first，失败回退缓存首页
 *  - 同源静态资源（JS/CSS/图片/字体）：stale-while-revalidate
 *  - 跨域请求（Supabase / COS API 等）不经过缓存，直接走网络
 */
const CACHE = 'hetong-cache-0.2.68-1790211779984'
// 导航请求的网络超时：弱网/假连接时 5 秒内没响应就回退缓存首页，避免冷启动长时间白屏
const NAV_TIMEOUT_MS = 5000

function withTimeout(promise, ms) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}
const CORE = [
  './index.html',
  './manifest.webmanifest',
  './icons/appicon-192.png',
  './icons/appicon-512.png',
  './icons/appicon-maskable-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)))
})

// 收到页面"立即刷新"指令后再跳过等待，接管控制权（配合新版本提示使用）
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  // 只处理同源资源（Supabase / COS 等 API 不缓存）
  if (url.origin !== self.location.origin) return

  // 导航：network-first（5s 超时），成功时同步刷新缓存的首页，失败回退缓存
  // 关键：成功也写回缓存，否则缓存里的 index.html 永远停在旧版本，
  // 引用的旧 hash JS 被新部署删除后，弱网回退缓存就会白屏死页。
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await withTimeout(fetch(req), NAV_TIMEOUT_MS)
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put('./index.html', copy))
          }
          return res
        } catch {
          const cached = await caches.match('./index.html')
          if (cached) return cached
          // 完全没有缓存：继续等网络（慢也比打不开强）
          return fetch(req).catch(() => Response.error())
        }
      })()
    )
    return
  }

  // 静态资源：stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy))
          }
          return res
        })
        .catch(() => cached)
      return cached || network
    })
  )
})
