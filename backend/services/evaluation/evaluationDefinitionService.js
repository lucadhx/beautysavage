// services/evaluation/evaluationDefinitionService.js
// FORMATION-EVALUATION — Définition d'évaluation (édition institut/dev).
//
// Sanitize + normalise la structure envoyée par l'éditeur (sections → questions → réponses +
// deliverables), préserve les _id existants (stabilité des tentatives qui les référencent), et
// expose une PROJECTION CLIENT qui retire toute info de correction (bonnes réponses / correctBoolean).
import mongoose from 'mongoose';
import EvaluationDefinition, {
  QUESTION_TYPES, QUIZ_MODES, DELIVERABLE_TYPES
} from '../../models/EvaluationDefinition.js';

function toId(v) {
  return v && mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(String(v)) : new mongoose.Types.ObjectId();
}
function str(v, max = 2000) {
  return String(v == null ? '' : v).slice(0, max);
}

function sanitizeAnswer(raw, index) {
  return {
    _id: toId(raw?._id),
    text: str(raw?.text, 500),
    correct: Boolean(raw?.correct),
    order: Number.isFinite(Number(raw?.order)) ? Number(raw.order) : index
  };
}

function sanitizeQuestion(raw, index) {
  const type = QUESTION_TYPES.includes(raw?.type) ? raw.type : 'true_false';
  const q = {
    _id: toId(raw?._id),
    type,
    prompt: str(raw?.prompt, 1000),
    required: raw?.required === undefined ? true : Boolean(raw.required),
    order: Number.isFinite(Number(raw?.order)) ? Number(raw.order) : index
  };
  if (type === 'true_false') {
    q.correctBoolean = raw?.correctBoolean === undefined ? true : Boolean(raw.correctBoolean);
  } else {
    q.mode = QUIZ_MODES.includes(raw?.mode) ? raw.mode : 'single';
    q.answers = (Array.isArray(raw?.answers) ? raw.answers : []).map(sanitizeAnswer);
  }
  return q;
}

function sanitizeSection(raw, index) {
  return {
    _id: toId(raw?._id),
    title: str(raw?.title, 300),
    description: str(raw?.description, 1000),
    order: Number.isFinite(Number(raw?.order)) ? Number(raw.order) : index,
    questions: (Array.isArray(raw?.questions) ? raw.questions : []).map(sanitizeQuestion)
  };
}

function sanitizeDeliverable(raw, index) {
  const type = DELIVERABLE_TYPES.includes(raw?.type) ? raw.type : 'photo_before_after';
  const d = {
    _id: toId(raw?._id),
    type,
    title: str(raw?.title, 300),
    description: str(raw?.description, 1000),
    required: raw?.required === undefined ? true : Boolean(raw.required),
    order: Number.isFinite(Number(raw?.order)) ? Number(raw.order) : index
  };
  if (type === 'video') {
    const max = Number(raw?.maxDurationSeconds);
    d.maxDurationSeconds = Number.isFinite(max) && max > 0 ? Math.round(max) : null;
  }
  return d;
}

/** Normalise une entrée d'éditeur en structure prête à sauvegarder. */
export function sanitizeDefinitionInput(input = {}) {
  return {
    active: Boolean(input?.active),
    sections: (Array.isArray(input?.sections) ? input.sections : []).map(sanitizeSection),
    deliverables: (Array.isArray(input?.deliverables) ? input.deliverables : []).map(sanitizeDeliverable)
  };
}

export async function getDefinition(formationId) {
  return EvaluationDefinition.findOne({ formationId, isDeleted: false });
}

export async function getActiveDefinition(formationId) {
  return EvaluationDefinition.findOne({ formationId, isDeleted: false, active: true }).lean();
}

/** Crée ou met à jour la définition d'une formation (idempotent, incrémente la version). */
export async function upsertDefinition(formationId, input) {
  const clean = sanitizeDefinitionInput(input);
  const existing = await EvaluationDefinition.findOne({ formationId });
  if (!existing) {
    return EvaluationDefinition.create({
      formationId,
      active: clean.active,
      version: 1,
      sections: clean.sections,
      deliverables: clean.deliverables,
      isDeleted: false
    });
  }
  existing.active = clean.active;
  existing.sections = clean.sections;
  existing.deliverables = clean.deliverables;
  existing.isDeleted = false;
  existing.deletedAt = null;
  existing.version = Number(existing.version || 1) + 1;
  await existing.save();
  return existing;
}

/**
 * Projection CLIENT : retire toute info de correction. Le client ne voit ni bonne réponse ni
 * `correctBoolean`. Conserve les libellés, ordres et _id (nécessaires pour répondre).
 */
export function toClientDefinition(def) {
  if (!def) return null;
  const d = typeof def.toObject === 'function' ? def.toObject() : def;
  return {
    formationId: String(d.formationId),
    active: Boolean(d.active),
    version: d.version,
    sections: (d.sections || [])
      .slice()
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map((s) => ({
        id: String(s._id),
        title: s.title,
        description: s.description,
        order: s.order,
        questions: (s.questions || [])
          .slice()
          .sort((a, b) => (a.order || 0) - (b.order || 0))
          .map((q) => ({
            id: String(q._id),
            type: q.type,
            prompt: q.prompt,
            required: q.required,
            order: q.order,
            ...(q.type === 'quiz'
              ? {
                  mode: q.mode,
                  answers: (q.answers || [])
                    .slice()
                    .sort((a, b) => (a.order || 0) - (b.order || 0))
                    .map((a) => ({ id: String(a._id), text: a.text, order: a.order }))
                }
              : {})
          }))
      })),
    deliverables: (d.deliverables || [])
      .slice()
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map((dl) => ({
        id: String(dl._id),
        type: dl.type,
        title: dl.title,
        description: dl.description,
        required: dl.required,
        order: dl.order,
        maxDurationSeconds: dl.maxDurationSeconds ?? null
      }))
  };
}

export default { sanitizeDefinitionInput, getDefinition, getActiveDefinition, upsertDefinition, toClientDefinition };
