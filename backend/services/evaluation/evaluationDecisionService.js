// services/evaluation/evaluationDecisionService.js
// FORMATION-EVALUATION — Décision institut (validation / refus) + orchestration.
//
// VALIDATION : décision immuable + diplôme (certificat + PDF) + e-mail/notif + tentature 'accepted'.
// REFUS      : décision immuable + on EFFACE réponses/fichiers de la tentative refusée (l'HISTORIQUE
//              — décision + tentative — reste) + création d'une NOUVELLE tentative (in_progress) +
//              e-mail/notif « recommencer ». Le commentaire est OBLIGATOIRE (garde ci-dessous).
import fs from 'node:fs';
import path from 'node:path';
import EvaluationAttempt from '../../models/EvaluationAttempt.js';
import EvaluationDecision from '../../models/EvaluationDecision.js';
import { computeScore } from './evaluationScoringService.js';
import { issueCertificate } from './certificateService.js';
import { onEvaluationAccepted, onEvaluationRefused } from './evaluationEventsService.js';

const UPLOAD_PREFIX = '/uploads/evaluations/';

export class EvaluationDecisionError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'EvaluationDecisionError';
    this.status = status;
  }
}

function requireComment(comment) {
  const c = String(comment || '').trim();
  if (!c) throw new EvaluationDecisionError('Un commentaire est obligatoire.', 400);
  return c.slice(0, 2000);
}

function reviewerName(reviewer) {
  return [reviewer?.firstName, reviewer?.lastName].filter(Boolean).join(' ').trim() || reviewer?.email || '';
}

// Supprime physiquement les fichiers uploadés d'une tentative (best-effort, uniquement notre dossier).
function scrubUploadedFiles(attempt) {
  for (const d of attempt.deliverables || []) {
    for (const f of d.files || []) {
      const url = String(f.url || '');
      if (!url.startsWith(UPLOAD_PREFIX)) continue;
      const rel = url.replace(/^\//, '');
      const abs = path.join(process.cwd(), rel);
      try { if (fs.existsSync(abs)) fs.unlinkSync(abs); } catch { /* best-effort */ }
    }
  }
}

/**
 * Valide une tentative → décision + diplôme + communications.
 * @returns {{ decision, certificate }}
 */
export async function acceptAttempt({ attempt, definition, user, formation, comment, reviewer }) {
  const cleanComment = requireComment(comment);
  if (attempt.status !== 'submitted') {
    throw new EvaluationDecisionError('Seule une tentative soumise peut être validée.', 409);
  }
  const score = computeScore(definition, attempt);

  const decision = await EvaluationDecision.create({
    attemptId: attempt._id,
    formationId: attempt.formationId,
    userId: attempt.userId,
    attemptNumber: attempt.attemptNumber,
    decision: 'accepted',
    comment: cleanComment,
    scorePercent: score.percent,
    reviewerId: reviewer?._id || null,
    reviewerName: reviewerName(reviewer)
  });

  const { certificate, pdfBase64 } = await issueCertificate({
    user, formation, attempt, decisionId: decision._id, reviewerId: reviewer?._id || null
  });
  decision.certificateId = certificate.certificateNumber;
  await decision.save();

  attempt.status = 'accepted';
  attempt.decidedAt = new Date();
  await attempt.save();

  await onEvaluationAccepted(user, formation, attempt, { certificate, pdfBase64 });
  return { decision, certificate };
}

/**
 * Refuse une tentative → décision + scrub réponses/fichiers + NOUVELLE tentative + communications.
 * @returns {{ decision, newAttempt }}
 */
export async function refuseAttempt({ attempt, definition, user, formation, comment, reviewer }) {
  const cleanComment = requireComment(comment);
  if (attempt.status !== 'submitted') {
    throw new EvaluationDecisionError('Seule une tentative soumise peut être refusée.', 409);
  }
  const score = computeScore(definition, attempt);

  const decision = await EvaluationDecision.create({
    attemptId: attempt._id,
    formationId: attempt.formationId,
    userId: attempt.userId,
    attemptNumber: attempt.attemptNumber,
    decision: 'refused',
    comment: cleanComment,
    scorePercent: score.percent,
    reviewerId: reviewer?._id || null,
    reviewerName: reviewerName(reviewer)
  });

  // Scrub : on efface les réponses + fichiers (physiques inclus), on conserve la ligne (historique).
  scrubUploadedFiles(attempt);
  attempt.answers = [];
  attempt.deliverables = [];
  attempt.questionnaireCompletedAt = null;
  attempt.status = 'refused';
  attempt.decidedAt = new Date();
  await attempt.save();

  // Nouvelle tentative (in_progress). L'index partiel garantit l'unicité de la reprise.
  const newAttempt = await EvaluationAttempt.create({
    formationId: attempt.formationId,
    userId: attempt.userId,
    sessionId: attempt.sessionId || null,
    definitionId: attempt.definitionId || null,
    definitionVersion: attempt.definitionVersion || 1,
    attemptNumber: Number(attempt.attemptNumber || 1) + 1,
    status: 'in_progress'
  });

  await onEvaluationRefused(user, formation, attempt, { comment: cleanComment });
  return { decision, newAttempt };
}

export default { acceptAttempt, refuseAttempt, EvaluationDecisionError };
