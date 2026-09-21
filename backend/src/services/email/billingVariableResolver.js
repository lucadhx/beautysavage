import { Contract } from '../../models/Contract.model.js';
import { Company } from '../../models/Company.model.js';
import { SiteStatus } from '../../models/SiteStatus.model.js';
import { SystemConfiguration } from '../../models/SystemConfiguration.model.js';
import { PaymentDefaultIncident } from '../../models/PaymentDefaultIncident.model.js';
import { Invoice } from '../../models/Invoice.model.js';
import { PAYMENT_TYPE } from '../../utils/contractConstants.js';
import { getSingleton } from '../../utils/singleton.js';
import { getPublishedDeveloperIdentity } from '../panelConfiguration/developerIdentity.service.js';
import { EmailVariableResolverError } from './emailVariableResolvers.js';
import { EMAIL_DELIVERY_ERROR_CODES as D } from '../../utils/emailTemplateConstants.js';
import { config } from '../../config/env.js';

/**
 * RÉSOLVEURS DE VARIABLES DU CYCLE DE PAIEMENT ET DES INCIDENTS TECHNIQUES.
 *
 * ─── ILS RELISENT LE MÉTIER, ILS NE RECOPIENT PAS L'ÉVÉNEMENT ────────────────
 *
 * Même doctrine que `contactVariableResolver` : l'événement sert à ROUTER, la
 * base sert à DIRE. Un e-mail rejoué dix minutes plus tard doit énoncer l'état
 * du moment — un impayé réglé entre-temps ne doit pas repartir en « action
 * requise » sous prétexte que l'événement, lui, n'a pas changé.
 *
 * Les payloads d'événement restent volontairement maigres et masqués (ils sont
 * relus et exposés par les routes DEV) : ils ne pourraient pas alimenter un
 * message de toute façon.
 *
 * ─── CHAQUE CLÉ EST ÉCRITE À LA MAIN ────────────────────────────────────────
 *
 * Aucun accès générique : il n'existe pas de `{{contract.anything}}` qui irait
 * chercher un champ dans un document Mongo. Un mapping explicite ne peut pas
 * publier par accident un identifiant fournisseur que personne n'avait prévu
 * d'exposer.
 *
 * ─── LES PHRASES D'ÉTAT SONT RÉDIGÉES ICI, PAS DANS LE TEMPLATE ─────────────
 *
 * `incident.serviceState` est une PHRASE, pas un booléen. Le moteur de
 * templates n'a ni condition ni branchement — c'est un choix de conception, pas
 * un manque — donc « suspension appliquée » vs « en cours d'application » se
 * décide ici, au seul endroit qui connaît les trois dates qui le déterminent.
 */

/* ── Petits utilitaires d'affichage ─────────────────────────────────────── */

/** Une date absente s'écrit, elle ne s'invente pas et ne vaut pas 1970. */
const jour = (v) =>
  (v
    ? new Date(v).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' })
    : 'non communiquée');

const instant = (v) =>
  (v
    ? new Date(v).toLocaleString('fr-FR', {
      day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris',
    })
    : 'non communiqué');

/**
 * Les URL du Manager, construites depuis la configuration réseau — JAMAIS en
 * dur. Le Manager change d'adresse entre développement, TEST et production ;
 * une adresse figée produirait un lien mort dans un e-mail réel, et personne ne
 * s'en apercevrait avant qu'un client ne clique.
 */
async function managerBase() {
  const cfg = await getSingleton(SystemConfiguration);
  const base = (cfg.network?.managerUrl || '').replace(/\/+$/, '');
  if (!base) {
    throw new EmailVariableResolverError(
      D.UNKNOWN_RESOLVER,
      "L'URL du Manager n'est pas configurée (Configuration système → Réseau) : "
      + 'impossible de construire les liens de ce message.',
    );
  }
  return base;
}

