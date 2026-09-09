// ============================================================
// Edge Function: cos-signed-url
// ------------------------------------------------------------
// 给前端签发 COS 对象临时签名 URL（用于预览 / 下载）
// 注意：签名 URL 由服务端用长期密钥签发，不下发 SecretKey 到前端
//
// 调用：
//   GET /functions/v1/cos-signed-url?path={object_key}&expires={秒}
//   Authorization: Bearer <supabase_access_token>
//
// 权限：
//   1. 必须登录
//   2. path 必须以 COS_PREFIX 开头（默认 contracts/），且第二段（去掉前缀后的第一段）
//      必须等于用户 store_id（HQ 不限）
//   3. URL 默认 1 小时有效
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10'
// 用 crypto-js（纯 JS，跨 Deno 版本稳定）做 HMAC-SHA1 签名
// 避开 Deno 上 crypto.subtle.importKey('raw', ...) 在 HMAC 模式下的隐性兼容问题（会导致 SignatureDoesNotMatch）
import CryptoJS from 'https://esm.sh/crypto-js@4.2.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const TENCENT_SECRET_ID = Deno.env.get('TENCENT_SECRET_ID')!
const TENCENT_SECRET_KEY = Deno.env.get('TENCENT_SECRET_KEY')!
const COS_BUCKET = Deno.env.get('COS_BUCKET')!
const COS_REGION = Deno.env.get('COS_REGION')!
// 与前端 VITE_COS_PREFIX 保持一致；多个软件共用同一桶时各自配置不同的 prefix
const COS_PREFIX = (Deno.env.get('COS_PREFIX') || 'contracts/').replace(/^\/|\/$/g, '') + '/'
// COS AppId。优先从 COS_APPID Secret 读，缺省自动从桶名后缀解析（jiayinht-1334164762 → 1334164762）
const COS_APPID = Deno.env.get('COS_APPID') || (COS_BUCKET.split('-').pop() ?? '')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'GET') return json({ error: '仅支持 GET' }, 405)

  try {
    const auth = req.headers.get('authorization') || ''
    const token = auth.replace(/^Bearer /i, '')
    if (!token) return json({ error: '未登录' }, 401)

    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: userData, error: userErr } = await sb.auth.getUser()
    if (userErr || !userData?.user) return json({ error: '登录状态无效' }, 401)
    const user = userData.user

    const url = new URL(req.url)
    const objectKey = url.searchParams.get('path')
    const expires = Math.min(7200, Math.max(60, Number(url.searchParams.get('expires') ?? 3600)))
    const download = url.searchParams.get('download')  // 下载文件名
    if (!objectKey) return json({ error: 'path 必填' }, 400)

    // 权限检查：path 必须以 COS_PREFIX 开头，且第二段（去掉前缀后的第一段）匹配用户 store_id
    if (!objectKey.startsWith(COS_PREFIX)) return json({ error: '路径不合法' }, 400)
    const segments = objectKey.split('/')
    // segments[0] = PREFIX 的第一段（contracts），segments[1] = store_id
    const storeIdInPath = segments[1]
    const { data: profile } = await sb
      .from('profiles')
      .select('role, active, store_id')
      .eq('id', user.id)
      .maybeSingle()
    if (!profile?.active) return json({ error: '账号已停用' }, 403)
    if (profile.role !== 'hq' && storeIdInPath !== profile.store_id) {
      return json({ error: '无权访问该文件' }, 403)
    }

    const signed = await signObjectUrl({
      bucket: COS_BUCKET,
      region: COS_REGION,
      appId: COS_APPID,
      key: objectKey,
      secretId: TENCENT_SECRET_ID,
      secretKey: TENCENT_SECRET_KEY,
      method: 'GET',
      expires,
      responseContentDisposition: download
        ? `attachment; filename="${encodeURIComponent(download)}"`
        : undefined,
    })

    return json({ url: signed, expiresAt })
  } catch (e) {
    // 调试态：错误里带上 host 拼出来的预期 URL 前缀，便于区分「桶不存在」/「签名错」/「权限错」
    const hint = `signed-host=${COS_BUCKET}-${COS_APPID}.cos.${COS_REGION}.myqcloud.com`
    return json({ error: (e instanceof Error ? e.message : String(e)) + ' | ' + hint }, 500)
  }
})

let expiresAt = 0

// ---------- 腾讯云 COS 对象签名 URL ----------
// 文档：https://cloud.tencent.com/document/product/436/35153
async function signObjectUrl(opts: {
  bucket: string
  region: string
  appId: string
  key: string
  secretId: string
  secretKey: string
  method: 'GET' | 'PUT'
  expires: number
  responseContentDisposition?: string
}): Promise<string> {
  // COS 桶名（如 jiayin-1334164762）本身已含 APPID 后缀，访问域名直接用 完整桶名.cos.region
  // 不要再拼一次 appId，否则会变成 jiayin-1334164762-1334164762.cos...（重复，桶不存在 → NoSuchBucket）
  const host = `${opts.bucket}.cos.${opts.region}.myqcloud.com`
  const url = `https://${host}/${encodeURI(opts.key).replace(/%2F/g, '/')}`

  const now = Math.floor(Date.now() / 1000)
  expiresAt = now + opts.expires
  const keyTime = `${now};${expiresAt}`

  // 参与签名的 URL 参数（下载文件名等走 query，必须登记进 q-url-param-list）
  const params: Record<string, string> = {}
  if (opts.responseContentDisposition) {
    params['response-content-disposition'] = opts.responseContentDisposition
  }
  const paramKeys = Object.keys(params).sort().join(';')
  const paramStr = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&')

  // HttpString = HttpMethod\nUri\nParameters\nHeaders\n  （腾讯云规定首尾换行符必须保留）
  const httpString =
    `${opts.method.toLowerCase()}\n` +
    `/${opts.key}\n` +
    (paramStr ? `${paramStr}\n` : '\n') +
    '\n'

  const httpStringHash = CryptoJS.SHA1(httpString).toString() // 16 进制小写
  // StringToSign 必须以 "sha1" 开头，依次为 KeyTime、SHA1(HttpString)，每行含 \n
  const stringToSign = `sha1\n${keyTime}\n${httpStringHash}\n`

  // SignKey = HMAC-SHA1(SecretKey, KeyTime)，取「16 进制小写字符串」作为下一步的密钥
  // （不可直接用原始二进制 WordArray，否则与腾讯云校验不一致 → SignatureDoesNotMatch）
  const signKey = CryptoJS.HmacSHA1(keyTime, opts.secretKey).toString()
  // Signature = HMAC-SHA1(SignKey, StringToSign)，同样取 16 进制小写
  const signature = CryptoJS.HmacSHA1(stringToSign, signKey).toString()

  const allParams = new URLSearchParams()
  allParams.set('q-sign-algorithm', 'sha1')
  allParams.set('q-ak', opts.secretId)
  allParams.set('q-sign-time', keyTime)
  allParams.set('q-key-time', keyTime)
  allParams.set('q-header-list', '')
  allParams.set('q-url-param-list', paramKeys)
  allParams.set('q-signature', signature)
  for (const [k, v] of Object.entries(params)) allParams.set(k, v)

  return `${url}?${allParams.toString()}`
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders },
  })
}