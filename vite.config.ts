import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages 项目站点的根路径是 /<仓库名>/，由 Actions 注入 GH_PAGES_BASE 自动适配，
// 本地 dev / 非 Pages 部署时回退为 '/'（绝对根）。
const base = process.env.GH_PAGES_BASE || '/'

export default defineConfig({
  base,
  plugins: [react()],
  server: { host: true, port: 5173 },
})
