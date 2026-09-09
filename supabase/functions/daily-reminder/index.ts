// ============================================================
// 每日到期提醒
// ------------------------------------------------------------
// 部署： supabase functions deploy daily-reminder
// 密钥： supabase secrets set RESEND_API_KEY=xxx MAIL_FROM=... CRON_SECRET=...
// 触发： 见 README「定时触发」一节（pg_cron 或外部 cron）
//
// 去重逻辑：每推送一条就往 reminders 写一行，
// (合同, 到期日, 提前天数, 渠道, 接收人) 唯一，重复跑不会重复推送。
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const MAIL_FROM = Deno.env.get('MAIL_FROM') ?? '合同云 <onboarding@resend.dev>'
const WEBHOOK_URL = Deno.env.get('WEBHOOK_URL') ?? ''
const APP_URL = Deno.env.get('APP_URL') ?? ''

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })

function levelOf(days: number): 'urgent' | 'warning' | 'info' {
  if (days <= 1) return 'urgent'
  if (days <= 7) return 'warning'
  return 'info'
}

function renderMail(rows: { title: string; store: string; end: string; days: number }[]) {
  const lis = rows
    .map(
      (r) =>
        `<li style="margin-bottom:8px"><b>${r.title}</b> — ${r.store}<br/>到期日 ${r.end} · ${
          r.days < 0 ? `已过期 ${-r.days} 天` : r.days === 0 ? '今天到期' : `还剩 ${r.days} 天`
        }</li>`,
    )
    .join('')
  return `<div style="font-family:-apple-system,'PingFang SC',sans-serif;font-size:14px;color:#111">
    <h3 style="margin:0 0 12px">合同到期提醒</h3>
    <ul style="padding-left:18px;margin:0">${lis}</ul>
    ${APP_URL ? `<p style="margin-top:16px"><a href="${APP_URL}">打开合同云查看</a></p>` : ''}
  </div>`
}

Deno.serve(async (req: Request) => {
  if (CRON_SECRET) {
    const auth = req.headers.get('authorization') ?? ''
    if (auth !== `Bearer ${CRON_SECRET}`) return json({ error: 'unauthorized' }, 401)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const today = new Date().toISOString().slice(0, 10)

  // 顺手把过期合同标记掉
  await admin.rpc('mark_expired_contracts')

  const { data: dues, error: dueErr } = await admin.rpc('due_contracts', {
    p_today: today,
    p_max_lead: 90,
  })
  if (dueErr) return json({ error: dueErr.message }, 500)

  const { data: profiles } = await admin
    .from('profiles')
    .select('id, store_id, role, full_name, active')
    .eq('active', true)
  const { data: userRes } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const emailOf = new Map<string, string>(
    (userRes?.users ?? []).map((u) => [u.id, u.email ?? '']),
  )

  const inAppSent: { userId: string; contractId: string; title: string; body: string; level: string }[] =
    []
  const mailByUser = new Map<string, { title: string; store: string; end: string; days: number }[]>()
  let skipped = 0

  for (const c of dues ?? []) {
    const days: number = c.days_left
    const leads: number[] = (c.remind_days ?? [30, 7, 1]).filter((n: number) => typeof n === 'number')
    const hits = days <= 0 ? [0] : leads.filter((l) => days <= l)
    if (hits.length === 0) continue

    for (const lead of hits) {
      // 接收人：总部全部 + 该门店账号
      const targets = (profiles ?? []).filter(
        (p) => p.role === 'hq' || p.store_id === c.store_id,
      )
      for (const p of targets) {
        const title =
          days < 0
            ? `【已过期】${c.title}`
            : days === 0
              ? `【今天到期】${c.title}`
              : `【${days} 天后到期】${c.title}`
        const body = `${c.store_name} · 到期日 ${c.end_at}${c.contract_no ? ` · 编号 ${c.contract_no}` : ''}`

        // 站内：reminders 去重
        const { error: e1 } = await admin.from('reminders').insert({
          contract_id: c.contract_id,
          due_date: c.end_at,
          lead_days: lead,
          channel: 'in_app',
          recipient: p.id,
        })
        if (e1) {
          if (e1.code === '23505') skipped++
          else console.error('reminder insert failed', e1)
        } else {
          inAppSent.push({
            userId: p.id,
            contractId: c.contract_id,
            title,
            body,
            level: levelOf(days),
          })
        }

        // 邮件：同一去重键，按人汇总成一封
        if (RESEND_API_KEY) {
          const { error: e2 } = await admin.from('reminders').insert({
            contract_id: c.contract_id,
            due_date: c.end_at,
            lead_days: lead,
            channel: 'email',
            recipient: p.id,
          })
          if (!e2) {
            const arr = mailByUser.get(p.id) ?? []
            arr.push({ title: c.title, store: c.store_name, end: c.end_at, days })
            mailByUser.set(p.id, arr)
          } else if (e2.code !== '23505') {
            console.error('email reminder insert failed', e2)
          }
        }
      }
    }
  }

  if (inAppSent.length) {
    const { error } = await admin.from('notifications').insert(
      inAppSent.map((n) => ({
        user_id: n.userId,
        contract_id: n.contractId,
        title: n.title,
        body: n.body,
        level: n.level,
      })),
    )
    if (error) console.error('notification insert failed', error)
  }

  let mails = 0
  if (RESEND_API_KEY) {
    for (const [userId, rows] of mailByUser) {
      const to = emailOf.get(userId)
      if (!to) continue
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: MAIL_FROM,
          to: [to],
          subject: `合同到期提醒（${rows.length} 份）`,
          html: renderMail(rows),
        }),
      })
      if (res.ok) mails++
      else console.error('resend failed', await res.text())
    }
  }

  // 可选：推送到企微 / 钉钉机器人
  let webhook = 0
  if (WEBHOOK_URL && inAppSent.length) {
    const text = inAppSent
      .slice(0, 20)
      .map((n) => `- ${n.title}（${n.body}）`)
      .join('\n')
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content: `合同到期提醒\n${text}` } }),
    })
    if (res.ok) webhook = 1
  }

  return json({
    date: today,
    scanned: (dues ?? []).length,
    notifications: inAppSent.length,
    mails,
    webhook,
    skippedDuplicates: skipped,
  })
})
