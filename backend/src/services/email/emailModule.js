// R10.5B — plus aucune lecture d'expéditeur local : il n'y en a plus.
import { registerVariableResolver } from './emailVariableResolvers.js';
import { registerRelevanceGuard } from '../events/actionRelevance.js';
import { registerEmailActionHandlers } from './sendEmailHandler.js';
import { registerReportIncidentHandler } from '../events/reportIncidentHandler.js';
import { refreshContracts } from './emailTemplateContract.service.js';
import { resolveContactAdminNotification } from './contactVariableResolver.js';
import {
  resolvePaymentConfirmedAdmin,
  resolvePaymentOverdueAdmin,
  resolvePaymentOverdueCriticalAdmin,
  resolvePaymentRetryFailedAdmin,
  relanceImpayeEncorePertinente,
  resolvePaymentRecoveredAdmin,
} from './billingVariableResolver.js';
import {
  resolveAppointmentCancelledClient,
  resolveCustomerEmailVerification,
  resolveCustomerPasswordReset,
  resolveGiftCardIssuedClient,
  resolveSaleConfirmationClient,
} from './commerceVariableResolver.js';
import { logger } from '../../utils/logger.js';

/**
 * Branchement du module e-mail — appelé UNE FOIS au bootstrap.
 *
 * Regroupe ici tout ce qui « se déclare » : le handler d'action, les résolveurs
 * de variables, les gardes de pertinence. Le reste du code n'importe jamais ces
 * modules pour les câbler — il y a un seul endroit où l'on branche, et c'est
 * celui-ci.
 */

/*
 * ── L'APERÇU N'EST PLUS RENDU ICI (L12.1) ───────────────────────────────────
 *
 * `senderVerificationTestOverride` fournissait des valeurs d'exemple au rendu
 * LOCAL d'un aperçu. Ce rendu a disparu : l'aperçu du Manager traverse le pont
 * et c'est le Panel qui le produit, avec SES variables d'exemple — celles du
 * registre qui possède le modèle.
 *
 * Garder une source d'exemples ici aurait maintenu deux jeux de valeurs pour un
 * seul contrat, c'est-à-dire la duplication que ce lot supprime : un aperçu
 * pouvait parfaitement réussir avec les exemples locaux et échouer à l'envoi
 * réel, sans que rien ne le laisse voir.
 */


/**
 * Initialise le module e-mail : résolveurs branchés, contrat de variables lu.
 *
 * IDEMPOTENT — peut être rappelé sans dommage (le bootstrap l'appelle une fois,
 * les tests plusieurs).
 */
