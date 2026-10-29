import { useMemo, useState } from 'react'
import { ConnectKitButton } from 'connectkit'
import { useNavigate } from 'react-router-dom'
import { erc20Abi } from 'viem'
import { useAccount, useReadContract } from 'wagmi'
import { Check, Plus, Trash2 } from 'lucide-react'
import { publicClient } from '@/lib/chain'
import { CHAIN, TRANCHE_ADDRESS, USDC_ADDRESS } from '@/lib/env'
import { bpsToPercentInput, describeError, evenBps, formatPercent, formatUsdc } from '@/lib/format'
import {
  MAX_ROWS,
  deadlineInDays,
  newId,
  validateGrant,
  type MilestoneRow,
  type RecipientRow,
} from '@/lib/grantForm'
import { MAX_NAME_LENGTH, namesQuery, saveNames } from '@/lib/milestoneNames'
import { useNow } from '@/hooks/useNow'
import { useTx } from '@/hooks/useTx'
import { ErrorNote, UsdcAmount, stageLabel } from './ui'

type Step = 'idle' | 'approve' | 'create'

const blankRecipient = (): RecipientRow => ({ id: newId(), address: '', percent: '' })
const blankMilestone = (): MilestoneRow => ({ id: newId(), name: '', amount: '' })

function FieldError({ message, show }: { message?: string; show: boolean }) {
  if (!show || !message) return null
  return (
    <p className="mt-1 text-xs" style={{ color: 'var(--danger)' }}>
      {message}
    </p>
  )
}

