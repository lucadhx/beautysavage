// LES DOCUMENTS LÉGAUX DE CE PROJET — reçus, appliqués, servis. Jamais écrits.
//
// ══ CE QUE CE MODULE EST L'AUTORITÉ DE RÉPONDRE ═════════════════════════════
//
//   « Que doit afficher /mentions-legales ? »            → `getLegalDocument()`
//   « Et /politique-de-confidentialite ? »               → idem, autre type.
//
// ══ CE QU'IL NE FAIT JAMAIS ════════════════════════════════════════════════
//
// RÉDIGER. Ni ce module, ni aucune route, ni aucun écran de ce dépôt ne compose
// un document légal. Le Panel en est l'autorité, et cette asymétrie est le cœur
// du chantier : une vitrine qui pourrait éditer ses mentions légales en
// détiendrait une copie, et cette copie divergerait — c'est exactement ce que
// le référentiel central existe pour supprimer.
//
// La seule écriture est celle de l'APPLICATEUR, sur réception du pont.
//
// ══ AUCUN ACCÈS RÉSEAU ═════════════════════════════════════════════════════
//
// On lit le DERNIER document reçu, persisté localement. Afficher les mentions
// légales n'interroge donc jamais le Panel : une panne du Panel ne vide pas la
// page, elle fige ce qu'on sait déjà. Sur une obligation légale, c'est la seule
// discipline acceptable.
//
// ══ AUCUN REPLI SILENCIEUX ═════════════════════════════════════════════════
//
// Sans document publié, la lecture rend `null` et la route publique répond 404.
// Elle ne retombe JAMAIS sur un texte générique, ni sur la fiche `Company`
// locale, ni sur un document d'un autre type. Afficher des mentions légales
// approximatives serait pire que de ne pas en afficher : elles seraient
// opposables.
import logger from '../../utils/logger.js';
import config from '../../config/env.js';
import { notifyResourceChanged, UI_RESOURCE } from '../uiLive/uiLive.service.js';
import { LegalDocument } from '../../models/LegalDocument.model.js';
import { legalDocumentPayloadSchema } from '../panelBridge/bridgeContract.js';

/* -------------------------------------------------------------------------- */
/*  L'IDENTITÉ DE CE PROJET — INJECTÉE, JAMAIS LUE DANS LE PONT               */
/* -------------------------------------------------------------------------- */

/**
 * QUI SOMMES-NOUS ? — la question que la garde multi-tenant doit poser.
 *
 * ══ POURQUOI UNE INJECTION PLUTÔT QU'UN IMPORT ═════════════════════════════
 *
 * La réponse vit dans l'appairage, donc dans le module de pont. Or la règle
 * d'architecture du dépôt est explicite et vérifiée par
 * `bridge-conformity.test.js` : AUCUN composant métier n'importe le module de
 * pont, hors le CONTRAT (`bridgeContract.js`, un vocabulaire) et deux façades
 * de lecture nommément listées.
 *
 * Elle n'est pas cosmétique : un service métier qui lit `pairingStore` gagne
 * l'accès au jeton de pont, à la file, à l'ordonnanceur et au transport — et
 * la prochaine ligne écrite ici pourrait, sans que personne ne le remarque,
 * émettre vers le Panel depuis un applicateur.
 *
 * Le CÂBLAGE est donc fait au bootstrap, le seul endroit autorisé à connaître
 * les deux mondes. Ce module reçoit une fonction, et ne peut rien faire de
 * plus que l'appeler.
 *
 * ══ LE DÉFAUT SÛR EST « JE NE SAIS PAS » ═══════════════════════════════════
 *
 * Tant que rien n'est câblé, le fournisseur rend `null`, et TOUT document est
 * refusé. C'est le bon comportement : un projet incapable de vérifier à qui
 * s'adresse ce qu'il reçoit ne doit rien appliquer.
 */
let fournisseurIdentite = () => null;

export function configureLegalDocumentIdentity(provider) {
  fournisseurIdentite = typeof provider === 'function' ? provider : () => null;
}

/** Remise à l'état initial — recettes uniquement. */
export function resetLegalDocumentIdentityForTests() {
  fournisseurIdentite = () => null;
}

/* -------------------------------------------------------------------------- */
/*  APPLICATION                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Applique un document légal publié par le Panel.
 *
 * @param {object} payload  charge utile `LegalDocumentPayload`
 * @param {'BOOTSTRAP'|'SYNC'} source
 * @param {string|null} bridgeEntityId
 */
