/* 零依赖 Service Worker：支持 PWA 安装 + 离线访问。
 * 策略：
 *  - 安装时预缓存核心壳（首页/清单/图标）
 *  - 导航请求：network-first，失败回退缓存首页
 *  - 同源静态资源（JS/CSS/图片/字体）：stale-while-revalidate
 *  - 跨域请求（Supabase / COS API 等）不经过缓存，直接走网络
 */
const CACHE = 'hetong-cache-0.1.0-1789139501927'
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

  // 导航：network-first，失败时回退缓存首页
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html').then((r) => r || Response.error()))
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
