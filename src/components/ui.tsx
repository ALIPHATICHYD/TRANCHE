import { ExternalLink, Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { addressUrl, txUrl } from '@/lib/env'
import { shortAddress } from '@/lib/format'
import type { TxStage } from '@/hooks/useTx'

export function AddressLink({ address, you }: { address: string; you?: boolean }) {
  return (
    <a
      href={addressUrl(address)}
      target="_blank"
      rel="noopener noreferrer"
      className="mono inline-flex items-center gap-1 text-[13px] hover:underline"
      style={{ color: 'var(--accent)' }}
      title={address}
    >
      {shortAddress(address)}
      {you && <span className="pill pill-accent ml-1">You</span>}
    </a>
  )
}

export function TxLink({ hash, label = 'View tx' }: { hash: string; label?: string }) {
  return (
    <a
      href={txUrl(hash)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs font-semibold hover:underline"
      style={{ color: 'var(--accent)' }}
    >
      {label} <ExternalLink className="size-3" />
    </a>
  )
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Loader2 className="size-4 animate-spin" /> {label}
    </span>
  )
}

export function stageLabel(stage: TxStage, idle: ReactNode): ReactNode {
  if (stage === 'wallet') return <Spinner label="Confirm in wallet…" />
  if (stage === 'confirming') return <Spinner label="Confirming…" />
  return idle
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="rounded-xl px-3 py-2 text-sm" style={{ background: 'rgba(186,43,76,0.08)', color: 'var(--danger)' }}>
      {message}
    </p>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl ${className}`} style={{ background: 'var(--surface-muted)' }} />
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card p-8 text-center">
      <h2 className="display text-xl font-semibold">{title}</h2>
      {children && <div className="mx-auto mt-2 max-w-sm text-sm text-pretty" style={{ color: 'var(--muted)' }}>{children}</div>}
    </div>
  )
}

export function UsdcAmount({ value, size = 'md' }: { value: string; size?: 'md' | 'xl' }) {
  return (
    <span className="inline-flex items-baseline gap-1 tabular-nums">
      <span className={size === 'xl' ? 'display text-4xl font-bold' : 'font-semibold'}>{value}</span>
      <span className={size === 'xl' ? 'text-lg font-medium' : 'text-xs'} style={{ color: 'var(--subtle)' }}>
        USDC
      </span>
    </span>
  )
}
