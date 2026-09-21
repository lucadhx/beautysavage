import { ACTION_TYPE, SINGLE_RECIPIENT_KEY } from '../../utils/domainEventConstants.js';
import {
  registerHandler,
  registerRecipientKeyResolver,
  ActionHandlerError,
} from '../events/eventActionHandlerRegistry.js';
import { resolveRecipients, assertResolverAllowedForEvents } from './emailRecipientResolvers.js';
import { resolveVariables } from './emailVariableResolvers.js';
import { sendTemplate, EmailDeliveryError } from './emailDelivery.service.js';
import { safeErrorMessage } from '../../utils/eventPayloadSafety.js';
import { logger } from '../../utils/logger.js';

/**
 * Handler RÉEL de l'action `SEND_EMAIL`, et résolveur de destinataires associé.
 *
 * ─── IL S'ENREGISTRE, IL N'EST PAS IMPORTÉ ───────────────────────────────────
 *
 * Le dispatcher ne connaît pas l'e-mail : c'est ce module qui vient se déclarer,
 * au bootstrap, via `registerHandler`. Le sens de dépendance va du métier vers le
 * dispatcher, jamais l'inverse — c'est ce qui garde le dispatcher réutilisable et
 * testable sans base ni Brevo.
 *
 * ─── SUCCEEDED N'EST ÉCRIT QU'APRÈS RÉPONSE DE BREVO ─────────────────────────
 *
 * `sendTemplate` ne rend la main qu'une fois Brevo interrogé (ou l'envoi constaté
 * déjà fait). Il n'y a aucun chemin par lequel une exécution passe SUCCEEDED sans
 * qu'un `messageId` existe. C'est l'invariant qui rend le journal crédible.
 *
 * ─── RETRYABLE vs PERMANENT ──────────────────────────────────────────────────
 *
 * La décision est prise EN AMONT (`BrevoEmailProvider` pour les refus fournisseur,
 * `EmailDeliveryService` pour la configuration et le rendu) et simplement
 * transportée ici. Ce handler ne redécide rien : deux endroits qui classent les
 * erreurs finiraient par se contredire.
 */

/**
 * Clés des destinataires d'une action e-mail.
 *
 * Une action `SEND_EMAIL` produit une exécution PAR destinataire. Les autres
 * types d'action retombent sur `_single`.
 *
 * ZÉRO DESTINATAIRE PRODUIT QUAND MÊME UNE EXÉCUTION : sans elle, l'événement
 * serait DISPATCHED avec zéro exécution, c'est-à-dire « tout va bien » alors que
 * personne n'a été prévenu. La sentinelle `_single` sert alors de support à cette
 * trace ; le handler la traduit en ÉCHEC explicite (EMAIL_RECIPIENTS_NOT_FOUND),
 * pas en SKIPPED — une action activée dont personne ne reçoit le résultat est un
 * problème, pas une décision.
 */
export async function emailRecipientKeyResolver(action, event) {
  if (action?.actionType !== ACTION_TYPE.SEND_EMAIL) return [SINGLE_RECIPIENT_KEY];

  assertResolverAllowedForEvents(action.recipientResolver);
  const recipients = await resolveRecipients(action.recipientResolver, { event });

  if (recipients.length === 0) {
    logger.warn(
      `Action ${action.actionId} (${event?.type}) : le résolveur « ${action.recipientResolver} » n'a renvoyé aucun ` +
        'destinataire. Une exécution en échec sera tracée (EMAIL_RECIPIENTS_NOT_FOUND).'
    );
    return [SINGLE_RECIPIENT_KEY];
  }
  return recipients.map((r) => r.key);
}

/**
 * Exécute un envoi pour UNE exécution (donc UN destinataire).
 *
 * @param {object} input
 * @param {object} input.event
 * @param {object} input.action     Définition du registre d'actions.
 * @param {object} input.execution  Document EventActionExecution (verrou détenu).
 * @returns {Promise<{status:string, providerMessageId?:string, reason?:string}>}
 */
