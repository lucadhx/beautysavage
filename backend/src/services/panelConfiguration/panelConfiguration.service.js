// APPLICATION DE LA CONFIGURATION REÇUE DU PANEL — Phase 4.
//
// C'est le pendant, côté projet, de ce que le Panel publie. Deux entrées
// seulement, et elles font la même chose :
//
//   applyCompanyChange()       DEV_COMPANY
//   refuseIntegratedApi()      INTEGRATED_API_CONFIG — REFUSE depuis L4
//
// Elles sont branchées comme handlers du PanelBridge : le projet ne va rien
// chercher de lui-même, il applique ce que le pont lui livre.
//
// ── IDEMPOTENCE ET ORDRE ────────────────────────────────────────────────────
// Une même écriture peut arriver deux fois (relivraison après coupure) et
// dans le désordre après un rattrapage. Deux protections :
//   · l'anti-rejeu par writeId est déjà assuré par le PanelBridge ;
//   · ici, une version d'entreprise ANTÉRIEURE à celle déjà appliquée est
//     ignorée. Sans quoi un rattrapage réappliquerait, dans l'ordre, toutes
//     les versions historiques — et le site clignoterait entre plusieurs
//     identités avant de se stabiliser.
//
// ── SÉCURITÉ ────────────────────────────────────────────────────────────────
// Les identifiants sont chiffrés AVANT écriture. Aucun log ne contient une
// valeur : on journalise le NOM des clés reçues, jamais leur contenu.
import mongoose from 'mongoose';

import config from '../../config/env.js';
import logger from '../../utils/logger.js';
import { notifyResourceChanged, UI_RESOURCE } from '../uiLive/uiLive.service.js';
// Plus aucun chiffrement ici depuis L4 : ce service n'accepte plus le moindre
// identifiant fournisseur venu du Panel, il n'a donc rien à protéger au repos.
import { PanelCompanyConfiguration } from '../../models/PanelConfiguration.model.js';
import { companyProfileSchema } from '../panelBridge/bridgeContract.js';

/* -------------------------------------------------------------------------- */
/*  ENTREPRISE                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Applique une configuration d'entreprise.
 *
 * @param {object} profile  charge utile CompanyProfile
 * @param {'BOOTSTRAP'|'SYNC'} source
 * @returns {{applied: boolean, reason?: string, version?: number}}
 */
export async function applyCompanyProfile(profile, source = 'SYNC') {
  const parsed = companyProfileSchema.safeParse(profile);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · ');
    logger.warn(`[panel-bridge] Configuration d'entreprise refusée (non conforme) : ${detail}`);
    return { applied: false, reason: 'INVALID_PAYLOAD' };
  }
  const value = parsed.data;

  // L'environnement doit concorder. Une entreprise de production n'a rien à
  // faire dans un projet de recette : mentions légales, domaines et contacts
  // réels s'afficheraient sur un site de test.
  if (value.environment !== config.env) {
    logger.warn(
      `[panel-bridge] Configuration d'entreprise ignorée : elle vise ${value.environment}, ce projet est en ${config.env}.`
    );
    return { applied: false, reason: 'ENVIRONMENT_MISMATCH' };
  }

  const current = await PanelCompanyConfiguration.findOne({ key: 'SINGLETON' }).lean();
  if (
    current &&
    typeof current.version === 'number' &&
    typeof value.version === 'number' &&
    value.version <= current.version
  ) {
    return { applied: false, reason: 'OLDER_VERSION', version: current.version };
  }

  await PanelCompanyConfiguration.findOneAndUpdate(
    { key: 'SINGLETON' },
    {
      $set: {
        companyId: value.companyId,
        slug: value.slug,
        environment: value.environment,
        version: value.version ?? null,
        identity: value.identity ?? null,
        branding: value.branding ?? null,
        domains: value.domains ?? null,
        contacts: value.contacts ?? null,
        legal: value.legal ?? null,
        settings: value.settings ?? null,
        signer: value.signer ?? null,
        references: value.references ?? [],
        team: value.team ?? [],
        appliedAt: new Date(),
        source,
      },
    },
    { upsert: true, new: true }
  );

  logger.info(
    `[panel-bridge] Entreprise « ${value.identity.name} » appliquée (version ${value.version ?? '—'}, ${source}).`
  );

  /**
   * ── LE DERNIER MAILLON : PRÉVENIR LES ÉCRANS OUVERTS ──────────────────────
   *
   * ══ CE QUI MANQUAIT ═══════════════════════════════════════════════════════
   *
   * Tout ce qui précède fonctionnait : le Panel livrait, ce backend
   * persistait, en quelques dizaines de millisecondes. Mais un Manager DÉJÀ
   * OUVERT ne l'apprenait jamais — `useResource` charge une fois, au montage,
   * et ne revalide pas. La page « Aide » affichait l'ancienne valeur jusqu'à
   * ce que l'utilisateur recharge.
   *
   * ══ APRÈS L'ÉCRITURE, ET C'EST TOUT CE QUI COMPTE ═════════════════════════
   *
   * Notifier avant l'écriture ouvrirait une fenêtre où le navigateur
   * redemande la donnée et reçoit l'ANCIENNE — puis ne redemande plus jamais,
   * puisqu'il a déjà été prévenu. L'écran resterait périmé sans que rien ne le
   * signale.
   *
   * L'événement ne transporte AUCUNE donnée métier : seulement le nom de la
   * ressource. Le navigateur la redemande à cette même API.
   */
  notifyResourceChanged(UI_RESOURCE.PANEL_COMPANY, { reason: source });

  return { applied: true, version: value.version ?? null };
}

