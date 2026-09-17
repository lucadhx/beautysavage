import Contract from '../models/Contract.js';
import Theme from '../models/Theme.js';
import { loadSessionUser } from '../utils/session.js';

const CACHE_TTL_MS = 30 * 1000;

let cachedStatus = null; // 'active' | 'inactive'
let cachedPendingMessage = 'Site en cours de configuration. Revenez bientôt.';
let cacheExpiresAt = 0;

export function invalidateContractCache() {
  cacheExpiresAt = 0;
  cachedStatus = null;
}

async function getContractStatus() {
  const now = Date.now();
  if (cachedStatus !== null && now < cacheExpiresAt) {
    return { status: cachedStatus, pendingMessage: cachedPendingMessage };
  }
  const contract = await Contract.findOne({ status: { $in: ['active', 'pending'] } })
    .select({ status: 1, pendingMessage: 1 })
    .lean();

  cachedStatus = contract?.status === 'active' ? 'active' : 'inactive';
  cachedPendingMessage =
    contract?.pendingMessage || 'Site en cours de configuration. Revenez bientôt.';
  cacheExpiresAt = now + CACHE_TTL_MS;

  return { status: cachedStatus, pendingMessage: cachedPendingMessage };
}

// Routes always allowed regardless of contract status
const ALLOWED_PATH_PREFIXES = [
  '/api/stripe/dev-webhook',
  '/api/stripe/webhook',
  '/api/stripe/config',
  '/api/webhooks/',
  '/api/contract/',
  '/api/vitrine/theme',
  '/api/vitrine/site-identity',
  '/auth/',
  '/admin-login',
];

const ALLOWED_EXACT_PATHS = new Set([
  '/api/contract/status',
  '/api/contract/pending-info',
  '/api/contract/download-file',
  '/admin-login',
  '/admin-login.html',
]);

// Admin routes always pass through (no contract required to manage things)
const ADMIN_ROUTE_PREFIXES = [
  '/api/gestion/',
  '/api/dev/',
];

function isAlwaysAllowed(req) {
  const path = String(req.path || '/').toLowerCase();
  const method = String(req.method || '').toUpperCase();

  // Static assets always allowed
  if (
    path.startsWith('/css/') ||
    path.startsWith('/js/') ||
    path.startsWith('/img/') ||
    path.startsWith('/images/') ||
    path.startsWith('/fonts/') ||
    path.startsWith('/uploads/') ||
    path === '/favicon.ico'
  ) {
    return true;
  }

  // RX1 — shells du frontend React (vitrine /app, manager /manager) : toujours servis. Comme les
  // pages Vanilla d'entrée, le shell doit se charger même pendant la configuration du contrat ;
  // l'état "contrat inactif" est rendu côté React via l'API /api/contract/status.
  if (path === '/app' || path.startsWith('/app/') || path === '/manager' || path.startsWith('/manager/')) {
    return true;
  }

  // Admin/dev management routes always allowed
  for (const prefix of ADMIN_ROUTE_PREFIXES) {
    if (path.startsWith(prefix)) return true;
  }

  // Explicitly allowed API paths
  for (const prefix of ALLOWED_PATH_PREFIXES) {
    if (path.startsWith(prefix.toLowerCase())) return true;
  }
  if (ALLOWED_EXACT_PATHS.has(path)) return true;

  // Auth routes
  if (path.startsWith('/auth/')) return true;

  return false;
}

function requestWantsHtml(req) {
  if (req.method !== 'GET') return false;
  const accept = String(req.headers?.accept || '').toLowerCase();
  return accept.includes('text/html');
}

function requestIsApi(req) {
  const path = String(req.path || '/').toLowerCase();
  return path.startsWith('/api/') || path.startsWith('/auth/');
}

async function buildWaitingPage(pendingMessage, req) {
  // Try to fetch theme colors for inline CSS
  let colors = {
    primary: '#5f4ff7',
    secondary: '#f24692',
    background: '#f5f4ef',
    surface: '#ffffff',
    text: '#0f172a'
  };
  let siteName = 'Beauty Savage';
  let accent = `color-mix(in oklab, ${colors.primary} 70%, ${colors.secondary} 30%)`;

  try {
    const theme = await Theme.findOne({ isActive: true })
      .select({ colors: 1, derivedTokens: 1 })
      .lean();
    if (theme?.colors) {
      colors = { ...colors, ...theme.colors };
      accent =
        theme.derivedTokens?.accent ||
        `color-mix(in oklab, ${colors.primary} 70%, ${colors.secondary} 30%)`;
    }
  } catch (_error) {
    // Use defaults
  }

  const message = String(pendingMessage || 'Site en cours de configuration. Revenez bientôt.');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${siteName}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: ${colors.background};
      color: ${colors.text};
      font-family: system-ui, -apple-system, sans-serif;
      padding: 2rem;
    }
    .waiting-card {
      background: ${colors.surface};
      border-radius: 1.5rem;
      padding: 3rem 2.5rem;
      max-width: 480px;
      width: 100%;
      text-align: center;
      box-shadow: 0 4px 32px rgba(0,0,0,0.08);
    }
    .waiting-icon {
      font-size: 4rem;
      color: ${accent};
      margin-bottom: 1.5rem;
      display: block;
      animation: swing 2s ease-in-out infinite;
    }
    @keyframes swing {
      0%, 100% { transform: rotate(-10deg); }
      50% { transform: rotate(10deg); }
    }
    .waiting-title {
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: 1rem;
      color: ${colors.text};
    }
    .waiting-message {
      font-size: 1rem;
      line-height: 1.6;
      opacity: 0.75;
    }
  </style>
</head>
<body>
  <div class="waiting-card">
    <i class="bi bi-hourglass-split waiting-icon" aria-hidden="true"></i>
    <h1 class="waiting-title">${siteName}</h1>
    <p class="waiting-message">${message}</p>
  </div>
</body>
</html>`;
}

export function contractGuard() {
  return async (req, res, next) => {
    try {
      if (isAlwaysAllowed(req)) {
        return next();
      }

      // Developer bypasses contract guard entirely
      const user = await loadSessionUser(req, res);
      if (user?.role === 'dev') {
        return next();
      }

      const { status, pendingMessage } = await getContractStatus();

      if (status === 'active') {
        return next();
      }

      // No active contract — block
      if (requestIsApi(req)) {
        return res.status(503).json({
          ok: false,
          code: 'CONTRACT_INACTIVE',
          error: 'Site en cours de configuration.'
        });
      }

      if (requestWantsHtml(req)) {
        const html = await buildWaitingPage(pendingMessage, req);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(503).send(html);
      }

      return res.status(503).json({
        ok: false,
        code: 'CONTRACT_INACTIVE',
        error: 'Site en cours de configuration.'
      });
    } catch (error) {
      console.error('[contractGuard] Erreur', error);
      return next();
    }
  };
}

export default contractGuard;
