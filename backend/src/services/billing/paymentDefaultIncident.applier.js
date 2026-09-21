import { PaymentDefaultIncident } from '../../models/PaymentDefaultIncident.model.js';
import { isValidObjectId } from 'mongoose';
import { Contract } from '../../models/Contract.model.js';
import { logger } from '../../utils/logger.js';
import { emitAndDispatch } from '../events/domainEvent.service.js';
import { EVENT_ACTOR_TYPE } from '../../utils/domainEventConstants.js';

/**
 * APPLICATEUR — le Panel observe, le projet enregistre pour l'afficher
 * (L10.6B-3).
 *
 * ══ CE QU'IL NE FAIT PAS, ET C'EST L'ESSENTIEL ══════════════════════════════
 *
 * Il n'appelle PAS `reconcileSiteStatus()`. Il ne touche PAS `SiteStatus`. Il
 * ne ferme ni ne rouvre aucun site, dans aucun cas, quel que soit le contenu de
 * la charge utile.
 *
 * C'est la différence entre cet applicateur et `paymentDefaultCause.applier` —
 * qui, lui, existe pour faire exactement cela. Un incident de paiement et une
 * cause de suspension sont deux concepts distincts : l'incident naît au premier
 * prélèvement refusé, la cause n'apparaît qu'à l'expiration du délai de grâce.
 * Pendant toute la grâce, l'incident existe et la cause n'est pas active.
 *
 * Si quelqu'un ajoute un jour une réconciliation ici « pour que ça se voie »,
 * il fermera les sites pendant leur délai de grâce. Un test statique interdit
 * cet import.
 *
 * ══ REMPLACEMENT COMPLET, JAMAIS UN DELTA ═══════════════════════════════════
 *
 * Chaque livraison porte l'incident ENTIER, et l'écrase. Une écriture qui
 * aurait dit « attemptCount + 1 » aurait supposé que la ligne existe et qu'elle
 * est à jour — deux hypothèses que deux livraisons dans le désordre suffisent à
 * casser, en silence, sans que rien ne le signale.
 *
 * Le remplacement est IDEMPOTENT par construction : huit livraisons identiques
 * laissent le même état qu'une seule, et une livraison manquée est réparée par
 * la suivante. C'est ce qui rend la convergence possible après une absence.
 *
 * ══ ET LE DÉSORDRE, QUI N'EST PAS LA DUPLICATION ════════════════════════════
 *
 * Le pont dédoublonne par `writeId` : il reconnaît la même livraison rejouée.
 * Il ne reconnaît PAS deux écritures distinctes arrivées à l'envers — cas
 * banal après un rattrapage, où le journal se rejoue pendant que le direct
 * reprend.
 *
 * Sans garde, la plus ancienne gagnerait : un incident résolu repasserait « en
 * échec » sous les yeux du client, et une suspension confirmée redeviendrait
 * « en cours d'application ». On compare donc `modifiedAt` à celui déjà
 * appliqué, et on refuse de reculer.
 *
 * À ÉGALITÉ, on applique : deux écritures peuvent partager l'horodatage de la
 * source, et refuser la seconde perdrait une donnée réelle.
 */
