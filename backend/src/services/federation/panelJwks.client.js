// LE JEU DE CLÉS DU PANEL, VU DU PROJET (L12.B).
//
// docs/auth/PANEL_FEDERATED_DEV_IDENTITY_IMPLEMENTATION.md §« JWKS CLIENT ».
//
// ── CE QUE CE CLIENT VA CHERCHER, ET CE QU'IL NE PEUT PAS RECEVOIR ──────────
//
// Des clés PUBLIQUES, et rien d'autre. Aucune clé privée, aucun secret
// partagé : le Panel n'en publie pas, et ce client n'a nulle part où en ranger
// une. C'est la propriété qui rend la fédération sûre à l'échelle du parc — un
// projet compromis ne peut pas forger d'assertion, ni pour lui, ni pour un
// autre.
//
// ── L'URL VIENT DE L'APPAIRAGE, JAMAIS DU CODE ──────────────────────────────
//
// Aucun domaine n'est écrit ici. `panelUrl` est celui que l'appairage a
// enregistré : le parcours survit donc à un changement de domaine du Panel
// sans redéploiement du projet. Coder une adresse — même « juste pour le
// local » — reviendrait à figer dans le projet une décision qui appartient à
// l'exploitant.
//
// ── POURQUOI UN CACHE, ET POURQUOI IL EST COURT ─────────────────────────────
//
// Sans cache, chaque connexion fédérée ferait un aller-retour réseau avant de
// vérifier quoi que ce soit — et une panne réseau du Panel deviendrait une
// panne de connexion, y compris pour une assertion qu'on pouvait vérifier.
//
// Avec un cache trop long, une clé retirée resterait acceptée. Cinq minutes
// tiennent les deux bouts, et la règle qui compte est ailleurs : un `kid`
// INCONNU force une relecture immédiate. Une rotation est donc prise en compte
// à la première assertion qui la porte, sans attendre l'expiration du cache.
import { panelUrlForFederation } from '../panelBridge/capabilityClient.js';
import { logger } from '../../utils/logger.js';

/** Durée de vie du cache. Voir l'en-tête : la relecture forcée fait le reste. */
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Au-delà, on abandonne : une connexion ne doit pas pendre indéfiniment. */
const FETCH_TIMEOUT_MS = 5000;

/** Chemin PUBLIC du jeu de clés, tel que le Panel le sert. */
const JWKS_PATH = '/api/federation/.well-known/jwks.json';

/** @type {{ fetchedAt: number, keys: Map<string, object> } | null} */
let cache = null;

/** Injectable — les recettes ne sortent pas sur le réseau. */
let fetchImpl = globalThis.fetch;

export function configureJwksFetch(impl) {
  fetchImpl = impl ?? globalThis.fetch;
}

/** Vide le cache. Réservé aux recettes et à un geste d'exploitation. */
export function resetJwksCache() {
  cache = null;
}

/**
 * L'ADRESSE DU PANEL — depuis l'appairage, jamais depuis le code.
 *
 * Rend `null` si le projet n'est pas appairé : la fédération est alors
 * impossible, et le dire franchement vaut mieux que d'essayer une URL vide.
 */
function panelBaseUrl() {
  const url = panelUrlForFederation();
  return url ? String(url).replace(/\/$/, '') : null;
}

/** Le projet est-il en mesure d'accueillir une connexion fédérée ? */
export function federationAvailable() {
  return Boolean(panelBaseUrl());
}

async function fetchJwks() {
  const base = panelBaseUrl();
  if (!base) {
    const error = new Error('Aucun Panel appairé : le jeu de clés est introuvable.');
    error.code = 'FEDERATION_PANEL_NOT_PAIRED';
    throw error;
  }

  const controller = new AbortController();
  const minuteur = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${base}${JWKS_PATH}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = new Error(`Le Panel a répondu ${response.status} au jeu de clés.`);
      error.code = 'FEDERATION_JWKS_UNAVAILABLE';
      throw error;
    }
    const body = await response.json();
    if (!Array.isArray(body?.keys)) {
      const error = new Error('Jeu de clés illisible.');
      error.code = 'FEDERATION_JWKS_MALFORMED';
      throw error;
    }

    /**
     * ON N'ACCEPTE QUE CE QU'ON SAIT VÉRIFIER.
     *
     * Une entrée sans `kid`, d'un autre type que RSA, ou annoncée pour un autre
     * algorithme, est écartée à l'entrée du cache plutôt qu'au moment de
     * vérifier. Le vérificateur ne doit jamais avoir à se demander si une clé
     * qu'il tient est utilisable — s'il la tient, elle l'est.
     */
    const keys = new Map();
    for (const jwk of body.keys) {
      if (!jwk?.kid || jwk.kty !== 'RSA' || (jwk.alg && jwk.alg !== 'RS256')) continue;
      keys.set(String(jwk.kid), jwk);
    }

    cache = { fetchedAt: Date.now(), keys };
    return cache;
  } finally {
    clearTimeout(minuteur);
  }
}

/**
 * LA CLÉ PUBLIQUE D'UN `kid`, ou `null`.
 *
 * ── LA RELECTURE FORCÉE, ET POURQUOI ELLE EST LA VRAIE RÈGLE ───────────────
 *
 * Un `kid` absent du cache n'est pas « inconnu » : c'est peut-être une clé
 * publiée depuis notre dernière lecture. On relit AVANT de conclure. Sans
 * cela, toute rotation provoquerait cinq minutes de refus — ce qui ferait
 * qu'on ne tournerait jamais les clés.
 *
 * On ne relit qu'UNE fois par appel : un `kid` forgé au hasard ne doit pas
 * pouvoir déclencher un aller-retour réseau par tentative.
 */
export async function publicJwkFor(kid) {
  if (!kid) return null;

  const perime = !cache || (Date.now() - cache.fetchedAt) > CACHE_TTL_MS;
  if (perime) {
    try {
      await fetchJwks();
    } catch (error) {
      // Cache présent mais périmé : on préfère une clé un peu vieille à une
      // connexion refusée pour une panne réseau. Cache absent : on propage.
      if (!cache) throw error;
      logger.warn(`[federation] jeu de clés non rafraîchi (${error.code ?? error.message}) — cache conservé.`);
    }
  }

  if (cache?.keys.has(kid)) return cache.keys.get(kid);

  // Inconnu du cache : peut-être une clé neuve. Une relecture, une seule.
  if (!perime) {
    try {
      await fetchJwks();
    } catch (error) {
      logger.warn(`[federation] relecture du jeu de clés impossible (${error.code ?? error.message}).`);
      return null;
    }
    if (cache?.keys.has(kid)) return cache.keys.get(kid);
  }

  return null;
}

export default { configureJwksFetch, federationAvailable, publicJwkFor, resetJwksCache };