/** Handler de synchronisation pour DEV_COMPANY. */
export async function applyCompanyChange({ change }) {
  if (change.deleted) {
    // Tombstone : l'entreprise disparaît. On efface l'identité mais on garde
    // le document, pour que l'écran puisse dire « plus aucune entreprise »
    // au lieu de « jamais configurée ».
    await PanelCompanyConfiguration.findOneAndUpdate(
      { key: 'SINGLETON' },
      {
        $set: {
          companyId: null, slug: null, version: null, identity: null,
          branding: null, domains: null, contacts: null, legal: null,
          appliedAt: new Date(), source: 'SYNC',
        },
      },
      { upsert: true }
    );
    logger.warn('[panel-bridge] Configuration d’entreprise retirée par le Panel.');
    return;
  }
  await applyCompanyProfile(change.payload, 'SYNC');
}

/* -------------------------------------------------------------------------- */
/*  API INTÉGRÉES — REFUSÉES (lot L4)                                         */
/* -------------------------------------------------------------------------- */

/**
 * LE PROJET N'ACCEPTE PLUS D'IDENTIFIANTS FOURNISSEURS DU PANEL.
 *
 * ── CE QUI SE PASSAIT AVANT ─────────────────────────────────────────────────
 *
 * Le Panel déchiffrait les clés Stripe, Brevo, Yousign de l'entreprise et les
 * poussait ici, sur le pont. Ce service les rechiffrait et les rangeait dans
 * `PanelProvidedApi`. Aucun module ne les lisait jamais : les drivers
 * consomment le registre LOCAL `IntegratedApi`, et rien d'autre.
 *
 * ── POURQUOI UN REFUS, ET NON UNE SUPPRESSION PURE ──────────────────────────
 *
 * Un Panel d'une version antérieure continue d'émettre cette entité. Si ce
 * handler disparaissait, le dispatcher répondrait « type non supporté » — et
 * selon la politique de rejet, cela pourrait faire échouer TOUT LE LOT, donc
 * bloquer l'entreprise, les contrats et les médias qui voyagent avec.
 *
 * Le refus est donc LOCAL et SILENCIEUX POUR LE LOT : l'écriture est acquittée
 * comme appliquée — nous avons bien traité ce qu'on nous a envoyé, en décidant
 * de n'en rien garder —, un avertissement nomme le fournisseur refusé, et rien
 * n'est persisté.
 *
 * ── QUAND RETIRER CETTE TOLÉRANCE ───────────────────────────────────────────
 *
 * Quand plus aucune instance de Panel antérieure à L4 ne tourne, et que le
 * journal du projet n'a plus produit d'avertissement `CREDENTIALS_REFUSED`
 * depuis un cycle de déploiement complet. Le retrait se fera avec la
 * suppression de `INTEGRATED_API_CONFIG` du vocabulaire du pont — un
 * changement de contrat, donc un lot à lui seul.
 */
export const INTEGRATED_API_REFUSAL = 'CREDENTIALS_REFUSED';

/**
 * Refuse une charge utile d'API intégrée, quelle qu'elle soit.
 *
 * Ne parse RIEN avec le schéma : valider une charge qu'on jette de toute façon
 * ne ferait que créer une occasion de la manipuler. On lit défensivement de
 * quoi nommer le fournisseur dans le journal, et c'est tout.
 */
export function refuseIntegratedApi(payload) {
  /**
   * Le nom est BORNÉ et NETTOYÉ avant d'être journalisé.
   *
   * `key` et `provider` sont des slugs — mais ils viennent d'un Panel dont on
   * ne contrôle plus la version, et ce journal part dans des fichiers. On ne
   * recopie donc que ce qui ressemble à un identifiant, sur 40 caractères :
   * un secret glissé là ne franchirait pas ce filtre.
   */
  const brut = typeof payload?.key === 'string' ? payload.key
    : typeof payload?.provider === 'string' ? payload.provider
      : '';
  const nom = brut.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40) || 'inconnue';
  logger.warn(
    `[panel-bridge] API intégrée « ${nom} » REFUSÉE : depuis L4, aucun identifiant `
    + 'fournisseur ne franchit le pont. Ce projet utilise ses intégrations locales.',
  );
  return { applied: false, reason: INTEGRATED_API_REFUSAL };
}

