/**
 * Vercel Blob storage for analytics. One JSON blob per browser session:
 *   sessions/YYYY-MM/{sessionId}.json
 *
 * Blob is object storage, not a database: heartbeats read-modify-write their own session file.
 * Different sessions never touch the same blob, and the read/write uses the blob ETag so a
 * concurrent heartbeat retries instead of silently overwriting.
 */

import {
  BlobNotFoundError,
  BlobPreconditionFailedError,
  get,
  list,
  put,
} from '@vercel/blob';

/** Public stores are the default. Set BLOB_ACCESS=private when using a private store. */
const ACCESS = process.env.BLOB_ACCESS === 'private' ? 'private' : 'public';
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN?.trim();
const OIDC = process.env.VERCEL_OIDC_TOKEN?.trim();
const STORE_ID = process.env.BLOB_STORE_ID?.trim();
const MAX_SESSIONS = 3000;
const MAX_BYTES = 64 * 1024;

export class SetupError extends Error {
  constructor() {
    super('setup');
    this.name = 'SetupError';
  }
}

/** A Blob store is connected if it provides a read-write token, or OIDC + a store id. */
export function blobConfigured() {
  return !!TOKEN || (!!STORE_ID && !!OIDC);
}

function authOptions() {
  // When no token is set, the SDK uses VERCEL_OIDC_TOKEN + BLOB_STORE_ID from the environment.
  return TOKEN ? { token: TOKEN } : {};
}

export function isPrecondition(error) {
  return error instanceof BlobPreconditionFailedError || error?.name === 'BlobPreconditionFailedError';
}

function isNotFound(error) {
  return error instanceof BlobNotFoundError || error?.name === 'BlobNotFoundError';
}

function requireSetup() {
  if (!blobConfigured()) throw new SetupError();
}

export function sessionPath(startedAtMs, sessionId) {
  const date = new Date(startedAtMs);
  const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  return `sessions/${month}/${sessionId}.json`;
}

async function getBlob(path, withEtag = false) {
  try {
    const result = await get(path, { access: ACCESS, useCache: false, ...authOptions() });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    const raw = await new Response(result.stream).text();
    if (raw.length > MAX_BYTES) return null;
    const data = JSON.parse(raw);
    return withEtag ? { data, etag: result.blob.etag } : data;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** Returns `{ data, etag }` for an existing session, or null. */
export async function readSession(path) {
  requireSetup();
  const result = await getBlob(path, true);
  if (!result) return null;
  return { data: result.data, etag: result.etag };
}

export async function writeSession(path, data, etag) {
  requireSetup();
  await put(path, JSON.stringify(data), {
    access: ACCESS,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 60,
    ...authOptions(),
    ...(etag ? { ifMatch: etag } : {}),
  });
}

function monthKeys(fromMs, toMs) {
  const keys = [];
  const cursor = new Date(fromMs);
  cursor.setUTCDate(1);
  cursor.setUTCHours(0, 0, 0, 0);
  const end = new Date(toMs);
  while (cursor <= end) {
    keys.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return keys;
}

/**
 * Reads the sessions that were active at or after `fromMs`. The month folders keep the list
 * bounded; the blob's uploadedAt is its last heartbeat, so older sessions cost nothing.
 */
export async function listSessions(fromMs, nowMs) {
  requireSetup();
  const blobs = [];
  for (const month of monthKeys(fromMs, nowMs)) {
    let cursor;
    do {
      const page = await list({
        prefix: `sessions/${month}/`,
        limit: 1000,
        cursor,
        ...authOptions(),
      });
      blobs.push(...page.blobs);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  }

  const candidates = blobs
    .filter((blob) => new Date(blob.uploadedAt).getTime() >= fromMs - 10 * 60_000)
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
    .slice(0, MAX_SESSIONS);

  const sessions = [];
  const batch = 16;
  for (let i = 0; i < candidates.length; i += batch) {
    const rows = await Promise.all(
      candidates.slice(i, i + batch).map(async (blob) => {
        try {
          return await getBlob(blob.pathname);
        } catch {
          // A single unreadable session should not blank the whole dashboard.
          return null;
        }
      }),
    );
    for (const row of rows) if (row) sessions.push(row);
  }
  return sessions;
}
