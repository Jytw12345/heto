// PWA 手动更新检测：触发 SW 的注册表 update()，若服务端有新 sw.js，
// PWAInstallPrompt 里的 updatefound 监听会自动弹出「新版本已就绪」横幅。
export async function checkForUpdate() {
  if (!('serviceWorker' in navigator)) {
    throw new Error('当前环境不支持 Service Worker')
  }
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) {
    throw new Error('尚未注册 PWA，请刷新后再试')
  }
  await reg.update()
}
