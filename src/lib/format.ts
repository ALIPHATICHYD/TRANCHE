import { BaseError, ContractFunctionRevertedError, formatUnits, parseUnits } from 'viem'
import { USDC_DECIMALS } from './env'

export const BPS = 10_000n

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/** Formats a raw 6-decimal USDC amount: grouped integer part, 2 to 6 decimals. */
export function formatUsdc(raw: bigint): string {
  const [whole, fraction = ''] = formatUnits(raw, USDC_DECIMALS).split('.')
  const trimmed = fraction.replace(/0+$/, '').padEnd(2, '0')
  const grouped = BigInt(whole).toLocaleString('en-US')
  return `${grouped}.${trimmed}`
}

/** Parses a user-typed USDC amount. Returns null when empty, malformed, zero, or over 6 decimals. */
export function parseUsdc(input: string): bigint | null {
  const value = input.trim()
  if (!/^\d+(\.\d{1,6})?$/.test(value)) return null
  const raw = parseUnits(value, USDC_DECIMALS)
  return raw > 0n ? raw : null
}

/** Parses a percent such as "33.33" into basis points (max 2 decimals). */
export function parsePercentToBps(input: string): bigint | null {
  const value = input.trim()
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(value)) return null
  const [whole, fraction = ''] = value.split('.')
  const bps = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  return bps > 0n && bps <= BPS ? bps : null
}

export function formatPercent(bps: bigint): string {
  const whole = bps / 100n
  const fraction = (bps % 100n).toString().padStart(2, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}%` : `${whole}%`
}

/** Even split in basis points, with the remainder spread one bp at a time from the first row. */
export function evenBps(count: number): bigint[] {
  if (count <= 0) return []
  const n = BigInt(count)
  const base = BPS / n
  const extra = Number(BPS % n)
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1n : 0n))
}

export function bpsToPercentInput(bps: bigint): string {
  const whole = bps / 100n
  const fraction = (bps % 100n).toString().padStart(2, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : `${whole}`
}

/** Mirrors the contract: floor(amount * bps / 10000) per recipient, rounding dust to the first. */
export function splitMilestone(amount: bigint, sharesBps: readonly bigint[]): bigint[] {
  const shares = sharesBps.map((bps) => (amount * bps) / BPS)
  const credited = shares.reduce((sum, share) => sum + share, 0n)
  if (shares.length > 0) shares[0] += amount - credited
  return shares
}

export function formatDeadline(deadline: bigint): string {
  return new Date(Number(deadline) * 1000).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function formatCountdown(deadline: bigint, nowSeconds: number): string {
  const diff = Number(deadline) - nowSeconds
  const abs = Math.abs(diff)
  const days = Math.floor(abs / 86_400)
  const hours = Math.floor((abs % 86_400) / 3_600)
  const minutes = Math.floor((abs % 3_600) / 60)
  const span = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes}m` : `${Math.max(minutes, 1)}m`
  return diff > 0 ? `${span} left` : `${span} ago`
}

const REVERT_MESSAGES: Record<string, string> = {
  NotApprover: 'Only the approver can release milestones.',
  NotFunder: 'Only the funder can do that.',
  DeadlineReached: 'The deadline has passed, so milestones can no longer be released.',
  DeadlineNotReached: 'Refunds open once the deadline has passed.',
  MilestoneAlreadyReleased: 'That milestone was already released.',
  GrantAlreadyRefunded: 'This grant has already been refunded.',
  NothingToRefund: 'Every milestone was released, so there is nothing to refund.',
  NothingToClaim: 'You have nothing to claim right now.',
  ZeroAddress: 'An address cannot be the zero address.',
  GrantNotFound: 'That grant does not exist.',
}

/** Turns wallet and RPC errors into one short, actionable sentence. Returns null for a user rejection. */
export function describeError(error: unknown): string | null {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  if (message.includes('user rejected') || message.includes('user denied') || message.includes('rejected the request')) {
    return null
  }
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError)
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName
      if (name && REVERT_MESSAGES[name]) return REVERT_MESSAGES[name]
      if (name) return `The contract rejected this: ${name}.`
    }
  }
  if (message.includes('insufficient funds') || message.includes('exceeds balance')) {
    return 'Not enough USDC for this transaction. Use Get test USDC in the sidebar, then try again.'
  }
  if (message.includes('network') || message.includes('timeout') || message.includes('fetch')) {
    return 'Network issue. Check your connection and try again.'
  }
  return 'Something went wrong. Please try again.'
}
