import { getAddress, isAddress, zeroAddress, type Address } from 'viem'
import { BPS, parsePercentToBps, parseUsdc } from './format'
import { MAX_NAME_LENGTH } from './milestoneNames'

export const MAX_ROWS = 10
export const MAX_TITLE_BYTES = 100
const MIN_LEAD_SECONDS = 120

export interface RecipientRow {
  id: string
  address: string
  percent: string
}

export interface MilestoneRow {
  id: string
  name: string
  amount: string
}

export interface GrantFormInput {
  title: string
  approver: string
  recipients: RecipientRow[]
  milestones: MilestoneRow[]
  deadline: string
  nowSeconds: number
}

export interface ParsedGrant {
  title: string
  approver: Address
  recipients: Address[]
  sharesBps: bigint[]
  amounts: bigint[]
  names: string[]
  deadline: bigint
  total: bigint
}

export interface GrantFormState {
  titleError?: string
  approverError?: string
  recipientErrors: (string | undefined)[]
  milestoneErrors: (string | undefined)[]
  sharesTotal: bigint
  sharesError?: string
  deadlineError?: string
  parsed?: ParsedGrant
}

export const newId = () => crypto.randomUUID()

/** Value for a datetime-local input, `days` from now in the user's timezone. */
export function deadlineInDays(days: number): string {
  const date = new Date(Date.now() + days * 86_400_000)
  date.setSeconds(0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function validateGrant(input: GrantFormInput): GrantFormState {
  const title = input.title.trim()
  const titleBytes = new TextEncoder().encode(title).length
  const titleError =
    title.length === 0 ? 'Add a title.' : titleBytes > MAX_TITLE_BYTES ? `Keep the title under ${MAX_TITLE_BYTES} bytes.` : undefined

  const approver = input.approver.trim()
  const approverError =
    approver.length === 0
      ? 'Add an approver address.'
      : !isAddress(approver) || approver.toLowerCase() === zeroAddress
        ? 'Enter a valid address.'
        : undefined

  const seen = new Set<string>()
  const recipientAddresses: Address[] = []
  const sharesBps: bigint[] = []
  let sharesTotal = 0n
  const recipientErrors = input.recipients.map((row) => {
    const address = row.address.trim()
    const bps = parsePercentToBps(row.percent)
    if (bps !== null) sharesTotal += bps
    if (!isAddress(address) || address.toLowerCase() === zeroAddress) return 'Enter a valid recipient address.'
    const key = address.toLowerCase()
    if (seen.has(key)) return 'This address is already listed.'
    seen.add(key)
    if (bps === null) return 'Share must be between 0.01% and 100%, up to 2 decimals.'
    recipientAddresses.push(getAddress(address))
    sharesBps.push(bps)
    return undefined
  })
  const sharesError = sharesTotal === BPS ? undefined : 'Shares must total exactly 100%.'

  const amounts: bigint[] = []
  const names: string[] = []
  const milestoneErrors = input.milestones.map((row) => {
    const name = row.name.trim()
    const amount = parseUsdc(row.amount)
    if (name.length === 0) return 'Name this milestone.'
    if (name.length > MAX_NAME_LENGTH) return `Keep the name under ${MAX_NAME_LENGTH} characters.`
    if (amount === null) return 'Enter an amount above 0, up to 6 decimals.'
    names.push(name)
    amounts.push(amount)
    return undefined
  })

  const deadlineMs = input.deadline ? new Date(input.deadline).getTime() : Number.NaN
  const deadlineSeconds = Math.floor(deadlineMs / 1000)
  const deadlineError = Number.isNaN(deadlineMs)
    ? 'Pick a deadline.'
    : deadlineSeconds < input.nowSeconds + MIN_LEAD_SECONDS
      ? 'The deadline must be at least a couple of minutes from now.'
      : undefined

  const valid =
    !titleError &&
    !approverError &&
    !sharesError &&
    !deadlineError &&
    recipientErrors.every((e) => !e) &&
    milestoneErrors.every((e) => !e) &&
    input.recipients.length > 0 &&
    input.milestones.length > 0

  return {
    titleError,
    approverError,
    recipientErrors,
    milestoneErrors,
    sharesTotal,
    sharesError,
    deadlineError,
    parsed: valid
      ? {
          title,
          approver: getAddress(approver),
          recipients: recipientAddresses,
          sharesBps,
          amounts,
          names,
          deadline: BigInt(deadlineSeconds),
          total: amounts.reduce((sum, a) => sum + a, 0n),
        }
      : undefined,
  }
}