/**
 * L'identité du PRESTATAIRE vient du Panel, jamais d'une fiche locale.
 *
 * Un message signé d'un nom que l'autorité ne connaît pas est le défaut déjà
 * corrigé côté contrats : on relit la même source, et on échoue franchement
 * plutôt que d'envoyer un e-mail signé « undefined ».
 */
async function prestataire() {
  const identite = await getPublishedDeveloperIdentity();
  const nom = identite?.name || '';
  /*
    UNE SEULE SOURCE POUR L'ADRESSE DE CONTACT.

    Le repli `|| identite?.email` visait un champ que cette identité n'expose
    pas : il valait toujours `undefined`, donc il ne servait à rien — mais il
    se lisait comme une seconde autorité, et la prochaine main aurait pu le
    faire pointer sur `contacts.email`, qui est l'adresse administrative de
    l'agence et non celle qu'on invite un client à écrire.
  */
  const support = identite?.supportEmail || '';
  if (!nom || !support) {
    throw new EmailVariableResolverError(
      D.UNKNOWN_RESOLVER,
      !nom
        ? "L'identité du prestataire n'est pas publiée par le Panel : "
          + "ce message ne peut pas être signé, il ne partira pas."
        : "Aucune adresse de contact public n'est publiée par le Panel "
          + "(écran « Expéditeur e-mail » → « E-mail de contact public ») : "
          + "ce message inviterait le client à répondre à une adresse vide, "
          + "il ne partira pas.",
    );
  }
  return { nom, support };
}

/** Le contrat désigné par l'événement, ou un refus NOMMABLE. */
async function contratDeLEvenement(event) {
  const id = event?.entityId || null;
  const contract = id ? await Contract.findById(id).lean() : null;
  if (!contract) {
    // Le contrat a disparu entre l'émission et l'envoi (purge, recette).
    // Non retryable : il ne reviendra pas.
    throw new EmailVariableResolverError(
      D.UNKNOWN_RESOLVER,
      `Le contrat ${id ?? '(non désigné)'} n'existe plus : notification sans objet.`,
    );
  }
  return contract;
}

/** L'incident désigné par le payload, ou un refus NOMMABLE. */
async function incidentDuPayload(event) {
  const id = event?.payloadSafe?.paymentDefaultId || null;
  const incident = id ? await PaymentDefaultIncident.findOne({ paymentDefaultId: id }).lean() : null;
  if (!incident) {
    throw new EmailVariableResolverError(
      D.UNKNOWN_RESOLVER,
      `L'incident de paiement ${id ?? '(non désigné)'} n'existe plus : notification sans objet.`,
    );
  }
  return incident;
}

/* ── PAYMENT_CONFIRMED_ADMIN (L12) ──────────────────────────────────────── */

/**
 * CE QUI A ÉTÉ PAYÉ — dit au client, jamais dans le vocabulaire du fournisseur.
 *
 * L'événement porte déjà cette information : c'est LUI qui distingue un premier
 * règlement d'un cycle d'abonnement. La relire ailleurs — sur le contrat, sur
 * un statut — reviendrait à redécouvrir ce qu'on sait déjà, et à se tromper le
 * jour où les deux se produisent dans la même minute.
 */
const NATURE_PAR_EVENEMENT = Object.freeze({
  'launch_fee.paid': 'Frais de lancement',
  'subscription.paid': 'Abonnement',
});

/**
 * LA PÉRIODE COUVERTE — une phrase, parce que le moteur n'a pas de condition.
 *
 * Un paiement unique n'en a pas, et « Paiement unique » est une information :
 * laisser la ligne vide ferait croire à une donnée manquante. Voir la doctrine
 * des phrases d'état en tête de ce fichier.
 */
function periodePayee(contract, type) {
  if (type !== 'subscription.paid') return 'Paiement unique';
  const debut = contract?.stripe?.subscription?.currentPeriodStart;
  const fin = contract?.stripe?.subscription?.currentPeriodEnd;
  if (!debut || !fin) return 'Période en cours';
  return `du ${jour(debut)} au ${jour(fin)}`;
}

