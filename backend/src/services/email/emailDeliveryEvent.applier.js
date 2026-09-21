/**
 * RETOUR DE LIVRAISON — appliquer un événement venu du Panel (L8.4C).
 *
 * ══ POURQUOI CE CHEMIN EXISTE ═══════════════════════════════════════════════
 *
 * Depuis que les envois partent du compte Brevo du PANEL, les webhooks de
 * livraison suivent le compte : ils n'arrivent plus ici. Sans cet applicateur,
 * chaque `EmailDelivery` resterait éternellement sur `SENT` — le suivi
 * mourrait en silence, ce qui est la pire des pannes.
 *
 * ══ CE MODULE NE DÉCIDE RIEN ═══════════════════════════════════════════════
 *
 * Il ne contient AUCUNE règle de transition. `brevoDeliveryTransitions.js`
 * possède déjà la politique complète — préséance des statuts, engagement qui
 * ne prouve pas la remise, `DELIVERED` qu'un `SENT` retardé ne fait pas
 * régresser. En réécrire une seconde ici produirait deux vérités sur l'état
 * d'un même message, et c'est la plus permissive qui gagnerait.
 *
 * Son travail se limite à trois gestes : RETROUVER la livraison, TRADUIRE le
 * verbe du Panel en événement normalisé, PERSISTER ce que la machine d'état a
 * décidé.
 *
 * ══ LA CORRÉLATION, ET POURQUOI L'ORDRE COMPTE ═════════════════════════════
 *
 *   1. `operationId`         — c'est le `deliveryId`, connu AVANT l'envoi.
 *   2. `providerMessageId`   — seulement à défaut.
 *
 * Cet ordre EST la solution à la course « webhook avant réponse » : un
 * événement peut arriver avant que la réponse d'envoi ait persisté
 * l'identifiant de message. Chercher d'abord par `providerMessageId`
 * échouerait précisément dans ce cas-là, c'est-à-dire au pire moment.
 *
 * ══ LE CORPS DE L'ÉVÉNEMENT NE DÉSIGNE JAMAIS LE PROJET ════════════════════
 *
 * Il n'y a pas de `projectId` à lire ici, et il ne doit jamais y en avoir : le
 * destinataire a été déterminé par le Panel à l'émission (`audience`), et le
 * pont ne remet cet événement qu'à l'instance concernée.
 */
import { EmailDelivery } from '../../models/EmailDelivery.model.js';
import { EmailDeliveryEvent } from '../../models/EmailDeliveryEvent.model.js';
import { NORMALIZED_EVENT } from '../../utils/brevoTransactionalEventRegistry.js';
import { normalizeProviderMessageId } from '../../utils/providerMessageId.js';
import { applyBrevoEventToDelivery } from './brevoDeliveryTransitions.js';
import { logger } from '../../utils/logger.js';

/**
 * Verbe du Panel → événement normalisé du projet.
 *
 * Le Panel n'envoie que deux verbes : ce sont les seuls qui changent un état
 * lu par un utilisateur. Un verbe inconnu n'est PAS une erreur — c'est un
 * Panel plus récent qui parle d'un fait dont ce projet n'a pas encore l'usage.
 * On l'ignore proprement plutôt que d'échouer, sans quoi une mise à jour du
 * Panel bloquerait la file de synchronisation d'un projet plus ancien.
 */
const VERBE_VERS_EVENEMENT = Object.freeze({
  EMAIL_DELIVERED: NORMALIZED_EVENT.DELIVERED,
  EMAIL_BOUNCED: NORMALIZED_EVENT.HARD_BOUNCE,
});

/**
 * Applique un `EMAIL_DELIVERY_EVENT`.
 *
 * @param {{change: {entityId: string, payload: object}}} args
 */
