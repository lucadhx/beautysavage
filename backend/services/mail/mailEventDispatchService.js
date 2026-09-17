// M2 — Moteur d'envoi e-mail événementiel par rôles.
// event métier → règle → fromRole/toRole → communicationRoleResolver → loadTemplate → render →
// postToBrevo → SendLog. Jamais de throw métier ; jamais de fallback hardcodé ; jamais de secret.
import { getMailDispatchRule } from '../../constants/mailDispatchRules.js';
import MailEventDelivery from '../../models/MailEventDelivery.js';
import { resolveMailEnvelope } from '../communicationRoleResolver.js';
import { CommunicationIdentityError } from '../communicationIdentityService.js';
import { loadTemplate } from './mailTemplateRuntime.js';
import { withMailThemeVars, replaceTemplateVariables, stripHtml } from './mailRenderer.js';
import { postToBrevo } from './mailBrevoGateway.js';

export function resolveMailRule(eventName) {
  return getMailDispatchRule(eventName);
}

// Mappe une CommunicationIdentityError vers un statut de ledger M2.
function statusFromIdentityError(error) {
  if (error?.code === 'client_recipient_missing') return 'client_missing';
  return 'identity_missing';
}

/**
 * Envoi RÉEL par rôles (résout from/to, charge/rend le template, poste via la gateway existante).
 * Renvoie { status: 'sent'|'failed'|'skipped_template_missing'|'identity_missing'|'client_missing', ... }.
 * Ne throw jamais (erreurs converties en statut).
 */
export async function dispatchTemplateByRoles({ templateKey, fromRole, toRole, context = {}, variables = {}, attachments = null } = {}) {
  const template = await loadTemplate(templateKey);
  if (!template) {
    return { status: 'skipped_template_missing', detailSafe: `Template "${templateKey}" introuvable.` };
  }

  let envelope;
  try {
    envelope = await resolveMailEnvelope({ fromRole, toRole, context });
  } catch (error) {
    if (error instanceof CommunicationIdentityError) {
      return { status: statusFromIdentityError(error), detailSafe: error.message, code: error.code };
    }
    return { status: 'failed', detailSafe: 'Résolution des rôles impossible.' };
  }

  const data = await withMailThemeVars(variables || {});
  const subject = replaceTemplateVariables(template.subject, data) || template.subject;
  const html =
    replaceTemplateVariables(template.fullHtml || template.bodyHtml || '', data, { html: true }) ||
    template.fullHtml ||
    template.bodyHtml ||
    '';
  const text = replaceTemplateVariables(template.bodyHtml || stripHtml(template.fullHtml || ''), data) || '';

  const recipient = envelope.to[0];
  const payload = {
    sender: { email: envelope.from.email, name: envelope.from.name || undefined },
    to: [{ email: recipient.email, name: recipient.name || undefined }],
    subject,
    // Tags → SendLog.templateKey (1er tag non-'transactional') + traçabilité des rôles dans metadata.tags.
    tags: ['transactional', templateKey, `from:${fromRole}`, `to:${toRole}`, 'role-engine']
  };
  if (html) payload.htmlContent = html;
  if (text) payload.textContent = text;
  // M13 — pièce jointe optionnelle (ex. carte cadeau PDF). Format Brevo : [{ name, content(base64) }].
  if (Array.isArray(attachments) && attachments.length) {
    payload.attachment = attachments
      .filter((att) => att && att.name && att.content)
      .map((att) => ({ name: String(att.name), content: String(att.content) }));
  }

  const ok = await postToBrevo(payload, {
    contextType: context?.contextType || null,
    contextId: context?.contextId || null
  });
  return ok
    ? { status: 'sent', detailSafe: '' }
    : { status: 'failed', detailSafe: 'Envoi via la gateway échoué.' };
}

// Enregistre (idempotent) une livraison dans le ledger. Au replay, renvoie l'entrée existante.
async function recordDelivery(rule, { contextId, status, sendLogId = null, detailSafe = '', templateKey = null }) {
  const filter = { eventName: rule.eventName, contextType: rule.contextType || null, contextId: contextId != null ? String(contextId) : null, templateKey: templateKey || rule.templateKey };
  try {
    const doc = await MailEventDelivery.findOneAndUpdate(
      filter,
      {
        $setOnInsert: {
          ...filter,
          fromRole: rule.fromRole,
          toRole: rule.toRole,
          status,
          sendLogId,
          detailSafe: String(detailSafe || '').slice(0, 300)
        }
      },
      { upsert: true, new: false }
    );
    // doc === null ⇒ insertion (première fois) ; sinon entrée déjà présente (idempotent).
    return { created: doc === null, status: doc ? doc.status : status, idempotent: doc !== null };
  } catch (error) {
    // Conflit d'unicité concurrent → considéré comme déjà livré (idempotent).
    if (error?.code === 11000) return { created: false, status, idempotent: true };
    return { created: false, status, idempotent: false, error: 'ledger_error' };
  }
}

/**
 * Dispatch déclenché par un event (best-effort). Honore le ledger d'idempotence et le mode shadow.
 * `eventLogOrPayload` : { eventName, contextType, contextId, payloadSafe } (+ context optionnel enrichi).
 */
export async function dispatchMailForEvent(eventLogOrPayload = {}, { context = {}, templateKeyOverride = null } = {}) {
  const eventName = String(eventLogOrPayload?.eventName || '');
  const rule = resolveMailRule(eventName);
  if (!rule) return { status: 'skipped_no_rule' };

  const contextId = eventLogOrPayload?.contextId ?? context?.contextId ?? null;
  // M3C — templateKey effectif : permet les variantes par event (ex. refund_confirmed_service).
  const effectiveTemplateKey = templateKeyOverride || rule.templateKey;

  // Idempotence : si une livraison existe déjà pour (event, contexte, template), ne rien refaire.
  const existing = await MailEventDelivery.findOne({
    eventName: rule.eventName,
    contextType: rule.contextType || null,
    contextId: contextId != null ? String(contextId) : null,
    templateKey: effectiveTemplateKey
  }).lean();
  if (existing) return { status: existing.status, idempotent: true };

  if (!rule.enabled) {
    await recordDelivery(rule, { contextId, status: 'skipped_rule_disabled', templateKey: effectiveTemplateKey });
    return { status: 'skipped_rule_disabled' };
  }

  // Un envoi direct existe déjà → shadow (pas de doublon) jusqu'à migration.
  if (rule.directSenderExists) {
    await recordDelivery(rule, { contextId, status: 'skipped_duplicate_direct_sender', detailSafe: 'Envoi direct existant.', templateKey: effectiveTemplateKey });
    return { status: 'skipped_duplicate_direct_sender' };
  }

  const mergedContext = { ...context, contextType: rule.contextType, contextId };
  const result = await dispatchTemplateByRoles({
    templateKey: effectiveTemplateKey,
    fromRole: rule.fromRole,
    toRole: rule.toRole,
    context: mergedContext,
    variables: context?.variables || {}
  });
  await recordDelivery(rule, { contextId, status: result.status, detailSafe: result.detailSafe, templateKey: effectiveTemplateKey });
  return result;
}
