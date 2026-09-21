/**
 * Instrumentation forensique du pipeline e-mail — activée par `DEBUG_EMAIL=true`.
 *
 * BUT : rendre TOUT le chemin observable, de l'envoi de test au webhook jusqu'au
 * statut dérivé, pour prouver une cause par élimination plutôt que la deviner.
 *
 * ─── PRINCIPES ───────────────────────────────────────────────────────────────
 *
 *  - INACTIF par défaut : coût nul en production (un booléen testé, rien d'écrit).
 *  - JAMAIS DE SECRET : la clé API, le token Bearer et le secret webhook sont
 *    systématiquement rédigés (`redactSecret`). C'est un outil de DEV, pas une
 *    faille. Les adresses ne sont pas masquées EN MODE DEBUG (on veut la vérité
 *    de corrélation), donc `DEBUG_EMAIL` ne doit pas rester actif en production.
 *  - LISIBLE : préfixe coloré `[EMAIL] / [WEBHOOK] / [TRACKING] / [BREVO] /
 *    [ERROR]`, horodatage, une étape par ligne.
 */

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  gray: '\x1b[90m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

/** Couleur par domaine tracé. */
const TAG_COLOR = {
  EMAIL: C.cyan,
  WEBHOOK: C.magenta,
  TRACKING: C.blue,
  BREVO: C.yellow,
  ERROR: C.red,
};

/** Le mode debug e-mail est-il actif ? Lu à CHAQUE appel (togglable sans build). */
export function isEmailDebug() {
  return String(process.env.DEBUG_EMAIL || '').toLowerCase() === 'true';
}

/** N'expose qu'une présence + 4 derniers caractères d'un secret. Jamais la valeur. */
export function redactSecret(value) {
  const s = String(value ?? '');
  if (!s) return '(absent)';
  return `présent(…${s.slice(-4)})`;
}

/** En-têtes HTTP sûrs à tracer : l'Authorization est réduit à sa présence. */
export function redactHeaders(headers = {}) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    const key = k.toLowerCase();
    if (key === 'authorization') out[k] = v ? `Bearer ${redactSecret(String(v).replace(/^Bearer\s+/i, ''))}` : '(absent)';
    else if (key === 'api-key') out[k] = redactSecret(v);
    else out[k] = v;
  }
  return out;
}

function fmt(data) {
  if (data === undefined) return '';
  try {
    return `\n${C.gray}${JSON.stringify(data, null, 2)}${C.reset}`;
  } catch {
    return `\n${C.gray}(donnée non sérialisable)${C.reset}`;
  }
}

/**
 * Trace une étape du pipeline. No-op si `DEBUG_EMAIL` n'est pas actif.
 *
 * @param {'EMAIL'|'WEBHOOK'|'TRACKING'|'BREVO'|'ERROR'} tag
 * @param {string} step   Étape lisible (« payload envoyé », « lookup EmailDelivery »…)
 * @param {object} [data] Données déjà SÛRES (secrets rédigés par l'appelant si besoin)
 */
export function emailDebug(tag, step, data) {
  if (!isEmailDebug()) return;
  const color = TAG_COLOR[tag] || C.gray;
  const ts = new Date().toISOString();
  // eslint-disable-next-line no-console
  console.log(`${color}${C.bold}[${tag}]${C.reset} ${C.gray}${ts}${C.reset} ${step}${fmt(data)}`);
}

/** Trace une erreur contextualisée (toujours sous le tag ERROR). */
export default { isEmailDebug, emailDebug, redactSecret, redactHeaders };
