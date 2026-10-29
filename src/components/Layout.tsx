import { ConnectKitButton } from 'connectkit'
import { NavLink, Outlet } from 'react-router-dom'
import { useAccount, useSwitchChain } from 'wagmi'
import { AlertTriangle } from 'lucide-react'
import { CHAIN } from '@/lib/env'

function Mark() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
      <rect width="26" height="26" rx="8" fill="var(--accent)" />
      <rect x="6" y="6.5" width="14" height="3.2" rx="1.6" fill="#fff" />
      <rect x="6" y="11.4" width="10" height="3.2" rx="1.6" fill="#fff" fillOpacity="0.8" />
      <rect x="6" y="16.3" width="6" height="3.2" rx="1.6" fill="#fff" fillOpacity="0.6" />
    </svg>
  )
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
    isActive ? 'bg-white text-[var(--ink)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--ink)]'
  }`

function WrongNetworkBanner() {
  const { isConnected, chainId } = useAccount()
  const { switchChain, isPending } = useSwitchChain()
  if (!isConnected || chainId === CHAIN.id) return null
  return (
    <div
      role="alert"
      className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm"
      style={{ borderColor: 'var(--border)', background: 'rgba(186,43,76,0.06)' }}
    >
      <span className="flex items-center gap-2 font-medium" style={{ color: 'var(--danger)' }}>
        <AlertTriangle className="size-4" /> Your wallet is on a different network.
      </span>
      <button className="btn btn-primary btn-sm" disabled={isPending} onClick={() => switchChain({ chainId: CHAIN.id })}>
        {isPending ? 'Switching…' : `Switch to ${CHAIN.name}`}
      </button>
    </div>
  )
}

export default function Layout() {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b backdrop-blur-xl" style={{ borderColor: 'var(--border)', background: 'rgba(249,249,252,0.8)' }}>
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <NavLink to="/" className="flex items-center gap-2">
            <Mark />
            <span className="display text-xl font-bold">Tranche</span>
          </NavLink>
          <nav className="order-3 flex w-full gap-1 sm:order-none sm:w-auto" aria-label="Main">
            <NavLink to="/" end className={navClass}>
              New grant
            </NavLink>
            <NavLink to="/payouts" className={navClass}>
              My payouts
            </NavLink>
          </nav>
          <ConnectKitButton showBalance={false} />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-28 pt-6">
        <WrongNetworkBanner />
        <Outlet />
      </main>
    </div>
  )
}
