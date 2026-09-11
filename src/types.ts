export type Role = 'hq' | 'store'

/** 职务权限模板（position_templates 表）：默认权限包 + 数据范围 */
export interface PositionTemplate {
  id: string
  name: string
  scope: Role
  permissions: Permissions
  is_system: boolean
  created_at: string
}
export type ContractStatus = 'draft' | 'active' | 'renewed' | 'expired' | 'cancelled'
// 文件角色：original=合同正本 / attachment=附件 / scan=扫描件 / invoice=发票 / template=模板
export type FileKind = 'original' | 'attachment' | 'scan' | 'invoice' | 'template'
export type NotifChannel = 'inapp' | 'email' | 'wecom' | 'dingtalk' | 'feishu'

export interface Store {
  id: string
  name: string
  code: string | null
  address: string | null
  manager: string | null
  phone: string | null
  active: boolean
  created_at: string
}

// 我方主体字典（合同「我方主体」下拉的可选列表）
export interface OurEntity {
  id: string
  name: string
  /** 手动维护的简写名，用于合同列表紧凑展示；为空时回退到自动简写 */
  short_name: string | null
  created_at?: string
}

export interface Profile {
  id: string
  store_id: string | null
  full_name: string | null
  phone: string | null
  wechat: string | null
  role: Role
  /** 职务模板引用（position_templates.id）；为空则回落到 role 默认权限 */
  position_template_id: string | null
  active: boolean
  /** 细粒度权限位覆盖（空对象 = 走职务/角色默认权限） */
  permissions: Permissions
  last_login_at: string | null
  created_at: string
}

/** 细粒度权限位 */
export type PermKey =
  | 'contract.create'    // 新建合同
  | 'contract.edit'      // 编辑合同
  | 'contract.delete'    // 删除合同
  | 'contract.export'    // 导出 Excel
  | 'contract.renew'     // 续签
  | 'file.upload'        // 上传扫描件
  | 'file.download'      // 下载扫描件
  | 'file.delete'        // 删除扫描件
  | 'amount.view'        // 看到金额字段
  | 'amount.edit'        // 修改金额字段
  | 'reminder.manage'    // 改提醒规则
  | 'channel.manage'     // 配推送渠道
  | 'store.manage'       // 管门店
  | 'user.manage'        // 管账号（含改 role/permissions）
  | 'audit.view'         // 看审计日志
  | 'template.manage'    // 管合同模板
  | 'tag.manage'         // 管合同标签

export type Permissions = Partial<Record<PermKey, boolean>>

export interface Contract {
  id: string
  store_id: string
  title: string
  contract_no: string | null
  counterparty: string | null
  our_entity: string | null
  category: string | null
  tags: string[]
  amount: number | null
  signed_at: string | null
  start_at: string | null
  end_at: string | null
  remind_days: number[]
  reminder_channels: NotifChannel[]
  auto_renew: boolean
  status: ContractStatus
  note: string | null
  template_id: string | null
  renewed_from: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  store_name?: string
  days_left?: number
  file_count?: number
}

export interface ContractFile {
  id: string
  contract_id: string
  store_id: string
  file_path: string
  file_name: string
  mime_type: string | null
  size_bytes: number
  sha256: string | null
  kind: FileKind
  uploaded_by: string | null
  created_at: string
}

export interface ContractTag {
  id: string
  store_id: string | null  // null = 全局
  name: string
  color: string
  created_at: string
}

export interface ContractTemplate {
  id: string
  name: string
  category: string | null
  our_entity: string | null
  default_remind_days: number[]
  fields: Record<string, unknown>
  note: string | null
  active: boolean
  /** 合同正文模板（HTML），支持 {{占位符}}；012 迁移新增 */
  body: string
  created_at: string
  updated_at?: string
}

export interface NotifChannelConfig {
  id: string
  store_id: string | null
  kind: 'wecom' | 'dingtalk' | 'feishu' | 'webhook' | 'email'
  name: string
  url: string
  active: boolean
  created_at: string
}

export interface ReminderRule {
  id: string
  store_id: string | null
  category: string | null
  lead_days: number[]
  template: string | null
  channels: NotifChannel[]
  active: boolean
}

export interface AppNotification {
  id: string
  user_id: string
  contract_id: string | null
  title: string
  body: string | null
  level: 'info' | 'warning' | 'urgent'
  read_at: string | null
  created_at: string
}

export interface AuditLog {
  id: string
  actor_id: string | null
  actor_email: string | null
  action: string
  resource: string | null
  resource_id: string | null
  store_id: string | null
  payload: Record<string, unknown> | null
  ip: string | null
  user_agent: string | null
  created_at: string
}

export const CATEGORIES = ['采购', '设计', '印刷', '安装', '施工', '服务', '广告', '装修', '租赁', '制作', '维保', '其他'] as const

export const FILE_KIND_LABEL: Record<FileKind, string> = {
  original: '合同正本',
  attachment: '附件',
  scan: '扫描件',
  invoice: '发票',
  template: '模板',
}

export const FILE_KIND_ORDER: FileKind[] = ['original', 'attachment', 'scan', 'invoice']

export const STATUS_LABEL: Record<ContractStatus, string> = {
  draft: '草稿',
  active: '履行中',
  renewed: '已续签',
  expired: '已到期',
  cancelled: '已作废',
}

export const STATUS_TONE: Record<ContractStatus, string> = {
  draft: 'bg-slate-100 text-slate-600',
  active: 'bg-emerald-50 text-emerald-700',
  renewed: 'bg-blue-50 text-blue-700',
  expired: 'bg-red-50 text-red-700',
  cancelled: 'bg-gray-100 text-gray-400 line-through',
}