/**
 * LA FACTURE DE CE RÈGLEMENT — et l'attente assumée quand elle n'est pas là.
 *
 * ══ POURQUOI ON REFUSE D'ENVOYER SANS ELLE ══════════════════════════════════
 *
 * Le message porte un bouton « Voir ma facture ». Un bouton qui mène à une
 * liste vide est pire que pas de bouton : le client vient d'être débité, on lui
 * confirme l'encaissement, il clique — et ne trouve rien. Il doute alors du
 * paiement lui-même, et il écrit au support.
 *
 * ══ POURQUOI L'ATTENTE EST LÉGITIME, ET COURTE ══════════════════════════════
 *
 * Le fournisseur annonce l'encaissement AVANT d'avoir fini d'émettre la
 * facture — sur le parcours réel, `invoice.finalized` arrive environ quatre
 * secondes après le règlement des frais de lancement. Le fait métier est vrai,
 * le message est dû, et la seule donnée qui manque est en route.
 *
 * On lève donc un refus REJOUABLE. L'ordonnanceur d'actions repasse à 30 s,
 * 2 min puis 10 min : la première tentative suffit dans tous les cas observés,
 * et la dernière laisse une marge très au-delà de ce que le fournisseur met.
 * Au bout des quatre, l'exécution part en DEAD_LETTER — visible, diagnosticable,
 * rejouable à la main. Un trou qu'on voit vaut mieux qu'un lien mort.
 *
 * ══ CE QU'ON NE FAIT PAS ════════════════════════════════════════════════════
 *
 * On n'interroge PAS le fournisseur pour aller chercher la facture. Elle
 * arrive par ses webhooks, comme tout le reste, et `billing.service` la
 * reflète. Ouvrir ici un second chemin de lecture ferait deux sources pour un
 * même document.
 */
async function factureDuReglement(contract, event) {
  const type = String(event?.type || '');
  const filtre = { contractId: contract._id, environment: config.env };

  /**
   * L'ABONNEMENT DÉSIGNE SA FACTURE, les frais de lancement se contentent de
   * leur type. Un cycle d'abonnement en produit une par mois : prendre « la
   * dernière » enverrait le client vers la facture d'un autre règlement le jour
   * où deux se croisent.
   */
  if (type === 'subscription.paid' && event?.payloadSafe?.invoiceId) {
    filtre.externalInvoiceId = event.payloadSafe.invoiceId;
  } else if (type === 'launch_fee.paid') {
    filtre.type = PAYMENT_TYPE.LAUNCH_FEE;
  }

  const facture = await Invoice.findOne(filtre).sort({ invoiceDate: -1 }).lean();
  if (facture) return facture;

  throw new EmailVariableResolverError(
    D.RENDER_FAILED,
    "La facture de ce règlement n'est pas encore parvenue du prestataire de paiement : "
    + "le message attend, plutôt que d'annoncer une facture introuvable.",
    /* rejouable */ true,
  );
}

/**
 * LE MODÈLE GÉNÉRIQUE DE CONFIRMATION D'ENCAISSEMENT.
 *
 * Sert `launch_fee.paid` ET `subscription.paid`, et servira toute prestation à
 * venir. Ce qui change entre eux tient dans trois valeurs — la nature, le
 * libellé, la période — et rien d'autre : c'est ce qui justifie un seul modèle
 * plutôt qu'un par type de règlement.
 */
