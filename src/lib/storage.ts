// ============================================================
// 文件存储抽象层（腾讯云 COS 版）
// ------------------------------------------------------------
// 上传：前端拿到 STS 临时凭证后直传 COS（>5MB 自动分片）
// 预览/下载：Edge Function cos-signed-url 用主密钥签临时链接
//
// 关键设计：
//   1. 路径 = {PREFIX}{store_id}/{contract_id}/{uuid}.{ext}
//      PREFIX = VITE_COS_PREFIX（默认 contracts/）
//      STS policy 限定到 {PREFIX}{store_id}/* → 即便前端 STS 被滥用也越不出去
//   2. 密钥永远不离开服务端：前端只持有 1 小时有效的 STS 凭证
//   3. 接口形态和之前的 Supabase Storage 实现一致，页面代码不感知底层切换
// ============================================================

import COS from 'cos-js-sdk-v5'
import { supabase } from './supabase'

export const BUCKET = import.meta.env.VITE_COS_BUCKET || ''
export const REGION = import.meta.env.VITE_COS_REGION || 'ap-beijing'
// 桶内顶层目录前缀，前端和 Edge Function 必须保持一致
export const PREFIX = (import.meta.env.VITE_COS_PREFIX || 'contracts/').replace(/^\/|\/$/g, '') + '/'
export const STS_URL = `${import.meta.env.VITE_SUPABASE_URL.replace(/\/$/, '')}/functions/v1/cos-sts`
export const SIGN_URL = `${import.meta.env.VITE_SUPABASE_URL.replace(/\/$/, '')}/functions/v1/cos-signed-url`

// 单文件 5GB（COS 单文件上限），按需调小
export const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024

export const ALLOWED_MIME = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  // 也允许常见压缩包，方便一次传多页合同
  'application/zip',
  'application/x-rar-compressed',
]

// 扩展名白名单：浏览器对 .docx/.doc/.zip 经常上报空或错误的 MIME，
// 仅靠 MIME 校验会把合法文件误拒。这里以扩展名为准、MIME 为辅，二者任一命中即放行。
export const ALLOWED_EXT = [
  'pdf',
  'jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'bmp', 'gif',
  'doc', 'docx',
  'zip', 'rar',
]

export interface UploadResult {
  path: string
  name: string
  size: number
  mime: string
  sha256: string
}

export class StorageError extends Error {}

export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : 'bin'
}

/**
 * 生成 v4 UUID。
 * crypto.randomUUID() 只在现代浏览器 + 安全上下文存在；
 * 部分环境（微信/QQ/Edge Legacy/国产老内核）尚不支持。
 * 降级方案：用 crypto.getRandomValues 拿到 16 字节随机数，
 * 按 RFC 4122 强转 v4 标记位 → 仍是合规的 v4 UUID，全局唯一性等价。
 */
