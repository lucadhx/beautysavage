import { SystemConfiguration } from '../models/SystemConfiguration.model.js';
import { getSingleton } from '../utils/singleton.js';
import { config } from '../config/env.js';
import { detectNgrokPublicUrl } from './ngrokTunnel.service.js';

/**
 * URL publique du backend — SOURCE DE VÉRITÉ UNIQUE.
 *
 * C'est la valeur éditable dans « Configuration Système → Réseau »
 * (`SystemConfiguration.network.backendUrl`), la MÊME que celle testée par le
 * bouton de test réseau et exposée par l'API publique. Ce n'est PAS la variable
 * d'environnement `PUBLIC_URL` (`config.publicUrl`) : cette dernière est un défaut
 * de démarrage, pas la vérité runtime éditable par un DEV.
 *
 * `getSingleton` relit la base à chaque appel (aucun cache) : une modification de la
 * Configuration Système est donc reflétée IMMÉDIATEMENT, sans redémarrage.
 *
 * @returns {Promise<string>} URL sans slash final, ou '' si non configurée.
 */
export async function getPublicBackendUrl() {
  const cfg = await getSingleton(SystemConfiguration);
  return String(cfg?.network?.backendUrl || '').trim().replace(/\/+$/, '');
}

/* -------------------------------------------------------------------------- */
/*  Résolution AUTOMATIQUE de l'URL publique — pour les webhooks               */
/* -------------------------------------------------------------------------- */

/** Provenances possibles de l'URL publique résolue. Codes STABLES (UI/tests). */
export const PUBLIC_URL_SOURCE = Object.freeze({
  NGROK: 'NGROK', // tunnel ngrok détecté automatiquement (dev, mode TEST)
  SYSTEM_CONFIGURATION: 'SYSTEM_CONFIGURATION', // Config Système (Manager ou moteur de déploiement)
  ENVIRONMENT: 'ENVIRONMENT', // variable d'env PUBLIC_BACKEND_URL (secours)
  LOCALHOST: 'LOCALHOST', // dev sans webhook — jamais exploitable par un fournisseur
  NONE: 'NONE',
});

/** Code d'état structuré quand AUCUNE URL exploitable n'existe. */
export const WEBHOOK_PUBLIC_URL_UNAVAILABLE = 'WEBHOOK_PUBLIC_URL_UNAVAILABLE';

/** Une URL est-elle exploitable par un fournisseur de webhooks (HTTPS public) ? */
export function isPubliclyReachableUrl(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'https:') return false;
    const h = u.hostname;
    return !(h === 'localhost' || h.endsWith('.local') || /^127\.|^0\.0\.0\.0$/.test(h));
  } catch {
    return false;
  }
}

const stripSlash = (u) => String(u || '').trim().replace(/\/+$/, '');

/**
 * RÉSOLUTION AUTOMATIQUE de l'URL publique du backend, par mode fournisseur.
 *
 * Le propriétaire ne saisit plus d'URL : le système la CONNAÎT.
 *
 *  - PROD : Config Système (que le moteur de déploiement écrit lui-même à
 *    chaque déploiement : `https://api.<domaine>`), sinon la variable d'env
 *    `PUBLIC_BACKEND_URL`, sinon indisponible. JAMAIS ngrok, JAMAIS localhost :
 *    un webhook PROD pointant un tunnel de dev serait une corruption silencieuse.
 *  - TEST : le tunnel ngrok COURANT d'abord (détection automatique — c'est lui
 *    la vérité quand il tourne, même si la Config Système garde une vieille
 *    URL), sinon Config Système si publique, sinon `PUBLIC_BACKEND_URL`,
 *    sinon localhost (dev sans webhook : le backend fonctionne, les webhooks
 *    ne sont simplement pas synchronisables).
 *
 * Ne lève jamais : renvoie un état structuré, y compris l'indisponibilité
 * (`WEBHOOK_PUBLIC_URL_UNAVAILABLE`) — c'est l'appelant qui décide d'en faire
 * une erreur (synchronisation) ou une information (affichage).
 *
 * @param {'TEST'|'PROD'} mode
 * @returns {Promise<{url: string, source: string, webhookReady: boolean, code?: string}>}
 */
