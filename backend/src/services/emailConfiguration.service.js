import { EmailConfiguration } from '../models/EmailConfiguration.model.js';
import { EmailDelivery } from '../models/EmailDelivery.model.js';
import { getSingleton } from '../utils/singleton.js';
import {
  EMAIL_TEST_STATUS as T,
  EMAIL_STATUS,
  EMAIL_ERROR_CODES as E,
  messageForErrorCode,
  looksLikeSenderRejection,
} from '../utils/emailConstants.js';
import { MODE_VALUES } from '../utils/integratedApiCatalog.js';
import { tryGetCredential, markProviderVerified } from './integratedApi.service.js';
import { resolveProviderEnvironment } from './integratedApiEnvironment.js';
import {
  EMAIL_DELIVERY_ERROR_CODES as D,
  DELIVERY_STATUS as DS,
} from '../utils/emailTemplateConstants.js';
import { emailDebug } from '../utils/emailDebug.js';
import {
  getBrevoOperationalReadiness,
  resetOperationalProbeCooldown,
} from './email/brevoOperational.service.js';
import { logger } from '../utils/logger.js';

/**
 * Configuration e-mail du projet — ce qu'il en reste après R10.5.
 *
 * ─── CE QUE CE SERVICE NE FAIT PLUS ─────────────────────────────────────────
 *
 * Il ne détient plus d'expéditeur, n'en écrit plus, n'en lit plus, et n'envoie
 * plus rien lui-même. Le From du parc est unique et détenu par le Panel ; le
 * test d'expédition vit dans le Panel et emprunte la chaîne réelle.
 *
 * Ce qu'il détient encore est la LECTURE de l'état d'envoi de ce projet : le
 * suivi des livraisons, l'issue résolue depuis le webhook, et le rétablissement
 * du service après un blocage opérationnel. Ce sont des faits locaux, dérivés
 * d'événements reçus — pas des réglages, et surtout pas des credentials.
 *
 * ─── CE QU’IL N’A JAMAIS FAIT, ET NE FERA PAS ───────────────────────────────
 *
 * Il n'appelle JAMAIS /senders ni /domains, ne crée aucun expéditeur chez Brevo,
 * ne déclenche aucun code de vérification et n'authentifie aucun domaine. Ces
 * opérations s'administrent dans le tableau de bord Brevo et chez le
 * fournisseur DNS.
 */


export async function getEmailConfiguration() {
  return getSingleton(EmailConfiguration);
}

/** Sous-document du mode demandé. Toujours présent (défauts du schéma). */
export function modeState(cfg, mode) {
  return cfg.modes[mode];
}

/*
 * ── CE QUI A ÉTÉ RETIRÉ EN R10.5A/B, ET POURQUOI ───────────────────────────
 *
 * getActiveSender / senderOf lisaient le From de CE projet. updateSender
 * l'écrivait. Il n'existe plus : l'expéditeur du parc est unique et détenu par
 * le Panel (SystemConfiguration.email). Un champ que le Manager pouvait encore
 * saisir sans qu'il parte jamais dans un en-tête aurait été pire que son
 * absence — l'écart ne se serait vu qu'à la réception.
 *
 * sendTestEmail / recordTestFailure / testEmailContent envoyaient un e-mail de
 * test EN APPELANT BREVO DIRECTEMENT, avec une clé locale : sans passerelle,
 * sans coffre du Panel, sans politique commerciale, sans registre d'opérations.
 * C'était le dernier chemin d'envoi du projet qui contournait le plan de
 * contrôle.
 *
 * Le test d'expédition vit désormais dans le Panel (« Expéditeur e-mail »), où
 * il emprunte la chaîne réelle de bout en bout jusqu'au webhook de livraison.
 * L'envoi de test d'un MODÈLE, lui, est conservé : il passait déjà par la
 * capacité email.send_template, donc par le plan de contrôle.
 */


/* --- Dérivation de l'issue depuis la livraison ----------------------------- */

