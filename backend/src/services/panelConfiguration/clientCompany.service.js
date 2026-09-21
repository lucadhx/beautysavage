// L'ENTREPRISE CLIENTE DE CE PROJET — reçue, appliquée, lue. Jamais écrite.
//
// ══ CE QUE CE MODULE EST L'AUTORITÉ DE RÉPONDRE ═════════════════════════════
//
//   « Qui est le client de ce projet ? »   → sa raison sociale, son SIREN,
//                                             son adresse, publiés par le Panel.
//   « Peut-il payer ? »                     → `readiness.billing`.
//   « Peut-il signer, et par qui ? »        → `readiness.signing` et le
//                                             signataire contractuel.
//
// ══ CE QU'IL NE FAIT JAMAIS ════════════════════════════════════════════════
//
// ÉCRIRE. Ni ce module, ni aucune route, ni aucun écran de ce projet ne
// modifie l'identité juridique du client. Le Panel en est l'autorité, et cette
// asymétrie est le cœur du chantier : un client ne choisit pas la raison
// sociale sur laquelle il est facturé, ni la personne qui l'engage.
//
// La seule écriture est celle de l'APPLICATEUR, sur réception du pont.
//
// ══ AUCUN ACCÈS RÉSEAU ═════════════════════════════════════════════════════
//
// On lit la DERNIÈRE configuration reçue, persistée localement. Afficher la
// page « Mon entreprise » n'interroge donc jamais le Panel : une panne du Panel
// ne vide pas l'écran, elle fige ce qu'on sait déjà. Même discipline que
// l'identité développeur.
//
// ══ AUCUN REPLI SILENCIEUX ═════════════════════════════════════════════════
//
// Sans entreprise publiée, ces fonctions rendent `null` ou un refus explicite.
// Elles ne retombent JAMAIS sur `Company` — la fiche locale du client, qui
// décrit son commerce (nom d'enseigne, horaires, logos) et n'a jamais porté
// d'identité juridique. Confondre les deux ferait facturer « SB Auto 06 » à la
// place de la société qui l'exploite.
import logger from '../../utils/logger.js';
import config from '../../config/env.js';
import { notifyResourceChanged, UI_RESOURCE } from '../uiLive/uiLive.service.js';
import { PanelClientCompanyConfiguration } from '../../models/PanelConfiguration.model.js';
import { clientCompanyProfileSchema } from '../panelBridge/bridgeContract.js';

/**
 * LES ÉTATS DE PRÉPARATION — le vocabulaire du Panel, repris tel quel.
 *
 * ══ POURQUOI ON NE LES RECALCULE PAS ═══════════════════════════════════════
 *
 * Ce projet a tous les champs sous les yeux : il POURRAIT juger de la
 * complétude. Il ne doit pas. La complétude est une décision de FACTURATION,
 * elle appartient à l'émetteur des factures, et deux implémentations
 * divergeraient au premier changement de mention obligatoire — par exemple le
 * SIREN, qui devient obligatoire sur la facture électronique française au
 * 1er septembre 2026.
 *
 * Ces constantes ne servent donc qu'à LIRE le verdict reçu, jamais à le
 * produire.
 */
export const CLIENT_COMPANY_READINESS = Object.freeze({
  READY: 'READY',
  MISSING_COMPANY: 'MISSING_COMPANY',
  MISSING_BILLING_IDENTITY: 'MISSING_BILLING_IDENTITY',
  MISSING_SIGNER: 'MISSING_SIGNER',
});

/* -------------------------------------------------------------------------- */
/*  APPLICATION                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Applique un profil d'entreprise cliente publié par le Panel.
 *
 * @param {object} profile  charge utile `ClientCompanyProfile`
 * @param {'BOOTSTRAP'|'SYNC'} source
 * @returns {{applied: boolean, reason?: string, version?: number}}
 */
