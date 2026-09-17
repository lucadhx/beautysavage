// controllers/evaluationClientController.js
// FORMATION-EVALUATION — Parcours CLIENT (après complétion de la formation).
//
// Accès gaté : achat (Purchase) + formation terminée (FormationProgress.completedAt) + tentature
// appartenant au client. Le client ne voit JAMAIS score / bonnes réponses (projection toClientDefinition).
import mongoose from 'mongoose';
import Formation from '../models/Formation.js';
import Purchase from '../models/Purchase.js';
import FormationProgress from '../models/FormationProgress.js';
import User from '../models/user.js';
import EvaluationAttempt from '../models/EvaluationAttempt.js';
import EvaluationDecision from '../models/EvaluationDecision.js';
import Certificate from '../models/Certificate.js';
import { getSessionUserId } from '../utils/session.js';
import { getActiveDefinition, toClientDefinition } from '../services/evaluation/evaluationDefinitionService.js';
import { validateSubmission } from '../services/evaluation/evaluationScoringService.js';
import { onEvaluationSubmitted } from '../services/evaluation/evaluationEventsService.js';
import { ensureCertificatePdf, streamCertificatePdf } from '../services/evaluation/certificateService.js';

const UPLOAD_PREFIX = '/uploads/evaluations/';

async function hasPurchase(userId, formationId) {
  const purchase = await Purchase.findOne({
    userId, itemType: 'formation', $or: [{ formationId }, { itemId: formationId }]
  }).lean();
  return Boolean(purchase);
}

async function isCompleted(userId, formationId) {
  const progress = await FormationProgress.findOne({ userId, formationId }).select('completedAt').lean();
  return Boolean(progress?.completedAt);
}

// Echo côté client (jamais de correction). answers + deliverables tels que stockés.
function clientAttemptView(attempt) {
  if (!attempt) return null;
  return {
    id: String(attempt._id),
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    answers: (attempt.answers || []).map((a) => ({
      questionId: String(a.questionId),
      sectionId: a.sectionId ? String(a.sectionId) : null,
      type: a.type,
      booleanValue: a.booleanValue,
      selectedAnswerIds: (a.selectedAnswerIds || []).map(String)
    })),
    deliverables: (attempt.deliverables || []).map((d) => ({
      deliverableId: String(d.deliverableId),
      type: d.type,
      files: (d.files || []).map((f) => ({ kind: f.kind, url: f.url, mime: f.mime, size: f.size }))
    })),
    questionnaireCompletedAt: attempt.questionnaireCompletedAt,
    submittedAt: attempt.submittedAt
  };
}

