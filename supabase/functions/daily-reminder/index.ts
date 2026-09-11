// ============================================================
// 每日到期提醒
// ------------------------------------------------------------
// 部署： supabase functions deploy daily-reminder
// 密钥： supabase secrets set RESEND_API_KEY=xxx MAIL_FROM=... CRON_SECRET=... [WEBHOOK_URL=...]
// 触发： 见 README「定时触发」一节（pg_cron 或外部 cron）
//
// 提醒来源优先级（越具体越优先）：
//   1) reminder_rules 命中「门店 + 类别」→ 用规则的 lead_days / channels / template
//   2) 没命中任何规则 → 沿用合同自带的 remind_days + 站内/邮件（保持老行为，不回归）
//
// 群 / webhook 推送：读 notification_channels 里 active 的渠道，
//   作用域 = 全局（store_id 为空）+ 合同所属门店；每个渠道汇总成一条消息。
//   没配任何规则时也会推（渠道已停用则不会）；配了规则后按规则 channels 收窄。
//
// 去重：每推送一条就往 reminders 写一行，(合同, 到期日, 提前天数, 渠道, 接收人) 唯一。
//   reminders.channel 只允许 'in_app' / 'email' / 'webhook'，
//   所以 webhook 类渠道统一记 'webhook'，用 recipient 存 notification_channels.id
//   —— 这样每个群各自去重，且不需要改表。
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

interface DueRow {
  contract_id: string
  store_id: string | null
  store_name: string
  title: string
  contract_no: string | null
  end_at: string
  days_left: number
  remind_days: number[] | null
}

interface RuleRow {
  id: string
  store_id: string | null
  category: string | null
  lead_days: number[] | null
  channels: string[] | null
  template: string | null
}

interface ChanRow {
  id: string
  store_id: string | null
  kind: string
  name: string
  url: string
}

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

// 规则模板变量：{{title}} {{counterparty}} {{days}} {{store}} {{end_at}} {{contract_no}} {{lead_days}}
function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => vars[k] ?? '')
}

