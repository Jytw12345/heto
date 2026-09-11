// ============================================================
// 细粒度权限模型
// ------------------------------------------------------------
// role 是粗粒度数据范围（hq 看全门店 / store 只看本店）；
// position_template 是职能默认权限包；permissions JSONB 是逐人覆盖。
//
// 解析规则：
//   1. 若账号绑定了职务模板，则以该模板权限为「基础默认」
//   2. 否则按 role 默认（HQ 全权 / 门店按 DEFAULT_STORE_PERMS）
//   3. profiles.permissions 里显式 true/false 的，覆盖上面默认值
//      （true = 额外允许；false = 收回默认权限）
// ============================================================

import type { PermKey, Permissions, Profile, Role } from '../types'

/** 总部默认权限（全开） */
export const DEFAULT_HQ_PERMS: Record<PermKey, true> = {
  'contract.create': true,
  'contract.edit': true,
  'contract.delete': true,
  'contract.export': true,
  'contract.renew': true,
  'file.upload': true,
  'file.download': true,
  'file.delete': true,
  'amount.view': true,
  'amount.edit': true,
  'reminder.manage': true,
  'channel.manage': true,
  'store.manage': true,
  'user.manage': true,
  'audit.view': true,
  'template.manage': true,
  'tag.manage': true,
}

/** 门店账号默认权限（看不到金额字段修改、看不到审计日志） */
export const DEFAULT_STORE_PERMS: Record<PermKey, boolean> = {
  'contract.create': true,
  'contract.edit': true,
  'contract.delete': false,
  'contract.export': true,
  'contract.renew': true,
  'file.upload': true,
  'file.download': true,
  'file.delete': true,
  'amount.view': true,
  'amount.edit': false,
  'reminder.manage': false,
  'channel.manage': false,
  'store.manage': false,
  'user.manage': false,
  'audit.view': false,
  'template.manage': false,
  'tag.manage': true,
}

/** 解析某账号的最终权限。
 *  @param templatePerms 该账号所绑定的职务模板权限（作为基础默认），可选
 */
export function resolvePerms(
  profile: Profile | null,
  templatePerms?: Permissions,
): Record<PermKey, boolean> {
  if (!profile) return {} as Record<PermKey, boolean>
  if (!profile.active) return {} as Record<PermKey, boolean>
  const base: Record<PermKey, boolean> = templatePerms
    ? { ...DEFAULT_STORE_PERMS, ...templatePerms }
    : profile.role === 'hq'
      ? { ...DEFAULT_HQ_PERMS }
      : { ...DEFAULT_STORE_PERMS }
  const over = profile.permissions || {}
  for (const k of Object.keys(over) as PermKey[]) {
    base[k] = !!over[k]
  }
  return base
}

export function can(profile: Profile | null, key: PermKey): boolean {
  return !!resolvePerms(profile)[key]
}

export function canAny(profile: Profile | null, keys: PermKey[]): boolean {
  const p = resolvePerms(profile)
  return keys.some((k) => p[k])
}

/** 全部权限位（用于 Admin 页面渲染矩阵） */
export const ALL_PERMS: { key: PermKey; label: string; group: string }[] = [
  { key: 'contract.create', label: '新建合同', group: '合同' },
  { key: 'contract.edit', label: '编辑合同', group: '合同' },
  { key: 'contract.delete', label: '删除合同', group: '合同' },
  { key: 'contract.export', label: '导出 Excel', group: '合同' },
  { key: 'contract.renew', label: '合同续签', group: '合同' },
  { key: 'file.upload', label: '上传扫描件', group: '附件' },
  { key: 'file.download', label: '下载扫描件', group: '附件' },
  { key: 'file.delete', label: '删除扫描件', group: '附件' },
  { key: 'amount.view', label: '查看金额', group: '字段' },
  { key: 'amount.edit', label: '修改金额', group: '字段' },
  { key: 'reminder.manage', label: '提醒规则', group: '系统' },
  { key: 'channel.manage', label: '推送渠道', group: '系统' },
  { key: 'tag.manage', label: '合同标签', group: '系统' },
  { key: 'template.manage', label: '合同模板', group: '系统' },
  { key: 'store.manage', label: '管理门店', group: '管理' },
  { key: 'user.manage', label: '管理账号', group: '管理' },
  { key: 'audit.view', label: '审计日志', group: '管理' },
]

export const ROLE_PRESET: Record<Role, { label: string; perms: Permissions }> = {
  hq: { label: '总部账号', perms: { ...DEFAULT_HQ_PERMS } },
  store: { label: '门店账号', perms: { ...DEFAULT_STORE_PERMS } },
}