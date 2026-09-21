import crypto from 'node:crypto';
import { ContactSubmission } from '../../models/ContactSubmission.model.js';
import { Company } from '../../models/Company.model.js';
import { getSingleton } from '../../utils/singleton.js';
import { ApiError } from '../../utils/ApiError.js';
import { logger } from '../../utils/logger.js';
import { maskEmail } from '../../utils/eventPayloadSafety.js';
import { emitAndDispatch } from '../events/domainEvent.service.js';
import { ENTITY_TYPE } from '../../utils/domainEventRegistry.js';
import { EVENT_ACTOR_TYPE } from '../../utils/domainEventConstants.js';
import {
  CONTACT_STATUS,
  CONTACT_SOURCE,
  CONTACT_ERROR_CODES as E,
  canTransition,
  contactStateOf,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../../utils/contactConstants.js';

/**
 * Demandes de contact : création publique, consultation et gestion.
 *
 * ═══ LA DEMANDE D'ABORD, LA NOTIFICATION ENSUITE ═════════════════════════════
 *
 * **Une demande enregistrée n'est JAMAIS annulée par un échec de notification.**
 *
 * C'est l'invariant central de ce module. Un visiteur a pris le temps d'écrire :
 * perdre son message parce que Brevo répond 500, parce qu'aucun administrateur
 * n'existe, ou parce que l'expéditeur n'est pas vérifié, serait absurde — il
 * n'aurait aucun moyen de le savoir, et personne n'aurait rien.
 *
 * L'ordre est donc : persister, puis émettre. `emitAndDispatch` n'échoue jamais
 * vers l'appelant (`emitSafe` avale et journalise). Aucun `try` autour de la
 * création n'annule quoi que ce soit.
 *
 * FENÊTRE DE PERTE ASSUMÉE : si le processus meurt entre l'écriture de la demande
 * et l'émission de l'événement, la demande existe **sans notification**, et rien
 * ne la rejoue. C'est la même limite que partout dans ce dépôt (cf.
 * DOMAIN_EVENTS.md §4 : aucune transaction, mongod standalone autorisé). Le trou
 * est une trace manquante, jamais une demande perdue — et la demande reste
 * visible dans le Manager, ce qui la rend rattrapable à la main.
 */

/**
 * Crée une demande, puis émet l'événement.
 *
 * @param {object} input Données DÉJÀ validées et normalisées (cf. validator).
 * @returns {Promise<{submission: object, deduplicated: boolean}>}
 */
export async function createSubmission(input) {
  const {
    name, email, phone = '', companyName, activity = '', reason, message,
    pageUrl = '', referrerUrl = '', clientSubmissionId = null, metadataSafe = {},
    antiAbuseSignals = [],
  } = input;

  // --- Idempotence : la clé du client a-t-elle déjà servi ? -----------------
  // Vérification AVANT l'insertion pour le cas courant (double clic espacé), et
  // l'index unique tranche le cas serré (deux requêtes concurrentes) plus bas.
  if (clientSubmissionId) {
    const existing = await ContactSubmission.findOne({ clientSubmissionId }).lean();
    if (existing) {
      logger.info(`Demande de contact déjà enregistrée (clé client rejouée) : ${existing.submissionId}`);
      return { submission: existing, deduplicated: true };
    }
  }

  // Mono-entreprise aujourd'hui (singleton). Renseigné quand même : voir le modèle.
  const company = await getSingleton(Company);
  const submittedAt = new Date();

  let submission;
  try {
    submission = await ContactSubmission.create({
      submissionId: crypto.randomUUID(),
      clientSubmissionId,
      companyId: company?._id || null,
      source: CONTACT_SOURCE.PUBLIC_WEBSITE,
      contact: { name, email, phone },
      companyName,
      activity,
      reason,
      message,
      pageUrl,
      referrerUrl,
      status: CONTACT_STATUS.NEW,
      metadataSafe,
      antiAbuseSignals,
      submittedAt,
    });
  } catch (err) {
    // 11000 = deux soumissions concurrentes avec la même clé client. L'index a
    // fait son travail : on renvoie celle qui a gagné, sans rien créer ni
    // notifier deux fois.
    if (err.code === 11000 && clientSubmissionId) {
      const winner = await ContactSubmission.findOne({ clientSubmissionId }).lean();
      if (winner) return { submission: winner, deduplicated: true };
    }
    throw err;
  }

  // --- L'événement, APRÈS. Ne peut pas faire échouer ce qui précède. --------
  await emitAndDispatch({
    type: 'contact.submitted',
    entityType: ENTITY_TYPE.CONTACT_SUBMISSION,
    // `entityId` porte l'identifiant : c'est lui qui permet de retrouver la
    // demande depuis un événement, et le resolver s'en sert.
    entityId: submission.submissionId,
    actor: { type: EVENT_ACTOR_TYPE.SYSTEM },
    payloadSafe: {
      submissionId: submission.submissionId,
      contactName: name,
      // L'ENTREPRISE n'est pas masquée : c'est une donnée publique, et c'est
      // elle qui rend un événement relisible sans rouvrir la demande.
      contactCompany: companyName,
      // MASQUÉE. Le journal des événements est relu par des humains et exposé
      // par les routes DEV : il n'a pas à devenir une seconde réserve d'adresses.
      contactEmailMasked: maskEmail(email),
      reason,
      submittedAt: submittedAt.toISOString(),
      source: CONTACT_SOURCE.PUBLIC_WEBSITE,
      ...(pageUrl ? { pageUrl } : {}),
      ...(company?._id ? { companyId: String(company._id) } : {}),
    },
    // Le `submissionId` est déjà unique et ne contient aucune donnée
    // personnelle : il fait une clé d'idempotence idéale. Rejouer le dispatch
    // d'une même demande ne crée jamais un second événement.
    idempotencyKey: `contact-submitted:${submission.submissionId}`,
  });

  return { submission: submission.toObject(), deduplicated: false };
}

// --- Consultation (Manager) --------------------------------------------------

/**
 * Projection SÛRE pour la liste — le message complet n'y figure pas.
 *
 * Contrat CLIENT réduit à l'essentiel : `state` (non lue / lue / résolue) dérivé
 * des horodatages. Pas de `status` de workflow, pas d'`assignedToUserId` : l'UX
 * cliente n'a ni ticketing ni attribution.
 */
export function serializeSummary(doc) {
  return {
    submissionId: doc.submissionId,
    contact: { name: doc.contact?.name || '', email: doc.contact?.email || '', phone: doc.contact?.phone || '' },
    companyName: doc.companyName || '',
    activity: doc.activity || '',
    reason: doc.reason,
    state: contactStateOf(doc),
    submittedAt: doc.submittedAt,
    readAt: doc.firstViewedAt || null,
    resolvedAt: doc.resolvedAt || null,
    /** Un extrait suffit à reconnaître une demande dans une liste. */
    messagePreview: String(doc.message || '').slice(0, 120),
  };
}

/** Projection complète (détail). */
export function serializeDetail(doc) {
  return {
    ...serializeSummary(doc),
    message: doc.message,
    pageUrl: doc.pageUrl || '',
    referrerUrl: doc.referrerUrl || '',
    source: doc.source,
    metadataSafe: {
      userAgentFamily: doc.metadataSafe?.userAgentFamily || '',
      locale: doc.metadataSafe?.locale || '',
    },
    // Signaux anti-abus — trace DEV. Le contrat les expose ; l'UI cliente ne les
    // affiche jamais (une demande légitime ne doit pas se lire « suspecte »).
    antiAbuseSignals: Array.isArray(doc.antiAbuseSignals) ? doc.antiAbuseSignals : [],
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Liste paginée — NON RÉSOLUES par défaut, NON LUES en tête.
 *
 * Tri : `_unread` (non lues d'abord) puis `submittedAt` décroissant. La pagination
 * par CURSEUR est immunisée contre l'insertion ; le curseur est COMPOSITE
 * (`{u, t}`) pour rester cohérent avec ce tri à deux clés. `resolved=true` bascule
 * sur les résolues (consultables sans jamais être supprimées).
 *
 * La borne de `limit` est appliquée ICI, jamais laissée au client.
 */
export async function listSubmissions({ resolved, unread, reason, search, from, to, limit, cursor } = {}) {
  const match = {};
  // NON résolues par défaut ; `resolved=true` → uniquement les résolues.
  match.resolvedAt = resolved === true || resolved === 'true' ? { $ne: null } : null;
  if (unread === true || unread === 'true') match.firstViewedAt = null;
  if (reason) match.reason = reason;
  if (from || to) {
    match.submittedAt = {};
    if (from) match.submittedAt.$gte = new Date(from);
    if (to) match.submittedAt.$lte = new Date(to);
  }
  if (search) {
    const rx = new RegExp(escapeRegex(String(search).trim()), 'i');
    match.$or = [
      { 'contact.name': rx }, { 'contact.email': rx },
      { companyName: rx }, { activity: rx },
      { message: rx },
    ];
  }

  const size = Math.min(Math.max(Number(limit) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);

  const pipeline = [
    { $match: match },
    { $addFields: { _unread: { $cond: [{ $eq: ['$firstViewedAt', null] }, 1, 0] } } },
  ];
  const cur = decodeCursor(cursor);
  if (cur) {
    // Après (u, t) dans un tri {_unread desc, submittedAt desc}.
    pipeline.push({
      $match: { $or: [{ _unread: { $lt: cur.u } }, { _unread: cur.u, submittedAt: { $lt: new Date(cur.t) } }] },
    });
  }
  pipeline.push({ $sort: { _unread: -1, submittedAt: -1 } }, { $limit: size + 1 });

  const docs = await ContactSubmission.aggregate(pipeline);
  const hasMore = docs.length > size;
  const page = hasMore ? docs.slice(0, size) : docs;
  const last = page[page.length - 1];

  return {
    items: page.map(serializeSummary),
    nextCursor: hasMore && last ? encodeCursor({ u: last._unread, t: last.submittedAt.toISOString() }) : null,
    hasMore,
  };
}

function encodeCursor(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64');
}
function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const c = JSON.parse(Buffer.from(String(cursor), 'base64').toString('utf8'));
    if (typeof c?.u === 'number' && c?.t && !Number.isNaN(new Date(c.t).getTime())) return c;
  } catch { /* curseur illisible : on repart du début */ }
  return null;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Nombre de demandes NON LUES et non résolues — pour le badge sidebar. */
export async function unreadCount() {
  return ContactSubmission.countDocuments({ firstViewedAt: null, resolvedAt: null });
}

/** Marque comme LUE (idempotent). `firstViewedAt` posé une seule fois. */
export async function markRead(submissionId) {
  const existing = await ContactSubmission.findOne({ submissionId });
  if (!existing) throw ApiError.notFound(`Demande introuvable : ${submissionId}`, { code: E.CONTACT_NOT_FOUND });
  if (!existing.firstViewedAt) {
    await ContactSubmission.updateOne({ submissionId, firstViewedAt: null }, { $set: { firstViewedAt: new Date() } });
  }
  return ContactSubmission.findOne({ submissionId }).lean();
}

/** Marque comme RÉSOLUE (idempotent). Ne supprime jamais rien. */
export async function resolve(submissionId, { actor } = {}) {
  const doc = await ContactSubmission.findOne({ submissionId });
  if (!doc) throw ApiError.notFound(`Demande introuvable : ${submissionId}`, { code: E.CONTACT_NOT_FOUND });
  if (!doc.resolvedAt) {
    await ContactSubmission.updateOne(
      { submissionId, resolvedAt: null },
      { $set: { resolvedAt: new Date(), status: CONTACT_STATUS.RESOLVED, firstViewedAt: doc.firstViewedAt || new Date() } }
    );
    logger.info(`Demande ${submissionId} résolue par ${actor?.email || 'système'}`);
  }
  return ContactSubmission.findOne({ submissionId }).lean();
}

/** Rouvre une demande résolue (idempotent) : la remet dans la liste principale. */
export async function reopen(submissionId, { actor } = {}) {
  const doc = await ContactSubmission.findOne({ submissionId });
  if (!doc) throw ApiError.notFound(`Demande introuvable : ${submissionId}`, { code: E.CONTACT_NOT_FOUND });
  if (doc.resolvedAt) {
    await ContactSubmission.updateOne(
      { submissionId },
      { $set: { resolvedAt: null, status: CONTACT_STATUS.IN_PROGRESS } }
    );
    logger.info(`Demande ${submissionId} rouverte par ${actor?.email || 'système'}`);
  }
  return ContactSubmission.findOne({ submissionId }).lean();
}

/**
 * Détail d'une demande, et marquage de la PREMIÈRE lecture.
 *
 * `firstViewedAt` est posé une seule fois, par une écriture CONDITIONNELLE
 * (`firstViewedAt: null` dans le filtre) : deux administrateurs qui ouvrent la
 * demande en même temps ne peuvent pas se voler la date. C'est un fait — « la
 * première fois qu'un humain l'a vue » — pas un compteur.
 */
export async function getSubmission(submissionId, { markViewed = false } = {}) {
  const doc = await ContactSubmission.findOne({ submissionId });
  if (!doc) throw ApiError.notFound(`Demande introuvable : ${submissionId}`, { code: E.CONTACT_NOT_FOUND });

  if (markViewed && !doc.firstViewedAt) {
    await ContactSubmission.updateOne(
      { submissionId, firstViewedAt: null },
      { $set: { firstViewedAt: new Date() } }
    );
    return ContactSubmission.findOne({ submissionId }).lean();
  }
  return doc.toObject();
}

/**
 * Change le statut.
 *
 * Le backend est l'AUTORITÉ : une transition absurde est refusée même si
 * l'interface l'a proposée. Le Manager n'affiche que les transitions permises,
 * mais un `curl` ne s'embarrasse pas de l'interface.
 */
export async function updateStatus({ submissionId, status, actor }) {
  const doc = await ContactSubmission.findOne({ submissionId });
  if (!doc) throw ApiError.notFound(`Demande introuvable : ${submissionId}`, { code: E.CONTACT_NOT_FOUND });

  if (!canTransition(doc.status, status)) {
    throw ApiError.badRequest(
      `Transition interdite : ${doc.status} → ${status}.`,
      { code: E.CONTACT_STATUS_TRANSITION_INVALID, from: doc.status, to: status }
    );
  }

  const set = { status };
  // `resolvedAt` suit le statut dans les DEUX sens : une date de résolution
  // laissée sur une demande rouverte affirmerait qu'elle est réglée.
  if (status === CONTACT_STATUS.RESOLVED) set.resolvedAt = new Date();
  else if (doc.status === CONTACT_STATUS.RESOLVED) set.resolvedAt = null;

  const updated = await ContactSubmission.findOneAndUpdate(
    { submissionId, status: doc.status }, // garde de concurrence
    { $set: set },
    { new: true }
  );
  if (!updated) {
    throw ApiError.conflict('Le statut vient de changer par ailleurs. Rechargez.', {
      code: E.CONTACT_STATUS_TRANSITION_INVALID,
    });
  }

  logger.info(`Demande ${submissionId} : ${doc.status} → ${status} par ${actor?.email || 'système'}`);
  return updated.toObject();
}

/** Assigne (ou désassigne si `userId` est nul). */
export async function updateAssignment({ submissionId, userId }) {
  const updated = await ContactSubmission.findOneAndUpdate(
    { submissionId },
    { $set: { assignedToUserId: userId || null } },
    { new: true }
  );
  if (!updated) throw ApiError.notFound(`Demande introuvable : ${submissionId}`, { code: E.CONTACT_NOT_FOUND });
  return updated.toObject();
}

export default {
  createSubmission,
  listSubmissions,
  getSubmission,
  updateStatus,
  updateAssignment,
  unreadCount,
  markRead,
  resolve,
  reopen,
  serializeSummary,
  serializeDetail,
};
