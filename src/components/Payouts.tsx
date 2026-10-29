import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ConnectKitButton } from 'connectkit'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { ChevronRight } from 'lucide-react'
import { fetchClaimable, fetchMyGrants, type MyGrant } from '@/lib/chain'
import { describeError, formatPercent, formatUsdc } from '@/lib/format'
import { useNow } from '@/hooks/useNow'
import { useTx } from '@/hooks/useTx'
import { Empty, ErrorNote, Skeleton, UsdcAmount, stageLabel } from './ui'

type Role = 'funder' | 'approver' | 'recipient'

const SECTIONS: { role: Role; title: string; hint: string }[] = [
  { role: 'recipient', title: 'You are a recipient', hint: 'Grants that pay you.' },
  { role: 'approver', title: 'You are the approver', hint: 'Grants where you release milestones.' },
  { role: 'funder', title: 'You are the funder', hint: 'Grants you created and funded.' },
]

function GrantRow({ entry, role, address, now }: { entry: MyGrant; role: Role; address: string; now: number }) {
  const { id, grant } = entry
  const released = grant.released.filter(Boolean).length
  const total = grant.amounts.length
  const pastDeadline = now >= Number(grant.deadline)
  const status = grant.refunded
    ? { label: 'Refunded', cls: 'pill' }
    : released === total
      ? { label: 'Fully released', cls: 'pill pill-ok' }
      : pastDeadline
        ? { label: 'Past deadline', cls: 'pill pill-bad' }
        : { label: 'Active', cls: 'pill pill-accent' }

  const myIndex = grant.recipients.findIndex((r) => r.toLowerCase() === address.toLowerCase())
  const detail =
    role === 'recipient' && myIndex >= 0
      ? `Your share ${formatPercent(grant.sharesBps[myIndex])}`
      : role === 'approver'
        ? `${total - released} of ${total} milestones left to release`
        : `${formatUsdc(grant.releasedAmount)} of ${formatUsdc(grant.totalAmount)} USDC released`

  return (
    <li>
      <Link to={`/grant/${id}`} className="flex min-h-14 items-center justify-between gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-white/80">
        <div className="min-w-0">
          <p className="truncate font-semibold">{grant.title}</p>
          <p className="truncate text-xs tabular-nums" style={{ color: 'var(--muted)' }}>
            #{id.toString()} · {detail}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={status.cls}>{status.label}</span>
          <ChevronRight className="size-4" style={{ color: 'var(--subtle)' }} />
        </div>
      </Link>
    </li>
  )
}

export default function Payouts() {
  const { address, isConnected } = useAccount()
  const queryClient = useQueryClient()
  const tx = useTx()
  const now = useNow()
  const [error, setError] = useState<string | null>(null)
  const [claiming, setClaiming] = useState(false)

  const claimableQuery = useQuery({
    queryKey: ['claimable', address],
    queryFn: () => fetchClaimable(address!),
    enabled: Boolean(address),
    refetchInterval: 15_000,
  })
  const grantsQuery = useQuery({
    queryKey: ['my-grants', address],
    queryFn: () => fetchMyGrants(address!),
    enabled: Boolean(address),
    refetchInterval: 30_000,
  })

  if (!isConnected || !address) {
    return (
      <Empty title="See what you can claim">
        <p>Connect your wallet to see claimable USDC and the grants you fund, approve, or are paid by.</p>
        <div className="mt-4 flex justify-center">
          <ConnectKitButton />
        </div>
      </Empty>
    )
  }

  const claimable = claimableQuery.data
  const claim = async () => {
    setError(null)
    setClaiming(true)
    try {
      await tx.claim()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['claimable'] }),
        queryClient.invalidateQueries({ queryKey: ['my-grants'] }),
      ])
    } catch (e) {
      setError(describeError(e))
    } finally {
      setClaiming(false)
    }
  }

  const grants = grantsQuery.data ?? []

  return (
    <div className="space-y-5">
      <section className="card p-5 sm:p-6">
        <p className="label">Claimable now</p>
        {claimable === undefined ? (
          <Skeleton className="h-10 w-48" />
        ) : (
          <UsdcAmount value={formatUsdc(claimable)} size="xl" />
        )}
        <p className="mt-1 text-sm text-pretty" style={{ color: 'var(--muted)' }}>
          Released milestones from every grant, paid out in one withdrawal.
        </p>
        <div className="mt-4">
          <button type="button" className="btn btn-primary w-full sm:w-auto" disabled={!claimable || tx.busy} onClick={() => void claim()}>
            {claiming ? stageLabel(tx.stage, 'Claiming…') : claimable ? `Claim ${formatUsdc(claimable)} USDC` : 'Nothing to claim'}
          </button>
        </div>
        <div className="mt-3"><ErrorNote message={error} /></div>
      </section>

      {grantsQuery.isPending && (
        <div className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      )}
      {grantsQuery.isError && <ErrorNote message="Could not load your grants. Check your connection and refresh." />}

      {grantsQuery.isSuccess && grants.length === 0 && (
        <Empty title="No grants yet">
          Grants you fund, approve, or are paid by will show up here.{' '}
          <Link to="/" className="font-semibold underline" style={{ color: 'var(--accent)' }}>Create one</Link>.
        </Empty>
      )}

      {SECTIONS.map(({ role, title, hint }) => {
        const rows = grants.filter((g) => g.roles.has(role))
        if (rows.length === 0) return null
        return (
          <section key={role} className="card p-3 sm:p-4">
            <div className="px-3 pb-1 pt-2">
              <h2 className="display text-lg font-semibold">{title}</h2>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>{hint}</p>
            </div>
            <ul>
              {rows.map((entry) => (
                <GrantRow key={entry.id.toString()} entry={entry} role={role} address={address} now={now} />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