export async function applyPaymentDefaultIncidentChange({ change }) {
  const payload = change?.payload ?? null;
  const entityId = change?.entityId ?? payload?.paymentDefaultId ?? null;

  if (!entityId) {
    throw new Error('Écriture PAYMENT_DEFAULT_INCIDENT sans identité : rien à appliquer.');
  }

  /**
   * UNE SUPPRESSION NE RETIRE RIEN, ELLE CLÔT.
   *
   * Le Panel n'en émet pas — un incident se résout ou se ferme, il ne s'efface
   * pas. Le cas est traité quand même : effacer un impayé de l'historique du
   * client le ferait disparaître de son espace de facturation, et c'est
   * précisément ce qu'un espace de facturation ne doit jamais faire.
   *
   * `causeActive: false` avec : une entité morte ne peut pas continuer à
   * expliquer une suspension.
   */
  if (change.deleted) {
    await PaymentDefaultIncident.updateOne(
      { paymentDefaultId: entityId },
      { $set: { status: 'CLOSED', causeActive: false, receivedAt: new Date().toISOString() } },
    );
    return;
  }

  if (!payload) throw new Error(`Écriture PAYMENT_DEFAULT_INCIDENT ${entityId} sans charge utile.`);

  const source = change.modifiedAt ? new Date(change.modifiedAt) : null;
  /**
   * L'ÉTAT CONNU AVANT ÉCRITURE — c'est lui qui distingue une TRANSITION d'une
   * simple relivraison. Sans cette lecture, huit livraisons identiques
   * produiraient huit e-mails ; avec elle, elles n'en produisent aucun après le
   * premier. Le statut s'ajoute donc à la projection déjà lue pour l'anti-recul :
   * une seule requête supplémentaire de champs, aucune requête supplémentaire
   * tout court.
   */
  const connu = await PaymentDefaultIncident.findOne({ paymentDefaultId: entityId })
    .select('sourceModifiedAt status suspensionRequestedAt suspensionConfirmedAt attemptCount').lean();

  if (source && connu?.sourceModifiedAt && source < new Date(connu.sourceModifiedAt)) {
    logger.info(
      `[billing] incident ${entityId} — écriture plus ancienne que l'état appliqué, ignorée.`,
    );
    return;
  }

  await PaymentDefaultIncident.updateOne(
    { paymentDefaultId: entityId },
    {
      $set: {
        paymentDefaultId: entityId,
        contractId: payload.contractId ?? null,
        invoiceId: payload.invoiceId ?? null,
        subscriptionId: payload.subscriptionId ?? null,

        status: payload.status,

        /**
         * OBSERVATIONS STRIPE, RECOPIÉES SANS AUCUN CALCUL. Pas de « si
         * attemptCount vaut 3 alors la prochaine est dans 5 jours » : nous
         * regardons la collecte, nous ne l'ordonnançons pas.
         */
        attemptCount: entier(payload.attemptCount),
        nextPaymentAttemptAt: date(payload.nextPaymentAttemptAt),
        firstFailedAt: date(payload.firstFailedAt),
        lastFailedAt: date(payload.lastFailedAt),

        /**
         * `null` RESTE `null`, ET `0` RESTE `0`.
         *
         * Un `?? 0` ici — le réflexe le plus naturel du monde — transformerait
         * « aucune politique de grâce n'est configurée » en « aucune clémence,
         * fermeture immédiate ». C'est le bogue le plus coûteux que ce champ
         * puisse produire, et il ne planterait nulle part.
         */
        graceDaysSnapshot: Number.isInteger(payload.graceDaysSnapshot)
          ? payload.graceDaysSnapshot
          : null,
        /** JAMAIS RECALCULÉE depuis `firstFailedAt + graceDays`. Reçue. */
        graceDeadlineAt: date(payload.graceDeadlineAt),

        amountDueCents: entier(payload.amountDueCents),
        currency: payload.currency ?? 'EUR',
        invoiceNumber: payload.invoiceNumber ?? null,
        hostedInvoiceUrl: payload.hostedInvoiceUrl ?? null,
        invoicePdfUrl: payload.invoicePdfUrl ?? null,

        suspensionRequestedAt: date(payload.suspensionRequestedAt),
        suspensionConfirmedAt: date(payload.suspensionConfirmedAt),
        causeRemovalConfirmedAt: date(payload.causeRemovalConfirmedAt),

        resolvedAt: date(payload.resolvedAt),
        resolution: payload.resolution ?? null,

        causeActive: payload.causeActive === true,
        reason: payload.reason || 'Défaut de paiement',

        sourceModifiedAt: source,
        receivedAt: new Date().toISOString(),
      },
    },
    { upsert: true },
  );

  logger.info(
    `[billing] incident de paiement ${entityId} — ${payload.status} `
    + `(cause ${payload.causeActive === true ? 'active' : 'inactive'}).`,
  );

  /**
   * PRÉVENIR NE PEUT PAS EMPÊCHER D'APPLIQUER.
   *
   * La projection est déjà écrite au-dessus. Si la notification échoue — base
   * indisponible, contrat au format inattendu, registre d'événements en
   * défaut — le pont ne doit pas voir d'erreur : il rejouerait la livraison,
   * et la seule chose qu'il réussirait à refaire est celle qui a déjà marché.
   */
  try {
    await annoncerTransition({ entityId, payload, avant: connu });
  } catch (err) {
    logger.error(
      `[billing] incident ${entityId} appliqué, notification impossible — ${err?.message ?? 'erreur inconnue'}.`,
    );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   LES TROIS MOMENTS QUI MÉRITENT UN MESSAGE

   ══ SUR TRANSITION, JAMAIS SUR LIVRAISON ═══════════════════════════════

   Le Panel relivre un incident à chaque observation du fournisseur : nouvelle
   tentative, nouvelle date, nouveau compteur. Émettre à chaque fois aurait
   produit un e-mail par battement — la définition même du harcèlement, et le
   plus sûr moyen de faire classer nos messages en indésirables.

   On compare donc l'état ÉCRIT à l'état CONNU, et on ne parle que lorsque la
   situation du client a réellement changé :

       (rien)     -> OPEN            « votre paiement n'a pas abouti »
       OPEN       -> GRACE_EXPIRED   « action requise »
       (vivant)   -> RESOLVED        « c'est régularisé »

   ══ ET LA SECONDE GARDE, CELLE QUI TIENT EN COURSE ═══════════════════════

   La comparaison ci-dessus suffit pour UN processus. Deux instances qui
   appliquent la même livraison en parallèle liraient toutes deux le même
   « avant » et émettraient toutes deux. La clé d'idempotence — construite sur
   (incident, état) — les départage dans la base : l'index unique de
   `DomainEvent` n'en laisse passer qu'une, et `emit()` rend le gagnant à
   l'autre. Le rejeu d'un journal complet est couvert par la même clé.

   ══ POURQUOI `emitAndDispatch` ET NON `emitSafe` ════════════════════════

   Un impayé se règle en heures, pas au prochain redémarrage. Le dispatch
   immédiat envoie le message tout de suite ; s'il échoue, la reprise
   (`processPendingEventActions`) le rattrape. Aucune des deux fonctions ne
   peut échouer vers l'appelant : APPLIQUER la projection reste prioritaire
   sur PRÉVENIR qu'elle a changé.
   ══════════════════════════════════════════════════════════════════════════ */

/** Les états où l'argent n'est toujours pas rentré. */
const VIVANTS = ['OPEN', 'GRACE_EXPIRED'];

/**
 * LES QUATRE ÉTATS QUE LE PANEL PEUT NOUS ENVOYER.
 *
 * ══ POURQUOI ON LES CONNAÎT ICI SANS EN ÊTRE L'AUTORITÉ ═════════════════════
 *
 * Le statut est DÉCIDÉ par le Panel : ce projet l'applique, il n'en invente
 * aucun. Mais la reconnaître est autre chose que la décider — et sans cette
 * liste, un statut inconnu se comportait comme un statut normal.
 *
 * Le scénario coûteux : le Panel envoie « RESOVLED ». Le champ n'a pas d'enum,
 * la valeur s'écrit, aucune des trois comparaisons de transition ne la
 * reconnaît, aucun e-mail ne part, aucune erreur n'est levée. Le Panel croit
 * l'impayé réglé, le projet affiche un état que personne ne sait lire, et rien
 * ne le signale — jamais.
 *
 * On applique quand même : refuser la projection ferait diverger les deux
 * bases, ce qui est pire. Mais on le DIT, fort, avec le statut fautif nommé.
 */
const STATUTS_CONNUS = Object.freeze(['OPEN', 'GRACE_EXPIRED', 'RESOLVED', 'CLOSED']);

async function annoncerTransition({ entityId, payload, avant }) {
  const avantStatut = avant?.status ?? null;
  const apres = payload.status;

  /**
   * UN STATUT INCHANGÉ N'EST PLUS LA FIN DE L'HISTOIRE.
   *
   * ══ CE QUE CE RETOUR ANTICIPÉ COÛTAIT ═══════════════════════════════════
   *
   * L'impayé reste `OPEN` pendant toute la grâce. Le prestataire de paiement,
   * lui, retente — trois, quatre, cinq fois — et le Panel republie l'incident
   * à chaque refus, compteur incrémenté. Toutes ces livraisons trouvaient
   * `OPEN → OPEN` et repartaient sans un mot.
   *
   * Le client recevait donc UN message, au premier échec, puis plus rien
   * jusqu'à l'annonce de la fermeture. Sept jours de silence entre l'avis et
   * la sanction, alors que c'est exactement l'intervalle où il peut encore
   * agir.
   *
   * ══ CE QUI DISTINGUE UNE VRAIE TENTATIVE D'UNE RELIVRAISON ══════════════
   *
   * `attemptCount` — le compteur du prestataire, recopié, jamais calculé ici.
   * Une même livraison rejouée huit fois porte huit fois le même compteur et
   * ne produit qu'un seul message. Une tentative réellement nouvelle
   * l'incrémente, et c'est le seul cas qui parle.
   *
   * Un deuxième événement décrivant le MÊME refus ne peut pas non plus
   * doubler la relance : seul `invoice.payment_failed` ouvre un incident chez
   * le Panel — `payment_intent.payment_failed` est explicitement non routable.
   * Un refus logique n'incrémente donc le compteur qu'une fois.
   */
  if (!STATUTS_CONNUS.includes(apres)) {
    logger.error(
      `[billing] incident ${entityId} — statut « ${apres} » INCONNU de ce projet. `
      + `L'état est appliqué pour ne pas diverger du Panel, mais aucune notification `
      + `ne peut être choisie. Statuts connus : ${STATUTS_CONNUS.join(', ')}.`,
    );
    return;
  }

  const nouvelleTentative = apres === 'OPEN'
    && avantStatut === 'OPEN'
    && Number.isInteger(payload.attemptCount)
    && payload.attemptCount > entier(avant?.attemptCount);

  if (avantStatut === apres && !nouvelleTentative) return; // relivraison : rien de neuf

  /**
   * SANS CONTRAT, PAS DE MESSAGE — et ce n'est pas un échec.
   *
   * Les résolveurs de variables relisent le contrat pour composer l'e-mail ;
   * un incident orphelin (contrat purgé, recette) ne produirait qu'un
   * DEAD_LETTER illisible. Mieux vaut ne rien émettre que tracer un échec dont
   * personne ne peut rien faire.
   */
  /**
   * `contractId` VIENT DU PANEL : c'est une chaîne, pas une garantie.
   *
   * `findById` sur une valeur qui n'est pas un identifiant de document lève
   * une erreur de conversion — et une notification manquée ne doit pas
   * ressembler à une panne. On vérifie donc la forme avant d'interroger,
   * plutôt que de rattraper une exception qui masquerait les vraies.
   */
  const idExploitable = isValidObjectId(payload.contractId ?? '');
  const contract = idExploitable ? await Contract.findById(payload.contractId).lean() : null;
  if (!contract) {
    logger.info(`[billing] incident ${entityId} sans contrat connu — aucune notification.`);
    return;
  }

  const commun = {
    entityType: 'Contract',
    entityId: contract._id,
    actor: { type: EVENT_ACTOR_TYPE.SYSTEM },
  };

  if (apres === 'OPEN' && avantStatut === null) {
    await emitAndDispatch({
      ...commun,
      type: 'contract.payment.overdue',
      payloadSafe: {
        paymentDefaultId: entityId,
        reference: contract.reference || '',
        attemptCount: Number.isInteger(payload.attemptCount) ? payload.attemptCount : 0,
        amountDueCents: Number.isInteger(payload.amountDueCents) ? payload.amountDueCents : 0,
        currency: payload.currency || 'EUR',
        graceDaysSnapshot: Number.isInteger(payload.graceDaysSnapshot) ? payload.graceDaysSnapshot : null,
        graceDeadlineAt: payload.graceDeadlineAt ? new Date(payload.graceDeadlineAt).toISOString() : null,
        invoiceNumber: payload.invoiceNumber ?? null,
      },
      idempotencyKey: `payment-overdue:${entityId}:OPEN`,
    });
    return;
  }

  if (nouvelleTentative) {
    await emitAndDispatch({
      ...commun,
      type: 'contract.payment.retry_failed',
      payloadSafe: {
        paymentDefaultId: entityId,
        reference: contract.reference || '',
        attemptCount: entier(payload.attemptCount),
        previousAttemptCount: entier(avant?.attemptCount),
        amountDueCents: entier(payload.amountDueCents),
        currency: payload.currency || 'EUR',
        graceDaysSnapshot: Number.isInteger(payload.graceDaysSnapshot) ? payload.graceDaysSnapshot : null,
        graceDeadlineAt: payload.graceDeadlineAt ? new Date(payload.graceDeadlineAt).toISOString() : null,
        firstFailedAt: payload.firstFailedAt ? new Date(payload.firstFailedAt).toISOString() : null,
        invoiceNumber: payload.invoiceNumber ?? null,
      },
      /**
       * LE COMPTEUR EST DANS LA CLÉ, et c'est ce qui rend la répétition sûre.
       *
       * Deux appliqueurs concurrents lisant le même « avant » émettraient tous
       * deux : l'index unique de `DomainEvent` n'en laisse passer qu'un. Le
       * rejeu d'un journal complet retombe sur les mêmes clés. Seule une
       * tentative réellement nouvelle produit une clé neuve.
       */
      idempotencyKey: `payment-retry-failed:${entityId}:${entier(payload.attemptCount)}`,
    });
    return;
  }

  if (apres === 'GRACE_EXPIRED') {
    await emitAndDispatch({
      ...commun,
      type: 'contract.payment.overdue_critical',
      payloadSafe: {
        paymentDefaultId: entityId,
        reference: contract.reference || '',
        attemptCount: Number.isInteger(payload.attemptCount) ? payload.attemptCount : 0,
        amountDueCents: Number.isInteger(payload.amountDueCents) ? payload.amountDueCents : 0,
        currency: payload.currency || 'EUR',
        graceDeadlineAt: payload.graceDeadlineAt ? new Date(payload.graceDeadlineAt).toISOString() : null,
        invoiceNumber: payload.invoiceNumber ?? null,
        suspensionRequested: Boolean(payload.suspensionRequestedAt),
        suspensionConfirmed: Boolean(payload.suspensionConfirmedAt),
      },
      idempotencyKey: `payment-overdue-critical:${entityId}:GRACE_EXPIRED`,
    });
    return;
  }

  if (apres === 'RESOLVED' && VIVANTS.includes(avantStatut)) {
    await emitAndDispatch({
      ...commun,
      type: 'contract.payment.recovered',
      payloadSafe: {
        paymentDefaultId: entityId,
        reference: contract.reference || '',
        amountDueCents: Number.isInteger(payload.amountDueCents) ? payload.amountDueCents : 0,
        currency: payload.currency || 'EUR',
        resolution: payload.resolution ?? null,
        resolvedAt: payload.resolvedAt ? new Date(payload.resolvedAt).toISOString() : null,
        /**
         * Le site avait-il RÉELLEMENT fermé ? Une suspension seulement DEMANDÉE
         * ne compte pas : annoncer un « rétablissement » à un client dont le
         * site n'a jamais cessé de répondre l'inquiéterait rétroactivement.
         */
        wasSuspended: Boolean(avant?.suspensionConfirmedAt),
      },
      idempotencyKey: `payment-recovered:${entityId}:RESOLVED`,
    });
  }
}

/** Un compte absent vaut ZÉRO, jamais `NaN` : un écran n'affiche pas « NaN ». */
const entier = (v) => (Number.isInteger(v) ? v : 0);
/** Une date absente vaut `null`, jamais « maintenant » : on n'invente pas. */
const date = (v) => (v ? new Date(v) : null);

export default { applyPaymentDefaultIncidentChange };