/**
 * Classe un rejet de livraison en code métier STABLE, sans jamais exposer le
 * texte du fournisseur.
 *
 *  - rebond / adresse invalide          → RECIPIENT_REJECTED (le destinataire) ;
 *  - blocage/erreur avec motif « sender » → SENDER_REFUSED (l'expéditeur) ;
 *  - tout autre blocage/erreur/spam     → RECIPIENT_REJECTED par défaut.
 */
function classifyDeliveryRejection(deliveryStatus, reasonText) {
  // Le motif Brevo prime quand il désigne explicitement l'EXPÉDITEUR : c'est le
  // cas « adresse non autorisée / domaine non authentifié », le seul que le
  // commerçant peut corriger lui-même.
  if (looksLikeSenderRejection(reasonText)) return E.SENDER_REFUSED;
  if (deliveryStatus === DS.SPAM) return E.SPAM_REJECTED;
  if (deliveryStatus === DS.SOFT_BOUNCED) return E.MAILBOX_UNAVAILABLE;
  if ([DS.HARD_BOUNCED, DS.INVALID, DS.BOUNCED, DS.BLOCKED].includes(deliveryStatus)) {
    return E.RECIPIENT_REJECTED;
  }
  // ERROR sans motif exploitable : panne fournisseur, pas une faute de config.
  return E.PROVIDER_ERROR;
}

/**
 * Issue EFFECTIVE du test d'un mode, dérivée de la livraison pointée.
 *
 * Le statut stocké (`ACCEPTED`/`FAILED`) est le point de départ ; si une
 * livraison existe, son statut RÉEL — mis à jour par le webhook — prime. C'est ce
 * qui permet d'afficher « Fonctionnel » UNIQUEMENT sur une preuve de livraison,
 * sans jamais coupler le webhook à la configuration.
 *
 * @returns {Promise<{status, code, message, deliveredAt, rejectedAt}>}
 */
export async function resolveTestOutcome(state) {
  const test = state.test;
  const base = {
    status: test.status,
    code: test.lastErrorSafe?.code || '',
    message: test.lastErrorSafe?.message || '',
    deliveredAt: null,
    rejectedAt: null,
    // Détail fournisseur (DEV) : statut brut de la livraison + dernier événement.
    deliveryStatus: null,
    providerEvent: null,
  };
  // FAILED (échec immédiat) et NOT_TESTED n'ont pas de livraison à consulter.
  const RESOLVABLE = [T.ACCEPTED, T.DEFERRED, T.DELIVERED, T.REJECTED];
  if (!test.deliveryId || !RESOLVABLE.includes(test.status)) {
    return base;
  }

  const delivery = await EmailDelivery.findOne({ deliveryId: test.deliveryId })
    .select('status deliveredAt lastEventAt lastEventType lastErrorSafe providerMessageId providerMode')
    .lean();
  emailDebug('TRACKING', 'lecture EmailDelivery pour dériver le statut du test', {
    deliveryId: test.deliveryId,
    storedTestStatus: test.status,
    deliveryStatus: delivery?.status ?? '(livraison introuvable)',
    providerMode: delivery?.providerMode,
    providerMessageId: delivery?.providerMessageId,
    lastEventAt: delivery?.lastEventAt ?? null,
    reason:
      !delivery
        ? 'livraison purgée : dernier état connu conservé'
        : delivery.status === DS.SENT
          ? 'toujours SENT → ACCEPTED (aucun webhook de livraison reçu)'
          : `livraison=${delivery.status}`,
  });
  if (!delivery) return base; // livraison purgée : on garde le dernier état connu

  const providerEvent = delivery.lastEventType || null;
  if (delivery.status === DS.DELIVERED) {
    return {
      status: T.DELIVERED, code: '', message: '',
      deliveredAt: delivery.deliveredAt || null, rejectedAt: null,
      deliveryStatus: delivery.status, providerEvent,
    };
  }
  const NEGATIVE = [DS.HARD_BOUNCED, DS.SOFT_BOUNCED, DS.INVALID, DS.BLOCKED, DS.ERROR, DS.SPAM, DS.BOUNCED];
  if (NEGATIVE.includes(delivery.status)) {
    const code = classifyDeliveryRejection(delivery.status, delivery.lastErrorSafe?.message || '');
    return {
      status: T.REJECTED,
      code,
      message: messageForErrorCode(code),
      deliveredAt: null,
      rejectedAt: delivery.lastEventAt || null,
      deliveryStatus: delivery.status,
      providerEvent,
    };
  }
  // DEFERRED : le fournisseur a DIT quelque chose — la messagerie du destinataire
  // a retardé la remise. C'est une information, pas un silence : la noyer dans
  // « accepté, en attente » revenait à jeter la seule explication disponible.
  if (delivery.status === DS.DEFERRED) {
    return {
      status: T.DEFERRED, code: '', message: '', deliveredAt: null, rejectedAt: null,
      deliveryStatus: delivery.status, providerEvent,
    };
  }
  // SENT / SENDING / PENDING : toujours en vol, aucune nouvelle.
  return {
    status: T.ACCEPTED, code: '', message: '', deliveredAt: null, rejectedAt: null,
    deliveryStatus: delivery.status, providerEvent,
  };
}