export async function applyLegalDocument(payload, source = 'SYNC', bridgeEntityId = null) {
  const parsed = legalDocumentPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · ');
    logger.warn(`[panel-bridge] Document légal refusé (non conforme) : ${detail}`);
    return { applied: false, reason: 'INVALID_PAYLOAD' };
  }
  const value = parsed.data;

  /**
   * ── LA GARDE MULTI-TENANT, TENUE PAR CE CÔTÉ-CI ────────────────────────
   *
   * L'audience de l'écriture décide déjà de qui reçoit quoi, et c'est la
   * barrière principale — elle est portée par le journal du Panel. Celle-ci en
   * est une SECONDE, indépendante, tenue par l'autre côté.
   *
   * Elle attrape ce que la première ne peut pas voir : une erreur d'audience,
   * un rejeu vers le mauvais destinataire, une base de recette restaurée sur le
   * mauvais projet. Sans elle, l'incident se solderait par l'affichage
   * SILENCIEUX des mentions légales d'un autre client — le pire résultat
   * possible, puisque rien n'échouerait.
   *
   * Un projet non appairé n'a pas d'identité à comparer : il n'a alors AUCUN
   * moyen de vérifier, et il refuse. C'est le bon défaut — un document arrivé
   * hors appairage n'a aucune raison d'être appliqué.
   */
  const monProjectId = fournisseurIdentite();
  if (!monProjectId || value.projectId !== monProjectId) {
    logger.warn(
      `[panel-bridge] Document légal REFUSÉ : il nomme le projet ${value.projectId}, `
      + `celui-ci est ${monProjectId ?? 'non appairé'}.`,
    );
    return { applied: false, reason: 'PROJECT_MISMATCH' };
  }

  /**
   * LE MONDE DOIT CONCORDER.
   *
   * Un document de production sur un site de recette afficherait le SIREN et
   * l'adresse réels d'un client sur une adresse d'essai. Même garde que pour
   * l'entreprise développeur et l'entreprise cliente.
   */
  if (value.environment !== config.env) {
    logger.warn(
      `[panel-bridge] Document légal ignoré : il vise ${value.environment}, `
      + `ce projet est en ${config.env}.`,
    );
    return { applied: false, reason: 'ENVIRONMENT_MISMATCH' };
  }

  const courant = await LegalDocument.findOne({ type: value.type }).lean();

  /**
   * UNE VERSION ANTÉRIEURE EST IGNORÉE.
   *
   * Après un rattrapage, le journal se rejoue dans l'ordre du JOURNAL, pas dans
   * celui des décisions. Sans cette garde, les versions historiques
   * s'appliqueraient l'une après l'autre et la page clignoterait entre
   * plusieurs textes avant de se stabiliser — sur le bon, mais après avoir
   * affiché les mauvais.
   *
   * La comparaison porte sur `documentVersion`, le compteur que le Panel tient
   * POUR CE PROJET — jamais sur `templateVersion`. Comparer des versions de
   * template ferait rejeter un changement d'affectation de A(v4) vers B(v1)
   * comme « plus ancien », et le site afficherait A pour toujours.
   */
  if (
    courant
    && typeof courant.documentVersion === 'number'
    && value.documentVersion <= courant.documentVersion
  ) {
    return { applied: false, reason: 'OLDER_VERSION', version: courant.documentVersion };
  }

  await LegalDocument.findOneAndUpdate(
    { type: value.type },
    {
      $set: {
        type: value.type,
        bridgeEntityId: bridgeEntityId ?? null,
        templateId: value.templateId,
        templateName: value.templateName,
        templateVersion: value.templateVersion,
        documentVersion: value.documentVersion,
        environment: value.environment,
        title: value.title,
        /**
         * LES BLOCS SONT NORMALISÉS À L'ÉCRITURE.
         *
         * Le contrat rend une union discriminée : un bloc `LIST` n'a pas de
         * `text`, un `PARAGRAPH` n'a pas d'`items`. Le modèle, lui, déclare les
         * trois champs. Les remplir explicitement — plutôt que de laisser
         * Mongoose deviner — évite qu'un `undefined` devienne un `null` ici et
         * une chaîne vide là, selon la version du pilote.
         */
        sections: value.sections.map((section) => ({
          heading: section.heading ?? '',
          blocks: section.blocks.map((block) => ({
            type: block.type,
            text: block.type === 'PARAGRAPH' ? block.text : '',
            items: block.type === 'LIST' ? block.items : [],
            fields: block.type === 'FIELDS' ? block.items : [],
          })),
        })),
        documentUpdatedAt: value.updatedAt ?? null,
        appliedAt: new Date(),
        source,
      },
    },
    { upsert: true, new: true },
  );

  logger.info(
    `[panel-bridge] Document légal « ${value.title} » (${value.type}) appliqué `
    + `— template « ${value.templateName} » v${value.templateVersion}, `
    + `document v${value.documentVersion}, ${source}.`,
  );

  /**
   * LES ONGLETS OUVERTS L'APPRENNENT — APRÈS l'écriture, jamais avant.
   *
   * Notifier d'abord ouvrirait une fenêtre où le navigateur redemande la page
   * et reçoit l'ANCIENNE — puis ne redemande plus jamais, puisqu'il a déjà été
   * prévenu. C'est ce canal qui rend « publier depuis le Panel » visible sur un
   * site déjà ouvert, sans rechargement et sans redéploiement.
   */
  notifyResourceChanged(UI_RESOURCE.LEGAL_DOCUMENT, { reason: source, type: value.type });

  return { applied: true, version: value.documentVersion };
}

