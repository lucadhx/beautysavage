/**
 * QUI DÉTIENT LES MÉDIAS MÉTIER DE CE PROJET — une seule instance, jamais deux.
 *
 * ══ LE DÉFAUT D'ORIGINE ═════════════════════════════════════════════════════
 *
 * Chaque instance du backend écrivait dans son propre dossier `/uploads`. Un
 * logo client, une photo avant/après ou une bannière importés depuis un poste
 * de développement vivaient sur ce poste ; le site déployé ne les avait jamais
 * vus. Et inversement : un média importé depuis le Manager déployé restait
 * invisible en local.
 *
 * Deux dossiers, deux vérités, et aucune façon de savoir laquelle la vitrine
 * afficherait. Synchroniser les deux aurait été pire : suppressions
 * concurrentes, noms identiques, contenus divergents, et une dépendance à un
 * poste allumé.
 *
 * ══ LA RÈGLE ═══════════════════════════════════════════════════════════════
 *
 * Le BACKEND DÉPLOYÉ du projet est l'autorité de SES médias métier. Toute
 * autre instance est un CLIENT : elle relaie, elle ne stocke rien.
 *
 *   Manager local    → backend local (relais authentifié)
 *                                    → backend canonique du projet
 *                                    → shared/uploads du projet
 *   Manager déployé  → backend canonique → même shared/uploads
 *   Vitrine          → lit le même backend canonique
 *
 * Le navigateur ne parle JAMAIS directement à l'autorité : il parle à son
 * propre backend, qui relaie en portant l'identité de l'appelant. Aucun
 * secret n'approche le navigateur, aucune adresse d'autorité n'y transite.
 *
 * ══ CE QUE CE MODULE N'EST PAS ══════════════════════════════════════════════
 *
 * Ce n'est pas une synchronisation de dossiers. Il n'y a qu'UN dossier. Rien
 * n'est copié dans les deux sens, et un média supprimé l'est là où il vit
 * réellement — donc partout, au même instant.
 *
 * Ce n'est pas non plus le pont du Panel : les médias MÉTIER d'un projet lui
 * appartiennent. Les faire transiter par le Panel ferait de lui un dépôt de
 * fichiers clients, ce qu'il n'est pas et ne doit pas devenir.
 */
import { config } from '../../config/env.js';
import { getPublicBackendUrl } from '../networkConfig.service.js';

/** Retire le préfixe d'API : `api.projet.fr` et `projet.fr` désignent le même backend. */
function siteHost(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h.startsWith('api.') ? h.slice(4) : h;
  } catch {
    return null;
  }
}

/** Une adresse qui ne désigne que la machine courante. */
function estLocale(url) {
  const h = siteHost(url);
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0';
}

/**
 * L'autorité média du projet, et le rôle de CETTE instance.
 *
 * ── DEUX PIÈGES, TOUS DEUX RÉELS ────────────────────────────────────────────
 *
 *  · l'adresse canonique est celle de l'API (`api.projet.fr`) alors qu'une
 *    instance se connaît par son adresse de façade. Comparer les chaînes
 *    ferait croire au backend déployé qu'il n'est pas l'autorité — et il se
 *    relaierait à lui-même, indéfiniment ;
 *
 *  · un poste de développement partage la BASE du projet déployé. L'adresse
 *    canonique qu'il y lit est donc celle du déployé, pas la sienne.
 *
 * On compare donc les DOMAINES, préfixe d'API retiré. Un poste dont l'adresse
 * propre est une boucle locale n'est jamais l'autorité — sauf si l'adresse
 * canonique est elle aussi locale, c'est-à-dire qu'aucun déploiement n'existe
 * encore : le poste est alors seul, et se suffit.
 *
 * @returns {Promise<{authority: string|null, isAuthority: boolean, reason: string}>}
 */
export async function resolveProjectMediaAuthority() {
  const canonique = await getPublicBackendUrl().catch(() => '');
  const moi = config.publicUrl || null;

  // Sans adresse canonique, il n'y a personne à qui relayer : cette instance
  // se suffit. C'est le cas d'un projet jamais déployé.
  if (!canonique) {
    return { authority: null, isAuthority: true, reason: 'AUCUNE_ADRESSE_CANONIQUE' };
  }

  // Aucune adresse propre : on ne peut pas prouver qu'on est un client, et se
  // relayer à l'aveugle risquerait une boucle. On stocke.
  if (!moi) {
    return { authority: null, isAuthority: true, reason: 'ADRESSE_PROPRE_INCONNUE' };
  }

  // Le backend canonique tourne en local : il n'y a pas encore de déployé.
  if (estLocale(canonique)) {
    return { authority: null, isAuthority: true, reason: 'CANONIQUE_LOCALE' };
  }

  // Même domaine, préfixe d'API retiré : c'est bien nous. Sans cette
  // comparaison, le backend déployé se relaierait à lui-même.
  if (siteHost(moi) === siteHost(canonique)) {
    return { authority: canonique, isAuthority: true, reason: 'MEME_DOMAINE' };
  }

  return { authority: canonique, isAuthority: false, reason: 'INSTANCE_CLIENTE' };
}

/**
 * Relaie une requête vers l'autorité, en portant l'identité de l'appelant.
 *
 * ── AUCUN SECRET N'EST STOCKÉ ───────────────────────────────────────────────
 * On réémet le `Authorization` reçu. Les deux instances partagent la clé de
 * signature des jetons : celui de l'utilisateur est donc déjà valide côté
 * autorité. Rien à provisionner, rien à faire tourner, et surtout aucun
 * identifiant permanent dans le navigateur.
 *
 * ── AUCUNE ÉCRITURE SI L'AUTORITÉ EST INDISPONIBLE ──────────────────────────
 * L'appelant qui reçoit une erreur de relais ne doit PAS se rabattre sur son
 * disque local : ce repli recréerait exactement les deux vérités qu'on vient
 * de supprimer. Le relais échoue, l'import échoue, et l'écran le dit.
 */
export async function relayToProjectAuthority(authority, chemin, { method = 'GET', headers = {}, body } = {}) {
  const cible = `${String(authority).replace(/\/+$/, '')}${chemin}`;
  return fetch(cible, {
    method,
    headers,
    body,
    // Un média ne suit jamais de redirection : une redirection vers un autre
    // hôte ferait sortir la lecture de l'autorité sans qu'on le sache.
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });
}

export default { resolveProjectMediaAuthority, relayToProjectAuthority };