export async function resolvePublicBackendUrl(mode) {
  const configured = await getPublicBackendUrl();
  const envUrl = stripSlash(process.env.PUBLIC_BACKEND_URL || '');

  if (String(mode).toUpperCase() === 'PROD') {
    if (isPubliclyReachableUrl(configured)) {
      return { url: configured, source: PUBLIC_URL_SOURCE.SYSTEM_CONFIGURATION, webhookReady: true };
    }
    if (isPubliclyReachableUrl(envUrl)) {
      return { url: envUrl, source: PUBLIC_URL_SOURCE.ENVIRONMENT, webhookReady: true };
    }
    return { url: '', source: PUBLIC_URL_SOURCE.NONE, webhookReady: false, code: WEBHOOK_PUBLIC_URL_UNAVAILABLE };
  }

  // --- TEST ---
  // Le tunnel ngrok ne vit qu'en développement : en PROD (ENV), on ne sonde pas.
  if (!config.isProd) {
    const ngrok = await detectNgrokPublicUrl();
    if (ngrok && isPubliclyReachableUrl(ngrok)) {
      return { url: ngrok, source: PUBLIC_URL_SOURCE.NGROK, webhookReady: true };
    }
  }
  if (isPubliclyReachableUrl(configured)) {
    return { url: configured, source: PUBLIC_URL_SOURCE.SYSTEM_CONFIGURATION, webhookReady: true };
  }
  if (isPubliclyReachableUrl(envUrl)) {
    return { url: envUrl, source: PUBLIC_URL_SOURCE.ENVIRONMENT, webhookReady: true };
  }
  if (configured) {
    // localhost/HTTP : le backend vit, mais AUCUN webhook externe ne peut y arriver.
    return { url: configured, source: PUBLIC_URL_SOURCE.LOCALHOST, webhookReady: false, code: WEBHOOK_PUBLIC_URL_UNAVAILABLE };
  }
  return { url: '', source: PUBLIC_URL_SOURCE.NONE, webhookReady: false, code: WEBHOOK_PUBLIC_URL_UNAVAILABLE };
}

/* -------------------------------------------------------------------------- */
/*  MÉDIAS PUBLICS DU PROJET — résolution d'URL, source unique                 */
/* -------------------------------------------------------------------------- */

/**
 * URL PUBLIQUE ABSOLUE d'un média du projet (logo, favicon).
 *
 * ── POURQUOI CETTE FONCTION EXISTE ──────────────────────────────────────────
 * La configuration d'entreprise stocke le logo tantôt en URL absolue, tantôt en
 * chemin local (`/uploads/...`). Un chemin relatif ne veut rien dire hors du
 * projet : publié tel quel dans le manifeste, il enverrait le Panel chercher
 * `/uploads/...` sur SON propre domaine. On le résout donc contre l'URL
 * publique du backend qui sert réellement le fichier.
 *
 * ── POURQUOI LE CHEMIN RELATIF EST PRÉFÉRABLE EN CONFIGURATION ──────────────
 * Un projet dupliqué hérite de la configuration du projet source. Si le logo y
 * est stocké en URL absolue, le duplicata continue de pointer le domaine du
 * SOURCE — durablement, et sans que rien ne le signale. Stocké en chemin
 * relatif, il se résout contre le domaine du duplicata. Voir
 * `docs/panelXvitrine/MEDIAS_PUBLICS.md`.
 *
 * Ne publie QUE ce qui est réellement joignable : une URL non HTTPS ou pointant
 * localhost n'est pas rendue. Mieux vaut aucun logo qu'un lien mort.
 *
 * Fonction PURE : aucune lecture de base, aucun accès réseau.
 *
 * @param {string|null|undefined} pathOrUrl  Valeur telle que configurée.
 * @param {string|null|undefined} publicBackendUrl  Origine publique du projet.
 * @returns {string|null} URL absolue joignable, ou `null` (champ omis).
 */
export function resolvePublicAssetUrl(pathOrUrl, publicBackendUrl) {
  const raw = String(pathOrUrl ?? '').trim();
  if (raw.length === 0) return null;

  // Déjà absolue : on la garde si — et seulement si — elle est joignable.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    return isPubliclyReachableUrl(raw) ? raw : null;
  }

  // Chemin local : il n'a de sens que rapporté à l'origine qui le sert.
  if (!raw.startsWith('/')) return null;
  const origin = stripSlash(publicBackendUrl);
  if (!origin) return null;

  const absolute = `${origin}${raw}`;
  return isPubliclyReachableUrl(absolute) ? absolute : null;
}