export default function NewGrant() {
  const navigate = useNavigate()
  const { address, isConnected, chainId } = useAccount()
  const tx = useTx()
  const now = useNow()

  const [title, setTitle] = useState('')
  const [approverEdit, setApproverEdit] = useState<string | null>(null)
  const [recipients, setRecipients] = useState<RecipientRow[]>([blankRecipient(), blankRecipient()])
  const [milestones, setMilestones] = useState<MilestoneRow[]>([blankMilestone()])
  const [deadline, setDeadline] = useState(() => deadlineInDays(30))
  const [touched, setTouched] = useState(false)
  const [step, setStep] = useState<Step>('idle')
  const [error, setError] = useState<string | null>(null)

  const approver = approverEdit ?? address ?? ''
  const form = useMemo(
    () => validateGrant({ title, approver, recipients, milestones, deadline, nowSeconds: now }),
    [title, approver, recipients, milestones, deadline, now],
  )
  const total = form.parsed?.total ?? 0n

  const { data: balance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: CHAIN.id,
    query: { enabled: Boolean(address) },
  })
  const insufficient = balance !== undefined && total > balance

  const updateRecipient = (id: string, patch: Partial<RecipientRow>) =>
    setRecipients((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const updateMilestone = (id: string, patch: Partial<MilestoneRow>) =>
    setMilestones((rows) => rows.map((m) => (m.id === id ? { ...m, ...patch } : m)))

  const splitEvenly = () => {
    const shares = evenBps(recipients.length)
    setRecipients((rows) => rows.map((r, i) => ({ ...r, percent: bpsToPercentInput(shares[i]) })))
  }

  const submit = async () => {
    setTouched(true)
    setError(null)
    const parsed = form.parsed
    if (!parsed || !address || insufficient) return
    try {
      const allowance = await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, TRANCHE_ADDRESS],
      })
      if (allowance < parsed.total) {
        setStep('approve')
        await tx.approveUsdc(parsed.total)
      }
      setStep('create')
      const { grantId } = await tx.createGrant({
        approver: parsed.approver,
        recipients: parsed.recipients,
        sharesBps: parsed.sharesBps,
        amounts: parsed.amounts,
        deadline: parsed.deadline,
        title: parsed.title,
      })
      saveNames(grantId.toString(), parsed.names)
      await navigate(`/grant/${grantId}${namesQuery(parsed.names)}`)
    } catch (e) {
      setError(describeError(e))
    } finally {
      setStep('idle')
    }
  }

  const sharesOk = form.sharesTotal === 10_000n
  const wrongChain = isConnected && chainId !== CHAIN.id
  const submitting = step !== 'idle'

  return (
    <div className="space-y-5">
      <div>
        <h1 className="display text-balance text-3xl font-bold sm:text-4xl">New grant</h1>
        <p className="mt-1 max-w-xl text-pretty text-sm" style={{ color: 'var(--muted)' }}>
          Lock USDC in milestones. The approver releases each one, and the team claims what has been released.
        </p>
      </div>

      <section className="card space-y-4 p-5">
        <div>
          <label className="label" htmlFor="title">Title</label>
          <input id="title" className="field" placeholder="Season 2 community fund" value={title} maxLength={100}
            aria-invalid={touched && Boolean(form.titleError)} onChange={(e) => setTitle(e.target.value)} />
          <FieldError message={form.titleError} show={touched} />
        </div>
        <div>
          <label className="label" htmlFor="approver">Approver</label>
          <input id="approver" className="field mono text-[13px]" placeholder="0x…" value={approver} spellCheck={false}
            aria-invalid={touched && Boolean(form.approverError)} onChange={(e) => setApproverEdit(e.target.value)} />
          <p className="mt-1 text-xs" style={{ color: 'var(--subtle)' }}>
            Only this address can release milestones. Defaults to your connected wallet.
          </p>
          <FieldError message={form.approverError} show={touched} />
        </div>
      </section>

      <section className="card p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="display text-lg font-semibold">Team split</h2>
          <span className={`pill ${sharesOk ? 'pill-ok' : 'pill-accent'} tabular-nums`}>
            {formatPercent(form.sharesTotal)} of 100%
          </span>
        </div>
        <div className="space-y-3">
          {recipients.map((row, i) => (
            <div key={row.id}>
              <div className="flex items-start gap-2">
                <input aria-label={`Recipient ${i + 1} address`} className="field mono min-w-0 flex-1 text-[13px]" placeholder="0x… recipient"
                  value={row.address} spellCheck={false} aria-invalid={touched && Boolean(form.recipientErrors[i])}
                  onChange={(e) => updateRecipient(row.id, { address: e.target.value })} />
                <div className="relative w-24 shrink-0">
                  <input aria-label={`Recipient ${i + 1} share`} inputMode="decimal" className="field pr-7 text-right tabular-nums" placeholder="0"
                    value={row.percent} aria-invalid={touched && Boolean(form.recipientErrors[i])}
                    onChange={(e) => updateRecipient(row.id, { percent: e.target.value.replace(/[^0-9.]/g, '') })} />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: 'var(--subtle)' }}>%</span>
                </div>
                <button type="button" aria-label={`Remove recipient ${i + 1}`} className="btn btn-ghost size-11 shrink-0 !p-0"
                  disabled={recipients.length === 1} onClick={() => setRecipients((rows) => rows.filter((r) => r.id !== row.id))}>
                  <Trash2 className="size-4" />
                </button>
              </div>
              <FieldError message={form.recipientErrors[i]} show={touched} />
            </div>
          ))}
        </div>
        <FieldError message={form.sharesError} show={touched} />
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn btn-ghost btn-sm" disabled={recipients.length >= MAX_ROWS}
            onClick={() => setRecipients((rows) => [...rows, blankRecipient()])}>
            <Plus className="size-4" /> Add recipient
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={splitEvenly}>Split evenly</button>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="display mb-3 text-lg font-semibold">Milestones</h2>
        <div className="space-y-3">
          {milestones.map((row, i) => (
            <div key={row.id}>
              <div className="flex items-start gap-2">
                <input aria-label={`Milestone ${i + 1} name`} className="field min-w-0 flex-1" placeholder={`Milestone ${i + 1} name`}
                  value={row.name} maxLength={MAX_NAME_LENGTH} aria-invalid={touched && Boolean(form.milestoneErrors[i])}
                  onChange={(e) => updateMilestone(row.id, { name: e.target.value })} />
                <div className="relative w-32 shrink-0">
                  <input aria-label={`Milestone ${i + 1} amount in USDC`} inputMode="decimal" className="field pr-14 text-right tabular-nums" placeholder="0.00"
                    value={row.amount} aria-invalid={touched && Boolean(form.milestoneErrors[i])}
                    onChange={(e) => updateMilestone(row.id, { amount: e.target.value.replace(/[^0-9.]/g, '') })} />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: 'var(--subtle)' }}>USDC</span>
                </div>
                <button type="button" aria-label={`Remove milestone ${i + 1}`} className="btn btn-ghost size-11 shrink-0 !p-0"
                  disabled={milestones.length === 1} onClick={() => setMilestones((rows) => rows.filter((m) => m.id !== row.id))}>
                  <Trash2 className="size-4" />
                </button>
              </div>
              <FieldError message={form.milestoneErrors[i]} show={touched} />
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-ghost btn-sm mt-3" disabled={milestones.length >= MAX_ROWS}
          onClick={() => setMilestones((rows) => [...rows, blankMilestone()])}>
          <Plus className="size-4" /> Add milestone
        </button>
      </section>

      <section className="card p-5">
        <label className="label" htmlFor="deadline">Deadline</label>
        <input id="deadline" type="datetime-local" className="field" value={deadline} aria-invalid={touched && Boolean(form.deadlineError)}
          onChange={(e) => setDeadline(e.target.value)} />
        <div className="mt-2 flex flex-wrap gap-2">
          {[7, 30, 90].map((days) => (
            <button key={days} type="button" className="btn btn-ghost btn-sm" onClick={() => setDeadline(deadlineInDays(days))}>
              +{days} days
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs" style={{ color: 'var(--subtle)' }}>
          Milestones can be released until the deadline. After it, you can refund whatever was not released.
        </p>
        <FieldError message={form.deadlineError} show={touched} />
      </section>

      <section className="card space-y-4 p-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="label !mb-1">You deposit</p>
            <UsdcAmount value={formatUsdc(total)} size="xl" />
          </div>
          {balance !== undefined && (
            <p className="text-right text-xs tabular-nums" style={{ color: insufficient ? 'var(--danger)' : 'var(--muted)' }}>
              Balance {formatUsdc(balance)} USDC
            </p>
          )}
        </div>

        {submitting && (
          <ol className="space-y-2 text-sm" aria-label="Progress">
            <li className="flex items-center gap-2" style={{ color: step === 'approve' ? 'var(--ink)' : 'var(--muted)' }}>
              {step === 'create' ? <Check className="size-4" style={{ color: 'var(--success)' }} /> : <span className="size-4 text-center">1</span>}
              Approve USDC
            </li>
            <li className="flex items-center gap-2" style={{ color: step === 'create' ? 'var(--ink)' : 'var(--muted)' }}>
              <span className="size-4 text-center">2</span> Create grant
            </li>
          </ol>
        )}

        <ErrorNote message={error ?? (insufficient ? 'Your USDC balance is lower than the total. Use Get test USDC in the sidebar.' : null)} />

        {!isConnected ? (
          <ConnectKitButton.Custom>
            {({ show }) => (
              <button type="button" className="btn btn-primary w-full" onClick={show}>Connect wallet</button>
            )}
          </ConnectKitButton.Custom>
        ) : (
          <button type="button" className="btn btn-primary w-full" disabled={submitting || tx.busy || insufficient || (touched && !form.parsed)}
            onClick={() => void submit()}>
            {wrongChain
              ? `Switch to ${CHAIN.name} and continue`
              : submitting
                ? stageLabel(tx.stage, step === 'approve' ? 'Approving…' : 'Creating…')
                : 'Approve USDC and create grant'}
          </button>
        )}
        <p className="text-center text-xs" style={{ color: 'var(--subtle)' }}>
          Two wallet confirmations: approve USDC, then create the grant.
        </p>
      </section>
    </div>
  )
}