/** GET /api/client/evaluation/formations/:formationId — état complet du parcours d'évaluation. */
export async function getClientEvaluation(req, res) {
  try {
    const userId = getSessionUserId(req);
    if (!userId) return res.status(401).json({ ok: false, error: 'Authentification requise.' });
    const formationId = req.params.formationId;
    if (!mongoose.isValidObjectId(formationId)) return res.status(400).json({ ok: false, error: 'Formation invalide.' });
    if (!(await hasPurchase(userId, formationId))) return res.status(403).json({ ok: false, error: 'Accès refusé.' });

    const def = await getActiveDefinition(formationId);
    const completed = await isCompleted(userId, formationId);
    const [attempt, decisions, certificate] = await Promise.all([
      EvaluationAttempt.findOne({ formationId, userId, status: { $in: ['in_progress', 'submitted'] } }).sort({ attemptNumber: -1 }).lean(),
      EvaluationDecision.find({ formationId, userId }).sort({ createdAt: 1 }).lean(),
      Certificate.findOne({ formationId, userId }).sort({ createdAt: -1 }).lean()
    ]);

    return res.json({
      ok: true,
      hasEvaluation: Boolean(def),
      completed,
      definition: def ? toClientDefinition(def) : null,
      attempt: clientAttemptView(attempt),
      decisions: decisions.map((d) => ({
        decision: d.decision, comment: d.comment, attemptNumber: d.attemptNumber, createdAt: d.createdAt
      })),
      certificate: certificate ? { id: String(certificate._id), certificateNumber: certificate.certificateNumber, issuedAt: certificate.issuedAt } : null
    });
  } catch (error) {
    console.error('[evaluationClient] getClientEvaluation', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

/** POST /api/client/evaluation/formations/:formationId/attempt — crée/récupère la tentative en cours. */
export async function createOrGetAttempt(req, res) {
  try {
    const userId = getSessionUserId(req);
    if (!userId) return res.status(401).json({ ok: false, error: 'Authentification requise.' });
    const formationId = req.params.formationId;
    if (!mongoose.isValidObjectId(formationId)) return res.status(400).json({ ok: false, error: 'Formation invalide.' });
    if (!(await hasPurchase(userId, formationId))) return res.status(403).json({ ok: false, error: 'Accès refusé.' });
    if (!(await isCompleted(userId, formationId))) return res.status(409).json({ ok: false, error: 'Formation non terminée.', code: 'NOT_COMPLETED' });

    const def = await getActiveDefinition(formationId);
    if (!def) return res.status(404).json({ ok: false, error: 'Aucune évaluation active pour cette formation.' });

    let attempt = await EvaluationAttempt.findOne({ formationId, userId, status: 'in_progress' });
    if (!attempt) {
      // attemptNumber = max existant + 1
      const last = await EvaluationAttempt.findOne({ formationId, userId }).sort({ attemptNumber: -1 }).select('attemptNumber').lean();
      try {
        attempt = await EvaluationAttempt.create({
          formationId, userId, definitionId: def._id, definitionVersion: def.version,
          attemptNumber: (last?.attemptNumber || 0) + 1, status: 'in_progress'
        });
      } catch (err) {
        if (err?.code === 11000) attempt = await EvaluationAttempt.findOne({ formationId, userId, status: 'in_progress' });
        else throw err;
      }
    }
    return res.status(201).json({ ok: true, attempt: clientAttemptView(attempt) });
  } catch (error) {
    console.error('[evaluationClient] createOrGetAttempt', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

async function loadOwnedInProgressAttempt(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) { res.status(401).json({ ok: false, error: 'Authentification requise.' }); return null; }
  const { attemptId } = req.params;
  if (!mongoose.isValidObjectId(attemptId)) { res.status(400).json({ ok: false, error: 'Tentative invalide.' }); return null; }
  const attempt = await EvaluationAttempt.findById(attemptId);
  if (!attempt) { res.status(404).json({ ok: false, error: 'Tentative introuvable.' }); return null; }
  if (String(attempt.userId) !== String(userId)) { res.status(403).json({ ok: false, error: 'Accès refusé.' }); return null; }
  if (attempt.status !== 'in_progress') { res.status(409).json({ ok: false, error: 'Tentative non modifiable.' }); return null; }
  return attempt;
}

/** PUT /api/client/evaluation/attempts/:attemptId/answers — enregistre les réponses du questionnaire. */
export async function saveAnswers(req, res) {
  try {
    const attempt = await loadOwnedInProgressAttempt(req, res);
    if (!attempt) return undefined;
    const def = await getActiveDefinition(attempt.formationId);
    if (!def) return res.status(404).json({ ok: false, error: 'Évaluation inactive.' });

    // Whitelist des questions connues.
    const questionIndex = new Map();
    for (const s of def.sections || []) {
      for (const q of s.questions || []) questionIndex.set(String(q._id), { sectionId: String(s._id), type: q.type });
    }
    const answers = (Array.isArray(req.body?.answers) ? req.body.answers : [])
      .filter((a) => questionIndex.has(String(a?.questionId)))
      .map((a) => {
        const meta = questionIndex.get(String(a.questionId));
        return {
          questionId: new mongoose.Types.ObjectId(String(a.questionId)),
          sectionId: meta.sectionId ? new mongoose.Types.ObjectId(meta.sectionId) : null,
          type: meta.type,
          booleanValue: meta.type === 'true_false' ? (a.booleanValue == null ? null : Boolean(a.booleanValue)) : null,
          selectedAnswerIds: meta.type === 'quiz'
            ? (Array.isArray(a.selectedAnswerIds) ? a.selectedAnswerIds : []).filter((x) => mongoose.isValidObjectId(x)).map((x) => new mongoose.Types.ObjectId(String(x)))
            : []
        };
      });

    attempt.answers = answers;
    attempt.questionnaireCompletedAt = new Date();
    await attempt.save();
    return res.json({ ok: true, attempt: clientAttemptView(attempt) });
  } catch (error) {
    console.error('[evaluationClient] saveAnswers', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

/** POST /api/client/evaluation/attempts/:attemptId/deliverables — upload d'un fichier (multer). */
export async function uploadDeliverable(req, res) {
  try {
    const attempt = await loadOwnedInProgressAttempt(req, res);
    if (!attempt) return undefined;
    if (!req.file) return res.status(400).json({ ok: false, error: 'Aucun fichier reçu.' });

    const def = await getActiveDefinition(attempt.formationId);
    const deliverableId = String(req.body?.deliverableId || '');
    const kind = String(req.body?.kind || '');
    const deliverable = (def?.deliverables || []).find((d) => String(d._id) === deliverableId);
    if (!deliverable) return res.status(400).json({ ok: false, error: 'Rendu inconnu.' });

    const validKind = deliverable.type === 'photo_before_after'
      ? ['before', 'after'].includes(kind)
      : kind === 'video';
    if (!validKind) return res.status(400).json({ ok: false, error: 'Type de fichier invalide pour ce rendu.' });

    const url = `${UPLOAD_PREFIX}${req.file.filename}`;
    const file = { kind, url, mime: req.file.mimetype || '', size: req.file.size || 0, uploadedAt: new Date() };

    let entry = (attempt.deliverables || []).find((d) => String(d.deliverableId) === deliverableId);
    if (!entry) {
      entry = { deliverableId: new mongoose.Types.ObjectId(deliverableId), type: deliverable.type, files: [] };
      attempt.deliverables.push(entry);
      entry = attempt.deliverables[attempt.deliverables.length - 1];
    }
    // Un fichier par (deliverable, kind) : remplace l'ancien.
    entry.files = (entry.files || []).filter((f) => f.kind !== kind);
    entry.files.push(file);
    await attempt.save();

    return res.json({ ok: true, file: { kind, url, mime: file.mime, size: file.size } });
  } catch (error) {
    console.error('[evaluationClient] uploadDeliverable', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

/** POST /api/client/evaluation/attempts/:attemptId/submit — soumission finale. */
export async function submitAttempt(req, res) {
  try {
    const attempt = await loadOwnedInProgressAttempt(req, res);
    if (!attempt) return undefined;
    const def = await getActiveDefinition(attempt.formationId);
    if (!def) return res.status(404).json({ ok: false, error: 'Évaluation inactive.' });

    const validation = validateSubmission(def, attempt);
    if (!validation.valid) {
      return res.status(400).json({
        ok: false, error: 'Évaluation incomplète.',
        missingQuestions: validation.missingQuestions,
        missingDeliverables: validation.missingDeliverables
      });
    }

    attempt.status = 'submitted';
    attempt.submittedAt = new Date();
    await attempt.save();

    const [user, formation] = await Promise.all([
      User.findById(attempt.userId).select('firstName lastName email').lean(),
      Formation.findById(attempt.formationId).select('name').lean()
    ]);
    void onEvaluationSubmitted(user, formation, attempt);

    return res.json({ ok: true, attempt: clientAttemptView(attempt) });
  } catch (error) {
    console.error('[evaluationClient] submitAttempt', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

/** GET /api/client/evaluation/certificates/:id — télécharge SON diplôme. */
export async function downloadClientCertificate(req, res) {
  try {
    const userId = getSessionUserId(req);
    if (!userId) return res.status(401).json({ ok: false, error: 'Authentification requise.' });
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ ok: false, error: 'Certificat invalide.' });
    const certificate = await Certificate.findById(id);
    if (!certificate) return res.status(404).json({ ok: false, error: 'Certificat introuvable.' });
    if (String(certificate.userId) !== String(userId)) return res.status(403).json({ ok: false, error: 'Accès refusé.' });
    const { pdfPath } = await ensureCertificatePdf(certificate);
    return streamCertificatePdf(res, pdfPath, certificate.formationNameSnapshot);
  } catch (error) {
    console.error('[evaluationClient] downloadClientCertificate', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}
