import { cleProjet } from '@/lib/projectIdentity';

/**
 * ══ CE QU'EST UN IDENTIFIANT DE RUN DE CE PROJET — UNE SEULE AUTORITÉ ═══════
 *
 * ── L'INCIDENT QUI A IMPOSÉ CE MODULE ──────────────────────────────────────
 *
 * Le backend de ce projet a reçu, quatre fois, une requête portant un
 * identifiant de run qu'il n'a JAMAIS pu produire :
 *
 *     GET /api/deployment/runs/4543fbf7-869c-4d4f-b385-a1869abcceae/stream?since=0
 *
 * Un run de ce projet est un document Mongo : son identifiant est un ObjectId
 * (24 caractères hexadécimaux), rendu au client par `String(run._id)`. La forme
 * ci-dessus est un UUID — la forme d'un AUTRE produit de l'écosystème.
 *
 * Un identifiant étranger ne devient jamais une adresse valide ici : au mieux
 * il produit un 401/404 qui ressemble à une panne d'authentification, au pire
 * il fait rejouer un suivi qui n'existe pas. Dans les deux cas, l'opérateur lit
 * un incident qui n'en est pas un — et cherche au mauvais endroit.
 *
 * ── POURQUOI UNE FONCTION PLUTÔT QU'UN `if` À CHAQUE APPEL ─────────────────
 *
 * Ce contrôle vit à DEUX frontières : ce qui revient d'un stockage persistant,
 * et ce qui part sur le réseau. Écrire la règle deux fois, c'est accepter
 * qu'elle diverge une fois.
 */

/**
 * LA FORME CANONIQUE, ET SON UNIQUE JUSTIFICATION.
 *
 * Le backend n'expose aucun contrat de format ; celui-ci est donc dérivé de la
 * seule source qui fasse foi — l'identifiant Mongo que le contrôleur rend
 * (`String(run._id)`). Si le projet adoptait un jour un autre format, c'est ICI
 * qu'il changerait, et la recette `deploymentRunId.test.mjs` le dirait.
 */
const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** Cet identifiant peut-il désigner un run DE CE PROJET ? */
export function estRunIdDeCeProjet(valeur: unknown): valeur is string {
  return typeof valeur === 'string' && OBJECT_ID.test(valeur);
}

/**
 * ══ CE QUI, SOUS `/runs/`, N'EST PAS UN IDENTIFIANT ════════════════════════
 *
 * ── LE DÉFAUT QUE CETTE LISTE CORRIGE ──────────────────────────────────────
 *
 * La garde des identifiants étrangers inspecte le premier segment après
 * `/deployment/runs/` et exige un ObjectId. Elle a été écrite quand ce segment
 * ne pouvait être QU'un identifiant.
 *
 * `GET /deployment/runs/active` — la découverte du déploiement en cours — a
 * changé cela : le segment y est un NOM DE SOUS-RESSOURCE. La garde y voyait un
 * identifiant mal formé et rejetait la requête AVANT le `fetch`, avec un code
 * `DEPLOYMENT_RUN_ID_ETRANGER`. L'écran de suivi ne se rendait donc jamais :
 * l'effet partait, aucune requête ne sortait, et le refus était avalé par le
 * `catch` de la découverte, qui traite légitimement un échec comme « aucun run ».
 *
 * ── POURQUOI UNE LISTE EXPLICITE, ET NON UN ASSOUPLISSEMENT DE LA FORME ────
 *
 * On aurait pu ne rejeter que ce qui RESSEMBLE à un identifiant étranger (un
 * UUID, par exemple). Ce serait affaiblir la garde exactement là où elle a été
 * posée : un format inconnu inventé demain repasserait. La règle reste donc
 * « tout ce qui occupe la place d'un identifiant DOIT en être un », et l'on
 * NOMME les rares mots de route qui n'en occupent pas la place.
 *
 * Ajouter une sous-ressource ici est un acte délibéré, visible en revue — pas
 * un effet de bord d'une expression régulière élargie.
 */
export const SOUS_RESSOURCES_DE_RUNS = Object.freeze(['active']);

/** Ce segment est-il un mot de route plutôt qu'un identifiant ? */
export function estSousRessourceDeRuns(valeur: unknown): boolean {
  return typeof valeur === 'string' && SOUS_RESSOURCES_DE_RUNS.includes(valeur);
}

/**
 * Préfixe des identifiants de run mémorisés par les écrans de déploiement.
 * Voir `RemovalDialog` : `<projet>.deployment.run.<mode>.<targetId>`.
 *
 * Préfixé par le PROJET, comme tout ce que ce manager écrit sur une origine
 * qu'il partage avec les autres managers du parc (voir `projectIdentity`). Les
 * identifiants de run sont des ObjectId : deux projets ne peuvent pas se
 * tromper l'un pour l'autre, mais le cloisonnement ne se décide pas au cas par
 * cas — une exception « sans risque » est une exception qu'on oublie.
 */
export const PREFIXE_MEMOIRE = cleProjet('deployment.run.');

/**
 * ══ PURGE DES RUNS ÉTRANGERS OU PÉRIMÉS, AU DÉMARRAGE ══════════════════════
 *
 * Un identifiant mémorisé survit à un rechargement complet — c'est sa raison
 * d'être : retrouver une opération en cours plutôt que d'en lancer une seconde.
 * Mais il survit AUSSI à un changement de produit, à une migration, ou à une
 * session ouverte sur un autre outil de l'écosystème.
 *
 * On ne purge donc pas « le cache » : on retire EXACTEMENT les entrées dont la
 * forme prouve qu'elles ne peuvent pas désigner un run d'ici. Une entrée
 * valide n'est jamais touchée — sans quoi la reprise d'opération, qui est le
 * comportement qu'on veut, disparaîtrait avec le défaut qu'on corrige.
 *
 * Ne lève jamais : un stockage refusé (navigation privée, quota) ne doit pas
 * empêcher l'application de démarrer.
 */
export function purgerRunsEtrangers(): { retires: string[] } {
  const retires: string[] = [];
  for (const stockage of [
    typeof sessionStorage !== 'undefined' ? sessionStorage : null,
    typeof localStorage !== 'undefined' ? localStorage : null,
  ]) {
    if (!stockage) continue;
    try {
      const cles: string[] = [];
      for (let i = 0; i < stockage.length; i += 1) {
        const cle = stockage.key(i);
        if (cle && cle.startsWith(PREFIXE_MEMOIRE)) cles.push(cle);
      }
      for (const cle of cles) {
        const valeur = stockage.getItem(cle);
        if (estRunIdDeCeProjet(valeur)) continue;
        stockage.removeItem(cle);
        retires.push(cle);
      }
    } catch {
      /* stockage indisponible : rien à purger, et surtout rien à casser */
    }
  }
  return { retires };
}

export default { estRunIdDeCeProjet, purgerRunsEtrangers };
