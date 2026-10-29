import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { Check, Clock, Copy, Share2 } from 'lucide-react'
import { fetchGrant, fetchGrantEvents, type Grant } from '@/lib/chain'
import { formatCountdown, formatDeadline, formatPercent, formatUsdc, describeError, splitMilestone } from '@/lib/format'
import { loadNames, namesQuery, saveNames } from '@/lib/milestoneNames'
import { buildShareLink } from '@/lib/share'
import { useNow } from '@/hooks/useNow'
import { useTx } from '@/hooks/useTx'
import { AddressLink, Empty, ErrorNote, Skeleton, TxLink, UsdcAmount, stageLabel } from './ui'
import FunderPanel from './FunderPanel'

type MilestoneStatus = 'released' | 'pending' | 'expired' | 'refunded'

function statusOf(grant: Grant, index: number, now: number): MilestoneStatus {
  if (grant.released[index]) return 'released'
  if (grant.refunded) return 'refunded'
  return now >= Number(grant.deadline) ? 'expired' : 'pending'
}

const STATUS_LABEL: Record<MilestoneStatus, string> = {
  released: 'Released',
  pending: 'Pending',
  expired: 'Not released',
  refunded: 'Refunded',
}

const STATUS_CLASS: Record<MilestoneStatus, string> = {
  released: 'pill pill-ok',
  pending: 'pill pill-accent',
  expired: 'pill pill-bad',
  refunded: 'pill',
}

