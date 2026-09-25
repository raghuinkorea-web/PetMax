/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Overrides the bundled full logo lockup (`/adisys-logo.png`). */
  readonly VITE_BRAND_LOGO_URL?: string;
  /** Overrides the bundled lettering-only mark (`/adisys-wordmark.png`). */
  readonly VITE_BRAND_WORDMARK_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
