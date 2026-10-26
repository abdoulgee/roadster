import { LocalBoard } from './localBoard';
import { SupabaseBoard } from './supabaseBoard';
import type { Leaderboard } from './types';

export * from './types';

/** Online when VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set (see .env.example), else device-only. */
export function createLeaderboard(): Leaderboard {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/+$/, '');
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  return url && key ? new SupabaseBoard(url, key) : new LocalBoard();
}