/* --- Statut global --------------------------------------------------------- */

/**
 * Statut affiché, DÉRIVÉ de trois faits : configuration locale, présence de la
 * clé du mode, issue effective du dernier test. `testStatus` est déjà l'issue
 * RÉSOLUE (cf. resolveTestOutcome), pas le statut brut stocké.
 */
export function deriveStatus({ hasApiKey, testStatus }) {
  /**
   * `hasName` / `hasEmail` ont disparu de cette dérivation (R10.5B).
   *
   * Ils décrivaient la complétude d'un expéditeur LOCAL qui n'existe plus. Les
   * garder aurait rendu ce projet éternellement « non configuré » : personne
   * n'écrit plus ces champs, donc la condition n'aurait jamais pu redevenir
   * vraie, et l'écran aurait signalé un défaut que rien ne peut réparer.
   */
  if (!hasApiKey) return EMAIL_STATUS.NOT_CONFIGURED;
  if (testStatus === T.DELIVERED) return EMAIL_STATUS.FUNCTIONAL;
  if (testStatus === T.REJECTED || testStatus === T.FAILED) return EMAIL_STATUS.ERROR;
  if (testStatus === T.ACCEPTED) return EMAIL_STATUS.ACCEPTED;
  return EMAIL_STATUS.NOT_TESTED;
}

/**
 * Projection pour le Manager. Aucun secret : seule la PRÉSENCE de la clé est
 * exposée, jamais sa valeur ni ses derniers caractères.
 */
export async function serializeEmailConfiguration(cfg, environment) {
  const modes = {};
  for (const m of MODE_VALUES) {
    const state = modeState(cfg, m);
    const hasApiKey = Boolean(await tryGetCredential('BREVO', 'apiKey', { mode: m }));
    // Issue RÉSOLUE : le statut brut stocké est confronté à la livraison réelle
    // (mise à jour par le webhook). C'est ce qui interdit un « Fonctionnel » sur
    // la seule acceptation.
    const outcome = await resolveTestOutcome(state);
    modes[m] = {
      /**
       * PLUS AUCUN `sender` DANS CETTE PROJECTION (R10.5B).
       *
       * L'exposer aurait suffi à le faire réapparaître à l'écran, et une valeur
       * morte encore visible dans le Manager est exactement ce que le lot
       * interdit : elle se lit comme un réglage, alors qu'elle n'influence plus
       * aucun en-tête. L'expéditeur réellement utilisé est celui du Panel, et
       * c'est le Panel qui l'affiche.
       */
      apiKeyConfigured: hasApiKey,
      test: {
        status: outcome.status,
        testExecutionId: state.test.testExecutionId || '',
        // DEV uniquement côté affichage : le Manager ne le montre pas au client.
        providerMessageIdSafe: state.test.providerMessageIdSafe || '',
        recipientMasked: state.test.recipientMasked || '',
        // Adresse de test du DEV, pour préremplir la modale (jamais un envoi auto).
        lastRecipient: state.test.lastRecipient || '',
        acceptedAt: state.test.acceptedAt || null,
        deliveredAt: outcome.deliveredAt,
        rejectedAt: outcome.rejectedAt,
        // Détail fournisseur : statut brut de la livraison + dernier événement Brevo.
        deliveryStatus: outcome.deliveryStatus,
        providerEvent: outcome.providerEvent,
        lastTestedAt: state.test.lastTestedAt,
        lastErrorSafe: { code: outcome.code, message: outcome.message },
      },
      status: deriveStatus({ hasApiKey, testStatus: outcome.status }),
      /**
       * AUTORISATION D'ENVOYER — exposée pour que le Manager désactive le bouton
       * « Envoyer un test » AVANT que l'utilisateur ne se heurte à un refus.
       *
       * `probe: false` volontairement : un simple affichage ne doit pas déclencher
       * d'appel réseau sortant, et la carte se rafraîchit fréquemment. La sonde
       * reste le fait du chemin d'envoi et du bouton de réparation.
       */
      operational: await operationalView(m),
    };
  }
  return { environment, modes, updatedAt: cfg.updatedAt };
}