export async function applyClientCompanyProfile(profile, source = 'SYNC', bridgeEntityId = null) {
  const parsed = clientCompanyProfileSchema.safeParse(profile);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · ');
    logger.warn(`[panel-bridge] Entreprise cliente refusée (non conforme) : ${detail}`);
    return { applied: false, reason: 'INVALID_PAYLOAD' };
  }
  const value = parsed.data;

  /**
   * LE MONDE DOIT CONCORDER.
   *
   * Une entreprise cliente de production n'a rien à faire dans un projet de
   * recette : son SIREN, son adresse et son signataire réels s'afficheraient
   * sur un site d'essai, et une facture d'essai partirait à son nom. Même
   * garde que pour l'entreprise développeur.
   */
  if (value.environment !== config.env) {
    logger.warn(
      `[panel-bridge] Entreprise cliente ignorée : elle vise ${value.environment}, `
      + `ce projet est en ${config.env}.`,
    );
    return { applied: false, reason: 'ENVIRONMENT_MISMATCH' };
  }

  const courant = await PanelClientCompanyConfiguration.findOne({ key: 'SINGLETON' }).lean();

  /**
   * UNE VERSION ANTÉRIEURE EST IGNORÉE.
   *
   * Après un rattrapage, le journal se rejoue dans l'ordre du JOURNAL, pas dans
   * celui des décisions. Sans cette garde, les versions historiques
   * s'appliqueraient l'une après l'autre et l'écran clignoterait entre
   * plusieurs identités avant de se stabiliser — sur la bonne, mais après avoir
   * affiché les mauvaises.
   *
   * La comparaison porte sur le MÊME client : une entreprise différente n'a
   * aucune raison d'avoir une version comparable, et c'est le cas d'un
   * changement de rattachement.
   */
  if (
    courant
    && courant.clientCompanyId === value.clientCompanyId
    && typeof courant.version === 'number'
    && typeof value.version === 'number'
    && value.version <= courant.version
  ) {
    return { applied: false, reason: 'OLDER_VERSION', version: courant.version };
  }

  await PanelClientCompanyConfiguration.findOneAndUpdate(
    { key: 'SINGLETON' },
    {
      $set: {
        clientCompanyId: value.clientCompanyId,
        /**
         * L'IDENTIFIANT PORTÉ PAR L'ÉCRITURE — seul rapprochement possible
         * pour un futur tombstone, qui n'a pas de charge utile. Voir le
         * modèle. À l'amorçage il n'y a pas d'écriture, donc pas d'identité
         * de pont : `null` est alors la vérité, pas un oubli.
         */
        bridgeEntityId: bridgeEntityId ?? null,
        environment: value.environment,
        version: value.version ?? null,
        profile: value,
        appliedAt: new Date(),
        source,
      },
    },
    { upsert: true, new: true },
  );

  logger.info(
    `[panel-bridge] Entreprise cliente « ${value.legalName} » appliquée `
    + `(version ${value.version ?? '—'}, ${source}).`,
  );

  /**
   * LES ÉCRANS OUVERTS L'APPRENNENT.
   *
   * APRÈS l'écriture, jamais avant : notifier d'abord ouvrirait une fenêtre où
   * le navigateur redemande la donnée et reçoit l'ANCIENNE — puis ne redemande
   * plus jamais, puisqu'il a déjà été prévenu.
   *
   * L'événement ne transporte AUCUNE donnée métier : seulement le nom de la
   * ressource. C'est ce qui rend « rattacher une entreprise depuis le Panel »
   * visible dans le Manager du client SANS redéploiement ni rechargement.
   */
  notifyResourceChanged(UI_RESOURCE.CLIENT_COMPANY, { reason: source });

  return { applied: true, version: value.version ?? null };
}

/**
 * Handler de synchronisation pour `CLIENT_COMPANY`.
 *
 * ── LE TOMBSTONE EST UN ÉTAT, PAS UNE PERTE ─────────────────────────────────
 *
 * Le Panel l'émet quand un projet est DÉTACHÉ de son entreprise, ou quand il
 * change de client. On efface l'identité mais on GARDE le document : l'écran
 * doit pouvoir dire « aucune entreprise n'est rattachée » plutôt que « jamais
 * configurée », et les gardes doivent lire une absence explicite.
 */