export default function GrantPage() {
  const { id = '' } = useParams()
  const [search] = useSearchParams()
  const queryClient = useQueryClient()
  const { address } = useAccount()
  const tx = useTx()
  const now = useNow()
  const validId = /^\d+$/.test(id)
  const grantId = validId ? BigInt(id) : 0n

  const grantQuery = useQuery({
    queryKey: ['grant', id],
    queryFn: () => fetchGrant(grantId),
    enabled: validId,
    retry: false,
    refetchInterval: 20_000,
  })
  const eventsQuery = useQuery({
    queryKey: ['grant-events', id],
    queryFn: () => fetchGrantEvents(grantId),
    enabled: validId && grantQuery.isSuccess,
    refetchInterval: 30_000,
  })

  const names = useMemo(() => loadNames(id, search.get('m')), [id, search])
  useEffect(() => {
    const fromLink = search.get('m')
    if (fromLink) saveNames(id, loadNames(id, fromLink))
  }, [id, search])

  const [shareLink, setShareLink] = useState<string>()
  const [copied, setCopied] = useState(false)
  const [releasing, setReleasing] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void buildShareLink(`/grant/${id}${namesQuery(names)}`).then((link) => {
      if (live) setShareLink(link)
    })
    return () => {
      live = false
    }
  }, [id, names])

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['grant', id] }),
      queryClient.invalidateQueries({ queryKey: ['grant-events', id] }),
      queryClient.invalidateQueries({ queryKey: ['my-grants'] }),
      queryClient.invalidateQueries({ queryKey: ['claimable'] }),
    ])

  if (!validId) return <Empty title="Grant not found">That link does not point to a grant.</Empty>
  if (grantQuery.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40" />
        <Skeleton className="h-64" />
      </div>
    )
  }
  if (grantQuery.isError) {
    return (
      <Empty title="Grant not found">
        There is no grant #{id} on this contract yet. Check the link, or{' '}
        <Link to="/" className="font-semibold underline" style={{ color: 'var(--accent)' }}>create a new grant</Link>.
      </Empty>
    )
  }

  const grant = grantQuery.data
  const me = address?.toLowerCase()
  const isApprover = me === grant.approver.toLowerCase()
  const isFunder = me === grant.funder.toLowerCase()
  const pastDeadline = now >= Number(grant.deadline)
  const canRelease = isApprover && !pastDeadline && !grant.refunded
  const unreleased = grant.totalAmount - grant.releasedAmount
  const pct = grant.totalAmount > 0n ? Number((grant.releasedAmount * 10_000n) / grant.totalAmount) / 10_000 : 0
  const allReleased = unreleased === 0n
  const events = eventsQuery.data

  const release = async (index: number) => {
    setError(null)
    setReleasing(index)
    try {
      await tx.releaseMilestone(grantId, BigInt(index))
      await refresh()
    } catch (e) {
      setError(describeError(e))
    } finally {
      setReleasing(null)
    }
  }

  const copy = async () => {
    if (!shareLink) return
    try {
      await navigator.clipboard.writeText(shareLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('Could not copy automatically. Select the link and copy it manually.')
    }
  }

  const heroStatus = grant.refunded ? 'Refunded' : allReleased ? 'Fully released' : pastDeadline ? 'Past deadline' : 'Active'
  const heroClass = grant.refunded ? 'pill' : allReleased ? 'pill pill-ok' : pastDeadline ? 'pill pill-bad' : 'pill pill-accent'

  const perRecipientReleased = grant.recipients.map(() => 0n)
  const perRecipientTotal = grant.recipients.map(() => 0n)
  grant.amounts.forEach((amount, m) => {
    splitMilestone(amount, grant.sharesBps).forEach((share, r) => {
      perRecipientTotal[r] += share
      if (grant.released[m]) perRecipientReleased[r] += share
    })
  })

  return (
    <div className="space-y-5">
      <section className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="label !mb-1">Grant #{id}</p>
            <h1 className="display text-balance text-2xl font-bold sm:text-3xl">{grant.title}</h1>
          </div>
          <span className={heroClass}>{heroStatus}</span>
        </div>

        <div className="mt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <UsdcAmount value={formatUsdc(grant.releasedAmount)} size="xl" />
            <span className="text-sm tabular-nums" style={{ color: 'var(--muted)' }}>of {formatUsdc(grant.totalAmount)} USDC released</span>
          </div>
          <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--surface-muted)' }}
            role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)} aria-label="Released versus total">
            <div className="h-full origin-left rounded-full transition-transform duration-500" style={{ background: 'var(--accent)', transform: `scaleX(${pct})` }} />
          </div>
        </div>

        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="label !mb-0.5">Funder</dt>
            <dd><AddressLink address={grant.funder} you={isFunder} /></dd>
          </div>
          <div>
            <dt className="label !mb-0.5">Approver</dt>
            <dd><AddressLink address={grant.approver} you={isApprover} /></dd>
          </div>
          <div>
            <dt className="label !mb-0.5">Deadline</dt>
            <dd className="tabular-nums">
              {formatDeadline(grant.deadline)}
              <span className="ml-2 inline-flex items-center gap-1 text-xs" style={{ color: pastDeadline ? 'var(--danger)' : 'var(--muted)' }}>
                <Clock className="size-3" /> {formatCountdown(grant.deadline, now)}
              </span>
            </dd>
          </div>
        </dl>

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
          <button type="button" className="btn btn-ghost btn-sm" disabled={!shareLink} onClick={() => void copy()}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? 'Copied' : 'Copy link'}
          </button>
          {typeof navigator.share === 'function' && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={!shareLink}
              onClick={() => {
                if (shareLink) void navigator.share({ title: grant.title, url: shareLink }).catch(() => undefined)
              }}>
              <Share2 className="size-4" /> Share
            </button>
          )}
          {events?.createdTx && <TxLink hash={events.createdTx} label="Funding tx" />}
        </div>
      </section>

      <section className="card p-5 sm:p-6">
        <h2 className="display mb-3 text-lg font-semibold">Milestones</h2>
        <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
          {grant.amounts.map((amount, index) => {
            const status = statusOf(grant, index, now)
            const releaseTx = events?.releaseTxs.get(index)
            return (
              <li key={index} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0" style={{ borderColor: 'var(--border)' }}>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{names[index] || `Milestone ${index + 1}`}</p>
                  <p className="text-sm tabular-nums" style={{ color: 'var(--muted)' }}>{formatUsdc(amount)} USDC</p>
                </div>
                <div className="flex items-center gap-3">
                  {status === 'released' && (releaseTx ? <TxLink hash={releaseTx} label="Release tx" /> : eventsQuery.isPending ? <span className="text-xs" style={{ color: 'var(--subtle)' }}>Finding tx…</span> : null)}
                  <span className={STATUS_CLASS[status]}>{STATUS_LABEL[status]}</span>
                  {canRelease && status === 'pending' && (
                    <button type="button" className="btn btn-primary btn-sm" disabled={tx.busy}
                      onClick={() => void release(index)}>
                      {releasing === index ? stageLabel(tx.stage, 'Releasing…') : 'Release'}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
        {isApprover && !canRelease && !allReleased && (
          <p className="mt-3 text-sm" style={{ color: 'var(--muted)' }}>
            {grant.refunded ? 'This grant was refunded.' : 'The deadline has passed, so milestones can no longer be released.'}
          </p>
        )}
        {!address && !allReleased && !pastDeadline && (
          <p className="mt-3 text-sm" style={{ color: 'var(--muted)' }}>Connect the approver wallet to release milestones.</p>
        )}
        <div className="mt-3"><ErrorNote message={error} /></div>
      </section>

      <section className="card overflow-hidden p-5 sm:p-6">
        <h2 className="display mb-3 text-lg font-semibold">Team split</h2>
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead>
              <tr className="label">
                <th className="pb-2 font-semibold">Recipient</th>
                <th className="pb-2 text-right font-semibold">Share</th>
                <th className="pb-2 text-right font-semibold">Released</th>
                <th className="pb-2 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {grant.recipients.map((recipient, r) => (
                <tr key={recipient} className="border-t tabular-nums" style={{ borderColor: 'var(--border)' }}>
                  <td className="py-2.5"><AddressLink address={recipient} you={me === recipient.toLowerCase()} /></td>
                  <td className="py-2.5 text-right">{formatPercent(grant.sharesBps[r])}</td>
                  <td className="py-2.5 text-right">{formatUsdc(perRecipientReleased[r])}</td>
                  <td className="py-2.5 text-right font-semibold">{formatUsdc(perRecipientTotal[r])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs" style={{ color: 'var(--subtle)' }}>
          Amounts in USDC. Any rounding leftover on a release goes to the first recipient. Recipients withdraw from My payouts.
        </p>
      </section>

      {isFunder && (
        <FunderPanel
          grantId={grantId}
          grant={grant}
          pastDeadline={pastDeadline}
          unreleased={unreleased}
          refundEvent={events?.refund}
          onDone={refresh}
        />
      )}
      {!isFunder && grant.refunded && events?.refund && (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          {formatUsdc(events.refund.amount)} USDC was refunded to the funder. <TxLink hash={events.refund.tx} label="Refund tx" />
        </p>
      )}
    </div>
  )
}
