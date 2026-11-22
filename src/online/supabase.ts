/** Shared Supabase plumbing for the leaderboard, analytics and the admin dashboard. */

export interface SupabaseConfig {
  url: string;
  key: string;
}

/** Online features turn on when both env values are set (see .env.example). */
export function supabaseConfig(): SupabaseConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/+$/, '');
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  return url && key ? { url, key } : null;
}

/** Calls one of the SECURITY DEFINER functions through PostgREST. */
export async function supabaseRpc<T>(
  config: SupabaseConfig,
  fn: string,
  args: Record<string, unknown>,
  options: { keepalive?: boolean } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${config.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
      keepalive: options.keepalive,
    });
  } catch {
    throw new Error('network');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (body as { message?: unknown } | null)?.message;
    throw new Error(typeof message === 'string' ? message : `http_${response.status}`);
  }
  return body as T;
}
