import dns from 'node:dns/promises';

/* ----------------------- Détection d'IP privées/sensibles ----------------------- */
function ipToLong(ip) {
  const p = ip.split('.').map(Number);
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}
function inRange(ip, cidr) {
  const [range, bits] = cidr.split('/');
  const mask = bits === '0' ? 0 : (~((2 ** (32 - Number(bits))) - 1)) >>> 0;
  return (ipToLong(ip) & mask) === (ipToLong(range) & mask);
}
// loopback, RFC1918, link-local (169.254 dont metadata cloud 169.254.169.254),
// CGNAT, benchmarking, "this host", TEST-NET… bref tout ce qui n'est pas public.
const V4_BLOCKED = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
];
function isPrivateIpV4(ip) {
  return V4_BLOCKED.some((c) => inRange(ip, c));
}
function isPrivateIpV6(ip) {
  const s = ip.toLowerCase();
  if (s === '::1' || s === '::') return true; // loopback / unspecified
  if (s.startsWith('fe80')) return true; // link-local
  if (s.startsWith('fc') || s.startsWith('fd')) return true; // ULA fc00::/7
  const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
  if (mapped) return isPrivateIpV4(mapped[1]);
  return false;
}
export function isPrivateIp(ip) {
  return ip.includes(':') ? isPrivateIpV6(ip) : isPrivateIpV4(ip);
}

/* --------------------------------- Probe HTTP --------------------------------- */
/**
 * Vérifie la joignabilité d'une URL de façon sûre (anti-SSRF).
 * - http/https uniquement, pas d'identifiants intégrés ;
 * - résolution DNS + refus des IP locales/privées (sauf `allowPrivate`) ;
 * - timeout court, HEAD puis fallback GET (corps non téléchargé) ;
 * - `redirect: 'manual'` → on ne suit AUCUNE redirection (anti-rebinding).
 *
 * @returns {{url,reachable,statusCode,durationMs,message}}
 */
export async function probeUrl(rawUrl, { allowPrivate = false, timeoutMs = 5000 } = {}) {
  const started = Date.now();
  const out = { url: rawUrl, reachable: false, statusCode: null, durationMs: 0, message: '' };

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    out.message = 'URL invalide';
    return out;
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    out.message = 'Protocole non autorisé';
    return out;
  }
  if (url.username || url.password) {
    out.message = 'URL avec identifiants refusée';
    return out;
  }

  try {
    const addrs = await dns.lookup(url.hostname, { all: true });
    if (!allowPrivate && addrs.some((a) => isPrivateIp(a.address))) {
      out.message = 'Destination interdite (IP locale ou privée)';
      out.durationMs = Date.now() - started;
      return out;
    }
  } catch {
    out.message = 'Résolution DNS impossible';
    out.durationMs = Date.now() - started;
    return out;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const fetchOnce = (method) =>
    fetch(url.toString(), {
      method,
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'user-agent': 'ProjectFactory-ConnectivityProbe' },
    });

  try {
    let res = null;
    try {
      res = await fetchOnce('HEAD');
    } catch {
      res = null;
    }
    if (!res || res.status === 405 || res.status === 501) {
      res = await fetchOnce('GET');
      try {
        await res.body?.cancel(); // ne pas télécharger le corps
      } catch {
        /* ignore */
      }
    }
    clearTimeout(timer);
    out.durationMs = Date.now() - started;
    out.reachable = true;
    if (res.type === 'opaqueredirect') {
      out.statusCode = null;
      out.message = 'Accessible (redirection)';
    } else {
      out.statusCode = res.status;
      out.message = res.status < 400 ? 'Accessible' : `Répond (HTTP ${res.status})`;
    }
    return out;
  } catch (e) {
    clearTimeout(timer);
    out.durationMs = Date.now() - started;
    out.message = e.name === 'AbortError' ? `Délai dépassé après ${timeoutMs / 1000} s` : 'Injoignable';
    return out;
  }
}

export default probeUrl;
