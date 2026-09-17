// M2 — Règles de dispatch e-mail par rôles. Le template ne définit JAMAIS les adresses : le moteur
// injecte expéditeur/destinataire (fromRole/toRole) à l'envoi via communicationRoleResolver.
//
// `directSenderExists: true` ⇒ un envoi DIRECT existe déjà pour cet event (mailDomainDispatchers) :
// le moteur reste en SHADOW (skipped_duplicate_direct_sender) pour éviter tout doublon, tant que la
// migration (M3) n'a pas retiré l'envoi direct. Les templateKey référencés EXISTENT (cf. rapport 173).

export const MAIL_DISPATCH_RULES = [
  {
    eventName: 'sale.finalized',
    templateKey: 'vente',
    fromRole: 'commerciale',
    toRole: 'client',
    contextType: 'sale',
    enabled: true,
    directSenderExists: true // sendSaleEmail (envoi direct) → shadow
  },
  {
    eventName: 'booking.confirmed',
    templateKey: 'booking_confirmed',
    fromRole: 'commerciale',
    toRole: 'client',
    contextType: 'service_booking',
    enabled: true,
    // M3D — MIGRÉ : l'event booking.confirmed est désormais émis par TOUS les chemins de
    // confirmation prestation (checkout + report de créneau). L'e-mail direct legacy (report)
    // est gaté derrière !isMailRoleResolverEnabled() (rollback = flag false). Idempotence par
    // booking._id : le report crée un nouveau booking → confirmation distincte. Voir rapport 182.
    mode: 'active',
    directSenderExists: false
  },
  {
    eventName: 'refund.succeeded',
    templateKey: 'refund_confirmed',
    fromRole: 'commerciale',
    toRole: 'client',
    contextType: 'refund_request',
    enabled: true,
    // M3C — MIGRÉ : moteur événementiel actif. L'e-mail direct est gaté derrière
    // !isMailRoleResolverEnabled() (rollback = flag false). Variante service gérée via
    // templateKeyOverride (mailEventVariableBuilder). Voir rapport 180.
    mode: 'active',
    directSenderExists: false
  },
  {
    eventName: 'commission.available',
    templateKey: 'commission_available',
    fromRole: 'support',
    toRole: 'commerciale',
    contextType: 'commission_payment',
    enabled: true,
    directSenderExists: true // sendCommissionAvailableEmail → shadow
  },
  {
    eventName: 'commission.reminder_sent',
    templateKey: 'commission_reminder',
    fromRole: 'support',
    toRole: 'commerciale',
    contextType: 'commission_payment',
    enabled: true,
    directSenderExists: true // sendCommissionReminderEmail → shadow
  },
  // M13 — cartes cadeaux. Aucun envoi direct legacy → le moteur par rôles est l'unique chemin
  // (directSenderExists:false). commerciale → client. Le from/to N'EST PAS hardcodé : ces règles
  // sont l'unique source d'autorité, consommées par giftCardMailService via getMailDispatchRule().
  {
    eventName: 'gift_card.manual_created',
    templateKey: 'gift_card_manual_created',
    fromRole: 'commerciale',
    toRole: 'client',
    contextType: 'gift_card',
    enabled: true,
    directSenderExists: false
  },
  {
    eventName: 'gift_card.manual_debited',
    templateKey: 'gift_card_manual_debited',
    fromRole: 'commerciale',
    toRole: 'client',
    contextType: 'gift_card',
    enabled: true,
    directSenderExists: false
  },
  {
    eventName: 'gift_card.online_created',
    templateKey: 'gift_card_online_created',
    fromRole: 'commerciale',
    toRole: 'client',
    contextType: 'gift_card',
    enabled: true,
    directSenderExists: false
  },
  // LOT2 §4 — reset PIN + renvoi carte cadeau (nouveau code, ancien invalidé). commerciale → client.
  {
    eventName: 'gift_card.pin_reset_and_resent',
    templateKey: 'gift_card_pin_reset',
    fromRole: 'commerciale',
    toRole: 'client',
    contextType: 'gift_card',
    enabled: true,
    directSenderExists: false
  },
  // C2 — Learning : mails commerciale → client (aucun envoi direct legacy → moteur seul sender).
  {
    eventName: 'formation.started',
    templateKey: 'formation_started',
    fromRole: 'commerciale',
    toRole: 'client',
    contextType: 'formation',
    enabled: true,
    directSenderExists: false
  },
  {
    eventName: 'lesson.completed',
    templateKey: 'lesson_completed',
    fromRole: 'commerciale',
    toRole: 'client',
    contextType: 'formation',
    enabled: true,
    directSenderExists: false
  },
  {
    eventName: 'formation.completed',
    templateKey: 'formation_completed',
    fromRole: 'commerciale',
    toRole: 'client',
    contextType: 'formation',
    enabled: true,
    directSenderExists: false
  },
  {
    eventName: 'presence.confirmed',
    templateKey: 'presence_confirmed',
    fromRole: 'commerciale',
    toRole: 'client',
    contextType: 'formation',
    enabled: true,
    directSenderExists: false
  },
  // FORMATION-EVALUATION — décisions d'évaluation (institut → client). Appelées impérativement par
  // evaluationMailService.dispatchTemplateByRoles (chemin D), indépendant du flag subscriber.
  {
    eventName: 'training.evaluation.accepted',
    templateKey: 'evaluation_accepted',
    fromRole: 'commerciale',
    toRole: 'client',
    contextType: 'formation',
    enabled: true,
    directSenderExists: false
  },
  {
    eventName: 'training.evaluation.refused',
    templateKey: 'evaluation_refused',
    fromRole: 'commerciale',
    toRole: 'client',
    contextType: 'formation',
    enabled: true,
    directSenderExists: false
  }
];

const RULES_BY_EVENT = new Map(MAIL_DISPATCH_RULES.map((rule) => [rule.eventName, rule]));

export function getMailDispatchRule(eventName) {
  return RULES_BY_EVENT.get(String(eventName || '')) || null;
}

export function listDispatchableEventNames() {
  return MAIL_DISPATCH_RULES.map((rule) => rule.eventName);
}

/** Lu à l'exécution (rollback immédiat). false → subscriber no-op ; envois existants inchangés. */
export function isMailRoleResolverEnabled() {
  return String(process.env.MAIL_ROLE_RESOLVER_ENABLED || '').trim().toLowerCase() === 'true';
}
