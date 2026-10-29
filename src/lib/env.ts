import { isAddress, type Address } from 'viem'
import { arcTestnet } from 'viem/chains'

function requireAddress(name: string, value: string | undefined): Address {
  if (!value || !isAddress(value)) {
    throw new Error(`${name} is missing or not a valid address. Set it in .env and restart the dev server.`)
  }
  return value
}

export const CHAIN = arcTestnet

/** The deployed TrancheEscrow contract. */
export const TRANCHE_ADDRESS = requireAddress('VITE_TRANCHE_ADDRESS', import.meta.env.VITE_TRANCHE_ADDRESS)

/** The ERC-20 view of USDC on Arc (6 decimals). Not the 18-decimal native gas view. */
export const USDC_ADDRESS = requireAddress('VITE_USDC_ADDRESS', import.meta.env.VITE_USDC_ADDRESS)

/** First block that can hold TrancheEscrow events. Event scans start here, never at block 0. */
export const DEPLOY_BLOCK = BigInt(import.meta.env.VITE_TRANCHE_DEPLOY_BLOCK ?? '0')

export const EXPLORER_URL: string = (import.meta.env.VITE_EXPLORER_URL ?? 'https://explorer.testnet.arc.io').replace(/\/+$/, '')

/** USDC has 6 decimals in its ERC-20 form. */
export const USDC_DECIMALS = 6

export const txUrl = (hash: string) => `${EXPLORER_URL}/tx/${hash}`
export const addressUrl = (address: string) => `${EXPLORER_URL}/address/${address}`