// 各家机器人的消息体字段名不一样
function buildWebhookBody(kind: string, content: string): unknown {
  switch (kind) {
    case 'wecom':
      return { msgtype: 'text', text: { content } }
    case 'dingtalk':
      return { msgtype: 'text', text: { content } }
    case 'feishu':
      return { msg_type: 'text', content: { text: content } }
    default: // webhook 等通用地址
      return { text: content }
  }
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

  const list = (dues ?? []) as DueRow[]

  // due_contracts 不返回 category / counterparty，单独补一次
  // （规则按「门店+类别」匹配必须拿到 category；counterparty 供模板变量用）
  const metaById = new Map<string, { category: string | null; counterparty: string | null }>()
  if (list.length) {
    const { data: metas } = await admin
      .from('contracts')
      .select('id, category, counterparty')
      .in(
        'id',
        list.map((c) => c.contract_id),
      )
    for (const m of (metas ?? []) as {
      id: string
      category: string | null
      counterparty: string | null
    }[]) {
      metaById.set(m.id, {
        category: m.category ?? null,
        counterparty: m.counterparty ?? null,
      })
    }
  }

  const [{ data: ruleData }, { data: chanData }] = await Promise.all([
    admin
      .from('reminder_rules')
      .select('id, store_id, category, lead_days, channels, template')
      .eq('active', true),
    admin
      .from('notification_channels')
      .select('id, store_id, kind, name, url')
      .eq('active', true)
      .neq('kind', 'email'),
  ])
  const activeRules = (ruleData ?? []) as RuleRow[]
  const chanList = (chanData ?? []) as ChanRow[]

  // 规则匹配：门店+类别 > 门店 > 类别 > 全局
  function pickRule(storeId: string | null, category: string | null): RuleRow | null {
    const cands = activeRules.filter(
      (r) =>
        (r.store_id === null || r.store_id === storeId) &&
        (r.category === null || r.category === category),
    )
    if (!cands.length) return null
    const score = (r: RuleRow) => (r.store_id ? 2 : 0) + (r.category ? 1 : 0)
    return cands.sort((a, b) => score(b) - score(a))[0]
  }

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
  // 群推送按渠道聚合；同时记住 reminders 去重行 id，发送失败时回滚以便下次重试
  const pendingByChan = new Map<
    string,
    {
      chan: ChanRow
      items: {
        reminderId: string
        row: { title: string; store: string; end: string; days: number }
      }[]
    }
  >()
  let skipped = 0

  for (const c of list) {
    const days: number = c.days_left
    const meta = metaById.get(c.contract_id)
    const category = meta?.category ?? null
    const rule = pickRule(c.store_id, category)

    // leads = 提前天数；wants = 规则指定的渠道，null 表示走老行为（站内+邮件）
    let leads: number[]
    let wants: string[] | null = null
    let tpl: string | null = null

    if (rule) {
      leads = (rule.lead_days ?? []).filter((n: number) => typeof n === 'number')
      if (!leads.length) {
        leads = (c.remind_days ?? [30, 7, 1]).filter((n: number) => typeof n === 'number')
      }
      wants = (rule.channels ?? []) as string[]
      tpl = rule.template ?? null
    } else {
      leads = (c.remind_days ?? [30, 7, 1]).filter((n: number) => typeof n === 'number')
    }

    const hits = days <= 0 ? [0] : leads.filter((l: number) => days <= l)
    if (hits.length === 0) continue

    // 本合同可以发到哪些群：全局渠道 + 本门店渠道
    const chansForContract = chanList.filter(
      (ch) => ch.store_id === null || ch.store_id === c.store_id,
    )

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
        const fallbackBody = `${c.store_name} · 到期日 ${c.end_at}${c.contract_no ? ` · 编号 ${c.contract_no}` : ''}`
        const body = tpl
          ? renderTemplate(tpl, {
              title: c.title,
              counterparty: meta?.counterparty ?? '',
              days: String(days),
              store: c.store_name,
              end_at: c.end_at,
              contract_no: c.contract_no ?? '',
              lead_days: String(lead),
            }) || fallbackBody
          : fallbackBody

        // 站内：reminders 去重
        if (!wants || wants.includes('inapp')) {
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
        }

        // 邮件：同一去重键，按人汇总成一封
        if (RESEND_API_KEY && (!wants || wants.includes('email'))) {
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

    // 群 / webhook：每个合同每天只记一条去重行、只汇总进一条消息，
    // 避免同一个合同在 hits 有多个 lead 时把群刷爆（站内/邮件维持原行为不变）
    if (!wants || wants.some((k) => k !== 'inapp' && k !== 'email')) {
      const lead = Math.min(...hits)
      for (const ch of chansForContract) {
        if (wants && !wants.includes(ch.kind)) continue
        const { data: ins, error: e3 } = await admin
          .from('reminders')
          .insert({
            contract_id: c.contract_id,
            due_date: c.end_at,
            lead_days: lead,
            channel: 'webhook',
            recipient: ch.id,
          })
          .select('id')
          .single()
        if (e3) {
          if (e3.code === '23505') skipped++
          else console.error('webhook reminder insert failed', e3)
          continue
        }
        const entry = pendingByChan.get(ch.id) ?? { chan: ch, items: [] }
        entry.items.push({
          reminderId: (ins as { id: string }).id,
          row: { title: c.title, store: c.store_name, end: c.end_at, days },
        })
        pendingByChan.set(ch.id, entry)
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

  // 按渠道汇总推送：每个群只发一条
  let pushes = 0
  const pushErrors: string[] = []
  for (const [, entry] of pendingByChan) {
    const ch = entry.chan
    const rows = entry.items.map((i) => i.row)
    const lines = rows
      .slice(0, 20)
      .map(
        (r) =>
          `- ${r.title}（${r.store}）${
            r.days < 0 ? `已过期 ${-r.days} 天` : r.days === 0 ? '今天到期' : `还剩 ${r.days} 天`
          } · 到期日 ${r.end}`,
      )
    const content = [
      `合同到期提醒（${rows.length} 份）`,
      '',
      ...lines,
      ...(rows.length > 20 ? [`...等共 ${rows.length} 份`] : []),
      ...(APP_URL ? ['', APP_URL] : []),
    ].join('\n')

    const rollback = async () => {
      // 发送失败时删掉去重行，否则这条提醒永远不会重试
      await admin
        .from('reminders')
        .delete()
        .in(
          'id',
          entry.items.map((i) => i.reminderId),
        )
    }

    try {
      const res = await fetch(ch.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildWebhookBody(ch.kind, content)),
      })
      const text = await res.text()
      // 企微 / 钉钉 / 飞书失败时 HTTP 仍然返回 200，错误在 body 的 errcode / code 里，
      // 只看 res.ok 会把「key 填错」当成发送成功
      let ok = res.ok
      let detail = ''
      try {
        const j = JSON.parse(text) as {
          errcode?: number
          errmsg?: string
          code?: number
          msg?: string
        }
        const ec = j.errcode ?? j.code
        if (typeof ec === 'number' && ec !== 0) {
          ok = false
          detail = `${ec} ${j.errmsg ?? j.msg ?? ''}`.trim()
        }
      } catch {
        if (!res.ok) detail = `HTTP ${res.status}`
      }
      if (ok) {
        pushes++
      } else {
        pushErrors.push(`${ch.name}: ${detail || `HTTP ${res.status}`} ${text.slice(0, 120)}`)
        await rollback()
      }
    } catch (e) {
      pushErrors.push(`${ch.name}: ${String(e)}`)
      await rollback()
    }
  }

  // 兜底：只有在完全没配渠道时才用旧的 WEBHOOK_URL 环境变量，避免和新渠道重复推送
  let webhook = 0
  if (WEBHOOK_URL && pendingByChan.size === 0 && inAppSent.length) {
    const text = inAppSent
      .slice(0, 20)
      .map((n) => `- ${n.title}（${n.body}）`)
      .join('\n')
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'text',
        text: { content: `合同到期提醒\n${text}` },
      }),
    })
    if (res.ok) webhook = 1
  }

  return json({
    date: today,
    scanned: list.length,
    rulesMatched: activeRules.length,
    channelsConfigured: chanList.length,
    notifications: inAppSent.length,
    mails,
    pushes,
    pushErrors,
    legacyWebhook: webhook,
    skippedDuplicates: skipped,
  })
})
