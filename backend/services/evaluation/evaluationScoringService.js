// services/evaluation/evaluationScoringService.js
// FORMATION-EVALUATION — Calcul du score (PUR, côté institut uniquement) + validation de soumission.
//
// Le score n'est JAMAIS renvoyé au client. Ces fonctions sont pures (pas d'accès DB) → testables
// isolément. Elles prennent la définition (agrégat) + la tentative et produisent un barème simple :
// une question juste = 1 point. Extensible ultérieurement (pondération, correction IA) sans refonte.

function idStr(v) {
  return v == null ? '' : String(v);
}

/** Vrai si la question est correctement répondue par la tentative. */
function isQuestionCorrect(question, answer) {
  if (!answer) return false;
  if (question.type === 'true_false') {
    if (answer.booleanValue == null) return false;
    return Boolean(answer.booleanValue) === Boolean(question.correctBoolean);
  }
  if (question.type === 'quiz') {
    const correctIds = new Set((question.answers || []).filter((a) => a.correct).map((a) => idStr(a._id)));
    const selected = new Set((answer.selectedAnswerIds || []).map(idStr));
    if (correctIds.size === 0) return false;
    if (question.mode === 'multiple') {
      if (selected.size !== correctIds.size) return false;
      for (const id of selected) if (!correctIds.has(id)) return false;
      return true;
    }
    // single : exactement la bonne réponse
    if (selected.size !== 1) return false;
    return correctIds.has([...selected][0]);
  }
  return false;
}

/**
 * Calcule le score d'une tentative contre une définition.
 * @returns {{ total, correct, wrong, percent, perQuestion: [{sectionId, questionId, correct}] }}
 */
export function computeScore(definition, attempt) {
  const answersByQuestion = new Map((attempt?.answers || []).map((a) => [idStr(a.questionId), a]));
  const perQuestion = [];
  let total = 0;
  let correct = 0;
  for (const section of definition?.sections || []) {
    for (const question of section.questions || []) {
      total += 1;
      const ok = isQuestionCorrect(question, answersByQuestion.get(idStr(question._id)));
      if (ok) correct += 1;
      perQuestion.push({ sectionId: idStr(section._id), questionId: idStr(question._id), correct: ok });
    }
  }
  const wrong = total - correct;
  const percent = total > 0 ? Math.round((correct / total) * 100) : 0;
  return { total, correct, wrong, percent, perQuestion };
}

/**
 * Valide qu'une tentature peut être soumise : toutes les questions OBLIGATOIRES répondues et tous
 * les rendus OBLIGATOIRES fournis (photo = avant + après ; vidéo = 1 fichier).
 * @returns {{ valid: boolean, missingQuestions: string[], missingDeliverables: string[] }}
 */
export function validateSubmission(definition, attempt) {
  const answersByQuestion = new Map((attempt?.answers || []).map((a) => [idStr(a.questionId), a]));
  const missingQuestions = [];
  for (const section of definition?.sections || []) {
    for (const question of section.questions || []) {
      if (!question.required) continue;
      const a = answersByQuestion.get(idStr(question._id));
      const answered = question.type === 'true_false'
        ? a && a.booleanValue != null
        : a && Array.isArray(a.selectedAnswerIds) && a.selectedAnswerIds.length > 0;
      if (!answered) missingQuestions.push(idStr(question._id));
    }
  }

  const filesByDeliverable = new Map(
    (attempt?.deliverables || []).map((d) => [idStr(d.deliverableId), d.files || []])
  );
  const missingDeliverables = [];
  for (const deliverable of definition?.deliverables || []) {
    if (!deliverable.required) continue;
    const files = filesByDeliverable.get(idStr(deliverable._id)) || [];
    if (deliverable.type === 'photo_before_after') {
      const hasBefore = files.some((f) => f.kind === 'before');
      const hasAfter = files.some((f) => f.kind === 'after');
      if (!hasBefore || !hasAfter) missingDeliverables.push(idStr(deliverable._id));
    } else if (deliverable.type === 'video') {
      const hasVideo = files.some((f) => f.kind === 'video');
      if (!hasVideo) missingDeliverables.push(idStr(deliverable._id));
    }
  }

  return {
    valid: missingQuestions.length === 0 && missingDeliverables.length === 0,
    missingQuestions,
    missingDeliverables
  };
}

export default { computeScore, validateSubmission };