/**
 * Handler de synchronisation pour `LEGAL_DOCUMENT`.
 *
 * ── LE TOMBSTONE RETIRE LA PAGE, ET C'EST VOULU ────────────────────────────
 *
 * Le Panel l'émet quand un projet n'a plus d'affectation pour ce type. La page
 * doit alors disparaître : la laisser en place afficherait indéfiniment un
 * document que plus personne n'a choisi, et personne ne saurait d'où il vient.
 *
 * On SUPPRIME le document plutôt que de le vider. Un document vide serait un
 * état de plus à gérer dans chaque lecteur — et le premier qui l'oublierait
 * rendrait une page blanche avec un titre.
 */
export async function applyLegalDocumentChange({ change }) {
  if (change.deleted) {
    /**
     * ON N'EFFACE QUE CE QUE L'ÉCRITURE DÉSIGNE.
     *
     * Le tombstone n'a pas de charge utile : il ne nomme le document que par
     * son `entityId`. Sans le rapprochement, un retrait effacerait « le »
     * document — lequel ? — au lieu du bon. Avec deux types servis, ce serait
     * une page sur deux, au hasard.
     */
    const courant = await LegalDocument.findOne({ bridgeEntityId: change.entityId }).lean();
    if (!courant) {
      return { applied: false, reason: 'UNKNOWN_ENTITY' };
    }
    await LegalDocument.deleteOne({ type: courant.type });
    logger.warn(
      `[panel-bridge] Document légal ${courant.type} RETIRÉ par le Panel — la page n’est plus servie.`,
    );
    notifyResourceChanged(UI_RESOURCE.LEGAL_DOCUMENT, { reason: 'REMOVED', type: courant.type });
    return { applied: true, removed: true };
  }
  return applyLegalDocument(change.payload, 'SYNC', change.entityId ?? null);
}

/* -------------------------------------------------------------------------- */
/*  LECTURE                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * LE DOCUMENT À SERVIR — ou `null`.
 *
 * `null` couvre deux situations qui se lisent pareil du point de vue du
 * visiteur : « jamais reçu » et « retiré par le Panel ». Dans les deux cas, la
 * page n'existe pas, et la route publique répond 404. Aucun repli.
 */
export async function getLegalDocument(type) {
  const document = await LegalDocument.findOne({ type }).lean();
  if (!document) return null;
  return {
    type: document.type,
    title: document.title,
    /**
     * `templateId` et `templateVersion` sont PUBLIÉS.
     *
     * Ce ne sont pas des secrets — un identifiant opaque et un entier — et ils
     * rendent la vérification de bout en bout possible : on peut prouver depuis
     * l'extérieur que le site affiche bien la version qu'on vient de publier.
     * Sans eux, cette preuve exigerait de comparer des paragraphes à l'œil.
     */
    templateId: document.templateId,
    templateVersion: document.templateVersion,
    documentVersion: document.documentVersion,
    updatedAt: document.documentUpdatedAt ?? null,
    sections: (document.sections ?? []).map((section) => ({
      heading: section.heading ?? '',
      blocks: (section.blocks ?? []).map((block) => {
        if (block.type === 'PARAGRAPH') return { type: 'PARAGRAPH', text: block.text };
        if (block.type === 'LIST') return { type: 'LIST', items: block.items ?? [] };
        return {
          type: 'FIELDS',
          items: (block.fields ?? []).map((f) => ({ label: f.label, value: f.value })),
        };
      }),
    })),
  };
}

/** Les documents disponibles — ce que le pied de page doit proposer. */
export async function listAvailableLegalDocuments() {
  const documents = await LegalDocument.find({}).select('type title documentVersion').lean();
  return documents.map((d) => ({ type: d.type, title: d.title }));
}

export default {
  applyLegalDocument,
  applyLegalDocumentChange,
  configureLegalDocumentIdentity,
  getLegalDocument,
  listAvailableLegalDocuments,
};
