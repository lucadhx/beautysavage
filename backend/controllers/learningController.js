// C2 — Learning Studio + expérience apprenant + présence. Modèle Formation → Chapitre → Leçon →
// Ressource (additif, ne touche pas FormationModule legacy). Accès gated via Purchase. Progression
// serveur. Présence présentiel (token opaque par participant + scan QR). Attestation = preview only.
import crypto from 'node:crypto';
import mongoose from 'mongoose';

import Chapter from '../models/Chapter.js';
import Lesson, { LESSON_RESOURCE_TYPES } from '../models/Lesson.js';
import FormationProgress from '../models/FormationProgress.js';
import SessionAttendance, { ATTENDANCE_STATUSES } from '../models/SessionAttendance.js';
import AttestationTemplate from '../models/AttestationTemplate.js';
import Formation from '../models/Formation.js';
import FormationSession from '../models/FormationSession.js';
import Purchase from '../models/Purchase.js';
import User from '../models/user.js';
import { computeProgress, markLessonComplete, refreshCompletion, getOrCreateProgress } from '../services/learning/progressionService.js';
import { getOrCreateAttestationForProgress } from '../services/learning/attestationRenderService.js';
import { sendCertificateAvailableEmail } from '../services/mailService.js';
import { resolvePublicBaseUrl } from '../services/system/domainResolver.js';
import {
  onFormationStarted,
  onLessonCompleted,
  onFormationCompleted,
  onPresenceConfirmed
} from '../services/learning/learningEventsService.js';

const isId = v => mongoose.Types.ObjectId.isValid(v);

// ─── Payload builders ──────────────────────────────────────────────────────────
function buildResource(r) {
  return {
    id: r._id?.toString(),
    name: r.name,
    type: r.type,
    url: r.url,
    description: r.description || '',
    order: r.order ?? 0,
    visible: r.visible !== false
  };
}

