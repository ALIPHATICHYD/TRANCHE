import { createPublicClient, http, type Address, type Hash } from 'viem'
import { CHAIN, DEPLOY_BLOCK, TRANCHE_ADDRESS } from './env'
import { trancheAbi } from './trancheAbi'

/** Read-only client, independent of any wallet, so public pages work when disconnected. */
export const publicClient = createPublicClient({ chain: CHAIN, transport: http() })

export async function fetchGrant(grantId: bigint) {
  return publicClient.readContract({
    address: TRANCHE_ADDRESS,
    abi: trancheAbi,
    functionName: 'getGrant',
    args: [grantId],
  })
}

export type Grant = Awaited<ReturnType<typeof fetchGrant>>

export async function fetchClaimable(account: Address): Promise<bigint> {
  return publicClient.readContract({
    address: TRANCHE_ADDRESS,
    abi: trancheAbi,
    functionName: 'claimable',
    args: [account],
  })
}

/**
 * Scans [DEPLOY_BLOCK, head] in bounded ranges, halving the range when the RPC rejects it.
 * Never starts at block 0.
 */
async function scan<T>(run: (from: bigint, to: bigint) => Promise<T[]>): Promise<T[]> {
  const head = await publicClient.getBlockNumber()
  const out: T[] = []
  let from = DEPLOY_BLOCK
  let span = 50_000n
  while (from <= head) {
    const to = from + span - 1n > head ? head : from + span - 1n
    try {
      out.push(...(await run(from, to)))
      from = to + 1n
    } catch (error) {
      if (span <= 500n) throw error
      span = span / 2n
    }
  }
  return out
}

export interface GrantEvents {
  createdTx?: Hash
  releaseTxs: Map<number, Hash>
  refund?: { tx: Hash; amount: bigint }
}

export async function fetchGrantEvents(grantId: bigint): Promise<GrantEvents> {
  const [created, released, refunded] = await Promise.all([
    scan((fromBlock, toBlock) =>
      publicClient.getContractEvents({
        address: TRANCHE_ADDRESS,
        abi: trancheAbi,
        eventName: 'GrantCreated',
        args: { grantId },
        fromBlock,
        toBlock,
      }),
    ),
    scan((fromBlock, toBlock) =>
      publicClient.getContractEvents({
        address: TRANCHE_ADDRESS,
        abi: trancheAbi,
        eventName: 'MilestoneReleased',
        args: { grantId },
        fromBlock,
        toBlock,
      }),
    ),
    scan((fromBlock, toBlock) =>
      publicClient.getContractEvents({
        address: TRANCHE_ADDRESS,
        abi: trancheAbi,
        eventName: 'Refunded',
        args: { grantId },
        fromBlock,
        toBlock,
      }),
    ),
  ])

  const releaseTxs = new Map<number, Hash>()
  for (const log of released) {
    releaseTxs.set(Number(log.args.index), log.transactionHash)
  }
  const refundLog = refunded[0]
  return {
    createdTx: created[0]?.transactionHash,
    releaseTxs,
    refund: refundLog ? { tx: refundLog.transactionHash, amount: refundLog.args.amount ?? 0n } : undefined,
  }
}

/** Grants where `account` is the approver now: created with them, or handed to them later. */
export async function fetchApproverGrantIds(account: Address): Promise<bigint[]> {
  const [created, changed] = await Promise.all([
    scan((fromBlock, toBlock) =>
      publicClient.getContractEvents({
        address: TRANCHE_ADDRESS,
        abi: trancheAbi,
        eventName: 'GrantCreated',
        args: { approver: account },
        fromBlock,
        toBlock,
      }),
    ),
    scan((fromBlock, toBlock) =>
      publicClient.getContractEvents({
        address: TRANCHE_ADDRESS,
        abi: trancheAbi,
        eventName: 'ApproverChanged',
        args: { newApprover: account },
        fromBlock,
        toBlock,
      }),
    ),
  ])
  const ids = new Set<bigint>()
  for (const log of created) if (log.args.grantId !== undefined) ids.add(log.args.grantId)
  for (const log of changed) if (log.args.grantId !== undefined) ids.add(log.args.grantId)
  return [...ids]
}

export interface MyGrant {
  id: bigint
  grant: Grant
  roles: Set<'funder' | 'approver' | 'recipient'>
}

export async function fetchMyGrants(account: Address): Promise<MyGrant[]> {
  const [funderIds, recipientIds, approverCandidates] = await Promise.all([
    publicClient.readContract({ address: TRANCHE_ADDRESS, abi: trancheAbi, functionName: 'grantsByFunder', args: [account] }),
    publicClient.readContract({ address: TRANCHE_ADDRESS, abi: trancheAbi, functionName: 'grantsByRecipient', args: [account] }),
    fetchApproverGrantIds(account),
  ])

  const ids = new Set<bigint>([...funderIds, ...recipientIds, ...approverCandidates])
  const grants = await Promise.all([...ids].map(async (id) => ({ id, grant: await fetchGrant(id) })))

  const me = account.toLowerCase()
  return grants
    .map(({ id, grant }) => {
      const roles = new Set<'funder' | 'approver' | 'recipient'>()
      if (grant.funder.toLowerCase() === me) roles.add('funder')
      // The approver can change after creation, so only the current onchain approver counts.
      if (grant.approver.toLowerCase() === me) roles.add('approver')
      if (grant.recipients.some((r) => r.toLowerCase() === me)) roles.add('recipient')
      return { id, grant, roles }
    })
    .filter((entry) => entry.roles.size > 0)
    .sort((a, b) => (a.id < b.id ? 1 : -1))
}
