import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    '缺少 Supabase 配置：请复制 .env.example 为 .env.local，填入 VITE_SUPABASE_URL 与 VITE_SUPABASE_ANON_KEY',
  )
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
  global: { headers: { 'x-application-name': 'hetong-cloud' } },
})

export const isSupabaseConfigured = Boolean(url && anonKey)