export async function resolvePaymentConfirmedAdmin({ event }) {
  const contract = await contratDeLEvenement(event);
  const company = await getSingleton(Company);
  const dev = await prestataire();
  const base = await managerBase();
  const type = String(event?.type || '');
  const nature = NATURE_PAR_EVENEMENT[type] ?? 'Paiement';

  // La facture D'ABORD : inutile de composer un message qu'on ne pourra pas
  // envoyer, et le refus doit nommer la vraie cause.
  const facture = await factureDuReglement(contract, event);

  /**
   * LE MONTANT VIENT DE LA FACTURE, pas du tarif contractuel.
   *
   * C'est ce qui a réellement été débité. Le snapshot du contrat dit ce qui
   * était DÛ — les deux coïncident presque toujours, et « presque » est
   * exactement le mot qui interdit de les confondre dans une confirmation de
   * paiement.
   */
  const montant = {
    amount: facture.amountIncludingTax
      ?? (type === 'subscription.paid'
        ? contract.pricing?.subscription?.amountIncludingTax
        : contract.pricing?.launchFee?.amountIncludingTax)
      ?? 0,
    currency: facture.currency || 'EUR',
  };

  /**
   * LA DATE DE L'ENCAISSEMENT, relue sur la facture puis sur le contrat — pas
   * celle de l'événement. Un rattrapage de réconciliation émet le fait
   * longtemps après l'argent : écrire « payé le » avec l'heure de l'e-mail
   * serait faux.
   */
  const paidAt = facture.paidAt
    || (type === 'subscription.paid' ? null : contract.stripe?.launchFee?.paidAt)
    || event.occurredAt;

  return {
    'company.name': company?.name || 'Votre entreprise',
    'contract.reference': contract.reference || '',
    'contract.name': contract.name || contract.reference || '',
    'payment.kind': nature,
    'payment.label': facture.label || facture.number
      ? `${nature}${facture.number ? ` — facture ${facture.number}` : ''}`
      : nature,
    'payment.amountIncludingTax': montant,
    'payment.paidOn': new Date(paidAt).toISOString(),
    'payment.period': periodePayee(contract, type),
    /**
     * L'ESPACE DE FACTURATION DU CLIENT — jamais une adresse du fournisseur.
     *
     * Celles-ci sont signées et périssables ; un e-mail se relit des mois plus
     * tard, et le client tomberait sur une erreur. La page de facturation, elle,
     * est servie par ce projet, protégée par son authentification, et elle liste
     * la facture qu'on vient de vérifier présente.
     */
    'payment.invoiceUrl': `${base}/factures`,
    'manager.contractUrl': `${base}/contrat`,
    'developer.companyName': dev.nom,
    'developer.supportEmail': dev.support,
  };
}

/* ── CONTRACT_PAYMENT_RECEIVED_ADMIN — RETIRÉ (L12) ─────────────────────────
 *
 * Remplacé par `resolvePaymentConfirmedAdmin` ci-dessus, qui couvre tous les
 * types de règlement et garantit le lien de facture. Le résolveur reste
 * enregistré : des instances de ce code existent encore côté Panel, avec leur
 * historique, et une exécution rejouée à la main doit continuer de se rendre.
 * Il n'a simplement plus d'action qui l'appelle.
 */

export async function resolvePaymentReceivedAdmin({ event }) {
  const contract = await contratDeLEvenement(event);
  const company = await getSingleton(Company);
  const dev = await prestataire();
  const base = await managerBase();

  return {
    'company.name': company?.name || 'Votre entreprise',
    'contract.reference': contract.reference || '',
    'contract.name': contract.name || contract.reference || '',
    'payment.amountIncludingTax': {
      amount: contract.pricing?.launchFee?.amountIncludingTax ?? 0,
      currency: contract.pricing?.launchFee?.currency || 'EUR',
    },
    /**
     * La date de l'ENCAISSEMENT, relue sur le contrat — pas celle de
     * l'événement. Un rattrapage de réconciliation émet le fait longtemps
     * après l'argent : écrire « payé le » avec l'heure de l'e-mail serait faux.
     */
    'payment.paidOn': contract.stripe?.launchFee?.paidAt
      ? new Date(contract.stripe.launchFee.paidAt).toISOString()
      : new Date(event.occurredAt).toISOString(),
    'payment.label': 'Frais de lancement',
    'manager.contractUrl': `${base}/contrat`,
    'developer.companyName': dev.nom,
    'developer.supportEmail': dev.support,
  };
}

