import { useCallback, useState } from 'react'
import { erc20Abi, parseEventLogs, type Address, type Hash } from 'viem'
import { useAccount, useSwitchChain, useWriteContract } from 'wagmi'
import { publicClient } from '@/lib/chain'
import { CHAIN, TRANCHE_ADDRESS, USDC_ADDRESS } from '@/lib/env'
import { trancheAbi } from '@/lib/trancheAbi'

export type TxStage = 'idle' | 'wallet' | 'confirming'

export interface CreateGrantInput {
  approver: Address
  recipients: Address[]
  sharesBps: bigint[]
  amounts: bigint[]
  deadline: bigint
  title: string
}

/** Wraps wallet writes: switches to Arc Testnet first, then waits for a real receipt. */
export function useTx() {
  const { chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const [stage, setStage] = useState<TxStage>('idle')

  const run = useCallback(
    async (write: () => Promise<Hash>) => {
      try {
        if (chainId !== CHAIN.id) await switchChainAsync({ chainId: CHAIN.id })
        setStage('wallet')
        const hash = await write()
        setStage('confirming')
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        if (receipt.status !== 'success') throw new Error('Transaction reverted')
        return receipt
      } finally {
        setStage('idle')
      }
    },
    [chainId, switchChainAsync],
  )

  const approveUsdc = useCallback(
    (amount: bigint) =>
      run(() =>
        writeContractAsync({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: 'approve',
          args: [TRANCHE_ADDRESS, amount],
          chainId: CHAIN.id,
        }),
      ),
    [run, writeContractAsync],
  )

  const createGrant = useCallback(
    async (input: CreateGrantInput) => {
      const receipt = await run(() =>
        writeContractAsync({
          address: TRANCHE_ADDRESS,
          abi: trancheAbi,
          functionName: 'createGrant',
          args: [input.approver, input.recipients, input.sharesBps, input.amounts, input.deadline, input.title],
          chainId: CHAIN.id,
        }),
      )
      const [created] = parseEventLogs({ abi: trancheAbi, logs: receipt.logs, eventName: 'GrantCreated' })
      if (!created) throw new Error('Grant created, but its id was not found in the receipt')
      return { grantId: created.args.grantId, receipt }
    },
    [run, writeContractAsync],
  )

  const releaseMilestone = useCallback(
    (grantId: bigint, index: bigint) =>
      run(() =>
        writeContractAsync({
          address: TRANCHE_ADDRESS,
          abi: trancheAbi,
          functionName: 'releaseMilestone',
          args: [grantId, index],
          chainId: CHAIN.id,
        }),
      ),
    [run, writeContractAsync],
  )

  const refund = useCallback(
    (grantId: bigint) =>
      run(() =>
        writeContractAsync({
          address: TRANCHE_ADDRESS,
          abi: trancheAbi,
          functionName: 'refund',
          args: [grantId],
          chainId: CHAIN.id,
        }),
      ),
    [run, writeContractAsync],
  )

  const claim = useCallback(
    () =>
      run(() =>
        writeContractAsync({
          address: TRANCHE_ADDRESS,
          abi: trancheAbi,
          functionName: 'claim',
          chainId: CHAIN.id,
        }),
      ),
    [run, writeContractAsync],
  )

  const changeApprover = useCallback(
    (grantId: bigint, newApprover: Address) =>
      run(() =>
        writeContractAsync({
          address: TRANCHE_ADDRESS,
          abi: trancheAbi,
          functionName: 'changeApprover',
          args: [grantId, newApprover],
          chainId: CHAIN.id,
        }),
      ),
    [run, writeContractAsync],
  )

  return { stage, busy: stage !== 'idle', approveUsdc, createGrant, releaseMilestone, refund, claim, changeApprover }
}
