/**
 * Adaptateur de persistance Mongo de l'ÉTAT DE CONSOMMATION du pont.
 *
 * Même discipline que l'appairage : c'est le SEUL fichier autorisé à toucher
 * le modèle, et il est injecté dans `consumptionStore.js`. Le cœur du pont ne
 * connaît ni Mongo, ni les modèles — `bridge-conformity` le vérifie.
 *
 * Contrat d'adaptateur :
 *   load()      -> l'état persisté, ou `null`
 *   save(état)  -> upsert du singleton
 *   clear()     -> suppression (désappairage)
 *
 * Aucun secret n'est manipulé ici, et il n'y a donc rien à chiffrer : un
 * curseur est une position opaque dans un journal, les compteurs sont des
 * nombres. Voir l'en-tête du modèle.
 */
import { BridgeSyncState } from '../../../models/BridgeSyncState.model.js';

const iso = (valeur) => (valeur ? new Date(valeur).toISOString() : null);

export function createMongoSyncStateAdapter() {
  return {
    /**
     * ══ L'UNICITÉ EST LA GARANTIE — ET ELLE DOIT EXISTER AVANT LE PREMIER BAIL ═
     *
     * Tout le bail repose sur un fait : il n'y a QU'UN document `SINGLETON`.
     * Mongoose construit ses index en tâche de fond, et `autoIndex` peut être
     * coupé en production. Mesuré sur une base neuve : deux réclamations
     * concurrentes ont créé DEUX documents, et les deux runtimes se sont crus
     * propriétaires. L'exclusion était alors purement décorative.
     *
     * On la pose donc explicitement, une fois, avant toute réclamation.
     * Idémpotent : `createIndexes` ne fait rien si l'index existe déjà.
     */
    async ensureIndexes() {
      await BridgeSyncState.createIndexes();
      return { ensured: true };
    },

    async load() {
      const doc = await BridgeSyncState.findOne({ key: 'SINGLETON' }).lean();
      if (!doc) return null;
      return {
        projectId: doc.projectId ?? null,
        generation: doc.generation ?? null,
        pullCursor: doc.pullCursor ?? null,
        lastCursorAdvanceAt: iso(doc.lastCursorAdvanceAt),
        lastSuccessfulApplyAt: iso(doc.lastSuccessfulApplyAt),
        consecutivePullFailures: doc.consecutivePullFailures ?? 0,
        consecutiveUnreadableChanges: doc.consecutiveUnreadableChanges ?? 0,
        appliedTotal: doc.appliedTotal ?? 0,
        recentWriteIds: Array.isArray(doc.recentWriteIds) ? doc.recentWriteIds : [],
        applyFailures: doc.applyFailures && typeof doc.applyFailures === 'object'
          ? { ...doc.applyFailures } : {},
        leaseOwner: doc.leaseOwner ?? null,
        leaseStartedAt: iso(doc.leaseStartedAt),
        leaseExpiresAt: iso(doc.leaseExpiresAt),
        deadLetters: Array.isArray(doc.deadLetters)
          ? doc.deadLetters.map((d) => ({
            ...d, parkedAt: iso(d.parkedAt), resolvedAt: iso(d.resolvedAt),
          }))
          : [],
      };
    },

    /**
     * ÉCRITURE CONDITIONNÉE À LA POSSESSION DU BAIL.
     *
     * `expectedOwner` à `null` → écriture inconditionnelle : c'est le runtime
     * seul, qui n'a jamais réclamé de bail, et le comportement mono-processus
     * d'avant reste intact.
     *
     * `expectedOwner` renseigné → l'écriture ne passe QUE si la base porte
     * encore ce propriétaire. C'est Mongo qui tranche, au bon instant — une
     * vérification locale pourrait être périmée entre le test et l'écriture.
     *
     * LES CHAMPS DE BAIL NE SONT JAMAIS DANS CE `$set` : ils appartiennent aux
     * opérations de bail. Les y mêler ferait qu'une sauvegarde de consommation
     * prolongerait un bail, ou l'écraserait.
     */
    async save(etat, { expectedOwner = null } = {}) {
      const r = await BridgeSyncState.updateOne(
        expectedOwner ? { key: 'SINGLETON', leaseOwner: expectedOwner } : { key: 'SINGLETON' },
        {
          $set: {
            projectId: etat.projectId ?? null,
            generation: etat.generation ?? null,
            pullCursor: etat.pullCursor ?? null,
            lastCursorAdvanceAt: etat.lastCursorAdvanceAt ? new Date(etat.lastCursorAdvanceAt) : null,
            lastSuccessfulApplyAt: etat.lastSuccessfulApplyAt
              ? new Date(etat.lastSuccessfulApplyAt)
              : null,
            consecutivePullFailures: etat.consecutivePullFailures ?? 0,
            consecutiveUnreadableChanges: etat.consecutiveUnreadableChanges ?? 0,
            appliedTotal: etat.appliedTotal ?? 0,
            recentWriteIds: etat.recentWriteIds ?? [],
            applyFailures: etat.applyFailures ?? {},
            deadLetters: (etat.deadLetters ?? []).map((d) => ({
              ...d,
              parkedAt: d.parkedAt ? new Date(d.parkedAt) : null,
              resolvedAt: d.resolvedAt ? new Date(d.resolvedAt) : null,
            })),
          },
        },
        { upsert: !expectedOwner },
      );
      if (expectedOwner && (r?.matchedCount ?? 0) === 0) {
        return { written: false, reason: 'LEASE_LOST' };
      }
      return { written: true };
    },

    /* ── LE BAIL DE CONSOMMATION — atomique, et rien d'autre ─────────────── */

    /**
     * RÉCLAMER — un seul `findOneAndUpdate`, un seul gagnant.
     *
     * Le filtre accepte : aucun bail, notre propre bail, ou un bail EXPIRÉ.
     * `upsert` crée le document au tout premier démarrage, quand la
     * consommation n'a encore rien écrit.
     */
    async claimLease({ projectId, generation, owner, now, expiresAt }) {
      /**
       * ══ LA GÉNÉRATION EST UNE CONDITION POSITIVE, PAS UNE ÉCHAPPATOIRE ════
       *
       * Première tentative : un `{generation: {$ne: g}}` dans le `$or`, censé
       * empêcher un vieux bail de bloquer une nouvelle génération. Il était
       * SYMÉTRIQUE — un runtime resté sur `g1` face à un document en `g2`
       * matchait tout aussi bien, et reprenait le bail d'une génération vivante.
       *
       * La bonne forme est l'inverse : on n'accorde le bail QUE si le document
       * n'a pas encore de génération, ou porte exactement celle qu'on demande.
       * Le déblocage après réappairage ne passe pas par ici mais par
       * `resetForGeneration` — un réappairage invalide le consommateur précédent
       * par nature, et le dire explicitement vaut mieux qu'un filtre malin.
       */
      const filtre = {
        key: 'SINGLETON',
        ...(generation
          ? {
            $and: [{
              $or: [
                { generation: null },
                { generation: { $exists: false } },
                { generation },
              ],
            }],
          }
          : {}),
        $or: [
          { leaseOwner: null },
          { leaseOwner: { $exists: false } },
          { leaseOwner: owner },
          { leaseExpiresAt: { $lte: now } },
          { leaseExpiresAt: null },
        ],
      };
      /**
       * `upsert` CRÉE LE DOCUMENT AU TOUT PREMIER DÉMARRAGE — et c'est aussi ce
       * qui trahit le perdant.
       *
       * Quand le filtre ne matche plus (un autre vient de prendre le bail),
       * Mongo tente une INSERTION, que l'index unique sur `key` refuse en
       * E11000. Ce refus n'est pas une panne : c'est la preuve que quelqu'un
       * d'autre a gagné. Sans ce `catch`, la réclamation LEVAIT au lieu de
       * rendre un refus, et deux runtimes concurrents faisaient tomber le
       * perdant au lieu de le laisser attendre son tour.
       */
      let doc = null;
      try {
        doc = await BridgeSyncState.findOneAndUpdate(
          filtre,
          {
            $set: {
              leaseOwner: owner,
              leaseStartedAt: now,
              leaseExpiresAt: expiresAt,
              lastLeaseHeartbeatAt: now,
              ...(projectId ? { projectId } : {}),
              ...(generation ? { generation } : {}),
            },
          },
          { new: true, upsert: true },
        );
      } catch (err) {
        if (err?.code !== 11000) throw err;
        doc = null;
      }
      if (doc?.leaseOwner === owner) {
        return { granted: true, owner, expiresAt: expiresAt.toISOString() };
      }
      const actuel = await BridgeSyncState.findOne({ key: 'SINGLETON' }).lean();
      return {
        granted: false,
        reason: 'LEASE_HELD',
        owner: actuel?.leaseOwner ?? null,
        expiresAt: actuel?.leaseExpiresAt ? new Date(actuel.leaseExpiresAt).toISOString() : null,
      };
    },

    /** RENOUVELER — uniquement si le bail est ENCORE le nôtre. */
    async renewLease({ owner, now, expiresAt }) {
      const r = await BridgeSyncState.updateOne(
        { key: 'SINGLETON', leaseOwner: owner },
        { $set: { leaseExpiresAt: expiresAt, lastLeaseHeartbeatAt: now } },
      );
      return (r?.matchedCount ?? 0) > 0
        ? { renewed: true, expiresAt: expiresAt.toISOString() }
        : { renewed: false, reason: 'NOT_OWNER' };
    },

    /** RENDRE — uniquement le sien. On ne rend jamais le bail d'un autre. */
    async releaseLease({ owner }) {
      const r = await BridgeSyncState.updateOne(
        { key: 'SINGLETON', leaseOwner: owner },
        { $set: { leaseOwner: null, leaseExpiresAt: null } },
      );
      return (r?.matchedCount ?? 0) > 0
        ? { released: true }
        : { released: false, reason: 'NOT_OWNER' };
    },

    /**
     * RÉAPPAIRAGE — le document repart à neuf, BAIL COMPRIS.
     *
     * Un projet réappairé parle à un autre journal : son curseur ne veut plus
     * rien dire, et le consommateur qui tenait le bail consommait pour une
     * relation qui n'existe plus. Le laisser expirer ferait taire le projet
     * pendant tout un TTL, sans raison.
     *
     * C'est la SEULE écriture qui efface un bail sans en être titulaire, et
     * elle est justifiée par un fait extérieur : l'appairage a changé.
     */
    async resetForGeneration({ projectId, generation }) {
      await BridgeSyncState.findOneAndUpdate(
        { key: 'SINGLETON' },
        {
          $set: {
            projectId: projectId ?? null,
            generation: generation ?? null,
            pullCursor: null,
            lastCursorAdvanceAt: null,
            lastSuccessfulApplyAt: null,
            consecutivePullFailures: 0,
            consecutiveUnreadableChanges: 0,
            appliedTotal: 0,
            recentWriteIds: [],
            applyFailures: {},
            deadLetters: [],
            leaseOwner: null,
            leaseStartedAt: null,
            leaseExpiresAt: null,
            lastLeaseHeartbeatAt: null,
          },
        },
        { upsert: true, new: true },
      );
      return { reset: true };
    },

    /** Ce que la base dit du bail — lecture seule. */
    async readLease() {
      const doc = await BridgeSyncState.findOne({ key: 'SINGLETON' }).lean();
      if (!doc) return null;
      return {
        projectId: doc.projectId ?? null,
        generation: doc.generation ?? null,
        leaseOwner: doc.leaseOwner ?? null,
        leaseStartedAt: iso(doc.leaseStartedAt),
        leaseExpiresAt: iso(doc.leaseExpiresAt),
        lastLeaseHeartbeatAt: iso(doc.lastLeaseHeartbeatAt),
      };
    },

    async clear() {
      await BridgeSyncState.deleteOne({ key: 'SINGLETON' });
    },
  };
}

export default { createMongoSyncStateAdapter };