export async function applyClientCompanyChange({ change }) {
  if (change.deleted) {
    const courant = await PanelClientCompanyConfiguration.findOne({ key: 'SINGLETON' }).lean();
    /**
     * ON N'EFFACE QUE SI C'EST BIEN CETTE ENTREPRISE-LÀ.
     *
     * Un changement de rattachement émet DEUX écritures : la nouvelle identité,
     * puis le retrait de l'ancienne. Elles peuvent arriver dans cet ordre — et
     * elles le font, puisque le Panel les émet ainsi. Appliquer le tombstone
     * sans vérifier l'identité effacerait la NOUVELLE entreprise qu'on vient
     * d'appliquer, et le projet se retrouverait sans client alors qu'il vient
     * d'en recevoir un.
     */
    /**
     * LE RAPPROCHEMENT SE FAIT SUR L'IDENTIFIANT D'ENTITÉ, PAS SUR L'ID
     * MÉTIER : l'écriture porte un UUID dérivé, la fiche porte l'identifiant
     * lisible, et les comparer directement ne peut QUE se tromper.
     *
     * Repli pour les fiches appliquées avant ce champ (`bridgeEntityId`
     * absent) : on compare alors comme avant. C'est juste pour elles, et
     * cela évite qu'une mise à niveau rende un retrait inapplicable.
     */
    const identiteCourante = courant?.bridgeEntityId ?? courant?.clientCompanyId ?? null;
    if (courant && identiteCourante && identiteCourante !== change.entityId) {
      logger.info(
        `[panel-bridge] Retrait de l’entreprise cliente ${change.entityId} ignoré : `
        + `ce projet est désormais rattaché à ${courant.clientCompanyId}.`,
      );
      return { applied: false, reason: 'OTHER_COMPANY' };
    }

    await PanelClientCompanyConfiguration.findOneAndUpdate(
      { key: 'SINGLETON' },
      {
        $set: {
          clientCompanyId: null,
          bridgeEntityId: null,
          version: null,
          profile: null,
          appliedAt: new Date(),
          source: 'SYNC',
        },
      },
      { upsert: true },
    );
    logger.warn('[panel-bridge] Entreprise cliente RETIRÉE par le Panel — paiements et signatures suspendus.');
    notifyResourceChanged(UI_RESOURCE.CLIENT_COMPANY, { reason: 'REMOVED' });
    return { applied: true, removed: true };
  }
  return applyClientCompanyProfile(change.payload, 'SYNC', change.entityId ?? null);
}

/* -------------------------------------------------------------------------- */
/*  LECTURE                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * L'ENTREPRISE CLIENTE APPLIQUÉE — ou `null`.
 *
 * `null` couvre DEUX situations qui se lisent pareil du point de vue du
 * métier : « jamais reçue » et « retirée par le Panel ». Dans les deux cas, ce
 * projet n'a pas de client légal, et c'est tout ce que ses gardes ont besoin de
 * savoir. La NUANCE, elle, appartient à l'écran — voir `describeClientCompany`.
 */
export async function getClientCompany() {
  const doc = await PanelClientCompanyConfiguration.findOne({ key: 'SINGLETON' }).lean();
  if (!doc?.clientCompanyId || !doc.profile) return null;
  return doc.profile;
}

/**
 * CE QUE LA PAGE « MON ENTREPRISE » AFFICHE — lecture seule, sans exception.
 *
 * ══ POURQUOI ELLE REND UN OBJET MÊME QUAND IL N'Y A RIEN ═══════════════════
 *
 * Parce que « aucune entreprise rattachée » EST une information, et que
 * l'écran doit pouvoir la présenter avec la marche à suivre plutôt qu'avec une
 * page blanche. Rendre `null` obligerait le frontend à inventer ce message.
 */
export async function describeClientCompany() {
  const doc = await PanelClientCompanyConfiguration.findOne({ key: 'SINGLETON' }).lean();
  const profil = doc?.clientCompanyId ? doc.profile : null;

  return {
    /** Y a-t-il un client légal rattaché ? La seule question qui gouverne. */
    linked: Boolean(profil),
    company: profil,
    /**
     * LE VERDICT DU PANEL — repris tel quel, jamais recalculé ici. Voir
     * `CLIENT_COMPANY_READINESS` pour l'arbitrage.
     */
    readiness: profil?.readiness ?? {
      state: CLIENT_COMPANY_READINESS.MISSING_COMPANY,
      ready: false,
      billing: { ready: false, missing: [] },
      signing: { ready: false, missing: [] },
    },
    appliedAt: doc?.appliedAt ? new Date(doc.appliedAt).toISOString() : null,
  };
}

