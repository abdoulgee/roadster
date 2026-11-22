import { LocalBoard } from './localBoard';
import { SupabaseBoard } from './supabaseBoard';
import { supabaseConfig } from './supabase';
import type { Leaderboard } from './types';

export * from './types';

/** Online when VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set (see .env.example), else device-only. */
export function createLeaderboard(): Leaderboard {
  const config = supabaseConfig();
  return config ? new SupabaseBoard(config.url, config.key) : new LocalBoard();
}