/* ── CONTRACT_PAYMENT_OVERDUE_ADMIN ─────────────────────────────────────── */

export async function resolvePaymentOverdueAdmin({ event }) {
  const contract = await contratDeLEvenement(event);
  const incident = await incidentDuPayload(event);
  const company = await getSingleton(Company);
  const dev = await prestataire();
  const base = await managerBase();

  return {
    'company.name': company?.name || 'Votre entreprise',
    'contract.reference': contract.reference || '',
    'incident.amountDue': { amount: incident.amountDueCents ?? 0, currency: incident.currency || 'EUR' },
    'incident.invoiceNumber': incident.invoiceNumber || 'non communiqué',
    'incident.attemptCount': String(incident.attemptCount ?? 0),
    /**
     * `null` ET `0` NE DISENT PAS LA MÊME CHOSE, et la nuance survit jusqu'ici :
     * aucune politique de grâce (« non applicable ») n'est pas zéro jour de
     * clémence. Le même piège que `graceConfigured` côté écran.
     */
    'incident.graceDeadline': Number.isInteger(incident.graceDaysSnapshot)
      ? jour(incident.graceDeadlineAt)
      : 'non applicable',
    'manager.billingUrl': `${base}/factures`,
    'developer.companyName': dev.nom,
    'developer.supportEmail': dev.support,
  };
}

/* ── PERTINENCE DES RELANCES D'IMPAYÉ ───────────────────────────────────── */

/**
 * « CETTE RELANCE A-T-ELLE ENCORE UN SENS ? » — posée juste avant l'envoi.
 *
 * ══ LE SCÉNARIO QU'ELLE FERME ═══════════════════════════════════════════════
 *
 * Une relance est créée, le fournisseur d'envoi est momentanément injoignable,
 * une nouvelle tentative est programmée dans deux minutes. Entre les deux, le
 * client paie. Sans cette garde, le worker se réveille et écrit « nous n'avons
 * toujours pas reçu votre règlement » à quelqu'un qui vient de régler.
 *
 * Ce n'est pas un défaut d'idempotence : rien n'est jamais parti. C'est un
 * message devenu FAUX pendant qu'il attendait son tour.
 *
 * ══ CE QU'ELLE NE FAIT PAS ══════════════════════════════════════════════════
 *
 * Elle ne juge pas l'ÉVÉNEMENT — il reste vrai, la tentative a bien été
 * refusée. Elle juge la CONSÉQUENCE, et seulement au moment de l'exécuter.
 *
 * Un incident disparu ne rend pas la relance obsolète : on ne peut alors rien
 * affirmer, et le résolveur de variables refusera de son côté avec un message
 * lisible. Se taire ici masquerait une donnée manquante derrière un « sans
 * objet » rassurant.
 */
const IMPAYE_VIVANT = ['OPEN', 'GRACE_EXPIRED'];

export async function relanceImpayeEncorePertinente(event) {
  const id = event?.payloadSafe?.paymentDefaultId || null;
  if (!id) return { relevant: true };

  const incident = await PaymentDefaultIncident.findOne({ paymentDefaultId: id })
    .select('status resolution').lean();
  /* Incident introuvable : ce n'est pas « réglé », c'est « inconnu ». */
  if (!incident) return { relevant: true };

  if (IMPAYE_VIVANT.includes(incident.status)) return { relevant: true };

  return {
    relevant: false,
    reason: `l’impayé est ${incident.status}`
      + (incident.resolution ? ` (${incident.resolution})` : '')
      + ' : réclamer un règlement déjà reçu serait faux',
  };
}

/* ── CONTRACT_PAYMENT_RETRY_FAILED_ADMIN ────────────────────────────────── */

