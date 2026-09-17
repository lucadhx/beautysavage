function getHeaderValue(headers, key) {
  if (!headers || typeof headers !== 'object') return '';
  const value = headers[key];
  if (Array.isArray(value)) {
    return String(value[0] || '').trim();
  }
  return String(value || '').trim();
}

function normalizeIp(candidate) {
  const raw = String(candidate || '').trim();
  if (!raw) return '';
  if (raw.startsWith('::ffff:')) {
    return raw.slice(7);
  }
  if (raw === '::1') {
    return '127.0.0.1';
  }
  return raw;
}

function parseForwardedFor(headers) {
  const value = getHeaderValue(headers, 'x-forwarded-for');
  if (!value) return '';
  const firstIp = value
    .split(',')
    .map(entry => entry.trim())
    .find(Boolean);
  return normalizeIp(firstIp);
}

export function extractClientIp(req) {
  const viaForwarded = parseForwardedFor(req?.headers);
  if (viaForwarded) return viaForwarded;
  const viaRealIp = normalizeIp(getHeaderValue(req?.headers, 'x-real-ip'));
  if (viaRealIp) return viaRealIp;
  const viaReqIp = normalizeIp(req?.ip);
  if (viaReqIp) return viaReqIp;
  const viaConnection = normalizeIp(req?.connection?.remoteAddress || req?.socket?.remoteAddress);
  if (viaConnection) return viaConnection;
  return '0.0.0.0';
}