export async function sendEmailHandler({
  event, action, execution,
  /**
   * FAÇADE DU PLAN DE CONTRÔLE — transmise telle quelle à `sendTemplate()`.
   *
   * Ce gestionnaire ne l'utilise pas lui-même : il la fait suivre. Sans ce
   * passage, la logique locale du chemin « événement de domaine » ne serait
   * plus éprouvable sans monter un Panel appairé — et l'on testerait
   * l'appairage au lieu de la résolution du destinataire.
   */
  controlPlane = undefined,
}) {
  // --- 1. Retrouver le destinataire derrière la clé -------------------------
  // La résolution est REJOUÉE ici : entre la matérialisation et l'exécution, la
  // liste a pu changer. C'est voulu — on envoie à qui doit recevoir MAINTENANT.
  let recipients;
  try {
    assertResolverAllowedForEvents(action.recipientResolver);
    recipients = await resolveRecipients(action.recipientResolver, { event });
  } catch (err) {
    // Résolveur inconnu ou interdit : erreur de registre, pas d'aléa. Rejouer ne
    // la corrigerait pas.
    throw new ActionHandlerError('UNKNOWN_RESOLVER', safeErrorMessage(err?.message || ''), false);
  }

  const recipient = recipients.find((r) => r.key === execution.recipientKey);

  if (!recipient) {
    // ── Aucun destinataire du tout : c'est un ÉCHEC, pas un SKIP ────────────
    //
    // Une action ACTIVÉE dont personne ne reçoit le résultat est un problème :
    // un e-mail attendu n'est parti nulle part. `SKIPPED` se lit « on a
    // délibérément rien fait » et rendrait l'événement DISPATCHED — « tout va
    // bien » — alors que la notification n'a pas eu lieu.
    //
    // Non retryable : aucun backoff de dix minutes ne crée un compte
    // administrateur. Le DEAD_LETTER rend le problème visible tout de suite dans
    // /dev/evenements, un humain crée le compte, puis relance à la main.
    if (execution.recipientKey === SINGLE_RECIPIENT_KEY) {
      throw new ActionHandlerError(
        'EMAIL_RECIPIENTS_NOT_FOUND',
        `Aucun destinataire valide pour « ${action.recipientResolver} » : personne n'a été prévenu. ` +
          "Vérifiez qu'au moins un compte existe avec une adresse valide.",
        false
      );
    }

    // ── Ce destinataire-là a disparu depuis la matérialisation ──────────────
    //
    // Cas différent, traitement différent : le compte a été supprimé entre-temps.
    // Il n'y a rien à réparer et rien à envoyer — les AUTRES destinataires ont
    // leur propre exécution et ne sont pas concernés. SKIPPED est ici la vérité.
    return {
      status: 'SKIPPED',
      reason: 'Le destinataire de cette exécution n’existe plus (compte supprimé depuis la matérialisation).',
    };
  }

  // --- 2. Résoudre les variables -------------------------------------------
  let variables;
  try {
    variables = await resolveVariables({
      templateId: action.templateId,
      context: { event, recipient, action },
    });
  } catch (err) {
    /**
     * DEUX REFUS DIFFÉRENTS, ET ON CESSE DE LES CONFONDRE (L12).
     *
     * Le défaut reste DEAD_LETTER immédiat : aucun résolveur enregistré, une
     * URL non configurée, un contrat disparu — rejouer quatre fois ne répare
     * rien et ne fait que remplir le journal.
     *
     * Mais un résolveur peut désormais demander à être RE-JOUÉ, et un seul cas
     * le justifie aujourd'hui : la donnée n'existe pas ENCORE. Le fournisseur
     * annonce un encaissement avant d'avoir fini d'émettre sa facture ; le
     * message est dû, et il ne manque qu'une poignée de secondes. Écraser cette
     * demande à `false` — ce que faisait cette ligne — condamnait la
     * confirmation de paiement pour une course perdue de trois secondes.
     *
     * On RELAIE ce que le résolveur a déclaré. On ne le recalcule pas, et on ne
     * devine jamais « retryable » à partir d'un code.
     */
    throw new ActionHandlerError(
      err?.code || 'UNKNOWN_RESOLVER',
      safeErrorMessage(err?.message || 'Variables non résolues.'),
      err?.retryable === true
    );
  }

  // --- 3. Envoyer -----------------------------------------------------------
  // Reply-To OPTIONNEL, tiré d'une variable déjà résolue (ex. l'e-mail du
  // visiteur pour une notification de contact). `variables` est une Map. Une
  // valeur absente ou malformée est simplement ignorée, jamais bloquante.
  const replyToEmail = action.replyToVariable
    ? (variables instanceof Map ? variables.get(action.replyToVariable) : variables?.[action.replyToVariable])
    : null;
  try {
    const res = await sendTemplate({
      ...(controlPlane ? { controlPlane } : {}),
      templateId: action.templateId,
      recipient,
      variables,
      replyTo: replyToEmail ? { email: String(replyToEmail) } : undefined,
      eventId: event.eventId,
      // L'IDENTIFIANT D'EXÉCUTION EST LA CLÉ D'IDEMPOTENCE. C'est lui qui rend
      // impossible le double envoi : l'index unique de EmailDelivery s'appuie
      // dessus, et il est stable d'une tentative à l'autre.
      actionExecutionId: String(execution._id),
    });

    if (res.alreadySent) {
      logger.info(`Exécution ${execution._id} : e-mail déjà envoyé (${res.providerMessageId}) — aucun renvoi.`);
    }
    return { status: 'SUCCEEDED', providerMessageId: res.providerMessageId };
  } catch (err) {
    const retryable = err instanceof EmailDeliveryError ? err.retryable : true;
    const code = err instanceof EmailDeliveryError ? err.code : 'HANDLER_ERROR';
    throw new ActionHandlerError(code, safeErrorMessage(err?.message || 'Envoi impossible.'), retryable);
  }
}

/**
 * Branche le module e-mail sur le dispatcher.
 *
 * Appelé UNE FOIS au bootstrap. Renvoie une fonction de restauration pour que les
 * tests puissent débrancher proprement.
 */
export function registerEmailActionHandlers() {
  const restoreHandler = registerHandler(ACTION_TYPE.SEND_EMAIL, sendEmailHandler);
  const restoreResolver = registerRecipientKeyResolver(emailRecipientKeyResolver);
  return () => {
    restoreHandler();
    restoreResolver();
  };
}

export default { sendEmailHandler, emailRecipientKeyResolver, registerEmailActionHandlers };