/**
 * CE QUE CE RÈGLEMENT PAIE — nommé, jamais supposé.
 *
 * Aujourd'hui un incident ne naît que d'une facture d'ABONNEMENT : le
 * normalisateur du Panel écarte explicitement les factures ponctuelles
 * (`NOT_A_SUBSCRIPTION`), parce qu'une prestation impayée ne suspend rien. La
 * présence de `subscriptionId` est donc la preuve, et non une supposition.
 *
 * Le jour où le périmètre s'ouvrira aux frais de lancement ou aux prestations,
 * cette fonction sera le seul endroit à corriger — et l'absence de preuve rend
 * une formule neutre plutôt qu'une affirmation fausse.
 */
function libelleDeLObjet(incident) {
  if (incident.subscriptionId) return 'votre abonnement';
  return 'votre facture';
}

/**
 * LA PHRASE D'ÉCHÉANCE — rédigée ici, parce qu'un modèle n'a pas de condition.
 *
 * ══ POURQUOI ELLE NE PEUT PAS ÊTRE UNE DATE ═══════════════════════════════
 *
 * Trois situations, trois phrases, et l'une d'elles ne contient aucune date :
 *
 *   · une échéance est fixée et pas encore atteinte → on annonce la date ;
 *   · l'échéance est passée → la fermeture est déjà possible, la promettre
 *     « avant le … » serait périmé ;
 *   · aucune politique de grâce n'est configurée → il n'existe AUCUNE date de
 *     fermeture automatique. Écrire « sans règlement avant le … votre site sera
 *     suspendu » serait une menace inventée, et le client s'en apercevrait.
 *
 * Le modèle reçoit donc la phrase entière. Lui demander de choisir supposerait
 * une syntaxe conditionnelle que le moteur n'a pas — et qu'on ne veut pas.
 */
function phraseEcheance(incident, maintenant = new Date()) {
  const configuree = Number.isInteger(incident.graceDaysSnapshot);
  const echeance = incident.graceDeadlineAt ? new Date(incident.graceDeadlineAt) : null;

  if (!configuree || !echeance) {
    return 'Aucune suspension automatique n’est prévue par votre contrat, mais la somme '
      + 'reste due et les tentatives de prélèvement se poursuivront.';
  }
  if (echeance.getTime() <= maintenant.getTime()) {
    return 'Le délai prévu par votre contrat est écoulé : la suspension de votre site '
      + 'est désormais possible à tout moment.';
  }
  return `Sans régularisation avant le ${jour(echeance)}, votre site sera suspendu `
    + 'conformément aux conditions de votre contrat.';
}

/**
 * OÙ PAYER — la page du prestataire d'abord, l'espace du Manager à défaut.
 *
 * `hostedInvoiceUrl` est la facture hébergée par le prestataire de paiement :
 * elle accepte une autre carte en trois clics, sans connexion. C'est le chemin
 * le plus court vers la régularisation, et il vient de la facture elle-même —
 * jamais d'une URL fabriquée ici.
 *
 * Elle peut manquer (facture ancienne, champ non transmis). L'espace
 * facturation du Manager reste alors un chemin valide : il sait produire une
 * session de paiement fraîche, là où un lien Stripe expiré n'aurait mené nulle
 * part.
 */
