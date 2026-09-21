/**
 * OÙ ENVOYER UN HUMAIN CHEZ LE PANEL — et pourquoi ce n'est pas `panelUrl`.
 *
 * ══ LE DÉFAUT QUE CE MODULE FERME ═══════════════════════════════════════════
 *
 * `panelUrl` servait à DEUX usages incompatibles :
 *
 *   · l'adresse de l'API du Panel, celle que le pont appelle — battements,
 *     synchronisation, capacités. C'est une adresse de MACHINE ;
 *   · l'origine où l'on envoie un NAVIGATEUR pour l'écran d'autorisation
 *     `/federation/authorize`. C'est une adresse d'HUMAIN.
 *
 * Chez L.Y Solution, l'hôte du frontal sert le SPA *et* proxifie `/api` ; l'hôte
 * d'API, lui, ne sert que l'API. Les deux valeurs « marchent » donc pour le
 * pont, et une seule marche pour la fédération. Le projet historique avait
 * enregistré l'origine du frontal : sa connexion fédérée fonctionnait, par
 * accident. Le premier projet dupliqué a enregistré l'origine d'API — celle que
 * la documentation d'appairage prescrit d'écrire dans le `.env` — et son bouton
 * « Se connecter avec L.Y Solution » a répondu :
 *
 *     {"success":false,"code":"NOT_FOUND",
 *      "message":"Route inconnue : GET /federation/authorize"}
 *
 * Un champ, deux rôles : tant qu'un seul projet existait, le conflit était
 * indécelable. C'est la forme même du défaut qu'un parc révèle.
 *
 * ══ L'ORDRE D'AUTORITÉ ══════════════════════════════════════════════════════
 *
 *   1. DÉCLARÉE — le Panel a dit son adresse publique à l'appairage. C'est la
 *      seule source qui SAIT : lui seul connaît sa propre topologie ;
 *   2. DÉRIVÉE — à défaut, on retire le sous-domaine d'API de l'adresse d'API,
 *      selon la convention de la fabrique (`API_SUBDOMAIN`). C'est une
 *      déduction, elle est NOMMÉE comme telle, et elle n'existe que pour les
 *      Panels antérieurs à cette correction ;
 *   3. REFUS — si rien n'est déductible, on refuse d'ouvrir le parcours. Un
 *      refus explicite vaut mieux qu'une redirection vers une page qui n'existe
 *      pas : le second se diagnostique en une demi-journée, le premier se lit.
 */
import { API_SUBDOMAIN } from '../../deployment-engine/config/project.profile.js';

/** D'où vient l'adresse retenue. Codes STABLES : ils sont journalisés et testés. */
export const PANEL_FRONTEND_SOURCE = Object.freeze({
  DECLARED: 'DECLARED',
  DERIVED: 'DERIVED',
  NONE: 'NONE',
});

/** Le code de refus, quand aucune origine humaine n'est connaissable. */
export const PANEL_FRONTEND_UNKNOWN = 'FEDERATION_PANEL_FRONTEND_UNKNOWN';

function normaliser(candidat) {
  const brut = String(candidat ?? '').trim();
  if (!brut) return null;
  let url;
  try { url = new URL(brut); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return `${url.protocol}//${url.host}`;
}

/**
 * Retire le sous-domaine d'API d'un hôte — `api.panel.exemple.com` →
 * `panel.exemple.com`. Rend `null` si l'hôte n'en porte pas : on ne devine
 * jamais deux fois.
 */
export function stripApiSubdomain(origine) {
  const normalisee = normaliser(origine);
  if (!normalisee) return null;
  const url = new URL(normalisee);
  const prefixe = `${API_SUBDOMAIN}.`;
  if (!url.hostname.startsWith(prefixe)) return null;
  const hote = url.hostname.slice(prefixe.length);
  // Un hôte réduit à un seul label après retrait ne serait pas un domaine.
  if (!hote.includes('.')) return null;
  url.hostname = hote;
  return `${url.protocol}//${url.host}`;
}

/**
 * L'ORIGINE PUBLIQUE DU PANEL, POUR UN NAVIGATEUR.
 *
 * @param {object} entree
 * @param {string|null} entree.declared  ce que le Panel a déclaré à l'appairage
 * @param {string|null} entree.panelUrl  l'adresse d'API connue du pont
 * @returns {{url: string, source: string}}
 * @throws  {Error & {code: string}} si aucune origine n'est connaissable
 */
export function resolvePanelFrontendUrl({ declared = null, panelUrl = null } = {}) {
  const declaree = normaliser(declared);
  if (declaree) return { url: declaree, source: PANEL_FRONTEND_SOURCE.DECLARED };

  const derivee = stripApiSubdomain(panelUrl);
  if (derivee) return { url: derivee, source: PANEL_FRONTEND_SOURCE.DERIVED };

  /**
   * DERNIER CAS : l'adresse d'API n'a pas de sous-domaine d'API — le Panel est
   * peut-être servi à la racine, auquel cas `panelUrl` EST l'origine humaine.
   * On l'accepte, mais seulement ici, après avoir écarté les deux autres :
   * l'accepter d'emblée aurait reproduit exactement le défaut d'origine.
   */
  const brute = normaliser(panelUrl);
  if (brute && !new URL(brute).hostname.startsWith(`${API_SUBDOMAIN}.`)) {
    return { url: brute, source: PANEL_FRONTEND_SOURCE.DERIVED };
  }

  const err = new Error(
    'Adresse publique du Panel inconnue : impossible d’ouvrir une connexion L.Y Solution. '
    + 'Le Panel ne l’a pas déclarée à l’appairage, et elle ne se déduit pas de son adresse d’API.',
  );
  err.code = PANEL_FRONTEND_UNKNOWN;
  throw err;
}

export default { resolvePanelFrontendUrl, stripApiSubdomain, PANEL_FRONTEND_SOURCE, PANEL_FRONTEND_UNKNOWN };