function buildLessonPayload(doc, { includeHidden = true } = {}) {
  const resources = (doc.resources || [])
    .filter(r => includeHidden || r.visible !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(buildResource);
  return {
    id: doc._id?.toString(),
    formationId: doc.formationId?.toString(),
    chapterId: doc.chapterId?.toString(),
    title: doc.title,
    description: doc.description || '',
    videoUrl: doc.videoUrl || '',
    resources,
    order: doc.order ?? 0,
    visible: doc.visible !== false,
    isFree: Boolean(doc.isFree),
    estimatedMinutes: doc.estimatedMinutes || 0
  };
}

function buildChapterPayload(doc) {
  return {
    id: doc._id?.toString(),
    formationId: doc.formationId?.toString(),
    title: doc.title,
    description: doc.description || '',
    order: doc.order ?? 0,
    visible: doc.visible !== false
  };
}

async function loadDistancielFormation(id) {
  if (!isId(id)) return null;
  const f = await Formation.findById(id).lean();
  if (!f || f.type !== 'distanciel') return null;
  return f;
}

// Purchase actif (ou archivé) prouvant l'accès du client à la formation.
async function findFormationPurchase(userId, formationId, { activeOnly = false } = {}) {
  const filter = { userId, itemType: 'formation', $or: [{ formationId }, { itemId: formationId }] };
  if (activeOnly) filter.participationStatus = { $ne: 'canceled' };
  return Purchase.findOne(filter).lean();
}

// ═══════════════════ MANAGER — Chapitres ═══════════════════
export async function listLearningTree(req, res) {
  try {
    const formation = await loadDistancielFormation(req.params.id);
    if (!formation) return res.status(404).json({ ok: false, error: 'Formation distancielle introuvable.' });
    const [chapters, lessons] = await Promise.all([
      Chapter.find({ formationId: formation._id }).sort({ order: 1 }).lean(),
      Lesson.find({ formationId: formation._id }).sort({ order: 1 }).lean()
    ]);
    return res.json({
      ok: true,
      chapters: chapters.map(buildChapterPayload),
      lessons: lessons.map(l => buildLessonPayload(l))
    });
  } catch (err) {
    console.error('[learning] listLearningTree', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function createChapter(req, res) {
  try {
    const formation = await loadDistancielFormation(req.params.id);
    if (!formation) return res.status(404).json({ ok: false, error: 'Formation distancielle introuvable.' });
    const title = String(req.body?.title || '').trim();
    if (!title) return res.status(400).json({ ok: false, error: 'Le titre du chapitre est requis.' });
    const count = await Chapter.countDocuments({ formationId: formation._id });
    const doc = await Chapter.create({
      formationId: formation._id,
      title,
      description: String(req.body?.description || '').trim(),
      order: count + 1,
      visible: req.body?.visible !== false
    });
    return res.status(201).json({ ok: true, chapter: buildChapterPayload(doc) });
  } catch (err) {
    console.error('[learning] createChapter', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function updateChapter(req, res) {
  try {
    const doc = await Chapter.findById(req.params.chapterId);
    if (!doc) return res.status(404).json({ ok: false, error: 'Chapitre introuvable.' });
    if (req.body?.title !== undefined) doc.title = String(req.body.title).trim() || doc.title;
    if (req.body?.description !== undefined) doc.description = String(req.body.description).trim();
    if (req.body?.visible !== undefined) doc.visible = Boolean(req.body.visible);
    if (req.body?.order !== undefined) doc.order = Math.max(0, Number(req.body.order) || 0);
    await doc.save();
    return res.json({ ok: true, chapter: buildChapterPayload(doc) });
  } catch (err) {
    console.error('[learning] updateChapter', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function deleteChapter(req, res) {
  try {
    const { chapterId } = req.params;
    if (!isId(chapterId)) return res.status(400).json({ ok: false, error: 'Identifiant invalide.' });
    const doc = await Chapter.findById(chapterId);
    if (!doc) return res.status(404).json({ ok: false, error: 'Chapitre introuvable.' });
    await Lesson.deleteMany({ chapterId });
    await doc.deleteOne();
    return res.json({ ok: true });
  } catch (err) {
    console.error('[learning] deleteChapter', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function reorderChapters(req, res) {
  try {
    const ids = Array.isArray(req.body?.orderedChapterIds) ? req.body.orderedChapterIds : [];
    await Promise.all(ids.map((id, idx) => isId(id) ? Chapter.updateOne({ _id: id }, { order: idx + 1 }) : null));
    return res.json({ ok: true });
  } catch (err) {
    console.error('[learning] reorderChapters', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

// ═══════════════════ MANAGER — Leçons ═══════════════════
function sanitizeResources(input) {
  if (!Array.isArray(input)) return undefined;
  return input
    .filter(r => r && r.name && r.url)
    .map((r, idx) => ({
      name: String(r.name).trim(),
      type: LESSON_RESOURCE_TYPES.includes(r.type) ? r.type : 'link',
      url: String(r.url).trim(),
      description: String(r.description || '').trim(),
      order: r.order ?? idx + 1,
      visible: r.visible !== false
    }));
}

export async function createLesson(req, res) {
  try {
    const formation = await loadDistancielFormation(req.params.id);
    if (!formation) return res.status(404).json({ ok: false, error: 'Formation distancielle introuvable.' });
    const chapterId = String(req.body?.chapterId || '');
    if (!isId(chapterId)) return res.status(400).json({ ok: false, error: 'Chapitre invalide.' });
    const chapter = await Chapter.findOne({ _id: chapterId, formationId: formation._id });
    if (!chapter) return res.status(404).json({ ok: false, error: 'Chapitre introuvable.' });
    const title = String(req.body?.title || '').trim();
    if (!title) return res.status(400).json({ ok: false, error: 'Le titre de la leçon est requis.' });
    const count = await Lesson.countDocuments({ chapterId });
    const doc = await Lesson.create({
      formationId: formation._id,
      chapterId,
      title,
      description: String(req.body?.description || '').trim(),
      videoUrl: String(req.body?.videoUrl || '').trim(),
      resources: sanitizeResources(req.body?.resources) || [],
      order: count + 1,
      visible: req.body?.visible !== false,
      isFree: Boolean(req.body?.isFree),
      estimatedMinutes: Math.max(0, Number(req.body?.estimatedMinutes) || 0)
    });
    return res.status(201).json({ ok: true, lesson: buildLessonPayload(doc) });
  } catch (err) {
    console.error('[learning] createLesson', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function updateLesson(req, res) {
  try {
    const doc = await Lesson.findById(req.params.lessonId);
    if (!doc) return res.status(404).json({ ok: false, error: 'Leçon introuvable.' });
    if (req.body?.title !== undefined) doc.title = String(req.body.title).trim() || doc.title;
    if (req.body?.description !== undefined) doc.description = String(req.body.description).trim();
    if (req.body?.videoUrl !== undefined) doc.videoUrl = String(req.body.videoUrl).trim();
    if (req.body?.visible !== undefined) doc.visible = Boolean(req.body.visible);
    if (req.body?.isFree !== undefined) doc.isFree = Boolean(req.body.isFree);
    if (req.body?.estimatedMinutes !== undefined) doc.estimatedMinutes = Math.max(0, Number(req.body.estimatedMinutes) || 0);
    if (req.body?.order !== undefined) doc.order = Math.max(0, Number(req.body.order) || 0);
    const resources = sanitizeResources(req.body?.resources);
    if (resources !== undefined) doc.resources = resources;
    await doc.save();
    return res.json({ ok: true, lesson: buildLessonPayload(doc) });
  } catch (err) {
    console.error('[learning] updateLesson', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function deleteLesson(req, res) {
  try {
    const doc = await Lesson.findById(req.params.lessonId);
    if (!doc) return res.status(404).json({ ok: false, error: 'Leçon introuvable.' });
    await doc.deleteOne();
    return res.json({ ok: true });
  } catch (err) {
    console.error('[learning] deleteLesson', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function reorderLessons(req, res) {
  try {
    const ids = Array.isArray(req.body?.orderedLessonIds) ? req.body.orderedLessonIds : [];
    await Promise.all(ids.map((id, idx) => isId(id) ? Lesson.updateOne({ _id: id }, { order: idx + 1 }) : null));
    return res.json({ ok: true });
  } catch (err) {
    console.error('[learning] reorderLessons', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

// ═══════════════════ CLIENT — Apprenant ═══════════════════
export async function listMyLearningFormations(req, res) {
  try {
    const userId = req.sessionUser?._id;
    const purchases = await Purchase.find({ userId, itemType: 'formation', sessionId: null }).lean();
    const formationIds = [...new Set(purchases.map(p => String(p.formationId || p.itemId)).filter(Boolean))];
    const [formations, progressDocs] = await Promise.all([
      formationIds.length ? Formation.find({ _id: { $in: formationIds }, type: 'distanciel' }).lean() : [],
      FormationProgress.find({ userId, formationId: { $in: formationIds } }).lean()
    ]);
    const formationById = new Map(formations.map(f => [String(f._id), f]));
    const progressById = new Map(progressDocs.map(p => [String(p.formationId), p]));
    // Compter les leçons visibles par formation pour un % léger.
    const lessons = formationIds.length
      ? await Lesson.find({ formationId: { $in: formationIds }, visible: true }).select('formationId').lean()
      : [];
    const totalByFormation = new Map();
    for (const l of lessons) {
      const k = String(l.formationId);
      totalByFormation.set(k, (totalByFormation.get(k) || 0) + 1);
    }
    const items = formationIds
      .filter(id => formationById.has(id))
      .map(id => {
        const f = formationById.get(id);
        const prog = progressById.get(id);
        const total = totalByFormation.get(id) || 0;
        const done = prog ? prog.completedLessonIds.filter(Boolean).length : 0;
        return {
          formationId: id,
          name: f.name,
          coverImage: f.coverImage || '',
          type: f.type,
          progressPct: total > 0 ? Math.round((Math.min(done, total) / total) * 100) : 0,
          startedAt: prog?.startedAt || null,
          completedAt: prog?.completedAt || null,
          lastLessonId: prog?.lastLessonId ? String(prog.lastLessonId) : null
        };
      });
    return res.json({ ok: true, formations: items });
  } catch (err) {
    console.error('[learning] listMyLearningFormations', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function getMyLearningFormation(req, res) {
  try {
    const userId = req.sessionUser?._id;
    const formation = await loadDistancielFormation(req.params.id);
    if (!formation) return res.status(404).json({ ok: false, error: 'Formation introuvable.' });
    const purchase = await findFormationPurchase(userId, formation._id);
    if (!purchase) return res.status(403).json({ ok: false, error: 'Accès refusé : formation non acquise.' });

    const [chapters, lessons, progress] = await Promise.all([
      Chapter.find({ formationId: formation._id, visible: true }).sort({ order: 1 }).lean(),
      Lesson.find({ formationId: formation._id, visible: true }).sort({ order: 1 }).lean(),
      getOrCreateProgress(userId, formation._id)
    ]);
    const stats = computeProgress(chapters, lessons, progress.completedLessonIds);
    return res.json({
      ok: true,
      formation: { id: String(formation._id), name: formation.name, coverImage: formation.coverImage || '', accessUrl: formation.accessUrl || '' },
      chapters: chapters.map(buildChapterPayload),
      lessons: lessons.map(l => buildLessonPayload(l, { includeHidden: false })),
      progress: {
        completedLessonIds: progress.completedLessonIds.map(String),
        lastLessonId: progress.lastLessonId ? String(progress.lastLessonId) : null,
        formationPct: stats.formation.pct,
        chapters: stats.chapters,
        completedAt: progress.completedAt || null
      }
    });
  } catch (err) {
    console.error('[learning] getMyLearningFormation', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function completeLesson(req, res) {
  try {
    const userId = req.sessionUser?._id;
    const { lessonId } = req.params;
    if (!isId(lessonId)) return res.status(400).json({ ok: false, error: 'Identifiant invalide.' });
    const lesson = await Lesson.findById(lessonId).lean();
    if (!lesson) return res.status(404).json({ ok: false, error: 'Leçon introuvable.' });
    const formation = await Formation.findById(lesson.formationId).lean();
    if (!formation) return res.status(404).json({ ok: false, error: 'Formation introuvable.' });
    const purchase = await findFormationPurchase(userId, formation._id);
    if (!purchase) return res.status(403).json({ ok: false, error: 'Accès refusé.' });

    const { progressDoc, justStarted } = await markLessonComplete(userId, formation._id, lessonId);
    const [chapters, lessons] = await Promise.all([
      Chapter.find({ formationId: formation._id, visible: true }).lean(),
      Lesson.find({ formationId: formation._id, visible: true }).lean()
    ]);
    const { justCompleted, progress } = await refreshCompletion(progressDoc, chapters, lessons);

    // Événements (best-effort, hors transaction).
    const user = req.sessionUser;
    if (justStarted) void onFormationStarted(user, formation);
    void onLessonCompleted(user, formation, lesson);
    if (justCompleted) {
      // C3 — génère l'attestation dès la complétion (idempotent ; le téléchargement la régénère sinon).
      try {
        await getOrCreateAttestationForProgress(progressDoc, { formation, user });
      } catch (e) {
        console.error('[learning] génération attestation', e?.message || e);
      }
      void onFormationCompleted(user, formation, { attestationReady: Boolean(progressDoc.attestation?.certificateId) });
      // LOT2 P1-12 — e-mail dédié « attestation disponible » (best-effort ; lien espace client).
      if (progressDoc.attestation?.certificateId && user?.email) {
        void sendCertificateAvailableEmail({
          toEmail: String(user.email).trim(),
          firstName: String(user.firstName || '').trim(),
          formationTitle: String(formation?.name || '').trim(),
          actionUrl: resolvePublicBaseUrl()
        }).catch((e) => console.error('[learning] email attestation', e?.message || e));
      }
    }

    return res.json({
      ok: true,
      progress: {
        completedLessonIds: progressDoc.completedLessonIds.map(String),
        formationPct: progress.formation.pct,
        chapters: progress.chapters,
        completedAt: progressDoc.completedAt || null
      }
    });
  } catch (err) {
    console.error('[learning] completeLesson', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

// ─── Présentiel : token de présence du client (QR affiché côté apprenant) ───
export async function getMyAttendanceToken(req, res) {
  try {
    const userId = req.sessionUser?._id;
    const { sessionId } = req.params;
    if (!isId(sessionId)) return res.status(400).json({ ok: false, error: 'Identifiant invalide.' });
    const purchase = await Purchase.findOne({ userId, itemType: 'formation', sessionId, participationStatus: { $ne: 'canceled' } }).lean();
    if (!purchase) return res.status(403).json({ ok: false, error: 'Aucune réservation pour cette session.' });
    let att = await SessionAttendance.findOne({ sessionId, userId });
    if (!att) {
      att = await SessionAttendance.create({
        sessionId,
        formationId: purchase.formationId || purchase.itemId,
        userId,
        status: 'pending',
        attendanceToken: crypto.randomBytes(16).toString('hex')
      });
    } else if (!att.attendanceToken) {
      att.attendanceToken = crypto.randomBytes(16).toString('hex');
      await att.save();
    }
    return res.json({
      ok: true,
      attendance: { status: att.status, token: att.attendanceToken, payload: `BS-PRESENCE:${sessionId}:${att.attendanceToken}` }
    });
  } catch (err) {
    console.error('[learning] getMyAttendanceToken', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

// ═══════════════════ Attestation PDF (C3) ═══════════════════
// Stream le PDF (téléchargement). Aucune donnée sensible dans le nom de fichier (certificateId opaque).
function streamAttestationPdf(res, result, formationName) {
  const safeName = String(formationName || 'formation').normalize('NFD').replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 60) || 'formation';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="attestation-${safeName}.pdf"`);
  return res.sendFile(result.pdfPath);
}

// Client : son attestation (formation TERMINÉE uniquement, gated par Purchase).
export async function getClientAttestation(req, res) {
  try {
    const userId = req.sessionUser?._id;
    const formation = await loadDistancielFormation(req.params.formationId);
    if (!formation) return res.status(404).json({ ok: false, error: 'Formation introuvable.' });
    const purchase = await findFormationPurchase(userId, formation._id);
    if (!purchase) return res.status(403).json({ ok: false, error: 'Accès refusé.' });
    const progress = await FormationProgress.findOne({ userId, formationId: formation._id });
    if (!progress || !progress.completedAt) {
      return res.status(409).json({ ok: false, error: 'Formation non terminée.', code: 'NOT_COMPLETED' });
    }
    const result = await getOrCreateAttestationForProgress(progress, { formation, user: req.sessionUser });
    return streamAttestationPdf(res, result, formation.name);
  } catch (err) {
    console.error('[learning] getClientAttestation', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

// Manager (admin/dev) : attestation d'un client donné.
export async function getManagerAttestation(req, res) {
  try {
    const { customerId, formationId } = req.params;
    if (!isId(customerId) || !isId(formationId)) return res.status(400).json({ ok: false, error: 'Identifiant invalide.' });
    const [formation, user] = await Promise.all([
      Formation.findById(formationId).lean(),
      User.findById(customerId).select('firstName lastName email').lean()
    ]);
    if (!formation || !user) return res.status(404).json({ ok: false, error: 'Introuvable.' });
    const progress = await FormationProgress.findOne({ userId: customerId, formationId });
    if (!progress || !progress.completedAt) {
      return res.status(409).json({ ok: false, error: 'Formation non terminée.', code: 'NOT_COMPLETED' });
    }
    const result = await getOrCreateAttestationForProgress(progress, { formation, user });
    return streamAttestationPdf(res, result, formation.name);
  } catch (err) {
    console.error('[learning] getManagerAttestation', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

// ═══════════════════ MANAGER — Présence ═══════════════════
async function buildParticipants(session) {
  const purchases = await Purchase.find({ sessionId: session._id, itemType: 'formation', participationStatus: { $ne: 'canceled' } }).lean();
  const userIds = [...new Set(purchases.map(p => String(p.userId)))];
  const [users, attendances] = await Promise.all([
    userIds.length ? User.find({ _id: { $in: userIds } }).select('firstName lastName email').lean() : [],
    SessionAttendance.find({ sessionId: session._id }).lean()
  ]);
  const userById = new Map(users.map(u => [String(u._id), u]));
  const attByUser = new Map(attendances.map(a => [String(a.userId), a]));
  return userIds.map(uid => {
    const u = userById.get(uid);
    const a = attByUser.get(uid);
    const name = u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email : '—';
    return {
      userId: uid,
      name,
      status: a?.status || 'pending',
      method: a?.method || null,
      checkedInAt: a?.checkedInAt || null
    };
  });
}

export async function listSessionParticipants(req, res) {
  try {
    const { sessionId } = req.params;
    if (!isId(sessionId)) return res.status(400).json({ ok: false, error: 'Identifiant invalide.' });
    const session = await FormationSession.findById(sessionId).lean();
    if (!session) return res.status(404).json({ ok: false, error: 'Session introuvable.' });
    const participants = await buildParticipants(session);
    const present = participants.filter(p => p.status === 'present').length;
    return res.json({ ok: true, participants, summary: { total: participants.length, present, remaining: participants.length - present } });
  } catch (err) {
    console.error('[learning] listSessionParticipants', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

async function markPresence(session, userId, status, method, adminId) {
  const purchase = await Purchase.findOne({ sessionId: session._id, userId, itemType: 'formation' }).lean();
  if (!purchase) return { error: 'not_participant' };
  const att = await SessionAttendance.findOneAndUpdate(
    { sessionId: session._id, userId },
    {
      $set: {
        formationId: purchase.formationId || purchase.itemId,
        status,
        method,
        markedByAdminId: adminId || null,
        checkedInAt: status === 'present' ? new Date() : null
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  if (status === 'present') {
    const [user, formation] = await Promise.all([
      User.findById(userId).select('firstName lastName email').lean(),
      Formation.findById(att.formationId).select('name').lean()
    ]);
    if (user && formation) void onPresenceConfirmed(user, formation, session);
  }
  return { attendance: att };
}

export async function markAttendance(req, res) {
  try {
    const { sessionId } = req.params;
    const userId = String(req.body?.userId || '');
    const status = String(req.body?.status || '');
    if (!isId(sessionId) || !isId(userId)) return res.status(400).json({ ok: false, error: 'Identifiant invalide.' });
    if (!ATTENDANCE_STATUSES.includes(status)) return res.status(400).json({ ok: false, error: 'Statut invalide.' });
    const session = await FormationSession.findById(sessionId).lean();
    if (!session) return res.status(404).json({ ok: false, error: 'Session introuvable.' });
    const result = await markPresence(session, userId, status, 'manual', req.sessionUser?._id);
    if (result.error) return res.status(404).json({ ok: false, error: 'Participant introuvable pour cette session.' });
    return res.json({ ok: true, status, userId });
  } catch (err) {
    console.error('[learning] markAttendance', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

// Scan QR institut : le token opaque résout un participant → présence validée.
export async function scanAttendance(req, res) {
  try {
    const { sessionId } = req.params;
    const token = String(req.body?.token || '').trim();
    if (!isId(sessionId)) return res.status(400).json({ ok: false, error: 'Identifiant invalide.' });
    if (!token) return res.status(400).json({ ok: false, error: 'Jeton manquant.' });
    const session = await FormationSession.findById(sessionId).lean();
    if (!session) return res.status(404).json({ ok: false, error: 'Session introuvable.' });
    // Le payload peut être "BS-PRESENCE:<sid>:<token>" ou le token brut.
    const rawToken = token.includes(':') ? token.split(':').pop() : token;
    const att = await SessionAttendance.findOne({ attendanceToken: rawToken });
    if (!att || String(att.sessionId) !== String(sessionId)) {
      return res.status(404).json({ ok: false, error: 'Participant introuvable (QR invalide).' });
    }
    const result = await markPresence(session, att.userId, 'present', 'qr', req.sessionUser?._id);
    if (result.error) return res.status(404).json({ ok: false, error: 'Participant introuvable.' });
    const user = await User.findById(att.userId).select('firstName lastName email').lean();
    const name = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email : '—';
    return res.json({ ok: true, participant: { userId: String(att.userId), name, status: 'present' } });
  } catch (err) {
    console.error('[learning] scanAttendance', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

// ═══════════════════ Attestation (préparation C3 — preview only) ═══════════════════
async function loadAttestationTemplate() {
  let t = await AttestationTemplate.findOne({ active: true });
  if (!t) t = await AttestationTemplate.create({});
  return t;
}

export async function getAttestationTemplate(_req, res) {
  try {
    const t = await loadAttestationTemplate();
    return res.json({ ok: true, template: { id: String(t._id), name: t.name, html: t.html, variables: t.variables, active: t.active } });
  } catch (err) {
    console.error('[learning] getAttestationTemplate', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

export async function updateAttestationTemplate(req, res) {
  try {
    const t = await loadAttestationTemplate();
    if (req.body?.name !== undefined) t.name = String(req.body.name).trim() || t.name;
    if (req.body?.html !== undefined) t.html = String(req.body.html);
    await t.save();
    return res.json({ ok: true, template: { id: String(t._id), name: t.name, html: t.html, variables: t.variables, active: t.active } });
  } catch (err) {
    console.error('[learning] updateAttestationTemplate', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

// Preview : substitue des données d'exemple dans le HTML. AUCUNE génération de document final (C3).
export async function previewAttestation(req, res) {
  try {
    const t = await loadAttestationTemplate();
    const sample = {
      clientName: 'Camille Martin',
      formationName: 'Formation exemple',
      sessionDate: new Date().toLocaleDateString('fr-FR'),
      durationDays: '2',
      instituteName: 'Beauty Savage',
      issuedAt: new Date().toLocaleDateString('fr-FR'),
      ...(req.body?.data || {})
    };
    let html = t.html || '<p>{{clientName}} — {{formationName}} ({{sessionDate}})</p>';
    for (const [k, v] of Object.entries(sample)) {
      html = html.replaceAll(`{{${k}}}`, String(v));
    }
    return res.json({ ok: true, preview: { html, prepared: true, generated: false } });
  } catch (err) {
    console.error('[learning] previewAttestation', err);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}
