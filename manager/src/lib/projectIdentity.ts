/**
 * ══ À QUEL PROJET APPARTIENT CE MANAGER — UNE SEULE AUTORITÉ ════════════════
 *
 * ── L'INCIDENT QUI A IMPOSÉ CE MODULE ──────────────────────────────────────
 *
 * Le régime de développement canonique sert TOUS les projets de la fabrique sur
 * la MÊME origine : `http://localhost:6071` (voir `vite.config.ts`). Or une
 * origine, c'est exactement le périmètre d'isolation de `localStorage`.
 *
 * Les quatre managers du parc écrivaient donc leur état sous des clés
 * IDENTIQUES et globales — `manager.company.cache`, `manager.session.token`,
 * `sb_federation_state`. Ouvrir le manager de FJ Services après celui de
 * KleenPro faisait démarrer FJ avec le nom, le logo et le favicon de KleenPro,
 * hydratés SYNCHRONEMENT au premier rendu ; et comme `CompanyContext` ne vide
 * jamais son cache sur une panne d'API (« la dernière identité connue vaut
 * mieux qu'un écran anonyme »), l'identité empruntée pouvait rester à l'écran
 * indéfiniment.
 *
 * Le jeton de session partageait le même défaut, et c'est lui qui ARMAIT le
 * précédent : `hasSession()` répondait « oui » sur le jeton du projet d'avant,
 * ce qui autorisait la lecture du cache d'entreprise étranger.
 *
 * ── POURQUOI LE NOM DU PAQUET, ET PAS AUTRE CHOSE ─────────────────────────
 *
 * L'identité doit venir d'une autorité de BUILD, stable et déjà réécrite à la
 * duplication. Trois candidats, un seul convient :
 *
 *   · le nom de l'entreprise (API)   — MUTABLE, et il arrive APRÈS le premier
 *                                      rendu : c'est précisément la donnée que
 *                                      l'on cherche à cloisonner ;
 *   · `VITE_API_URL`                 — vide en DEV canonique, et identique
 *                                      (`localhost:6070`) pour tout le parc ;
 *   · `manager/package.json` `name`  — `<PROJECT_SLUG>-manager`, RÉÉCRIT par le
 *                                      moteur de duplication au même instant
 *                                      que `project.profile.js`. C'est le seul
 *                                      qui soit à la fois figé au build, propre
 *                                      au projet, et déjà gardé.
 *
 * `vite.config.ts` l'injecte donc sous `__PROJECT_KEY__`.
 *
 * ── ET SI L'INJECTION MANQUE : ISOLÉ, PAS PARTAGÉ ─────────────────────────
 *
 * Retomber sur un espace de noms global serait recréer le défaut exact que ce
 * module ferme — en silence, et le jour où la configuration de build change.
 * On retombe donc sur un espace de noms ALÉATOIRE, propre à ce chargement : le
 * stockage devient inutile (rien n'y est relu d'une fois sur l'autre), il n'est
 * jamais partagé, et la console le dit. Inutilisable-mais-cloisonné est le seul
 * repli acceptable ; partagé-mais-pratique est ce qui a produit l'incident.
 */

/** Injecté au build par `vite.config.ts` (`define`). Absent sous Node pur. */
declare const __PROJECT_KEY__: string | undefined;

function resoudreCleProjet(): string {
  /**
   * `typeof` sur un identifiant NON DÉCLARÉ ne lève pas — c'est ce qui permet
   * aux recettes de modules purs (Node, sans Vite) d'importer ce fichier sans
   * que le remplacement ait eu lieu.
   */
  const injecte = typeof __PROJECT_KEY__ === 'string' ? __PROJECT_KEY__.trim() : '';
  if (injecte) return injecte;

  const secours = `projet-non-identifie-${Math.random().toString(36).slice(2, 10)}`;
  try {
    console.error(
      '[projectIdentity] __PROJECT_KEY__ absent du build : le stockage local repart '
      + `d'un espace de noms jetable (${secours}). Aucun état ne sera relu, et AUCUN `
      + 'ne sera partagé avec un autre projet. Vérifiez le `define` de vite.config.ts.',
    );
  } catch { /* pas de console : rien à signaler, la garde tient quand même */ }
  return secours;
}

/**
 * LA CLÉ DE CE PROJET. `rlv-detail`, `kleenpro`, `sbauto`, `fj-services-06`…
 * — c'est-à-dire le `PROJECT_SLUG` du profil de déploiement.
 */
export const PROJECT_KEY = resoudreCleProjet();

/**
 * PRÉFIXE TOUTE CLÉ DE STOCKAGE PAR LE PROJET.
 *
 * Un seul point de passage : une clé écrite à la main ailleurs échapperait au
 * cloisonnement, et la garde `managerStorageIsolation.test.mjs` échoue si l'un
 * des modules concernés reconstruit sa clé sans passer par ici.
 */
export function cleProjet(suffixe: string): string {
  return `${PROJECT_KEY}.${suffixe}`;
}

export default { PROJECT_KEY, cleProjet };
