/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NEON_URL?: string;
  readonly VITE_NEON_AUTH_BASE_URL?: string;
  readonly VITE_NEON_DATA_API_URL?: string;
  readonly VITE_BACKEND_API_URL?: string;
  readonly VITE_PUBLIC_CONTACT_EMAIL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
