import { useState } from 'react'
import { getAddress, isAddress, zeroAddress, type Hash } from 'viem'
import type { Grant } from '@/lib/chain'
import { describeError, formatUsdc } from '@/lib/format'
import { useTx } from '@/hooks/useTx'
import { ErrorNote, TxLink, stageLabel } from './ui'

interface Props {
  grantId: bigint
  grant: Grant
  pastDeadline: boolean
  unreleased: bigint
  refundEvent?: { tx: Hash; amount: bigint }
  onDone: () => Promise<unknown>
}

type Action = 'refund' | 'approver' | null

export default function FunderPanel({ grantId, grant, pastDeadline, unreleased, refundEvent, onDone }: Props) {
  const tx = useTx()
  const [action, setAction] = useState<Action>(null)
  const [error, setError] = useState<string | null>(null)
  const [newApprover, setNewApprover] = useState('')

  const canRefund = pastDeadline && !grant.refunded && unreleased > 0n
  const approverValid = isAddress(newApprover.trim()) && newApprover.trim().toLowerCase() !== zeroAddress
  const sameApprover = approverValid && getAddress(newApprover.trim()) === grant.approver

  const run = async (which: Exclude<Action, null>, send: () => Promise<unknown>) => {
    setError(null)
    setAction(which)
    try {
      await send()
      setNewApprover('')
      await onDone()
    } catch (e) {
      setError(describeError(e))
    } finally {
      setAction(null)
    }
  }

  return (
    <section className="card space-y-4 p-5 sm:p-6">
      <h2 className="display text-lg font-semibold">Funder controls</h2>

      <div>
        {grant.refunded ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Refunded {refundEvent ? `${formatUsdc(refundEvent.amount)} USDC` : 'the unreleased milestones'} to you.{' '}
            {refundEvent && <TxLink hash={refundEvent.tx} label="Refund tx" />}
          </p>
        ) : (
          <>
            <button type="button" className="btn btn-primary w-full sm:w-auto" disabled={!canRefund || tx.busy}
              onClick={() => void run('refund', () => tx.refund(grantId))}>
              {action === 'refund' ? stageLabel(tx.stage, 'Refunding…') : `Refund ${formatUsdc(unreleased)} USDC`}
            </button>
            <p className="mt-2 text-xs" style={{ color: 'var(--subtle)' }}>
              {unreleased === 0n
                ? 'Every milestone was released, so there is nothing to refund.'
                : pastDeadline
                  ? 'Returns the milestones that were not released. Released funds stay claimable by the team.'
                  : 'Refunds open once the deadline has passed.'}
            </p>
          </>
        )}
      </div>

      {!grant.refunded && (
        <div className="border-t pt-4" style={{ borderColor: 'var(--border)' }}>
          <label className="label" htmlFor="new-approver">Change approver</label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input id="new-approver" className="field mono text-[13px]" placeholder="0x… new approver" spellCheck={false}
              value={newApprover} onChange={(e) => setNewApprover(e.target.value)} />
            <button type="button" className="btn btn-ghost shrink-0" disabled={!approverValid || sameApprover || tx.busy}
              onClick={() => void run('approver', () => tx.changeApprover(grantId, getAddress(newApprover.trim())))}>
              {action === 'approver' ? stageLabel(tx.stage, 'Updating…') : 'Update'}
            </button>
          </div>
          {sameApprover && <p className="mt-1 text-xs" style={{ color: 'var(--subtle)' }}>That address is already the approver.</p>}
        </div>
      )}

      <ErrorNote message={error} />
    </section>
  )
}
