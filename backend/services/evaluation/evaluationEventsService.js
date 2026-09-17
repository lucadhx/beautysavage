// services/evaluation/evaluationEventsService.js
// FORMATION-EVALUATION — Intégration Communication Center des événements d'évaluation.
//
// Trois canaux (best-effort, ne cassent jamais le flux métier) :
//   - audit EventLog (emitEvent) → timeline / observabilité
//   - notification interne admin (triggerNotification)
//   - e-mail client via le moteur par rôles (dispatchTemplateByRoles, chemin D, indépendant du flag)
// L'e-mail « validé » embarque le diplôme (PDF base64) en pièce jointe.
import { emitEvent } from '../eventBusService.js';
import { triggerNotification } from '../notificationService.js';
import { getMailDispatchRule } from '../../constants/mailDispatchRules.js';
import { dispatchTemplateByRoles } from '../mail/mailEventDispatchService.js';
import { resolvePublicBaseUrl } from '../system/domainResolver.js';

function fid(formation) { return String(formation?._id || formation?.id || ''); }
function uid(user) { return String(user?._id || user?.id || ''); }
function clientName(user) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || user?.email || '—';
}
function clientEnvelope(user) {
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
  return { email: String(user?.email || '').trim(), name: name || undefined };
}

async function audit(eventName, formation, user, extra = {}) {
  try {
    await emitEvent(
      eventName,
      { formationId: fid(formation), clientId: uid(user), ...extra, contextType: 'formation', contextId: fid(formation) },
      { contextType: 'formation', contextId: fid(formation) }
    );
  } catch (err) {
    console.error('[evaluationEvents] audit', eventName, err?.message || err);
  }
}

async function sendEvalMail(eventName, { formation, user, variables, attachment = null }) {
  const rule = getMailDispatchRule(eventName);
  if (!rule) return { mail: 'skipped_no_rule' };
  const recipient = clientEnvelope(user);
  if (!recipient.email) return { mail: 'client_missing' };
  try {
    const result = await dispatchTemplateByRoles({
      templateKey: rule.templateKey,
      fromRole: rule.fromRole,
      toRole: rule.toRole,
      context: { client: recipient, contextType: 'formation', contextId: fid(formation) },
      variables,
      attachments: attachment ? [attachment] : null
    });
    return { mail: result?.status || 'unknown' };
  } catch (err) {
    console.error('[evaluationEvents] mail', eventName, err?.message || err);
    return { mail: 'failed' };
  }
}

export async function onEvaluationSubmitted(user, formation, attempt) {
  void audit('training.evaluation.submitted', formation, user, { attemptId: String(attempt?._id || '') });
  try {
    void triggerNotification('evaluation_submitted', {
      clientName: clientName(user),
      formationName: formation?.name || '',
      attemptNumber: String(attempt?.attemptNumber || 1)
    });
  } catch { /* best-effort */ }
}

export async function onEvaluationAccepted(user, formation, attempt, { certificate, pdfBase64 } = {}) {
  void audit('training.evaluation.accepted', formation, user, { attemptId: String(attempt?._id || '') });
  if (certificate) {
    void audit('training.certificate.generated', formation, user, { certificateNumber: certificate.certificateNumber });
  }
  try {
    void triggerNotification('evaluation_accepted', { clientName: clientName(user), formationName: formation?.name || '' });
  } catch { /* best-effort */ }

  const attachment = pdfBase64
    ? { name: `diplome-${certificate?.certificateNumber || 'formation'}.pdf`, content: pdfBase64 }
    : null;
  const res = await sendEvalMail('training.evaluation.accepted', {
    formation,
    user,
    variables: { firstname: user?.firstName || '', formationtitle: formation?.name || '', actionurl: resolvePublicBaseUrl() },
    attachment
  });
  if (res.mail === 'sent' && certificate) {
    void audit('training.certificate.sent', formation, user, { certificateNumber: certificate.certificateNumber });
  }
  return res;
}

export async function onEvaluationRefused(user, formation, attempt, { comment } = {}) {
  void audit('training.evaluation.refused', formation, user, { attemptId: String(attempt?._id || '') });
  try {
    void triggerNotification('evaluation_refused', { clientName: clientName(user), formationName: formation?.name || '' });
  } catch { /* best-effort */ }
  return sendEvalMail('training.evaluation.refused', {
    formation,
    user,
    variables: {
      firstname: user?.firstName || '',
      formationtitle: formation?.name || '',
      reason: comment || '',
      actionurl: resolvePublicBaseUrl()
    }
  });
}

export default { onEvaluationSubmitted, onEvaluationAccepted, onEvaluationRefused };
