/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Set to "1" to stop the game sending anonymous usage stats to /api/track. */
  readonly VITE_ANALYTICS_OFF?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