function lienDeReglement(incident, base) {
  const hebergee = String(incident.hostedInvoiceUrl ?? '').trim();
  if (/^https:\/\//i.test(hebergee)) return hebergee;
  return `${base}/factures`;
}

export async function resolvePaymentRetryFailedAdmin({ event }) {
  const contract = await contratDeLEvenement(event);
  const incident = await incidentDuPayload(event);
  const company = await getSingleton(Company);
  const dev = await prestataire();
  const base = await managerBase();

  return {
    'company.name': company?.name || 'Votre entreprise',
    'contract.reference': contract.reference || '',
    'incident.amountDue': { amount: incident.amountDueCents ?? 0, currency: incident.currency || 'EUR' },
    'incident.purposeLabel': libelleDeLObjet(incident),
    'incident.invoiceNumber': incident.invoiceNumber || 'non communiqué',
    /**
     * L'ÉCHÉANCE D'ORIGINE EST LE PREMIER REFUS, et non le dernier.
     *
     * Un prélèvement d'abonnement est tenté le jour où il est dû : le premier
     * refus date donc de l'échéance. Prendre `lastFailedAt` ferait glisser la
     * date à chaque tentative, et le client lirait une échéance qui recule —
     * exactement la dérive que le Panel a fermée en figeant `firstFailedAt`.
     */
    'incident.originalDueDate': jour(incident.firstFailedAt),
    'incident.attemptCount': String(incident.attemptCount ?? 0),
    'incident.deadlineSentence': phraseEcheance(incident),
    'incident.paymentUrl': lienDeReglement(incident, base),
    'developer.companyName': dev.nom,
    'developer.supportEmail': dev.support,
  };
}

/* ── CONTRACT_PAYMENT_OVERDUE_CRITICAL_ADMIN ────────────────────────────── */

/**
 * LA PHRASE D'ÉTAT — trois faits distincts, jamais fusionnés.
 *
 * Confirmée : le site EST fermé, on le dit. Demandée seulement : la fermeture
 * est en cours d'application, et le site répond peut-être encore — l'affirmer
 * close serait un mensonge vérifiable d'un clic. Ni l'une ni l'autre : le
 * service est encore assuré, et c'est justement le moment d'agir.
 */
function phraseEtatService(incident) {
  if (incident.suspensionConfirmedAt) {
    return "Votre site n'est plus accessible à vos visiteurs.";
  }
  if (incident.suspensionRequestedAt) {
    return "La suspension de votre site est en cours d'application.";
  }
  return 'Votre site est encore accessible, mais sa suspension est désormais possible à tout moment.';
}

export async function resolvePaymentOverdueCriticalAdmin({ event }) {
  const contract = await contratDeLEvenement(event);
  const incident = await incidentDuPayload(event);
  const company = await getSingleton(Company);
  const dev = await prestataire();
  const base = await managerBase();

  return {
    'company.name': company?.name || 'Votre entreprise',
    'contract.reference': contract.reference || '',
    'incident.amountDue': { amount: incident.amountDueCents ?? 0, currency: incident.currency || 'EUR' },
    'incident.invoiceNumber': incident.invoiceNumber || 'non communiqué',
    'incident.graceDeadline': jour(incident.graceDeadlineAt),
    'incident.serviceState': phraseEtatService(incident),
    'manager.billingUrl': `${base}/factures`,
    'developer.companyName': dev.nom,
    'developer.supportEmail': dev.support,
  };
}

/* ── CONTRACT_PAYMENT_RECOVERED_ADMIN ───────────────────────────────────── */

export async function resolvePaymentRecoveredAdmin({ event }) {
  const contract = await contratDeLEvenement(event);
  const incident = await incidentDuPayload(event);
  const company = await getSingleton(Company);
  const dev = await prestataire();
  const base = await managerBase();

  /**
   * « Rétabli » se lit dans `SiteStatus`, pas dans l'incident.
   *
   * Un site peut rester fermé après régularisation — une maintenance technique
   * suffit. Écrire « votre site est de nouveau accessible » sans le vérifier
   * enverrait le client constater le contraire.
   */
  const site = await getSingleton(SiteStatus);
  const accessible = site?.status === 'ACTIVE';
  const avaitEteFerme = Boolean(incident.suspensionConfirmedAt);

  let etat;
  if (avaitEteFerme && accessible) etat = 'Votre site est de nouveau accessible.';
  else if (avaitEteFerme) etat = "Le rétablissement de votre site est en cours d'application.";
  else etat = "Votre site est resté accessible pendant toute la durée de l'incident.";

  return {
    'company.name': company?.name || 'Votre entreprise',
    'contract.reference': contract.reference || '',
    'incident.amountDue': { amount: incident.amountDueCents ?? 0, currency: incident.currency || 'EUR' },
    'incident.resolvedOn': jour(incident.resolvedAt),
    'incident.serviceState': etat,
    'manager.billingUrl': `${base}/factures`,
    'developer.companyName': dev.nom,
    'developer.supportEmail': dev.support,
  };
}

/* ── PLATFORM_INCIDENT_DEV_ALERT ────────────────────────────────────────── */

/**
 * Ce que chaque famille d'incident SIGNIFIE, en une phrase.
 *
 * Écrite ici plutôt que dans le payload : un résumé est du CONTENU, et le
 * payload d'un événement est relu et exposé par les routes DEV — il porte des
 * faits, pas de la prose. Changer une formulation ne doit pas réécrire
 * l'histoire des événements déjà émis.
 */
const RESUME_PAR_NATURE = Object.freeze({
  CAPABILITY_FAILURE:
    "Une capacité du Panel est durablement indisponible : les opérations qui en dépendent échouent.",
  PANEL_PROJECTION_FAILURE:
    "Une projection vers le Panel est définitivement refusée : la fiche du projet ne reflète plus la réalité.",
  DEPLOYMENT_FAILURE:
    "Un déploiement a échoué et ne se reprendra pas seul : une intervention est nécessaire.",
  SERVICE_UNAVAILABLE:
    "Un service dont dépend le projet est durablement injoignable.",
});

/**
 * Ce résolveur est le SEUL du fichier qui lise l'événement plutôt que la base.
 *
 * C'est assumé, et c'est la différence de nature : un incident technique n'a
 * pas de document métier à relire. Le fait EST la donnée — et il est déjà borné
 * et validé par le schéma du registre (codes stables, messages plafonnés, aucune
 * charge utile fournisseur).
 */
export async function resolvePlatformIncidentDevAlert({ event }) {
  const p = event?.payloadSafe ?? {};
  const base = await managerBase();
  const company = await getSingleton(Company);

  /**
   * L'alerte « impayé critique » emprunte ce même modèle : elle décrit alors
   * un incident commercial dont l'équipe doit être prévenue AVANT le client au
   * téléphone. Elle n'a ni `kind` ni `component` — on les rend explicites plutôt
   * que de laisser le rendu échouer sur une variable obligatoire absente.
   */
  const estIncidentTechnique = Boolean(p.kind);
  const kind = p.kind || 'PAYMENT_DEFAULT_CRITICAL';
  const component = p.component || `contrat ${p.reference || ''}`.trim();
  const resume = estIncidentTechnique
    ? (RESUME_PAR_NATURE[kind] || 'Incident technique durable sur ce projet.')
    : "Le délai de grâce d'un impayé est épuisé : la suspension du site est désormais possible. "
      + 'Aucune action technique n’est requise — cette alerte existe pour que le support ne soit pas pris de court.';

  return {
    'incident.kind': kind,
    'incident.component': component || 'non précisé',
    'incident.environment': p.environment || config.env,
    'incident.occurrences': String(p.occurrences ?? 1),
    'incident.firstSeenOn': instant(p.firstSeenAt || event?.occurredAt),
    'incident.errorCode': p.error?.code || 'non communiqué',
    'incident.errorMessage': p.error?.message || 'non communiqué',
    'incident.summary': resume,
    'project.name': company?.name || 'Projet',
    'manager.eventsUrl': `${base}/dev/evenements`,
  };
}

export default {
  resolvePaymentReceivedAdmin,
  resolvePaymentOverdueAdmin,
  resolvePaymentOverdueCriticalAdmin,
  resolvePaymentRecoveredAdmin,
  resolvePlatformIncidentDevAlert,
};