export async function initEmailModule({ skipBootstrap = false } = {}) {
  // Résolveurs MÉTIER — un par template branché à un événement actif.
  // Sans lui, l'action correspondante partirait en DEAD_LETTER (UNKNOWN_RESOLVER)
  // plutôt que d'envoyer un e-mail aux variables vides.
  registerVariableResolver('CONTACT_ADMIN_NOTIFICATION', resolveContactAdminNotification);
  registerVariableResolver('CUSTOMER_EMAIL_VERIFICATION', resolveCustomerEmailVerification);
  registerVariableResolver('CUSTOMER_PASSWORD_RESET', resolveCustomerPasswordReset);
  registerVariableResolver('COMMERCE_SALE_CONFIRMATION_CLIENT', resolveSaleConfirmationClient);
  registerVariableResolver('COMMERCE_GIFT_CARD_CLIENT', resolveGiftCardIssuedClient);
  registerVariableResolver('APPOINTMENT_CANCELLED_CLIENT', resolveAppointmentCancelledClient);

  /**
   * Cycle de paiement et incidents techniques.
   *
   * Ils se déclarent ICI, au même endroit que le reste : sans enregistrement,
   * l'action correspondante partirait en DEAD_LETTER (`UNKNOWN_RESOLVER`)
   * plutôt que d'envoyer un e-mail aux variables vides. C'est ce refus explicite
   * qui rend sûr d'activer une action dans le registre.
   */
  registerVariableResolver('PAYMENT_CONFIRMED_ADMIN', resolvePaymentConfirmedAdmin);
  /*
   * `CONTRACT_PAYMENT_RECEIVED_ADMIN` N'EST PLUS ENREGISTRÉ (L12.1).
   *
   * Il l'était encore « pour les rejeux manuels d'exécutions passées », alors
   * qu'aucune action ne le nommait plus depuis L12. L'audit a montré que ce
   * repli ne pouvait pas fonctionner : le code est retiré du provisionnement
   * côté Panel, donc jamais déclaré par ce projet, donc refusé à l'envoi par
   * `EMAIL_TEMPLATE_NOT_DECLARED_BY_PROJECT`. Un rejeu produisait un
   * DEAD_LETTER, pas un e-mail.
   *
   * Le garder revenait donc à entretenir l'illusion d'un filet qui n'attrapait
   * rien — et son instance orpheline restait présentée comme active dans le
   * Panel. Elle y est désormais archivée, historique conservé.
   */
  registerVariableResolver('CONTRACT_PAYMENT_OVERDUE_ADMIN', resolvePaymentOverdueAdmin);
  registerVariableResolver('CONTRACT_PAYMENT_RETRY_FAILED_ADMIN', resolvePaymentRetryFailedAdmin);

  /**
   * LES TROIS MESSAGES QUI RÉCLAMENT DE L'ARGENT — et eux seuls.
   *
   * Chacun affirme « vous devez encore ». Si la dette a été réglée pendant
   * qu'une tentative d'envoi attendait son tour, l'affirmation devient fausse
   * et le message ne doit pas partir.
   *
   * `contract.payment.recovered` n'est PAS gardé : il annonce la bonne
   * nouvelle, et rien ne peut la rendre fausse après coup.
   */
  for (const type of [
    'contract.payment.overdue',
    'contract.payment.retry_failed',
    'contract.payment.overdue_critical',
  ]) {
    registerRelevanceGuard(type, relanceImpayeEncorePertinente);
  }
  registerVariableResolver('CONTRACT_PAYMENT_OVERDUE_CRITICAL_ADMIN', resolvePaymentOverdueCriticalAdmin);
  registerVariableResolver('CONTRACT_PAYMENT_RECOVERED_ADMIN', resolvePaymentRecoveredAdmin);
  /*
   * `PLATFORM_INCIDENT_DEV_ALERT` N'EST PLUS RÉSOLU ICI (L12.1).
   *
   * Ce projet n'envoie plus cette alerte : elle appartient au control plane.
   * Le modèle est de portée PANEL — c'est L.Y Solution qui parle à l'équipe
   * technique — et un projet ne peut pas demander une portée PANEL. L'appel
   * échouait donc systématiquement, en silence : aucun incident n'a jamais pu
   * partir. Le projet POUSSE désormais l'incident (`PLATFORM_INCIDENT`), et le
   * Panel décide de l'alerte, de ses destinataires et de son contenu.
   */

  const restoreEmail = registerEmailActionHandlers();
  /**
   * L'INCIDENT SE BRANCHE ICI, AVEC LES AUTRES (L12.1).
   *
   * Il n'envoie plus d'e-mail — il rapporte au control plane — mais il reste
   * une réaction à un événement de domaine, et le lot de branchement du projet
   * est ce module. L'installer ailleurs aurait créé un second endroit où
   * chercher « qu'est-ce qui réagit à quoi ».
   */
  const restoreIncident = registerReportIncidentHandler();
  const restore = () => {
    restoreEmail();
    restoreIncident();
  };

  if (!skipBootstrap) {
    /**
     * ── PLUS AUCUN MODÈLE N'EST « CRÉÉ » AU DÉMARRAGE (L12.1) ───────────────
     *
     * `ensureEmailTemplates()` posait ici quatorze modèles complets — sujet,
     * HTML, version, historique — dans la base de ce projet. C'est cette pose
     * qui faisait exister la seconde autorité : dès le premier démarrage, le
     * projet possédait une copie éditable de contenus qu'il n'expédiait pas, et
     * qui dérivait ensuite silencieusement des vrais.
     *
     * Ne reste qu'une LECTURE : le contrat de variables servi par le Panel, mis
     * en cache pour valider ce que ce projet FOURNIT. Elle ne lève jamais — un
     * Panel injoignable au boot est banal, et l'autorité de validation reste de
     * toute façon le Panel à l'envoi.
     */
    const contrat = await refreshContracts();
    logger.info(
      contrat.refreshed
        ? `Module e-mail prêt — contrat de variables lu pour ${contrat.cached} modèle(s).`
        : `Module e-mail prêt — contrat de variables non lu (${contrat.reason}) : `
          + 'la plateforme validera à l’envoi.',
    );
  }
  return restore;
}

export default { initEmailModule };
