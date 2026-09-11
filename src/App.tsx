import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { ToastProvider } from './components/Toast'
import Layout from './components/Layout'
import PWAInstallPrompt from './components/PWAInstallPrompt'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Contracts from './pages/Contracts'
import ContractDetail from './pages/ContractDetail'
import Reminders from './pages/Reminders'
import Admin from './pages/Admin'
import Settings from './pages/Settings'
import Audit from './pages/Audit'
import { Empty } from './components/ui'

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <Empty text="加载中…" />
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}

function RequirePerm({ perm, children }: { perm: string; children: ReactNode }) {
  const { can } = useAuth()
  if (!can(perm as any)) return <Empty text={`需要权限：${perm}`} />
  return <>{children}</>
}

function RequireHq({ children }: { children: ReactNode }) {
  const { isHq } = useAuth()
  if (!isHq) return <Empty text="仅总部账号可访问此页面" />
  return <>{children}</>
}

function HomeGate() {
  const { session } = useAuth()
  return session ? <Navigate to="/" replace /> : <Login />
}

export default function App() {
  // 把 basename 设为 Vite 注入的 base：本地 '/'，GitHub Pages '/heto/'
  // 这样所有 <Link to> / navigate('/') / <Navigate to> 都会拼上正确前缀，
  // 不会再出现"登录后跳到 /contracts 缺 /heto/ 前缀"的问题。
  const basename = import.meta.env.BASE_URL.replace(/\/$/, '')
  return (
    <AuthProvider>
      <ToastProvider>
        {/* future flags：提前对齐 React Router v7 行为，消除控制台的 future flag 警告 */}
        <BrowserRouter
          basename={basename || undefined}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <PWAInstallPrompt />
          <Routes>
            <Route path="/login" element={<HomeGate />} />
            <Route
              element={
                <RequireAuth>
                  <Layout />
                </RequireAuth>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route path="/contracts" element={<Contracts />} />
              <Route path="/contracts/:id" element={<ContractDetail />} />
              <Route path="/reminders" element={<Reminders />} />
              <Route
                path="/admin"
                element={
                  <RequireHq>
                    <Admin />
                  </RequireHq>
                }
              />
              <Route
                path="/audit"
                element={
                  <RequirePerm perm="audit.view">
                    <Audit />
                  </RequirePerm>
                }
              />
              <Route path="/settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  )
}