// RX-GO — Constructeur d'URL front FLAG-AWARE. Source unique des liens embarqués dans les e-mails (et
// retours Stripe côté service dédié) : quand REACT_OFFICIAL_FRONTEND=OFF → chemins Vanilla (IDENTIQUES au
// legacy, zéro régression) ; quand ON → routes React sous /app. Seules les destinations qui possèdent un
// équivalent React figurent ici ; les autres continuent d'utiliser DomainResolver directement (pas
// d'invention d'écran).
import { isReactOfficialFrontend } from './reactFrontend.js';
import { resolveVitrineUrl } from './domainResolver.js';

const enc = (v) => encodeURIComponent(String(v ?? ''));

/**
 * Registre : clé de route → builders de chemin (relatifs à la base vitrine) Vanilla vs React.
 * Les chemins Vanilla reproduisent EXACTEMENT l'existant (parité flag OFF).
 */
const FRONTEND_ROUTES = {
  // Décision post-annulation tokenisée (RX4 S3). Vanilla: page slug ; React: /app/decision (query).
  'session-cancel-decision': {
    vanilla: (p) => `vitrine.html?page=session-cancel-decision&flowId=${enc(p.flowId)}&token=${enc(p.token)}`,
    react: (p) => `app/decision?flowId=${enc(p.flowId)}&token=${enc(p.token)}`,
  },
  // Suivi remboursement tokenisé (RX4 S3). Vanilla: query token ; React: token en PATH (/app/refund-tracking/:token).
  'refund-tracking': {
    vanilla: (p) => `vitrine.html?page=refund-tracking&token=${enc(p.token)}`,
    react: (p) => `app/refund-tracking/${enc(p.token)}`,
  },
  // Facture publique par token (RX-GO-2). Vanilla: slug=invoice ; React: token en PATH (/app/invoice/:token).
  'invoice': {
    vanilla: (p) => `vitrine.html?slug=invoice&token=${enc(p.token)}`,
    react: (p) => `app/invoice/${enc(p.token)}`,
  },
  // Réinitialisation mot de passe CLIENT (RX-GO-2). Vanilla: /reset-password ; React: /app/reinitialiser-mot-de-passe.
  'password-reset': {
    vanilla: (p) => `reset-password?token=${enc(p.token)}`,
    react: (p) => `app/reinitialiser-mot-de-passe?token=${enc(p.token)}`,
  },
  // RX-BLOCKER-2 — Invitation MANAGER. Le SPA /manager est servi quel que soit le flag → toujours React.
  'manager-invitation': {
    vanilla: (p) => `manager/invitation/${enc(p.token)}`,
    react: (p) => `manager/invitation/${enc(p.token)}`,
  },
  // RX-BLOCKER-2 — Réinitialisation mot de passe MANAGER (toujours React /manager, servi quel que soit le flag).
  'manager-password-reset': {
    vanilla: (p) => `manager/reinitialiser-mot-de-passe/${enc(p.token)}`,
    react: (p) => `manager/reinitialiser-mot-de-passe/${enc(p.token)}`,
  },
};

/**
 * Construit une URL absolue vers une route front, en respectant le flag REACT_OFFICIAL_FRONTEND.
 * @param {string} routeKey clé du registre (ex. 'refund-tracking')
 * @param {object} params paramètres de la route (ex. { token } ou { flowId, token })
 * @returns {string} URL absolue
 */
export function resolveFrontendUrl(routeKey, params = {}) {
  const entry = FRONTEND_ROUTES[routeKey];
  if (!entry) {
    throw new Error(`[frontendUrl] route inconnue: ${routeKey}`);
  }
  const build = isReactOfficialFrontend() ? entry.react : entry.vanilla;
  return resolveVitrineUrl(build(params));
}

/** Vrai si React est le frontend officiel (proxy lisible pour les services). */
export function isReactFrontendActive() {
  return isReactOfficialFrontend();
}
