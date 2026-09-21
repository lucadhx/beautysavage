// L'ANNUAIRE DES COMPTES DE CE PROJET — une seule lecture, deux populations.
//
// ══ QUI FAIT AUTORITÉ, ET SUR QUOI ══════════════════════════════════════════
//
//   les comptes LOCAUX      ce projet, et lui seul. Ils naissent, changent et
//                           meurent dans son Manager.
//   les accès L.Y SOLUTION  le Panel. Ce que nous en gardons est une
//                           PROJECTION — un journal de présence de qui est
//                           réellement venu, avec ce qu'on savait au dernier
//                           contact.
//
// Les deux se lisent ensemble parce qu'un opérateur se demande « qui peut
// entrer ici », pas « quelles collections existent ». Mais ils ne se
// confondent jamais : `source` et `principalType` les distinguent sur chaque
// ligne, et aucune écriture n'est possible sur la seconde population.
//
// ══ POURQUOI CETTE FONCTION EST PARTAGÉE ════════════════════════════════════
//
// Elle sert le Manager ET le pont vers le Panel. C'est la seule façon de
// garantir que les deux écrans montrent la même réalité : non pas parce
// qu'on l'a vérifié une fois, mais parce qu'il n'y a qu'un seul code capable
// de la produire.
import { User } from '../../models/User.model.js';
import { ExternalPrincipal, EXTERNAL_PROVIDERS } from '../../models/ExternalPrincipal.model.js';
import { localAccountView, panelAccountView } from './projectAccountView.js';

/**
 * TOUS LES COMPTES, DANS LA REPRÉSENTATION CANONIQUE.
 *
 * ── L'ORDRE EST STABLE, ET IL A UN SENS ─────────────────────────────────────
 *
 * Les comptes du projet d'abord, les accès L.Y Solution ensuite, chacun par
 * nom. Un ordre instable ferait « bouger » la liste entre deux
 * rafraîchissements et donnerait l'impression que quelque chose a changé
 * alors que rien n'a bougé.
 */
export async function listProjectAccounts() {
  const [locaux, federes] = await Promise.all([
    User.find().sort({ createdAt: 1 }).lean(),
    ExternalPrincipal
      .find({ provider: EXTERNAL_PROVIDERS.LY_SOLUTION_PANEL })
      .sort({ displayName: 1, email: 1 })
      .lean(),
  ]);

  return [
    ...locaux.map(localAccountView),
    ...federes.map(panelAccountView),
  ];
}

/** Le résumé que le Panel affiche en tête de liste, calculé ici une fois. */
export function summarizeAccounts(accounts) {
  return {
    total: accounts.length,
    local: accounts.filter((a) => a.source === 'LOCAL').length,
    panel: accounts.filter((a) => a.source === 'PANEL').length,
    disabled: accounts.filter((a) => a.enabled === false).length,
  };
}

export default { listProjectAccounts, summarizeAccounts };
