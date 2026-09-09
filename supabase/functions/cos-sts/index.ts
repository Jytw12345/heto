// ============================================================
// Edge Function: cos-sts
// ------------------------------------------------------------
// 给前端签发腾讯云 COS 临时凭证（STS AssumeRole），用于浏览器直传
//
// 配置（Supabase Dashboard → Edge Functions → Secrets）：
//   TENCENT_SECRET_ID       主/子账号 SecretId（调用 AssumeRole 的账号）
//   TENCENT_SECRET_KEY      对应 SecretKey
//   TENCENT_STS_ROLE_ARN    角色 ARN，例如
//                            qcs::cam::uin/100040235793:roleName/COSAccessRole
//   COS_APPID               桶所属 APPID（可选，默认从桶名后缀自动解析）
//   COS_BUCKET              COS 桶名，如 jlayin-1334164762
//   COS_REGION              COS 地域，如 ap-beijing
//   COS_PREFIX              桶内顶层目录前缀（默认 contracts/，与前端 VITE_COS_PREFIX 保持一致）
//
// 前端调用：
//   GET /functions/v1/cos-sts?store_id={uuid}
//   Authorization: Bearer <supabase_access_token>
//
// 权限策略：
//   1. 必须登录（Supabase Auth）
//   2. 必须是 HQ，或者 store_id = 自己的 profile.store_id
//   3. 临时凭证 policy 限定只能读写 {COS_PREFIX}{store_id}/*
//      → 即便前端 STS 被滥用，也只能往当前门店的目录写
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10'
// 用 crypto-js（纯 JS，跨 Deno 版本稳定）做 TC3-HMAC-SHA256 链式签名
// 避开 Deno 上 crypto.subtle.importKey('raw', ...) 在 HMAC 模式下的隐性兼容问题
import CryptoJS from 'https://esm.sh/crypto-js@4.2.0'

const Hex = CryptoJS.enc.Hex

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const TENCENT_SECRET_ID = Deno.env.get('TENCENT_SECRET_ID')!
const TENCENT_SECRET_KEY = Deno.env.get('TENCENT_SECRET_KEY')!
const TENCENT_STS_ROLE_ARN = Deno.env.get('TENCENT_STS_ROLE_ARN')!
const COS_BUCKET = Deno.env.get('COS_BUCKET')!
const COS_REGION = Deno.env.get('COS_REGION')!
// 与前端 VITE_COS_PREFIX 保持一致；多个软件共用同一桶时各自配置不同的 prefix
const COS_PREFIX = (Deno.env.get('COS_PREFIX') || 'contracts/').replace(/^\/|\/$/g, '') + '/'

// COS 资源 ARN 里的 uid 必须是桶所属 APPID（桶名后缀那串数字）
// jlayin-1334164762 → 1334164762；优先用 COS_APPID Secret，缺省从桶名解析
const COS_APPID = Deno.env.get('COS_APPID') || (COS_BUCKET.split('-').pop() ?? '')

