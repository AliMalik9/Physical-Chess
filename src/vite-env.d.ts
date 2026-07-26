/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Origin of the Cloudflare Worker, e.g. "https://boardlink.<you>.workers.dev".
   *
   * Leave unset for the single-origin Cloudflare deployment, where the Worker
   * serves the client itself. Set it only when the client is hosted separately
   * (Vercel, Netlify, …) and needs to reach the Worker cross-origin.
   */
  readonly VITE_API_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