/**
 * PEUT-ON PAYER ? — la lecture que les gardes de paiement consultent.
 *
 * ══ CE REFUS N'EST PAS L'AUTORITÉ, ET C'EST IMPORTANT ══════════════════════
 *
 * L'autorité est le PANEL : c'est lui qui refuse d'ouvrir une session Stripe
 * sans identité de facturation, et son refus tombe avant tout contact
 * fournisseur. Cette garde-ci existe pour une autre raison — expliquer AVANT
 * de faire cliquer.
 *
 * Sans elle, un client sans entreprise verrait un bouton « Payer », cliquerait,
 * attendrait, et recevrait une erreur venue du plan de contrôle. Avec elle, il
 * lit ce qui manque et qui doit agir. Les deux sont nécessaires : l'une protège,
 * l'autre explique.
 */
export async function billingReadiness() {
  const vue = await describeClientCompany();
  return {
    ready: Boolean(vue.readiness?.billing?.ready),
    state: vue.readiness?.state ?? CLIENT_COMPANY_READINESS.MISSING_COMPANY,
    missing: vue.readiness?.billing?.missing ?? [],
    linked: vue.linked,
  };
}

/** PEUT-ON SIGNER ? — même raisonnement, autre métier. */
export async function signingReadiness() {
  const vue = await describeClientCompany();
  return {
    ready: Boolean(vue.readiness?.signing?.ready),
    state: vue.readiness?.state ?? CLIENT_COMPANY_READINESS.MISSING_COMPANY,
    missing: vue.readiness?.signing?.missing ?? [],
    linked: vue.linked,
  };
}

/**
 * LE SIGNATAIRE CONTRACTUEL DU CLIENT — l'unique source, depuis ce chantier.
 *
 * ══ CE QU'IL REMPLACE ══════════════════════════════════════════════════════
 *
 * `Company.signer` — une fiche ÉDITÉE DANS CE PROJET. Deux conséquences, et
 * les deux se sont produites :
 *
 *   · un même client possédant deux sites pouvait déclarer deux signataires
 *     différents pour la même personne morale ;
 *   · le CLIENT décidait de l'identité qui signe le contrat que L.Y Solution
 *     lui présente. Un signataire n'est pas une préférence d'affichage.
 *
 * ══ `null` PLUTÔT QU'UN OBJET INCOMPLET ════════════════════════════════════
 *
 * Rendre un signataire à moitié rempli laisserait l'appelant décider si
 * « pas de nom de famille » est acceptable — et le premier appelant pressé
 * déciderait que oui. `null` ne se discute pas.
 */
export async function getClientContractualSigner() {
  const profil = await getClientCompany();
  const signataire = profil?.contractualSigner ?? null;
  const prenom = String(signataire?.firstName ?? '').trim();
  const nom = String(signataire?.lastName ?? '').trim();
  const courriel = String(signataire?.email ?? '').trim().toLowerCase();
  if (!prenom || !nom || !courriel) return null;

  return {
    firstName: prenom,
    lastName: nom,
    jobTitle: String(signataire.jobTitle ?? '').trim(),
    email: courriel,
    /**
     * LA RAISON SOCIALE ACCOMPAGNE LE SIGNATAIRE.
     *
     * Le document contractuel affiche « Jean Dupont, SARL DUPONT AUTOMOBILES ».
     * Sans elle, l'instantané figé au contrat ne se lirait pas seul — et l'on
     * irait la rechercher dans une fiche qui aura changé depuis.
     */
    companyName: profil.legalName ?? null,
    clientCompanyId: profil.clientCompanyId ?? null,
  };
}

/** Purge — au désappairage : ce qui venait du Panel repart avec lui. */
export async function clearClientCompany() {
  await PanelClientCompanyConfiguration.deleteMany({});
}

export default {
  CLIENT_COMPANY_READINESS,
  applyClientCompanyProfile,
  applyClientCompanyChange,
  getClientCompany,
  describeClientCompany,
  billingReadiness,
  signingReadiness,
  getClientContractualSigner,
  clearClientCompany,
};