export async function applyEmailDeliveryEvent({ change }) {
  const payload = change?.payload ?? {};
  const verbe = String(payload.event ?? '');
  const normalise = VERBE_VERS_EVENEMENT[verbe];

  if (!normalise) {
    logger.info(`[email-retour] verbe « ${verbe} » sans usage métier ici — ignoré.`);
    return { applied: false, reason: 'EVENT_NOT_CONSUMED' };
  }

  /**
   * `entityId` PORTE L'OPÉRATION — c'est l'identité de la livraison, imposée
   * par le contrat de pont (`entityId: uuid`). La charge utile la répète pour
   * qu'un lecteur du journal n'ait pas à connaître cette convention.
   */
  const operationId = String(payload.operationId ?? change?.entityId ?? '').trim();
  const providerMessageId = normalizeProviderMessageId(payload.providerMessageId ?? '');

  /**
   * RETROUVER — par l'identifiant d'opération d'abord.
   *
   * `operationId` EST le `deliveryId` : il existe avant même que l'envoi soit
   * parti. C'est ce qui rend la course « webhook avant réponse » sans effet.
   */
  let delivery = operationId
    ? await EmailDelivery.findOne({ deliveryId: operationId })
    : null;

  if (!delivery && providerMessageId) {
    delivery = await EmailDelivery.findOne({ providerMessageId });
  }

  if (!delivery) {
    /**
     * Aucune livraison : ce message n'a pas été envoyé par ce projet, ou sa
     * trace a été purgée. Ce n'est pas une panne — on le dit et on s'arrête.
     * Lever ferait rejouer l'événement indéfiniment dans la file.
     */
    logger.warn(`[email-retour] aucune livraison pour l’opération « ${operationId || '(absente)'} » — ignoré.`);
    return { applied: false, reason: 'DELIVERY_NOT_FOUND' };
  }

  /**
   * IDEMPOTENCE — portée par l'index unique de l'historique.
   *
   * `webhookEventId` est déjà unique sur `EmailDeliveryEvent`. On y écrit une
   * clé DÉTERMINISTE du fait reçu : le même événement livré deux fois produit
   * la même clé, et la seconde écriture est refusée par la base. On s'appuie
   * dessus plutôt que sur une lecture préalable — deux remises concurrentes du
   * même fait passeraient toutes deux un test d'existence.
   *
   * `writeId` du pont serait un mauvais choix : il change à chaque réémission
   * du Panel, alors que le FAIT, lui, est le même.
   */
  const occurredAt = payload.occurredAt ? new Date(payload.occurredAt) : null;
  const webhookEventId = [
    'panel',
    delivery.deliveryId,
    verbe,
    payload.providerEvent ?? '',
    payload.occurredAt ?? '',
  ].join(':');

  const dejaVu = await EmailDeliveryEvent.findOne({ webhookEventId }).lean();
  if (dejaVu) {
    logger.info(`[email-retour] ${verbe} déjà appliqué sur ${delivery.deliveryId} — ignoré.`);
    return { applied: false, reason: 'ALREADY_APPLIED', status: delivery.status };
  }

  const decision = applyBrevoEventToDelivery({
    currentStatus: delivery.status,
    engagement: delivery.engagement,
    normalizedEvent: normalise,
    occurredAt: Number.isNaN(occurredAt?.getTime?.()) ? null : occurredAt,
  });

  if (decision.kind === 'NOOP') {
    // La machine d'état a tranché : cet événement ne change rien. Un
    // `DELIVERED` reçu deux fois, ou un `SENT` arrivé après lui, tombent ici.
    logger.info(
      `[email-retour] ${verbe} sans effet sur ${delivery.deliveryId} `
      + `(statut ${delivery.status} conservé).`,
    );
    return { applied: false, reason: 'NO_TRANSITION', status: delivery.status };
  }

  delivery.status = decision.statusAfter;
  delivery.engagement = decision.engagement;
  if (decision.setDeliveredAt && !delivery.deliveredAt) {
    delivery.deliveredAt = occurredAt ?? new Date();
  }
  await delivery.save();

  // L'historique : une ligne par fait reçu, jamais le contenu du message.
  await EmailDeliveryEvent.create({
    deliveryId: delivery.deliveryId,
    webhookEventId,
    type: normalise,
    occurredAt: occurredAt ?? new Date(),
    statusBefore: decision.statusBefore,
    statusAfter: decision.statusAfter,
  }).catch(() => {
    // L'historique est une trace, pas une garantie : son échec ne doit pas
    // annuler une transition déjà persistée et déjà juste.
  });

  logger.info(
    `[email-retour] ${delivery.deliveryId} : ${decision.statusBefore} → ${decision.statusAfter} `
    + `(${verbe}, opération ${operationId || 'inconnue'}).`,
  );

  return { applied: true, status: decision.statusAfter, deliveryId: delivery.deliveryId };
}

export default { applyEmailDeliveryEvent };