/** Handler de synchronisation pour INTEGRATED_API_CONFIG — refuse et n'écrit rien. */
export async function applyIntegratedApiChange({ change }) {
  // Un tombstone n'a plus rien à effacer : la collection n'existe plus.
  if (change.deleted) return { applied: false, reason: INTEGRATED_API_REFUSAL };
  return refuseIntegratedApi(change.payload);
}

/**
 * PURGE DES IDENTIFIANTS HÉRITÉS — jouée au démarrage, idempotente.
 *
 * Une instance déjà appairée détient, chiffrés, les identifiants qu'un Panel
 * antérieur lui a envoyés. Supprimer le modèle sans les effacer laisserait des
 * secrets au repos dans une collection que plus aucun code ne connaît : le
 * pire des deux mondes — invisibles à la relecture, et toujours là dans un
 * dump.
 *
 * Ne dépend d'aucun Panel : le projet se nettoie lui-même, même hors ligne.
 *
 * @returns {Promise<{purged: number}>}
 */
export async function purgePanelProvidedApis() {
  const collection = mongoose.connection?.db?.collection('panelprovidedapis');
  if (!collection) return { purged: 0 };
  const total = await collection.countDocuments().catch(() => 0);
  if (total === 0) return { purged: 0 };
  await collection.drop().catch(async () => {
    // `drop` échoue si la collection est concurremment absente : le vidage
    // reste la garantie qui compte.
    await collection.deleteMany({}).catch(() => {});
  });
  logger.warn(
    `[panel-bridge] ${total} identifiant(s) fournisseur hérité(s) du Panel purgé(s) — `
    + 'ils n’étaient lus par aucun module (lot L4).',
  );
  return { purged: total };
}

/* -------------------------------------------------------------------------- */
/*  LECTURE                                                                   */
/* -------------------------------------------------------------------------- */

/** L'entreprise appliquée — pour la vitrine, le Manager, les mentions légales. */
export async function getCompanyConfiguration() {
  const doc = await PanelCompanyConfiguration.findOne({ key: 'SINGLETON' }).lean();
  if (!doc || !doc.companyId) return null;
  return {
    companyId: doc.companyId,
    slug: doc.slug,
    environment: doc.environment,
    version: doc.version,
    identity: doc.identity,
    branding: doc.branding,
    domains: doc.domains,
    contacts: doc.contacts,
    legal: doc.legal,
    settings: doc.settings,
    // Identité DÉVELOPPEUR : le Manager les affiche en lecture seule.
    signer: doc.signer ?? null,
    references: doc.references ?? [],
    team: doc.team ?? [],
    appliedAt: doc.appliedAt,
    source: doc.source,
  };
}

/**
 * CE QUE LE PROJET DÉCLARE AU PANEL (Identity.appliedConfiguration, >= 1.3.0).
 *
 * Aucune valeur de secret, seulement des noms et des compteurs : cette
 * charge utile est lue par le Panel, affichée dans son interface, et
 * potentiellement journalisée.
 */
export async function describeAppliedConfiguration({ lastSyncAt = null } = {}) {
  const company = await PanelCompanyConfiguration.findOne({ key: 'SINGLETON' }).lean();
  return {
    companyId: company?.companyId ?? null,
    companySlug: company?.slug ?? null,
    companyVersion: company?.version ?? null,
    companyAppliedAt: company?.appliedAt ? new Date(company.appliedAt).toISOString() : null,
    /**
     * ZÉRO, ET C'EST UN FAIT — pas une omission.
     *
     * Depuis L4, ce projet n'applique plus aucune API fournie par le Panel.
     * Les champs restent sur le fil (le Panel les affiche dans sa supervision)
     * et disent la vérité : rien n'a été appliqué. Les taire laisserait le
     * Panel afficher la dernière valeur connue.
     */
    integratedApiCount: 0,
    integratedApiKeys: [],
    lastSyncAt,
  };
}

/**
 * Purge — au désappairage : ce qui venait du Panel repart avec lui.
 *
 * Le tour d'identifiants hérités est fait par `purgePanelProvidedApis()`, au
 * démarrage : il ne dépend d'aucun désappairage, et joue même sur une instance
 * qu'on n'a jamais dépairée.
 */
export async function clearPanelConfiguration() {
  await PanelCompanyConfiguration.deleteMany({});
}

export default {
  applyCompanyProfile, applyCompanyChange,
  refuseIntegratedApi, applyIntegratedApiChange, purgePanelProvidedApis,
  getCompanyConfiguration,
  describeAppliedConfiguration, clearPanelConfiguration,
};