/**
 * Vue SÛRE de l'état opérationnel POUR LA CARTE : des codes stables et des
 * phrases métier.
 *
 * `requireLiveReachability: false` — la carte reflète l'INSTALLATION du suivi
 * (webhook enregistré, actif, secret, URL alignée, non désynchronisé). Une
 * configuration correcte ne doit PAS rester orange faute d'événement récent : la
 * joignabilité est une information séparée (`webhook.lastReceivedAt` /
 * `healthStatus`), pas un blocage d'affichage. Le garde-fou d'envoi
 * (`assertBrevoOperational`), lui, continue d'exiger la joignabilité réelle.
 */
async function operationalView(mode) {
  const r = await getBrevoOperationalReadiness(mode, { probe: false, requireLiveReachability: false });
  return {
    ready: r.ready,
    state: r.state,
    blockers: r.blockers.map((b) => ({ code: b.code, message: b.message })),
    // TROIS lectures SÉPARÉES (LOT états) : canal d'envoi, installation du
    // suivi, activité du suivi. L'UI ne doit plus les mélanger dans un panneau.
    canSend: r.canSend,
    deliveryServiceStatus: r.deliveryServiceStatus,
    deliveryBlockers: r.deliveryBlockers.map((b) => ({ code: b.code, message: b.message })),
    trackingBlockers: r.trackingBlockers.map((b) => ({ code: b.code, message: b.message })),
    webhookConfigurationStatus: r.webhookConfigurationStatus,
    trackingActivity: r.trackingActivity,
    statusSince: r.statusSince || null,
    // Joignabilité INFORMATIVE (jamais bloquante ici) : « Configuration ✓ » d'un
    // côté, « Dernier événement reçu / joignabilité » de l'autre.
    webhook: r.webhook
      ? {
          healthStatus: r.webhook.healthStatus,
          healthyUntil: r.webhook.healthyUntil,
          lastReceivedAt: r.webhook.lastReceivedAt,
          // URL RÉSOLUE automatiquement + provenance — affichage en LECTURE
          // SEULE : personne ne saisit une URL de webhook.
          expectedUrl: r.webhook.expectedUrl || '',
          publicBackendUrl: r.webhook.publicBackendUrl || '',
          publicUrlSource: r.webhook.publicUrlSource || 'NONE',
        }
      : null,
  };
}

/* --- Rétablir le service : UNE action, plusieurs sous-étapes ---------------- */

