// controllers/evaluationManagerController.js
// FORMATION-EVALUATION — Côté INSTITUT (dev/admin) : édition de la définition + console « Résultats »
// (liste, fiche détaillée avec score + bonnes réponses, validation / refus + diplôme).
import mongoose from 'mongoose';
import Formation from '../models/Formation.js';
import User from '../models/user.js';
import EvaluationAttempt from '../models/EvaluationAttempt.js';
import EvaluationDecision from '../models/EvaluationDecision.js';
import Certificate from '../models/Certificate.js';
import { getDefinition, upsertDefinition } from '../services/evaluation/evaluationDefinitionService.js';
import { computeScore } from '../services/evaluation/evaluationScoringService.js';
import { acceptAttempt, refuseAttempt, EvaluationDecisionError } from '../services/evaluation/evaluationDecisionService.js';
import { ensureCertificatePdf, streamCertificatePdf } from '../services/evaluation/certificateService.js';

function clientName(u) {
  return [u?.firstName, u?.lastName].filter(Boolean).join(' ').trim() || u?.email || '—';
}

/** GET /api/gestion/evaluation/formations/:formationId/definition — définition complète (édition). */
export async function getManagerDefinition(req, res) {
  try {
    const { formationId } = req.params;
    if (!mongoose.isValidObjectId(formationId)) return res.status(400).json({ ok: false, error: 'Formation invalide.' });
    const def = await getDefinition(formationId);
    return res.json({
      ok: true,
      definition: def
        ? { formationId: String(def.formationId), active: def.active, version: def.version, sections: def.sections, deliverables: def.deliverables }
        : { formationId: String(formationId), active: false, version: 0, sections: [], deliverables: [] }
    });
  } catch (error) {
    console.error('[evaluationManager] getDefinition', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

/** PUT /api/gestion/evaluation/formations/:formationId/definition — crée/met à jour (sanitize + version). */
export async function putManagerDefinition(req, res) {
  try {
    const { formationId } = req.params;
    if (!mongoose.isValidObjectId(formationId)) return res.status(400).json({ ok: false, error: 'Formation invalide.' });
    const formation = await Formation.findById(formationId).select('_id').lean();
    if (!formation) return res.status(404).json({ ok: false, error: 'Formation introuvable.' });
    const def = await upsertDefinition(formationId, req.body || {});
    return res.json({
      ok: true,
      definition: { formationId: String(def.formationId), active: def.active, version: def.version, sections: def.sections, deliverables: def.deliverables }
    });
  } catch (error) {
    console.error('[evaluationManager] putDefinition', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

/** GET /api/gestion/evaluation/results — liste des résultats (filtres formation/statut/date). */
export async function listResults(req, res) {
  try {
    const filter = { status: { $in: ['submitted', 'accepted', 'refused'] } };
    if (req.query.formationId && mongoose.isValidObjectId(req.query.formationId)) filter.formationId = req.query.formationId;
    if (req.query.status && ['submitted', 'accepted', 'refused'].includes(String(req.query.status))) filter.status = String(req.query.status);
    if (req.query.from || req.query.to) {
      filter.submittedAt = {};
      if (req.query.from) filter.submittedAt.$gte = new Date(String(req.query.from));
      if (req.query.to) filter.submittedAt.$lte = new Date(String(req.query.to));
    }

    const attempts = await EvaluationAttempt.find(filter)
      .sort({ submittedAt: -1, updatedAt: -1 })
      .limit(300)
      .populate('userId', 'firstName lastName email')
      .populate('formationId', 'name')
      .lean();

    const rows = attempts.map((a) => ({
      id: String(a._id),
      client: clientName(a.userId),
      clientEmail: a.userId?.email || '',
      formationId: a.formationId?._id ? String(a.formationId._id) : String(a.formationId || ''),
      formation: a.formationId?.name || '—',
      submittedAt: a.submittedAt,
      status: a.status,
      attemptNumber: a.attemptNumber
    }));
    return res.json({ ok: true, results: rows });
  } catch (error) {
    console.error('[evaluationManager] listResults', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

/** GET /api/gestion/evaluation/results/:attemptId — fiche détaillée (score + bonnes réponses + rendus). */
export async function getResult(req, res) {
  try {
    const { attemptId } = req.params;
    if (!mongoose.isValidObjectId(attemptId)) return res.status(400).json({ ok: false, error: 'Résultat invalide.' });
    const attempt = await EvaluationAttempt.findById(attemptId)
      .populate('userId', 'firstName lastName email')
      .populate('formationId', 'name')
      .lean();
    if (!attempt) return res.status(404).json({ ok: false, error: 'Résultat introuvable.' });

    const def = await getDefinition(attempt.formationId?._id || attempt.formationId);
    const definition = def ? def.toObject() : { sections: [], deliverables: [] };
    const score = computeScore(definition, attempt);
    const correctByQuestion = new Map(score.perQuestion.map((p) => [p.questionId, p.correct]));
    const answerByQuestion = new Map((attempt.answers || []).map((a) => [String(a.questionId), a]));

    // Bloc questionnaire (institut voit tout : réponse client + bonne réponse).
    const sections = (definition.sections || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0)).map((s) => ({
      id: String(s._id), title: s.title, description: s.description,
      questions: (s.questions || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0)).map((q) => {
        const ans = answerByQuestion.get(String(q._id));
        const base = {
          id: String(q._id), type: q.type, prompt: q.prompt, required: q.required,
          correct: Boolean(correctByQuestion.get(String(q._id))),
          clientAnswer: ans ? {
            booleanValue: ans.booleanValue,
            selectedAnswerIds: (ans.selectedAnswerIds || []).map(String)
          } : null
        };
        if (q.type === 'true_false') base.correctBoolean = q.correctBoolean;
        else {
          base.mode = q.mode;
          base.answers = (q.answers || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0))
            .map((a) => ({ id: String(a._id), text: a.text, correct: a.correct }));
        }
        return base;
      })
    }));

    // Bloc rendus (photos avant/après + vidéos).
    const filesByDeliverable = new Map((attempt.deliverables || []).map((d) => [String(d.deliverableId), d.files || []]));
    const deliverables = (definition.deliverables || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0)).map((d) => ({
      id: String(d._id), type: d.type, title: d.title, description: d.description,
      files: (filesByDeliverable.get(String(d._id)) || []).map((f) => ({ kind: f.kind, url: f.url, mime: f.mime }))
    }));

    const [decisions, certificate] = await Promise.all([
      EvaluationDecision.find({ userId: attempt.userId?._id || attempt.userId, formationId: attempt.formationId?._id || attempt.formationId })
        .sort({ createdAt: 1 })
        .populate('reviewerId', 'firstName lastName email')
        .lean(),
      Certificate.findOne({ attemptId: attempt._id }).lean()
    ]);

    return res.json({
      ok: true,
      result: {
        id: String(attempt._id),
        client: clientName(attempt.userId),
        clientEmail: attempt.userId?.email || '',
        formation: attempt.formationId?.name || '—',
        status: attempt.status,
        attemptNumber: attempt.attemptNumber,
        submittedAt: attempt.submittedAt,
        score: { total: score.total, correct: score.correct, wrong: score.wrong, percent: score.percent },
        sections,
        deliverables,
        decisions: decisions.map((d) => ({
          decision: d.decision, comment: d.comment, attemptNumber: d.attemptNumber,
          reviewer: d.reviewerName || clientName(d.reviewerId), createdAt: d.createdAt, certificateId: d.certificateId
        })),
        certificate: certificate ? { id: String(certificate._id), certificateNumber: certificate.certificateNumber, issuedAt: certificate.issuedAt } : null
      }
    });
  } catch (error) {
    console.error('[evaluationManager] getResult', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

async function loadDecisionContext(attemptId) {
  const attempt = await EvaluationAttempt.findById(attemptId);
  if (!attempt) return null;
  const [user, formation, def] = await Promise.all([
    User.findById(attempt.userId).select('firstName lastName email').lean(),
    Formation.findById(attempt.formationId).select('name').lean(),
    getDefinition(attempt.formationId)
  ]);
  return { attempt, user, formation, definition: def ? def.toObject() : { sections: [], deliverables: [] } };
}

/** POST /api/gestion/evaluation/results/:attemptId/accept — validation (commentaire obligatoire → diplôme). */
export async function acceptResult(req, res) {
  try {
    const { attemptId } = req.params;
    if (!mongoose.isValidObjectId(attemptId)) return res.status(400).json({ ok: false, error: 'Résultat invalide.' });
    const ctx = await loadDecisionContext(attemptId);
    if (!ctx) return res.status(404).json({ ok: false, error: 'Résultat introuvable.' });
    const { decision, certificate } = await acceptAttempt({
      attempt: ctx.attempt, definition: ctx.definition, user: ctx.user, formation: ctx.formation,
      comment: req.body?.comment, reviewer: req.sessionUser
    });
    return res.json({
      ok: true,
      decision: { decision: decision.decision, comment: decision.comment },
      certificate: { id: String(certificate._id), certificateNumber: certificate.certificateNumber }
    });
  } catch (error) {
    if (error instanceof EvaluationDecisionError) return res.status(error.status).json({ ok: false, error: error.message });
    console.error('[evaluationManager] acceptResult', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

/** POST /api/gestion/evaluation/results/:attemptId/refuse — refus (commentaire obligatoire → nouvelle tentative). */
export async function refuseResult(req, res) {
  try {
    const { attemptId } = req.params;
    if (!mongoose.isValidObjectId(attemptId)) return res.status(400).json({ ok: false, error: 'Résultat invalide.' });
    const ctx = await loadDecisionContext(attemptId);
    if (!ctx) return res.status(404).json({ ok: false, error: 'Résultat introuvable.' });
    const { decision, newAttempt } = await refuseAttempt({
      attempt: ctx.attempt, definition: ctx.definition, user: ctx.user, formation: ctx.formation,
      comment: req.body?.comment, reviewer: req.sessionUser
    });
    return res.json({
      ok: true,
      decision: { decision: decision.decision, comment: decision.comment },
      newAttempt: { id: String(newAttempt._id), attemptNumber: newAttempt.attemptNumber }
    });
  } catch (error) {
    if (error instanceof EvaluationDecisionError) return res.status(error.status).json({ ok: false, error: error.message });
    console.error('[evaluationManager] refuseResult', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}

/** GET /api/gestion/evaluation/certificates/:id — télécharge un diplôme (institut). */
export async function downloadManagerCertificate(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ ok: false, error: 'Certificat invalide.' });
    const certificate = await Certificate.findById(id);
    if (!certificate) return res.status(404).json({ ok: false, error: 'Certificat introuvable.' });
    const { pdfPath } = await ensureCertificatePdf(certificate);
    return streamCertificatePdf(res, pdfPath, certificate.formationNameSnapshot);
  } catch (error) {
    console.error('[evaluationManager] downloadManagerCertificate', error);
    return res.status(500).json({ ok: false, error: 'Erreur serveur.' });
  }
}
