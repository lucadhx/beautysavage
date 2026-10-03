import { isOriginAllowed } from '../config/corsOrigins.js';
import { SystemConfiguration } from '../models/SystemConfiguration.model.js';
import { getSingleton } from './singleton.js';

/**
 * L'ADRESSE DU SITE — celle d'où vient la cliente, jamais une adresse devinée.
 *
 * ══ LE DÉFAUT CORRIGÉ ══════════════════════════════════════════════════════
 *
 * L'adresse de retour (Stripe, liens d'e-mails) était cherchée dans
 * `CORS_ORIGINS` : la première origine contenant « beautysavage ». Sur la
 * recette (testbeauty…), aucune ne correspondait, et le repli renvoyait la
 * cliente sur le site de PRODUCTION après avoir payé — où sa session n'existe
 * pas : l'écran restait sur « Confirmation de votre paiement… ».
 *
 * ══ LA RÈGLE ═══════════════════════════════════════════════════════════════
 *
 *   1. une action faite DEPUIS le site : on revient sur ce même site — si son
 *      origine fait partie des origines autorisées (CORS), et seulement alors ;
 *   2. sinon (e-mail, tâche de fond) : l'adresse configurée du site
 *      (`SystemConfiguration.network.websiteUrl`), celle de CETTE instance.
 */

const clean = (url) => String(url || '').trim().replace(/\/+$/, '');

function originOf(value) {
  try { return new URL(value).origin; } catch { return ''; }
}

/** L'origine du site d'où vient la requête, si elle est autorisée (jamais le Manager ni l'API). */
export function siteOriginFromRequest(req) {
  const candidate = originOf(req?.get?.('origin') || '') || originOf(req?.get?.('referer') || '');
  if (!candidate || !/^https?:\/\//.test(candidate)) return '';
  if (/\/\/(api|manager)\./i.test(candidate)) return '';
  return isOriginAllowed(candidate) ? candidate : '';
}

/** L'adresse configurée du site de CETTE instance. */
export async function configuredSiteUrl() {
  const cfg = await getSingleton(SystemConfiguration).catch(() => null);
  const fromConfig = clean(cfg?.network?.websiteUrl);
  if (fromConfig) return fromConfig;
  const fromCors = (process.env.CORS_ORIGINS || '').split(',').map(clean)
    .find((o) => /^https:\/\//.test(o) && !/\/\/(api|manager)\./i.test(o));
  return fromCors || '';
}

/** L'origine de la requête si elle est sûre, sinon l'adresse configurée. */
export async function siteUrlFor(req) {
  return siteOriginFromRequest(req) || await configuredSiteUrl();
}
