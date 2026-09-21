/**
 * ÉQUIPE DU PROJET → PANEL.
 *
 * ── CE QUI EST PUBLIÉ, ET RIEN D'AUTRE ──────────────────────────────────────
 * Le modèle `User` porte : e-mail, nom, rôle, dates. C'est tout ce qui part.
 *
 * Pas de « dernière connexion », pas de « statut actif » : ces champs
 * N'EXISTENT PAS dans le modèle. Les fabriquer donnerait au Panel une donnée
 * d'apparence fiable et systématiquement fausse — le pire des deux mondes.
 * Le jour où le projet les tiendra vraiment, ils s'ajouteront ici.
 *
 * Jamais publiés, et la liste est courte parce qu'elle doit se vérifier d'un
 * coup d'œil : `password` (haché), `passwordReset.tokenHash`, et toute
 * permission technique. Le Panel affiche une équipe, il n'authentifie
 * personne.
 *
 * ── SUPPRESSIONS ────────────────────────────────────────────────────────────
 * Un `upsert` ne dit jamais qu'un membre est parti. Deux mécanismes se
 * complètent donc :
 *   · à chaud, le hook du modèle émet un tombstone pour le partant ;
 *   · au démarrage, la RÉCONCILIATION compare l'équipe réelle à la dernière
 *     photographie envoyée et rattrape ce qui a été manqué — suppression en
 *     lot, écriture directe en base, projet arrêté au mauvais moment.
 */
import crypto from 'node:crypto';
import { User } from '../../models/User.model.js';
import { PanelRosterState } from '../../models/PanelRosterState.model.js';
import logger from '../../utils/logger.js';

const ROSTER_KIND = 'TEAM_MEMBER';

/** Identifiant STABLE d'un membre — le même à chaque émission. */
export function memberEntityId(userId) {
  const hex = crypto.createHash('sha256').update(`user:${userId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Projection d'un membre. Construite par ÉNUMÉRATION explicite : jamais un
 * `...user`, qui embarquerait le jour où un champ sensible s'ajoute au modèle.
 */
export function buildMemberProjection(user) {
  return {
    entityType: 'TEAM_MEMBER',
    entityId: memberEntityId(user._id),
    payload: {
      sourceUserId: String(user._id),
      email: user.email,
      // `name` est un champ unique dans ce modèle : ni prénom ni nom séparés.
      ...(user.name ? { name: user.name } : {}),
      role: user.role,
      createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : null,
    },
    modifiedAt: new Date(user.updatedAt ?? Date.now()).toISOString(),
  };
}

/** Tombstone d'un membre parti. Le Panel efface sa projection. */
export function buildMemberTombstone(entityId) {
  return {
    entityType: 'TEAM_MEMBER',
    entityId,
    deleted: true,
    payload: null,
    modifiedAt: new Date().toISOString(),
  };
}

/* -------------------------------------------------------------------------- */

let enqueue = null;
let requestFlush = null;

export function configureTeamSync({ enqueueProjection, flush } = {}) {
  if (enqueueProjection) enqueue = enqueueProjection;
  if (flush) requestFlush = flush;
}

export function resetTeamSync() {
  enqueue = null;
  requestFlush = null;
}

export function isTeamSyncWired() {
  return typeof enqueue === 'function';
}

async function mettreEnFile(changes) {
  let queued = 0;
  for (const change of changes) {
    // eslint-disable-next-line no-await-in-loop
    const res = await enqueue(change);
    if (res?.queued) queued += 1;
  }
  if (queued > 0 && typeof requestFlush === 'function') void requestFlush();
  return queued;
}

/** Un membre a été créé ou modifié : on republie son état. */
export async function projectMember(userId) {
  if (!isTeamSyncWired()) return { queued: 0 };
  try {
    const user = await User.findById(userId).lean();
    if (!user) return projectMemberRemoval(userId);
    const queued = await mettreEnFile([buildMemberProjection(user)]);
    await rememberMember(memberEntityId(userId));
    return { queued };
  } catch (err) {
    logger.warn(`[sync] projection du membre ${userId} impossible : ${err.message}`);
    return { queued: 0 };
  }
}

/** Un membre est parti : on émet son tombstone et on l'oublie. */
export async function projectMemberRemoval(userId) {
  if (!isTeamSyncWired()) return { queued: 0 };
  try {
    const entityId = memberEntityId(userId);
    const queued = await mettreEnFile([buildMemberTombstone(entityId)]);
    await forgetMember(entityId);
    return { queued };
  } catch (err) {
    logger.warn(`[sync] tombstone du membre ${userId} impossible : ${err.message}`);
    return { queued: 0 };
  }
}

/**
 * PHOTOGRAPHIE COMPLÈTE — la réparation.
 *
 * Republie toute l'équipe, et émet un tombstone pour chaque identifiant
 * précédemment annoncé qui n'existe plus. C'est ce second membre de phrase qui
 * fait la différence entre « des upserts » et « une collection projetée ».
 */
export async function reconcileTeam() {
  if (!isTeamSyncWired()) return { upserts: 0, tombstones: 0 };
  try {
    const users = await User.find().lean();
    const presents = users.map((u) => memberEntityId(u._id));

    const etat = await PanelRosterState.findOne({ kind: ROSTER_KIND }).lean();
    const connus = etat?.entityIds ?? [];
    const disparus = connus.filter((id) => !presents.includes(id));

    const changes = [
      ...users.map(buildMemberProjection),
      ...disparus.map(buildMemberTombstone),
    ];
    await mettreEnFile(changes);

    await PanelRosterState.updateOne(
      { kind: ROSTER_KIND },
      { $set: { entityIds: presents, updatedAt: new Date() } },
      { upsert: true },
    );

    if (disparus.length > 0) {
      logger.info(`[sync] équipe : ${disparus.length} membre(s) disparu(s) effacé(s) côté Panel.`);
    }
    return { upserts: users.length, tombstones: disparus.length };
  } catch (err) {
    logger.warn(`[sync] réconciliation de l’équipe impossible : ${err.message}`);
    return { upserts: 0, tombstones: 0 };
  }
}

/* ── Mémoire de ce qui a été annoncé ──────────────────────────────────────── */

async function rememberMember(entityId) {
  await PanelRosterState.updateOne(
    { kind: ROSTER_KIND },
    { $addToSet: { entityIds: entityId }, $set: { updatedAt: new Date() } },
    { upsert: true },
  );
}

async function forgetMember(entityId) {
  await PanelRosterState.updateOne(
    { kind: ROSTER_KIND },
    { $pull: { entityIds: entityId }, $set: { updatedAt: new Date() } },
  );
}

export default {
  memberEntityId,
  buildMemberProjection,
  buildMemberTombstone,
  configureTeamSync,
  resetTeamSync,
  isTeamSyncWired,
  projectMember,
  projectMemberRemoval,
  reconcileTeam,
};
