import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages 项目站点的根路径是 /<仓库名>/，由 Actions 注入 GH_PAGES_BASE 自动适配，
// 本地 dev / 非 Pages 部署时回退为 '/'（绝对根）。
const base = process.env.GH_PAGES_BASE || '/'

export default defineConfig({
  base,
  plugins: [react()],
  server: { host: true, port: 5173 },
  // 本地 WorkBuddy 沙箱的 safe-delete 会拦截 Vite 的 rmSync 导致超时；
  // 设为 false 后改为手动 `rm -rf dist` 清理。GitHub Actions 上无此问题，可保留默认。
  build: { emptyOutDir: false },
})
