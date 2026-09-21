import { resolveProviderEnvironment } from '../integratedApiEnvironment.js';
import { capabilitiesAvailable } from '../panelBridge/capabilityClient.js';

/**
 * PEUT-ON ENVOYER, ET LE SUIVI EST-IL ASSURÉ ? — version R11.
 *
 * ══ CE QUE CE MODULE DÉCRIVAIT, ET QUI N'EXISTE PLUS ════════════════════════
 *
 * Il décrivait un canal LOCAL : une clé Brevo détenue par ce projet, et un
 * webhook que ce projet installait lui-même chez Brevo pour recevoir les
 * `delivered` / `bounced`. Ses états — clé absente, webhook non enregistré,
 * URL divergente, adresse injoignable — parlaient tous de cette installation.
 *
 * Elle n'existe plus. Les e-mails partent du compte Brevo DU PANEL, et les
 * événements de livraison suivent le COMPTE : ils arrivent au Panel, qui les
 * reprojette par le pont (`EMAIL_DELIVERED` / `EMAIL_BOUNCED`). Ce projet
 * n'installe rien, ne détient aucune clé, et n'a plus d'endpoint à surveiller.
 *
 * ══ POURQUOI NE PAS AVOIR GARDÉ LES ANCIENS ÉTATS « AU CAS OÙ » ═════════════
 *
 * Parce qu'ils auraient MENTI, et dans le sens le plus coûteux. `API_KEY_MISSING`
 * serait devenu permanent — aucune clé locale n'existe plus, et aucune écriture
 * n'est acceptée pour en remettre une. La carte du Manager aurait affiché « clé
 * absente » pour un service qui envoie parfaitement, et l'opérateur serait parti
 * chercher un champ de saisie qui n'existe plus.
 *
 * Un blocage qu'aucune action ne peut lever ne protège de rien : il éteint le
 * service dans l'esprit de celui qui le lit.
 *
 * ══ CE QUI PEUT ENCORE EMPÊCHER UN ENVOI ═══════════════════════════════════
 *
 * Une seule chose, et elle est réelle : la plateforme injoignable. C'est elle
 * qui détient le coffre, la politique commerciale et le registre d'opérations.
 * Sans elle, aucun e-mail ne part — et c'est un état RÉPARABLE (rappairer,
 * rétablir le lien), donc légitime à afficher.
 *
 * La validité de la clé, l'existence du compte, l'autorisation du projet sont
 * des questions du PANEL, tranchées à l'appel avec des codes précis. Les
 * redemander ici produirait une seconde autorité, plus pauvre, et
 * systématiquement en retard.
 */

export const OPERATIONAL_BLOCKERS = Object.freeze({
  /**
   * LA PLATEFORME EST INJOIGNABLE — le seul obstacle local qui subsiste.
   *
   * Il remplace `API_KEY_MISSING` : la question n'est plus « ce projet a-t-il
   * une clé ? » mais « le projet est-il relié à celui qui en a une ? ».
   */
  PANEL_NOT_PAIRED: 'PANEL_NOT_PAIRED',
});

/**
 * Catégorie d'action attendue de l'utilisateur. Le Manager n'a pas à
 * interpréter dix codes : il affiche un état et une action.
 */
export const OPERATIONAL_STATE = Object.freeze({
  READY: 'READY',
  /** Il manque le lien à la plateforme. */
  CONFIGURATION_REQUIRED: 'CONFIGURATION_REQUIRED',
});

const BLOCKER_MESSAGES = Object.freeze({
  [OPERATIONAL_BLOCKERS.PANEL_NOT_PAIRED]:
    "Les e-mails sont envoyés par la plateforme, et elle est injoignable.",
});

/** État du CANAL D'ENVOI. */
export const DELIVERY_SERVICE_STATUS = Object.freeze({
  OPERATIONAL: 'operational',
  DISABLED: 'disabled',
});

/**
 * ÉTAT DU SUIVI DE LIVRAISON.
 *
 * `PLATFORM` est le seul état possible désormais, et il est volontairement
 * distinct d'`installed` : ce projet n'a rien installé. Nommer la réalité
 * évite qu'un écran propose un bouton « réparer le suivi » qui n'aurait
 * aucun endpoint à réparer.
 */
export const WEBHOOK_CONFIGURATION_STATUS = Object.freeze({
  PLATFORM: 'platform',
});

function blockerOf(code) {
  return { code, message: BLOCKER_MESSAGES[code] || code };
}

/**
 * Lit l'état opérationnel du canal e-mail.
 *
 * La signature est conservée (`mode`, options `probe` / `requireLiveReachability`)
 * pour que les appelants n'aient pas à changer : les options concernaient la
 * sonde d'un endpoint local, et sont désormais sans objet. Les accepter et les
 * ignorer est plus sûr que de casser trois appelants pour un paramètre mort.
 */
export async function getBrevoOperationalReadiness(mode) {
  const resolvedMode = mode || resolveProviderEnvironment('BREVO');
  const blockers = capabilitiesAvailable() ? [] : [blockerOf(OPERATIONAL_BLOCKERS.PANEL_NOT_PAIRED)];
  const ready = blockers.length === 0;

  return {
    ready,
    state: ready ? OPERATIONAL_STATE.READY : OPERATIONAL_STATE.CONFIGURATION_REQUIRED,
    mode: resolvedMode,
    blockers,
    /* Envoi et suivi partagent désormais la même dépendance : la plateforme. */
    canSend: ready,
    deliveryServiceStatus: ready
      ? DELIVERY_SERVICE_STATUS.OPERATIONAL
      : DELIVERY_SERVICE_STATUS.DISABLED,
    deliveryBlockers: blockers,
    trackingBlockers: [],
    webhookConfigurationStatus: WEBHOOK_CONFIGURATION_STATUS.PLATFORM,
    /**
     * L'ACTIVITÉ DU SUIVI N'EST PLUS OBSERVABLE D'ICI.
     *
     * Elle l'était par le journal des webhooks reçus localement. Les événements
     * arrivent maintenant par le pont, et leur trace vit dans `EmailDelivery`.
     * Rendre `null` est exact ; inventer une date le serait moins.
     */
    trackingActivity: null,
    statusSince: null,
    webhook: null,
  };
}

/**
 * Conservé comme NO-OP : il vidait le cache d'une sonde de joignabilité qui
 * n'existe plus. Ses appelants (tests, réparation manuelle) n'ont plus rien à
 * réinitialiser, mais les casser pour un cache disparu n'apporterait rien.
 */
export function resetOperationalProbeCooldown() {}

export default { getBrevoOperationalReadiness };
