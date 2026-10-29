/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TRANCHE_ADDRESS?: string
  readonly VITE_TRANCHE_DEPLOY_BLOCK?: string
  readonly VITE_USDC_ADDRESS?: string
  readonly VITE_EXPLORER_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
