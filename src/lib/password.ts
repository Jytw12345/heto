/**
 * 密码强度校验（注册 / 修改密码共用）
 * 规则：≥8 位；含大写、小写、数字；数字字符全局不重复且相邻不连续（升序/降序）。
 */

export interface PasswordCheck {
  ok: boolean
  /** 校验未通过时的中文提示，通过则为空串 */
  msg: string
  /** 满足条件项，用于前端实时显示勾选 */
  items: {
    len: boolean // 至少 8 位
    upper: boolean // 含大写
    lower: boolean // 含小写
    digit: boolean // 含数字
    digitUnique: boolean // 数字不重复
    digitNoSeq: boolean // 数字不连续
  }
}

export function checkPassword(pw: string): PasswordCheck {
  const items = {
    len: pw.length >= 8,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    digit: /\d/.test(pw),
    digitUnique: true,
    digitNoSeq: true,
  }

  const digits = (pw.match(/\d/g) ?? []).map(Number)

  // 数字全局不重复
  if (digits.length > 0 && new Set(digits).size !== digits.length) {
    items.digitUnique = false
  }

  // 相邻数字不连续（递增 1 或递减 1）
  for (let i = 1; i < digits.length; i++) {
    const diff = Math.abs(digits[i] - digits[i - 1])
    if (diff === 1) {
      items.digitNoSeq = false
      break
    }
  }

  const ok =
    items.len && items.upper && items.lower && items.digit && items.digitUnique && items.digitNoSeq

  let msg = ''
  if (!items.len) msg = '密码至少 8 位'
  else if (!items.upper) msg = '需包含大写字母（A-Z）'
  else if (!items.lower) msg = '需包含小写字母（a-z）'
  else if (!items.digit) msg = '需包含数字（0-9）'
  else if (!items.digitUnique) msg = '数字不能重复（如 11、22）'
  else if (!items.digitNoSeq) msg = '数字不能连续（如 12、21）'

  return { ok, msg, items }
}
