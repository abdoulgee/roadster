/** Small HTTP helpers shared by the Vercel Functions. */

export function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  return null;
}

export function json(res, status, data) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  if (status === 204 || data === undefined) {
    res.end();
    return;
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}