/**
 * Répare le suivi puis VÉRIFIE que la réparation a produit son effet.
 *
 * ─── POURQUOI CETTE FONCTION EXISTE ──────────────────────────────────────────
 *
 * Le Manager enchaînait « synchroniser » puis relisait la configuration, et
 * annonçait un succès dès que la synchronisation n'avait pas levé d'erreur.
 * C'était faux, et le défaut était structurel : synchroniser parle à l'API du
 * fournisseur — laquelle reste parfaitement joignable quand c'est NOTRE URL
 * publique qui est tombée. La réparation « réussissait » donc toujours, pendant
 * que l'envoi restait bloqué. L'écran affichait un succès vert au-dessus d'un
 * blocage orange.
 *
 * La règle est désormais : une réparation qui ne CONSTATE pas son résultat n'a
 * rien réparé. On resynchronise, on sonde réellement l'URL, puis on renvoie
 * l'état opérationnel final — c'est LUI, et lui seul, qui autorise le message
 * de succès.
 *
 * @returns {Promise<{cfg: object, ready: boolean, code: string}>}
 *   `code` est un motif d'échec STABLE, destiné à choisir une phrase côté
 *   Manager. Jamais affiché tel quel.
 */
export async function restoreEmailService({ mode, actor }) {
  let syncFailed = false;
  try {
    /*
     * R11 — PLUS AUCUN WEBHOOK LOCAL A SYNCHRONISER.
     *
     * Cet appel declarait l'endpoint de ce projet chez Brevo, avec la cle du
     * projet. Le suivi de livraison arrive desormais par le Panel : il n'y a
     * plus d'endpoint local, donc plus rien a declarer.
     */
  } catch (err) {
    // Un échec de synchronisation n'interrompt pas : la sonde reste la seule
    // preuve qui compte, et elle peut réussir malgré une resynchronisation
    // refusée (webhook déjà correct chez le fournisseur, par exemple).
    syncFailed = true;
    logger.warn(`[brevo] rétablissement (${mode}) — synchronisation échouée : ${err.message}`);
  }

  // La sonde est INCONDITIONNELLE ici — c'est tout l'intérêt de l'action : le
  // verdict doit porter sur l'instant, pas sur une preuve stockée. On lève au
  // passage le délai anti-martèlement, sans quoi une sonde ayant échoué juste
  // avant empêcherait le prochain contrôle de constater le rétablissement.
  resetOperationalProbeCooldown(mode);

  const readiness = await getBrevoOperationalReadiness(mode, { probe: false });
  const cfg = await getEmailConfiguration();
  return {
    cfg,
    ready: readiness.ready,
    code: readiness.ready ? '' : (readiness.blockers[0]?.code || (syncFailed ? 'SYNC_FAILED' : 'UNKNOWN')),
  };
}

/* --- Suivi CIBLÉ du dernier test ------------------------------------------- */

/**
 * Issue du dernier test, et RIEN d'autre.
 *
 * ─── POURQUOI UNE ROUTE À PART ───────────────────────────────────────────────
 *
 * Le Manager suivait l'issue d'un test en rechargeant toute la configuration
 * toutes les trois secondes. Or cette projection embarque l'expéditeur, la
 * présence des clés et l'état opérationnel des DEUX modes — dont un contrôle de
 * joignabilité. Suivre une livraison relançait donc l'écran entier : formulaire
 * réinitialisable, blocs qui clignotent, et une impression de travail permanent.
 *
 * Cette lecture-ci ne touche qu'un objet : l'issue du test. Elle ne consulte ni
 * les identifiants, ni l'état opérationnel, ni l'autre mode.
 *
 * `terminal` est calculé ICI plutôt que déduit côté client : c'est ce qui
 * garantit que le suivi s'arrête au même moment partout.
 */
export async function getTestDeliveryStatus({ mode }) {
  const cfg = await getEmailConfiguration();
  const state = modeState(cfg, mode);
  const outcome = await resolveTestOutcome(state);
  const TRANSITORY = [T.ACCEPTED, T.DEFERRED];
  return {
    deliveryId: state.test.deliveryId || '',
    status: outcome.status,
    terminal: !TRANSITORY.includes(outcome.status),
    recipientMasked: state.test.recipientMasked || '',
    lastTestedAt: state.test.lastTestedAt,
    acceptedAt: state.test.acceptedAt,
    deliveredAt: outcome.deliveredAt,
    rejectedAt: outcome.rejectedAt,
    lastErrorSafe: { code: outcome.code, message: outcome.message },
  };
}
