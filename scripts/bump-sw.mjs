// 构建后把 sw.js 里的 %SW_VERSION% 占位符替换为「包版本-时间戳」，
// 确保每次部署 sw.js 内容都变化 → 浏览器重新注册新 SW、清理旧缓存。
// 这样每次升级功能都不用手动计算版本号。
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { version } = require('../package.json')
const here = dirname(fileURLToPath(import.meta.url))

// outDir 跟随 vite.config（默认 dist）
const distSw = resolve(here, '..', 'dist', 'sw.js')

if (!existsSync(distSw)) {
  console.warn('[bump-sw] 未找到 dist/sw.js，跳过（请先执行 vite build）')
  process.exit(0)
}

let code = readFileSync(distSw, 'utf8')
if (!code.includes('%SW_VERSION%')) {
  console.log('[bump-sw] sw.js 中无 %SW_VERSION% 占位符，跳过')
  process.exit(0)
}

const v = `${version}-${Date.now()}`
code = code.replace('%SW_VERSION%', v)
writeFileSync(distSw, code)
console.log(`[bump-sw] sw.js 版本已写入：${v}`)
