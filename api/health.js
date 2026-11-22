import { json } from './_lib/http.js';

/** Connectivity/configuration check used by the game analytics and the pit-wall login screen. */
export default function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'method' });
  const token = !!process.env.BLOB_READ_WRITE_TOKEN;
  const oidc = !!process.env.BLOB_STORE_ID && !!process.env.VERCEL_OIDC_TOKEN;
  json(res, 200, {
    ok: true,
    configured: token || oidc,
    access: process.env.BLOB_ACCESS === 'private' ? 'private' : 'public',
    passwordConfigured: !!process.env.ADMIN_PASSWORD,
  });
}
