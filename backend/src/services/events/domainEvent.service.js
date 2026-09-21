import crypto from 'node:crypto';
import { DomainEvent } from '../../models/DomainEvent.model.js';
import { logger } from '../../utils/logger.js';
import { EVENT_ACTOR_TYPE, EVENT_DISPATCH_STATUS } from '../../utils/domainEventConstants.js';
import { assertKnownEventType, validateEventPayload } from '../../utils/domainEventRegistry.js';
import { assertSafePayload, EventPayloadError } from '../../utils/eventPayloadSafety.js';

/**
 * Émission d'événements métier.
 *
 * ─── ATOMICITÉ : best-effort, PAS transactionnelle ───────────────────────────
 *
 * Ce dépôt n'utilise AUCUNE transaction MongoDB, et n'en a pas la garantie :
 * `docs/VPS_DEPLOYMENT_GUIDE.md` autorise explicitement un `mongod` **standalone**
 * local (`MONGODB_URI=mongodb://127.0.0.1:27017`), qui ne les supporte pas — et la
 * suite de tests tourne sur un `MongoMemoryServer` standalone. Envelopper
 * l'émission dans une transaction échouerait donc dans des déploiements légitimes.
 *
 * Stratégie retenue, assumée : **l'événement est émis APRÈS la réussite de
 * l'opération métier, en best-effort**. Conséquences honnêtes :
 *
 *  - un crash entre le `save()` métier et l'émission PERD l'événement. Il n'est pas
 *    rejoué : rien ne le reconstruit. C'est un trou de trace, pas une incohérence
 *    métier ;
 *  - en contrepartie, l'inverse est IMPOSSIBLE : jamais d'événement pour une
 *    opération qui n'a pas eu lieu ;
 *  - `emitSafe()` n'échoue JAMAIS vers l'appelant. Une résiliation ne sera pas
 *    annulée parce que le journal a hoqueté.
 *
 * Le jour où les transactions seront garanties (Atlas / replica set partout), le
 * point d'insertion est ici : passer une `session` à `DomainEvent.create()` et à
 * l'écriture métier.
 */

/**
 * Émet un événement. Lève en cas de type inconnu, de payload invalide ou de clé
 * sensible — ce sont des erreurs de PROGRAMMATION, elles doivent se voir.
 *
 * @param {object}  input
 * @param {string}  input.type            Type canonique (registre).
 * @param {string}  input.entityType
 * @param {string}  [input.entityId]
 * @param {object}  [input.actor]         `{ type, id, role }` — défaut : system.
 * @param {object}  input.payloadSafe
 * @param {string}  [input.idempotencyKey] Rejouer la même clé ne crée rien de neuf.
 * @param {Date}    [input.occurredAt]
 * @returns {Promise<import('mongoose').Document>} l'événement canonique
 */
export async function emit({ type, entityType, entityId, actor, payloadSafe, idempotencyKey, occurredAt }) {
  const definition = assertKnownEventType(type);

  if (!definition.entityTypes.includes(entityType)) {
    throw new EventPayloadError(
      'INVALID_PAYLOAD',
      `L'entité « ${entityType} » n'est pas autorisée pour « ${type} » (attendu : ${definition.entityTypes.join(', ')}).`,
      { type, entityType }
    );
  }

  // Deux gardes complémentaires, dans cet ordre :
  //  1. confidentialité/structure — refuse une clé sensible, une profondeur ou une
  //     taille excessive, un objet non littéral. S'applique à TOUT payload.
  //  2. schéma du registre — vérifie la forme attendue de CE type.
  // La garde de confidentialité passe en premier : un secret ne doit pas pouvoir
  // être rejeté « seulement » par un schéma trop permissif.
  assertSafePayload(payloadSafe);
  const payload = validateEventPayload(type, payloadSafe);

  const resolvedActor = {
    type: actor?.type || EVENT_ACTOR_TYPE.SYSTEM,
    id: actor?.id ? String(actor.id) : null,
    role: actor?.role || null,
  };

  const doc = {
    eventId: crypto.randomUUID(),
    type,
    entityType,
    entityId: entityId != null ? String(entityId) : null,
    actor: resolvedActor,
    payloadSafe: payload,
    occurredAt: occurredAt || new Date(),
    idempotencyKey: idempotencyKey || null,
    retentionClass: definition.retentionClass,
    dispatchStatus: EVENT_DISPATCH_STATUS.PENDING,
  };

  try {
    return await DomainEvent.create(doc);
  } catch (err) {
    // Course sur la clé d'idempotence : l'index unique a tranché. On renvoie
    // l'événement gagnant — l'appelant ne doit pas distinguer les deux cas.
    if (err.code === 11000 && idempotencyKey) {
      const existing = await DomainEvent.findOne({ idempotencyKey });
      if (existing) return existing;
    }
    throw err;
  }
}

/**
 * Émet SANS jamais échouer vers l'appelant.
 *
 * À utiliser sur tout point métier où la trace ne doit pas pouvoir casser l'action :
 * une résiliation, une vérification d'expéditeur, une soumission de formulaire
 * restent valides même si le journal est indisponible.
 *
 * Renvoie l'événement, ou `null` si l'émission a échoué (l'échec est journalisé,
 * jamais silencieux).
 */
export async function emitSafe(input) {
  try {
    return await emit(input);
  } catch (err) {
    // On journalise le CODE et le message, jamais l'objet d'erreur complet.
    logger.error(`Émission d'événement échouée (${input?.type})`, err?.code || err?.name, err?.message);
    return null;
  }
}

/**
 * Émet puis déclenche le dispatch, sans jamais échouer vers l'appelant.
 *
 * Import dynamique du dispatcher : `domainEventDispatcher` importe ce module pour
 * la mise à jour du statut global, un import statique croisé casserait le cycle.
 */
export async function emitAndDispatch(input) {
  const event = await emitSafe(input);
  if (!event) return null;
  try {
    const { dispatchEvent } = await import('./domainEventDispatcher.service.js');
    await dispatchEvent(event.eventId);
  } catch (err) {
    // Le dispatch a sa propre reprise (processPendingEventActions) : un échec ici
    // retarde les actions, il ne perd rien.
    logger.error(`Dispatch immédiat échoué (${event.eventId})`, err?.message);
  }
  return event;
}

export default { emit, emitSafe, emitAndDispatch };
