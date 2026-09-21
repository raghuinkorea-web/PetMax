/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Path to the official ADISYS logo asset, when one has been supplied. */
  readonly VITE_BRAND_LOGO_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
