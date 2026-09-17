import { emitEvent } from '../eventBusService.js';
import { getMailDispatchRule } from '../../constants/mailDispatchRules.js';
import { dispatchTemplateByRoles } from '../mail/mailEventDispatchService.js';

/**
 * M13 — Mails carte cadeau (events + template, from/to NON hardcodés).
 *
 * Pour chaque action (création manuelle, débit manuel, achat en ligne) on :
 *   1. émet l'event métier (EventLog) → observabilité + timeline Customer 360 ;
 *   2. envoie l'e-mail via le moteur par rôles : le couple from/to provient de la RÈGLE centrale
 *      (`getMailDispatchRule`), jamais d'une constante locale. commerciale → client.
 *
 * Best-effort : ne throw jamais (un échec mail ne doit pas casser la création de la carte). Si
 * l'identité commerciale n'est pas configurée, le moteur renvoie `identity_missing` sans envoyer.
 */

function buildClientEnvelope(client = {}) {
  const firstName = String(client.firstName || '').trim();
  const lastName = String(client.lastName || '').trim();
  const name = `${firstName} ${lastName}`.trim();
  return {
    email: String(client.email || '').trim(),
    name: name || undefined
  };
}

/**
 * @param {object} params
 * @param {string} params.eventName  ex. 'gift_card.manual_created'
 * @param {object} params.giftCard   document carte (au moins _id, creationMode, paymentMode).
 * @param {object} params.client     { email, firstName, lastName } — propriétaire de la carte.
 * @param {object} params.variables  variables du template mail.
 * @param {{ name: string, content: string } | null} [params.attachment]  PDF base64 (carte).
 * @param {object} [params.eventPayload]  payload SAFE additionnel pour l'EventLog.
 * @param {string|null} [params.actorId]  admin émetteur (audit).
 * @returns {Promise<{ event: boolean, mail: string }>}
 */
export async function sendGiftCardEventMail({
  eventName,
  giftCard = {},
  client = {},
  variables = {},
  attachment = null,
  eventPayload = {},
  actorId = null
} = {}) {
  const giftCardId = giftCard?._id?.toString() || giftCard?.id || null;
  let eventEmitted = false;

  // 1) Event métier (best-effort).
  try {
    await emitEvent(
      eventName,
      { giftCardId, ...eventPayload, contextType: 'gift_card', contextId: giftCardId },
      { actorType: actorId ? 'admin' : 'system', actorId, contextType: 'gift_card', contextId: giftCardId }
    );
    eventEmitted = true;
  } catch (error) {
    console.error(`[giftCardMail] emitEvent ${eventName} failed:`, error?.message || error);
  }

  // 2) E-mail via le moteur par rôles (from/to issus de la règle centrale).
  const rule = getMailDispatchRule(eventName);
  if (!rule) {
    return { event: eventEmitted, mail: 'skipped_no_rule' };
  }

  const recipient = buildClientEnvelope(client);
  if (!recipient.email) {
    return { event: eventEmitted, mail: 'client_missing' };
  }

  try {
    const result = await dispatchTemplateByRoles({
      templateKey: rule.templateKey,
      fromRole: rule.fromRole,
      toRole: rule.toRole,
      context: {
        client: recipient,
        contextType: 'gift_card',
        contextId: giftCardId
      },
      variables,
      attachments: attachment ? [attachment] : null
    });
    return { event: eventEmitted, mail: result?.status || 'unknown' };
  } catch (error) {
    console.error(`[giftCardMail] dispatch ${eventName} failed:`, error?.message || error);
    return { event: eventEmitted, mail: 'failed' };
  }
}

export default { sendGiftCardEventMail };
