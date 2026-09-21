import { singletonFactory } from '../utils/singletonFactory.js';
import { Company } from '../models/Company.model.js';
import { HomeContent } from '../models/HomeContent.model.js';
import { Theme } from '../models/Theme.model.js';
import { ManagerTheme } from '../models/ManagerTheme.model.js';

import { RoleAppearance } from '../models/RoleAppearance.model.js';

/**
 * ENTREPRISE — la fiche brute, plus les adresses d'affichage de ses médias.
 *
 * Les champs stockés (`logos.header`, `heroImage`) restent des CHEMINS : c'est
 * ce que l'écran renvoie en enregistrant, et une adresse calculée qui y
 * reviendrait serait persistée. Les adresses résolues vivent donc à côté, dans
 * `mediaResolution`, indexées par le chemin du descripteur.
 */
export const companyController = singletonFactory(Company, {
  decorate: async (doc) => {
    const { companyMediaResolution } = await import('../services/media/mediaProjection.service.js');
    return { ...doc.toObject(), mediaResolution: await companyMediaResolution(doc) };
  },
  /**
   * ── LE SIGNATAIRE CONTRACTUEL N'EST PLUS ÉCRIT ICI ────────────────────────
   *
   * ══ CE QU'IL FAISAIT, ET POURQUOI C'ÉTAIT LA MAUVAISE MAISON ═════════════
   *
   * `Company.signer` était la personne physique qui engage l'entreprise
   * cliente. Éditée depuis CE Manager, donc par le client lui-même. Deux
   * conséquences, et les deux se sont produites :
   *
   *   · un même client possédant deux sites pouvait déclarer deux signataires
   *     différents pour la même personne morale, et rien ne disait lequel
   *     engageait réellement l'entreprise ;
   *   · le CLIENT choisissait l'identité qui signe le contrat que
   *     L.Y Solution lui présente.
   *
   * L'autorité est désormais la fiche « Clients » du Panel, publiée par le
   * pont. Ce projet la REÇOIT et l'affiche ; il ne l'écrit jamais.
   *
   * ══ POURQUOI ON RETIRE EN SILENCE PLUTÔT QUE DE REFUSER ══════════════════
   *
   * Un onglet resté ouvert sur l'ancienne version de l'écran renvoie tout le
   * document, `signer` compris. Refuser la requête entière l'empêcherait
   * d'enregistrer ses HORAIRES D'OUVERTURE — une régression franche, pour un
   * champ dont la valeur n'est de toute façon plus lue par personne.
   *
   * On l'écarte donc, et le champ persisté reste tel quel : aucune donnée
   * historique n'est détruite, et plus aucune écriture ne la modifie.
   */
  transform: (body) => {
    if (!body || typeof body !== 'object') return body;
    const { signer, ...reste } = body;
    void signer;
    return reste;
  },
});
/**
 * CONTENU D'ACCUEIL — le document brut, plus l'adresse de l'image de maquette.
 *
 * `image` reste un CHEMIN en base : c'est ce que l'écran renvoie en
 * enregistrant, et une adresse calculée qui y reviendrait serait persistée —
 * exactement le défaut que le descripteur supprime. L'adresse d'affichage
 * voyage donc dans un bloc parallèle, lu par l'aperçu et ignoré à l'écriture.
 */
export const homeContentController = singletonFactory(HomeContent, {
  decorate: async (doc) => {
    const { projectHomeContentMedia } = await import('../services/media/mediaProjection.service.js');
    const projete = await projectHomeContentMedia(doc);
    return {
      ...doc.toObject(),
      heroImageUrl: projete?.hero?.image ?? '',
      showcaseImageUrl: projete?.showcase?.image ?? '',
    };
  },
});

export const themeController = singletonFactory(Theme);
export const managerThemeController = singletonFactory(ManagerTheme);

export const roleAppearanceController = singletonFactory(RoleAppearance);