const STS_HOST = 'sts.tencentcloudapi.com'
const STS_VERSION = '2018-08-13'
const STS_ACTION = 'AssumeRole'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'GET') return json({ error: '仅支持 GET' }, 405)

  try {
    // 1. 验登录
    const auth = req.headers.get('authorization') || ''
    const token = auth.replace(/^Bearer /i, '')
    if (!token) return json({ error: '未登录' }, 401)

    const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: userData, error: userErr } = await sb.auth.getUser()
    if (userErr || !userData?.user) return json({ error: '登录状态无效' }, 401)
    const user = userData.user

    // 2. 取 store_id 与权限
    const url = new URL(req.url)
    const storeId = url.searchParams.get('store_id')
    if (!storeId) return json({ error: 'store_id 必填' }, 400)

    const { data: profile } = await sb
      .from('profiles')
      .select('role, active, store_id')
      .eq('id', user.id)
      .maybeSingle()

    if (!profile?.active) return json({ error: '账号已停用' }, 403)
    if (profile.role !== 'hq' && profile.store_id !== storeId) {
      return json({ error: '无权访问该门店' }, 403)
    }

    // 3. 拼 policy：限定只能操作 {COS_PREFIX}{store_id}/*
    //    资源 ARN 格式：qcs::cos:{region}:uid/{APPID}:{bucket}/{key}
    //    APPID 取自桶名后缀（jlayin-1334164762 → 1334164762）
    const policy = {
      version: '2.0',
      statement: [{
        effect: 'allow',
        action: [
          'cos:PutObject',
          'cos:InitiateMultipartUpload',
          'cos:ListMultipartUploads',
          'cos:ListParts',
          'cos:UploadPart',
          'cos:CompleteMultipartUpload',
          'cos:AbortMultipartUpload',
          'cos:GetObject',
          'cos:HeadObject',
          'cos:DeleteObject',
        ],
        resource: [
          `qcs::cos:${COS_REGION}:uid/${COS_APPID}:${COS_BUCKET}/${COS_PREFIX}${storeId}/*`,
        ],
      }],
    }

    // 4. 调 STS AssumeRole
    const credentials = await assumeRole(JSON.stringify(policy))

    // 5. 写审计日志（失败不影响主流程）
    sb.from('audit_logs')
      .insert({
        actor_id: user.id,
        actor_email: user.email,
        action: 'cos.sts',
        resource: 'store',
        resource_id: storeId,
        store_id: storeId,
      })
      .then(() => {})
      .catch(() => {})

    return json({
      tmpSecretId: credentials.tmpSecretId,
      tmpSecretKey: credentials.tmpSecretKey,
      sessionToken: credentials.sessionToken,
      expiredTime: credentials.expiredTime,
      bucket: COS_BUCKET,
      region: COS_REGION,
      uploadPrefix: `${COS_PREFIX}${storeId}/`,
    })
  } catch (e) {
    return json({
      error: e instanceof Error ? e.message : String(e),
    }, 500)
  }
})

// ---------- 腾讯云 TC3-HMAC-SHA256 签名 + AssumeRole ----------
async function assumeRole(policyJson: string) {
  const now = Math.floor(Date.now() / 1000)
  const date = isoDate(now)

  const payloadObj = {
    RoleArn: TENCENT_STS_ROLE_ARN,
    RoleSessionName: `web-${now}`,
    Policy: policyJson,
    DurationSeconds: 3600,
  }
  const payload = JSON.stringify(payloadObj)

  const canonicalHeaders =
    `content-type:application/json; charset=utf-8\n` +
    `host:${STS_HOST}\n` +
    `x-tc-action:${STS_ACTION.toLowerCase()}\n` +
    `x-tc-region:${COS_REGION}\n`
  const signedHeaders = 'content-type;host;x-tc-action;x-tc-region'
  const hashedPayload = CryptoJS.SHA256(payload).toString(Hex)
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`

  const credentialScope = `${date}/sts/tc3_request`
  const hashedCanonical = CryptoJS.SHA256(canonicalRequest).toString(Hex)
  const stringToSign =
    `TC3-HMAC-SHA256\n${now}\n${credentialScope}\n${hashedCanonical}`

  // TC3 链式 HMAC-SHA256：secretDate → secretService → secretSigning → final
  // crypto-js 的 HmacSHA256 第一个参数是 message、第二个是 key（按 WordArray 顺序）
  const secretDate = CryptoJS.HmacSHA256(date, `TC3${TENCENT_SECRET_KEY}`)
  const secretService = CryptoJS.HmacSHA256('sts', secretDate)
  const secretSigning = CryptoJS.HmacSHA256('tc3_request', secretService)
  const signature = CryptoJS.HmacSHA256(stringToSign, secretSigning).toString(Hex)

  const authorization =
    `TC3-HMAC-SHA256 Credential=${TENCENT_SECRET_ID}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  const resp = await fetch(`https://${STS_HOST}`, {
    method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json; charset=utf-8',
        Host: STS_HOST,
        'X-TC-Action': STS_ACTION,
        'X-TC-Region': COS_REGION,
        'X-TC-Timestamp': String(now),
        'X-TC-Version': STS_VERSION,
      },
    body: payload,
  })

  if (!resp.ok) throw new Error(`STS HTTP ${resp.status}`)
  const data = await resp.json()
  if (data.Response?.Error) {
    throw new Error(`STS ${data.Response.Error.Code}: ${data.Response.Error.Message}`)
  }
  const c = data.Response.Credentials
  return {
    tmpSecretId: c.TmpSecretId as string,
    tmpSecretKey: c.TmpSecretKey as string,
    sessionToken: c.Token as string,
    expiredTime: Number(c.ExpiredTime),
  }
}

function isoDate(unixSec: number): string {
  const d = new Date(unixSec * 1000)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders },
  })
}