function genId(): string {
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined
  if (c && typeof c.randomUUID === 'function') {
    try {
      return c.randomUUID()
    } catch {
      /* 安全上下文不满足时会抛，降级到下面 */
    }
  }
  if (c && typeof c.getRandomValues === 'function') {
    const b = new Uint8Array(16)
    c.getRandomValues(b)
    // RFC 4122: 第 7 字节高 4 位 = 0100（v4），第 9 字节高 2 位 = 10
    b[6] = (b[6] & 0x0f) | 0x40
    b[8] = (b[8] & 0x3f) | 0x80
    const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  throw new StorageError('当前浏览器不支持安全的随机数生成，请换 Chrome/Edge/Firefox 最新版再上传')
}

export function buildPath(storeId: string, contractId: string, fileName: string): string {
  const id = genId()
  return `${PREFIX}${storeId}/${contractId}/${id}.${extOf(fileName)}`
}

export function validateFile(file: File): string | null {
  if (file.size > MAX_FILE_SIZE) {
    return `文件超过 ${(MAX_FILE_SIZE / 1024 / 1024 / 1024).toFixed(0)}GB，请先压缩或分卷后再传`
  }
  if (file.size === 0) return '文件为空'

  const ext = extOf(file.name)
  const mimeOk = !!file.type && ALLOWED_MIME.includes(file.type)
  const extOk = !!ext && ALLOWED_EXT.includes(ext)

  // 扩展名或 MIME 任一命中即放行；两者都没有才拒（避免 .docx 等被空 MIME 误杀）
  if (!extOk && !mimeOk) {
    const hint = ext ? `扩展名 .${ext}` : file.type || '未知类型'
    return `不支持的文件类型：${hint}（仅支持 PDF / 图片 / Word / 压缩包）`
  }
  return null
}

async function sha256(file: File): Promise<string> {
  try {
    const buf = await file.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', buf)
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    return ''
  }
}

interface StsCreds {
  tmpSecretId: string
  tmpSecretKey: string
  sessionToken: string
  expiredTime: number
  bucket: string
  region: string
  uploadPrefix: string
}

let _cachedCreds: { storeId: string; creds: StsCreds; expiresAt: number } | null = null

/** 取一次 STS 凭证（同一门店在过期前复用，省一次往返） */
async function getSts(storeId: string): Promise<StsCreds> {
  if (_cachedCreds && _cachedCreds.storeId === storeId && _cachedCreds.expiresAt > Date.now() + 60_000) {
    return _cachedCreds.creds
  }
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new StorageError('登录状态已失效，请重新登录')

  const resp = await fetch(`${STS_URL}?store_id=${encodeURIComponent(storeId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!resp.ok) {
    let msg = `STS 签发失败（${resp.status}）`
    try {
      const j = await resp.json()
      if (j.error) msg = j.error
    } catch {}
    throw new StorageError(msg)
  }
  const creds = (await resp.json()) as StsCreds
  // 提前 60s 过期
  _cachedCreds = { storeId, creds, expiresAt: creds.expiredTime * 1000 - 60_000 }
  return creds
}

function makeCos(creds: StsCreds): COS {
  return new COS({
    SecretId: creds.tmpSecretId,
    SecretKey: creds.tmpSecretKey,
    SecurityToken: creds.sessionToken,
    ExpiredTime: creds.expiredTime,
    Protocol: 'https',
    UploadCheckContentMd5: false,
  })
}

/** 上传（>5MB 自动分片） */
export async function uploadFile(
  file: File,
  opts: { storeId: string; contractId: string; onProgress?: (pct: number) => void },
): Promise<UploadResult> {
  const err = validateFile(file)
  if (err) throw new StorageError(err)

  const key = buildPath(opts.storeId, opts.contractId, file.name)
  const creds = await getSts(opts.storeId)
  const cos = makeCos(creds)

  // >5MB 走分片（每片 5MB）
  const useSlice = file.size > 5 * 1024 * 1024

  await new Promise<void>((resolve, reject) => {
    cos.uploadFile(
      {
        Bucket: creds.bucket,
        Region: creds.region,
        Key: key,
        Body: file,
        SliceSize: useSlice ? 5 * 1024 * 1024 : 0,
        onProgress: (info) => {
          if (opts.onProgress) opts.onProgress(info.percent / 100)
        },
      },
      (err, _data) => {
        if (err) reject(new StorageError(err.message || '上传失败'))
        else {
          opts.onProgress?.(1)
          resolve()
        }
      },
    )
  })

  return {
    path: key,
    name: file.name,
    size: file.size,
    mime: file.type || 'application/octet-stream',
    sha256: await sha256(file),
  }
}

/** 在线预览（调 Edge Function 签 URL → fetch 转 Blob → 造 blob URL，1 小时有效）
 * 走 blob 是为了避开 Chrome "下载 PDF 而不打开" 偏好对跨域 PDF iframe 的拦截：
 *  跨域 application/pdf 在 iframe 里若用户开了"下载 PDF"，Chrome 会直接下载、iframe 空白；
 *  改为同源 blob URL 后，Chrome 的 PDF viewer 始终内嵌渲染（img/iframe 都用同一份 blob）。
 * 调用方负责在不再使用时 URL.revokeObjectURL() 释放内存。 */
export async function createViewUrl(path: string, _expiresIn = 3600): Promise<string> {
  const url = await signUrl(path)
  const res = await fetch(url)
  if (!res.ok) throw new StorageError(`预览获取文件失败（${res.status}）`)
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

/** 下载链接（带原文件名） */
export async function createDownloadUrl(path: string, fileName: string, _expiresIn = 300): Promise<string> {
  const url = await signUrl(path, fileName)
  return url
}

async function signUrl(path: string, download?: string): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new StorageError('登录状态已失效，请重新登录')

  const qs = new URLSearchParams({ path, expires: '3600' })
  if (download) qs.set('download', download)

  const resp = await fetch(`${SIGN_URL}?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!resp.ok) {
    let msg = `签名 URL 失败（${resp.status}）`
    try {
      const j = await resp.json()
      if (j.error) msg = j.error
    } catch {}
    throw new StorageError(msg)
  }
  const j = (await resp.json()) as { url: string }
  return j.url
}

/** 触发浏览器下载（先取签名 URL，再 fetch 转 blob，避免签名 URL 留在地址栏） */
export async function downloadFile(path: string, fileName: string): Promise<void> {
  const url = await createDownloadUrl(path, fileName)
  const res = await fetch(url)
  if (!res.ok) throw new StorageError('下载失败，请重试')
  const blob = await res.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

/** COS 删除：用 STS 凭证直接发起请求 */
export async function removeFile(path: string): Promise<void> {
  // path 形如 {PREFIX}{store_id}/...，去掉 PREFIX 取第二段作为 store_id
  const parts = path.split('/')
  // PREFIX 段数 = (PREFIX 中的 / 数) + 1
  // 例如 PREFIX=contracts/ → 1 个 / → 拆出 ['', 'contracts', 'store_id', ...]
  // 实际更稳的做法：找到 PREFIX 末尾之后的第一个段
  const prefixParts = PREFIX.split('/').filter(Boolean).length
  const storeId = parts[prefixParts]
  if (!storeId) throw new StorageError('路径不合法')
  const creds = await getSts(storeId)
  const cos = makeCos(creds)
  await new Promise<void>((resolve, reject) => {
    cos.deleteObject({ Bucket: creds.bucket, Region: creds.region, Key: path }, (err) => {
      if (err) reject(new StorageError(err.message || '删除失败'))
      else resolve()
    })
  })
}