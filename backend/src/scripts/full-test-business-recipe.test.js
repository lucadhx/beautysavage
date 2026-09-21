/* RECETTE MÉTIER COMPLÈTE — contrat sans signature, encaissement, cycle
 * d'impayé, et les MESSAGES que ces faits déclenchent.
 *
 * ══ CE QUE CETTE SUITE AJOUTE AUX AUTRES ═══════════════════════════════════
 *
 * `payments-flow` prouve qu'un paiement s'encaisse. `domain-events` prouve que
 * le dispatcher dispatche. `email-delivery` prouve qu'un message part. Aucune
 * ne prouve la CHAÎNE : qu'un encaissement produit un fait, que ce fait produit
 * une action, que cette action atteint la bonne population — et qu'un rejeu
 * n'en produit pas une seconde.
 *
 * C'est cette couture-là qui casse en silence : chaque maillon reste vert,
 * et le client ne reçoit rien.
 *
 * ══ LA POPULATION DES DÉVELOPPEURS EST LE CŒUR DE LA SUITE ═════════════════
 *
 * Depuis la fédération, un projet peut n'avoir AUCUN compte DEV local et une
 * équipe entière côté Panel. Une alerte technique adressée à `DEV_EMAILS`
 * n'atteindrait alors personne, sans qu'aucun test ne rougisse. Les cinq cas
 * de `resolveProjectDeveloperRecipients` sont donc éprouvés un par un.
 *
 * Panel SIMULÉ (stub officiel), aucun envoi réel, aucun réseau. Runner autonome. */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'test_base';
process.env.DB_PROD = 'prod_base';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.PORT = '4157';
process.env.CORS_ORIGINS = 'http://localhost:6061';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

// ---------------------------------------------------------------------------
const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
const { bootstrap } = await import('../config/bootstrap.js');
await connectDatabase();
await bootstrap();
await (await import('./helpers/serviceReady.helper.js')).markTestServiceReady();
await (await import('./helpers/testAccounts.helper.js')).seedTestAccounts();

/* ══════════════════════════════════════════════════════════════════════════
   UN PANEL APPAIRÉ — parce qu'envoyer un e-mail EST une capacité.

   Depuis le cutover, `sendTemplate` ne parle plus à Brevo : il demande
   `email.send_template` au Panel. Sans appairage, cette suite ne prouverait
   que l'absence de Panel. On appaire donc le VRAI runtime du pont sur le stub
   officiel : tout le chemin réel est exercé, seul le Panel distant est doublé.
   ══════════════════════════════════════════════════════════════════════════ */
const { createPanelStub } = await import('../services/panelBridge/panelStub.js');
const bridgeRuntime = await import('../services/panelBridge/bridgeRuntime.js');

const panel = createPanelStub();
bridgeRuntime.configureBridgeRuntime({ clientFactory: () => panel });
await bridgeRuntime.pairWithPanel({
  panelUrl: 'https://panel-stub.test',
  pairingCode: 'PAIR-OK',
  publicBackendUrl: 'https://projet-stub.test',
});

const { User } = await import('../models/User.model.js');
const { Company } = await import('../models/Company.model.js');
const { Contract } = await import('../models/Contract.model.js');
const { Payment } = await import('../models/Payment.model.js');
const { SiteStatus } = await import('../models/SiteStatus.model.js');
const { DomainEvent } = await import('../models/DomainEvent.model.js');
const { EventActionExecution } = await import('../models/EventActionExecution.model.js');
const { Invoice } = await import('../models/Invoice.model.js');
const { EmailDelivery } = await import('../models/EmailDelivery.model.js');
const { EmailConfiguration } = await import('../models/EmailConfiguration.model.js');
const { IntegratedApi } = await import('../models/IntegratedApi.model.js');
const { SystemConfiguration } = await import('../models/SystemConfiguration.model.js');
const { PaymentDefaultIncident } = await import('../models/PaymentDefaultIncident.model.js');
const { ExternalPrincipal } = await import('../models/ExternalPrincipal.model.js');

const { EMAIL_TEST_STATUS } = await import('../utils/emailConstants.js');
const { EXECUTION_STATUS } = await import('../utils/domainEventConstants.js');
const { PAYMENT_TYPE, PAYMENT_STATUS } = await import('../utils/contractConstants.js');
const { encryptSecret, lastFourOf } = await import('../utils/integratedApiCrypto.js');
const { makeBrevoOperational } = await import('./helpers/brevoOperational.helper.js');
const { publishDeveloperIdentity } = await import('./helpers/developerIdentity.helper.js');
const { publishClientCompany } = await import('./helpers/clientCompany.helper.js');

const paymentSvc = await import('../services/payment.service.js');
const contractSvc = await import('../services/contract.service.js');
const { applyPaymentDefaultIncidentChange } = await import(
  '../services/billing/paymentDefaultIncident.applier.js'
);
const { resolveProjectDeveloperRecipients, DEVELOPER_RECIPIENT_SOURCE } = await import(
  '../services/email/emailRecipientResolvers.js'
);
const { DOMAIN_EVENT_REGISTRY } = await import('../utils/domainEventRegistry.js');
const { DOMAIN_EVENT_ACTION_REGISTRY, validateActionRegistry } = await import(
  '../utils/domainEventActionRegistry.js'
);
/**
 * LE CONTRAT DES MODÈLES VIENT DU PANEL (L12.1).
 *
 * Il était lu dans un registre local de ce projet, supprimé avec ce lot : le
 * vocabulaire des modèles appartient au Panel, et le redéclarer ici l'aurait
 * laissé diverger — c'est exactement ce qui est arrivé aux contenus.
 */
const { loadPanelTemplateContract } = await import('./helpers/panelTemplateContract.helper.js');
const PANEL_CONTRAT = await loadPanelTemplateContract();
const { resolveVariables } = await import('../services/email/emailVariableResolvers.js');
const { processPendingEventActions } = await import('../services/events/domainEventDispatcher.service.js');
const { wakePendingActionsForContract } = await import('../services/events/pendingActionWakeup.js');

function cred(v) { return { encryptedValue: encryptSecret(v), lastFour: lastFourOf(v) }; }

/** Le décor minimal pour qu'un message puisse RÉELLEMENT partir. */
async function makeEmailReady() {
  const brevo = await IntegratedApi.findOne({ provider: 'BREVO' });
  brevo.modes.TEST.credentials.set('apiKey', cred('xkeysib-recipe-TEST-0000000000000000000000aa'));
  brevo.modes.TEST.verified = true;
  brevo.activeMode = 'TEST';
  brevo.enabled = true;
  await brevo.save();
  await makeBrevoOperational('TEST');

  await EmailConfiguration.deleteMany({});
  await EmailConfiguration.create({
    modes: {
      TEST: {
        sender: { email: 'support@exemple.fr', name: 'SB Auto' },
        test: { status: EMAIL_TEST_STATUS.DELIVERED, lastTestedAt: new Date() },
      },
    },
  });
  await SystemConfiguration.updateOne(
    {},
    { $set: { 'network.managerUrl': 'https://manager.exemple.fr' } },
    { upsert: true },
  );
  await Company.updateOne({}, { $set: { name: 'Garage de Recette' } }, { upsert: true });
  // Le prestataire SIGNE les messages : sans identité publiée, les résolveurs
  // refusent d'envoyer un e-mail signé « undefined ».
  await publishDeveloperIdentity({
    name: 'Studio de Recette',
    references: [{ label: 'Support', value: 'support@studio.test', order: 1 }],
  });
  /**
   * L’ENTREPRISE CLIENTE — exigée depuis le chantier « facturation légale ».
   *
   * Ni paiement ni signature ne s’ouvrent pour un projet sans identité
   * juridique de client. La publier ici n’assouplit rien : elle donne au
   * parcours la donnée qu’il exige désormais, exactement comme le fait
   * L.Y Solution en remplissant la fiche « Clients » avant d’encaisser.
   */
  await publishClientCompany();
}

/** Les envois LOGIQUES observés côté Panel, rejeux exclus. */
const envois = () => panel.emailSendRequests();
const envoisPour = (templateRef) => envois().filter((e) => String(e.templateRef).includes(templateRef));
const destinatairesDe = (templateRef) => envoisPour(templateRef).map((e) => e.recipient).sort();

async function resetEnvois() {
  panel.resetCapabilityCalls();
  await EmailDelivery.deleteMany({});
}

await makeEmailReady();

// ═══════════════════════════════════════════════════════════════════════════
section('§13/§20/§21 — le registre : un fait, une action, un modèle, un résolveur');
{
  check('registre d’actions cohérent', validateActionRegistry().length === 0);

  const AJOUTES = [
    'launch_fee.paid',
    'contract.payment.overdue',
    'contract.payment.overdue_critical',
    'contract.payment.recovered',
    'platform.incident.raised',
  ];
  for (const type of AJOUTES) {
    check(`« ${type} » est déclaré au registre des ÉVÉNEMENTS`, Boolean(DOMAIN_EVENT_REGISTRY[type]));
    check(`« ${type} » porte au moins une action ACTIVE`,
      (DOMAIN_EVENT_ACTION_REGISTRY[type] ?? []).some((a) => a.enabled));
  }

  /**
   * TOUTE ACTION ACTIVE DOIT POUVOIR S'EXÉCUTER.
   *
   * Un `templateId` inconnu du registre de modèles, ou un modèle sans résolveur
   * de variables, produit un DEAD_LETTER à l'exécution — c'est-à-dire un
   * message qui ne part jamais, découvert par le client qui ne l'a pas reçu.
   */
  const actionsActives = Object.values(DOMAIN_EVENT_ACTION_REGISTRY).flat().filter((a) => a.enabled);
  const actionsEmail = actionsActives.filter((a) => a.templateId);
  check(PANEL_CONTRAT.available
    ? 'tout modèle référencé par une action existe au registre du Panel'
    : `⚠ registre du Panel absent — NON VÉRIFIÉ (${PANEL_CONTRAT.reason})`,
  PANEL_CONTRAT.available
    && actionsEmail.every((a) => PANEL_CONTRAT.templateCodes().includes(a.templateId)));
  check('tout modèle référencé par une action est servi en portée PROJECT',
    PANEL_CONTRAT.available
    && actionsEmail.every((a) => PANEL_CONTRAT.templateDefinition(a.templateId)?.scopes.includes('PROJECT')));

  /**
   * ══ LE CLOISONNEMENT DES POPULATIONS, VÉRIFIÉ STATIQUEMENT ═══════════════
   *
   * Le modèle d'alerte technique nomme des composants internes et un
   * environnement. L'adresser à `ADMIN_EMAILS` enverrait « CAPABILITY_FAILURE
   * — billing.checkout.create » au garagiste. Ce n'est pas une faute qu'on
   * remarque en relecture : c'est un mot changé dans un registre.
   */
  /**
   * ══ LE CLOISONNEMENT EST DEVENU STRUCTUREL (L12.1) ════════════════════════
   *
   * Ce contrôle vérifiait que l'alerte technique était bien adressée à un
   * résolveur DEV. Il gardait une faute qu'on pouvait commettre — changer un
   * mot dans le registre — mais il masquait un défaut plus grave : cette
   * alerte ne pouvait de toute façon PAS partir, son modèle étant de portée
   * PANEL et l'appel venant d'un projet.
   *
   * Le projet ne nomme plus ce modèle du tout : il rapporte l'incident, et le
   * control plane choisit le contenu ET les destinataires. La faute n'est donc
   * plus « possible mais gardée » : elle est devenue inexprimable.
   */
  check('aucune action de ce projet ne nomme le modèle d’alerte technique',
    actionsEmail.every((a) => a.templateId !== 'PLATFORM_INCIDENT_DEV_ALERT'));
  check('l’incident est rapporté au control plane, pas envoyé',
    actionsActives.some((a) => a.actionType === 'REPORT_INCIDENT'));

  /** Le vocabulaire du client ne contient aucun identifiant fournisseur. */
  const ADMIN_TEMPLATES = [
    'PAYMENT_CONFIRMED_ADMIN',
    'CONTRACT_PAYMENT_OVERDUE_ADMIN',
    'CONTRACT_PAYMENT_OVERDUE_CRITICAL_ADMIN',
    'CONTRACT_PAYMENT_RECOVERED_ADMIN',
  ];
  check('aucun modèle client ne réclame un identifiant fournisseur',
    PANEL_CONTRAT.available
    && ADMIN_TEMPLATES.every((id) => PANEL_CONTRAT.variablesFor(id)
      .every((v) => !/stripe|paymentIntent|customerId|sessionId/i.test(v.key))));
}

// ═══════════════════════════════════════════════════════════════════════════
section('§4 — un contrat de TEST sans exigence de signature');
let contrat;
{
  const dev = await User.findOne({ role: 'DEV' });
  contrat = await contractSvc.createContract(dev, { name: 'Recette automatisée' });
  await contractSvc.updateDraft(
    contrat,
    {
      signatureRequirement: 'NOT_REQUIRED',
      launchFee: { enabled: true, amountExcludingTax: 10 },
      subscription: { enabled: false },
      taxRate: 20,
    },
    dev,
  );
  check('signature déclarée NON requise', contrat.signatureRequirement === 'NOT_REQUIRED');
  check('frais de lancement : 10 € HT → 12 € TTC',
    contrat.pricing.launchFee.amountIncludingTax === 1200);

  // Le PDF est la seule pièce exigée par la validation d'un contrat sans signature.
  contrat.document.originalFilename = 'contrat-recette.pdf';
  contrat.document.pageCount = 1;
  await contrat.save();

  await contractSvc.validateContract(contrat, dev);
  check('validation → INACTIVE (l’étape signature est SAUTÉE)', contrat.status === 'INACTIVE');
  check('aucune demande de signature créée', !contrat.yousign.signatureRequestId);
  check('aucun signataire figé', !contrat.signersSnapshot.developer && !contrat.signersSnapshot.client);

  /**
   * LA PREUVE NÉGATIVE QUI COMPTE : le projet n'a pas ESSAYÉ de signer.
   * Un contrat « sans signature » qui invoquerait quand même la capacité
   * consommerait un crédit fournisseur, et personne ne s'en apercevrait.
   */
  const signature = panel.capabilityCalls().filter((c) => String(c.code).startsWith('signature.'));
  check('aucune capacité « signature.* » invoquée', signature.length === 0);
}

// ═══════════════════════════════════════════════════════════════════════════
section('§5/§21/§23 — l’encaissement produit un fait, le fait produit UN message');
await resetEnvois();
let paiement;
{
  paiement = await Payment.create({
    contractId: contrat._id,
    type: PAYMENT_TYPE.LAUNCH_FEE,
    status: PAYMENT_STATUS.PENDING,
    // Le monde du FOURNISSEUR et celui de l'APPLICATION sont distincts par
    // conception : ici les deux valent TEST, mais le modèle exige qu'on le dise.
    provider: 'STRIPE',
    providerMode: 'TEST',
    applicationEnvironment: 'TEST',
    environment: 'TEST',
    amountExcludingTax: 1000,
    taxAmount: 200,
    amountIncludingTax: 1200,
    currency: 'EUR',
    attempt: 1,
    idempotencyKey: `launch-${contrat._id}-v0-a1-TEST`,
  });

  const r = await paymentSvc.markPaid(contrat, paiement, { customerId: 'cus_recette' });
  check('encaissement acté', r.changed === true && paiement.status === PAYMENT_STATUS.PAID);
  check('projection du contrat mise à jour', contrat.stripe.launchFee.status === 'PAID');

  const fait = await DomainEvent.findOne({ type: 'launch_fee.paid', entityId: String(contrat._id) });
  check('§21 un fait « launch_fee.paid » est émis', Boolean(fait));
  check('le fait porte la référence et le montant TTC',
    fait?.payloadSafe?.reference === contrat.reference && fait?.payloadSafe?.amountIncludingTax === 1200);
  check('le fait ne porte AUCUN identifiant fournisseur',
    !JSON.stringify(fait?.payloadSafe ?? {}).match(/cus_|pi_|cs_/));

  /* ── L12 : LE MESSAGE ATTEND SA FACTURE, IL NE PART PAS SANS ELLE ────────
   *
   * Le fournisseur annonce l'encaissement AVANT d'avoir fini d'émettre la
   * facture — sur le parcours réel, environ quatre secondes séparent les deux.
   * Le message porte un bouton « Voir ma facture » : l'expédier tout de suite
   * enverrait le client sur une liste vide, à l'instant précis où on lui
   * confirme un débit. Il douterait du paiement, et il écrirait au support.
   *
   * On prouve donc les DEUX moitiés de la doctrine : le refus d'envoyer trop
   * tôt, ET le départ dès que la facture est là. Un test qui ne prouverait que
   * la seconde laisserait passer un envoi prématuré. */
  await processPendingEventActions();

  check('§24 aucun message tant que la facture n’est pas parvenue',
    envoisPour('PAYMENT_CONFIRMED_ADMIN').length === 0);

  const enAttente = await EventActionExecution.findOne({ eventType: 'launch_fee.paid' }).lean();
  check('§24 l’exécution est REJOUABLE, jamais mise au rebut',
    enAttente?.status === EXECUTION_STATUS.FAILED && enAttente?.lastErrorSafe?.retryable === true);

  /* La facture arrive — c'est ce que fait `invoice.finalized` puis
   * `invoice.paid` sur le parcours réel, par `billing.service`. */
  await Invoice.create({
    contractId: contrat._id,
    provider: 'STRIPE',
    externalInvoiceId: 'in_recette_launch',
    number: 'RCT-0001',
    type: PAYMENT_TYPE.LAUNCH_FEE,
    amountExcludingTax: 1000,
    taxAmount: 200,
    amountIncludingTax: 1200,
    currency: 'EUR',
    status: 'PAID',
    invoiceDate: new Date(),
    paidAt: new Date(),
    hostedInvoiceUrl: 'https://invoice.exemple.test/hosted',
    invoicePdfUrl: 'https://invoice.exemple.test/pdf',
    environment: 'TEST',
  });

  /**
   * LA REPRISE EST CELLE DU RUNTIME, PAS UN RACCOURCI DE RECETTE.
   *
   * `wakePendingActionsForContract` est ce que le webhook de facture appelle
   * réellement : la donnée attendue vient d'arriver, donc ce qui l'attendait
   * redevient éligible et repart. Forcer `availableAt` à la main aurait prouvé
   * que le dispatcher sait dispatcher — pas que le produit se réveille tout
   * seul, ce qui est précisément la question.
   */
  const reveil = await wakePendingActionsForContract(contrat._id);
  check('§24 l’arrivée de la facture RÉVEILLE l’envoi en attente', reveil.awakened === 1);

  const admins = (await User.find({ role: 'ADMIN' }).lean()).map((u) => u.email).sort();
  check('§23 le message d’encaissement part au(x) administrateur(s)',
    destinatairesDe('PAYMENT_CONFIRMED_ADMIN').join(',') === admins.join(','));

  const envoi = envoisPour('PAYMENT_CONFIRMED_ADMIN')[0];
  check('§23 les variables métier sont résolues (montant, référence)',
    String(envoi?.variables?.['contract.reference']) === contrat.reference);
  check('§24 le message porte un lien de facture NON vide',
    /^https?:\/\/.+/.test(String(envoi?.variables?.['payment.invoiceUrl'] ?? '')));
  check('§18 la nature du règlement est dite, pas devinée',
    envoi?.variables?.['payment.kind'] === 'Frais de lancement');
  check('§23 aucune variable ne transporte d’identifiant fournisseur',
    !JSON.stringify(envoi?.variables ?? {}).match(/cus_|pi_|cs_|sk_test/));
}

// ═══════════════════════════════════════════════════════════════════════════
section('§22 — idempotence : rejouer un fait métier ne produit pas un second message');
{
  const avant = envoisPour('PAYMENT_CONFIRMED_ADMIN').length;

  // 1. le webhook rejoué : `markPaid` sur un paiement déjà PAYÉ.
  const rejeu = await paymentSvc.markPaid(contrat, paiement, { customerId: 'cus_recette' });
  check('un webhook rejoué ne re-marque rien', rejeu.changed === false);

  // 2. la reprise du dispatcher, qui ne doit rien re-matérialiser.
  await processPendingEventActions();

  const faits = await DomainEvent.countDocuments({ type: 'launch_fee.paid' });
  check('un seul fait en base malgré le rejeu', faits === 1);
  check('§22 aucun second message', envoisPour('PAYMENT_CONFIRMED_ADMIN').length === avant);

  const execs = await EventActionExecution.countDocuments({ eventType: 'launch_fee.paid' });
  const adminCount = await User.countDocuments({ role: 'ADMIN' });
  check('une exécution par destinataire, pas une de plus', execs === adminCount);
}

// ═══════════════════════════════════════════════════════════════════════════
section('§11/§27 — l’impayé : trois transitions, trois messages, et rien entre');
const siteAvantImpaye = (await SiteStatus.findOne({}).lean());
const INCIDENT = 'pd-recette-1';
const jour = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

/** Une livraison du Panel, telle que le pont la remet à l'applicateur. */
function livraison(patch, ordre) {
  return {
    change: {
      entityId: INCIDENT,
      entityType: 'PAYMENT_DEFAULT_INCIDENT',
      modifiedAt: iso(Date.now() + ordre * 1000),
      payload: {
        paymentDefaultId: INCIDENT,
        contractId: String(contrat._id),
        amountDueCents: 11880,
        currency: 'EUR',
        invoiceNumber: 'RECETTE-0001',
        graceDaysSnapshot: 7,
        reason: 'Défaut de paiement',
        ...patch,
      },
    },
  };
}

await resetEnvois();
{
  await applyPaymentDefaultIncidentChange(livraison({
    status: 'OPEN', attemptCount: 1,
    firstFailedAt: iso(Date.now() - jour), lastFailedAt: iso(Date.now() - jour),
    graceDeadlineAt: iso(Date.now() + 6 * jour), causeActive: false,
  }, 1));
  await processPendingEventActions();

  check('§11 ouverture de l’impayé → message « paiement en échec »',
    envoisPour('CONTRACT_PAYMENT_OVERDUE_ADMIN').length === 1);
  check('…et AUCUNE alerte technique à ce stade',
    envoisPour('PLATFORM_INCIDENT_DEV_ALERT').length === 0);

  /**
   * ══ LA RELIVRAISON, C'EST-À-DIRE LE CAS RÉEL ═════════════════════════════
   * Le Panel relivre l'incident à chaque observation du fournisseur. Trois
   * relivraisons identiques ne doivent produire AUCUN message : c'est la
   * différence entre notifier une situation et harceler un client.
   */
  for (let i = 0; i < 3; i++) {
    await applyPaymentDefaultIncidentChange(livraison({
      status: 'OPEN', attemptCount: 2 + i,
      firstFailedAt: iso(Date.now() - jour), lastFailedAt: iso(Date.now()),
      graceDeadlineAt: iso(Date.now() + 6 * jour), causeActive: false,
    }, 2 + i));
  }
  await processPendingEventActions();
  check('§27 trois relivraisons du MÊME état → toujours un seul message',
    envoisPour('CONTRACT_PAYMENT_OVERDUE_ADMIN').length === 1);
}

{
  await applyPaymentDefaultIncidentChange(livraison({
    status: 'GRACE_EXPIRED', attemptCount: 4,
    firstFailedAt: iso(Date.now() - 9 * jour), lastFailedAt: iso(Date.now() - jour),
    graceDeadlineAt: iso(Date.now() - 2 * jour),
    suspensionRequestedAt: iso(Date.now() - 2 * jour), suspensionConfirmedAt: null,
    causeActive: true,
  }, 10));
  await processPendingEventActions();

  check('§11 grâce épuisée → message « action requise » au client',
    envoisPour('CONTRACT_PAYMENT_OVERDUE_CRITICAL_ADMIN').length === 1);
  /**
   * ══ ET AUCUNE ALERTE TECHNIQUE — C'EST UNE DÉCISION, PAS UN OUBLI ════════
   *
   * Le Panel prévient déjà toute son équipe (`SITE_SUSPENDED_PAYMENT_DEFAULT_
   * TEAM`) quand la suspension est confirmée. Un second message émis d'ici
   * toucherait la même population, pour le même incident, depuis le côté qui
   * n'est pas l'autorité. Ce test verrouille l'absence.
   */
  check('§14 aucune alerte technique doublonnant celle du Panel',
    envoisPour('PLATFORM_INCIDENT_DEV_ALERT').length === 0);

  /**
   * DEMANDÉE ≠ APPLIQUÉE. La suspension n'est pas confirmée : le message ne
   * doit pas affirmer une fermeture. La phrase est produite par le résolveur,
   * et c'est elle qu'on lit — pas un booléen.
   */
  const critique = envoisPour('CONTRACT_PAYMENT_OVERDUE_CRITICAL_ADMIN')[0];
  const phrase = String(critique?.variables?.['incident.serviceState'] ?? '');
  check('§11 le message n’affirme pas une fermeture non confirmée',
    /en cours d’application|en cours d'application/.test(phrase));
}

{
  await applyPaymentDefaultIncidentChange(livraison({
    status: 'RESOLVED', attemptCount: 4,
    firstFailedAt: iso(Date.now() - 9 * jour), lastFailedAt: iso(Date.now() - jour),
    graceDeadlineAt: iso(Date.now() - 2 * jour),
    suspensionRequestedAt: iso(Date.now() - 2 * jour),
    resolvedAt: iso(Date.now()), resolution: 'PAID', causeActive: false,
  }, 20));
  await processPendingEventActions();

  check('§11 régularisation → message de clôture',
    envoisPour('CONTRACT_PAYMENT_RECOVERED_ADMIN').length === 1);

  const cloture = envoisPour('CONTRACT_PAYMENT_RECOVERED_ADMIN')[0];
  check('§11 le message de clôture ne parle pas d’un rétablissement qui n’a pas eu lieu',
    /rest[ée] accessible/.test(String(cloture?.variables?.['incident.serviceState'] ?? '')));
}

{
  /**
   * ══ LE POINT LE PLUS IMPORTANT DE TOUTE LA SUITE ═════════════════════════
   *
   * Un cycle d'impayé complet vient de se dérouler, avec une cause déclarée
   * ACTIVE par le Panel. L'accessibilité du site n'a pas bougé d'un octet :
   * l'applicateur d'INCIDENT ne ferme rien, et seul l'applicateur de CAUSE le
   * ferait. C'est ce qui permet d'éprouver l'UX de retard sans jamais couper
   * un site réel.
   */
  const apres = await SiteStatus.findOne({}).lean();
  check('§12 l’accessibilité du site n’a pas bougé de tout le cycle',
    apres.status === siteAvantImpaye.status
    && apres.causes.paymentDefault === siteAvantImpaye.causes.paymentDefault
    && apres.paymentDefault.active === siteAvantImpaye.paymentDefault.active);
}

// ═══════════════════════════════════════════════════════════════════════════
section('§16→§19 — QUI est développeur de CE projet : natifs et fédérés');
{
  await ExternalPrincipal.deleteMany({});

  // 1. le natif — il existe déjà (`dev@mail.com`).
  // 2. un fédéré AUTORISÉ : sa projection n'existe que parce que le Panel a
  //    émis une assertion d'audience = ce projet.
  await ExternalPrincipal.create({
    externalUserId: 'panel-dev-autorise',
    role: 'DEV',
    enabled: true,
    displayName: 'Dev fédéré',
    email: 'federe@ly-solution.test',
  });
  // 3. un compte DÉSACTIVÉ côté Panel.
  await ExternalPrincipal.create({
    externalUserId: 'panel-dev-revoque',
    role: 'DEV',
    enabled: false,
    displayName: 'Dev révoqué',
    email: 'revoque@ly-solution.test',
  });
  // 4. un DOUBLON : la même personne, des deux côtés.
  await ExternalPrincipal.create({
    externalUserId: 'panel-dev-doublon',
    role: 'DEV',
    enabled: true,
    displayName: 'Doublon fédéré',
    email: 'dev@mail.com',
  });
  // 5. le dev Panel NON autorisé sur ce projet n'est représenté NULLE PART —
  //    c'est précisément la propriété testée : il n'a pas de projection.

  const { recipients, sources } = await resolveProjectDeveloperRecipients();
  const adresses = recipients.map((r) => r.email).sort();

  check('§19 le développeur NATIF est destinataire', adresses.includes('dev@mail.com'));
  check('§19 le développeur FÉDÉRÉ autorisé est destinataire',
    adresses.includes('federe@ly-solution.test'));
  check('§19 le compte RÉVOQUÉ est exclu', !adresses.includes('revoque@ly-solution.test'));
  check('§19 le dev Panel NON autorisé est exclu (aucune projection)',
    !adresses.some((a) => a.includes('non-autorise')));
  check('§19 le doublon ne produit QU’UNE adresse',
    adresses.filter((a) => a === 'dev@mail.com').length === 1);

  check('§45 la provenance de chaque destinataire est traçable',
    sources.find((s) => s.email === 'dev@mail.com')?.source === DEVELOPER_RECIPIENT_SOURCE.NATIVE
    && sources.find((s) => s.email === 'federe@ly-solution.test')?.source === DEVELOPER_RECIPIENT_SOURCE.FEDERATED);

  /**
   * LE CAS QUI JUSTIFIE TOUT LE RÉSOLVEUR : un projet SANS compte DEV local.
   * `DEV_EMAILS` n'y trouverait personne, et l'alerte technique n'atteindrait
   * aucune boîte — sans qu'aucune erreur ne soit levée nulle part.
   */
  /**
   * On passe par le PILOTE, pas par le modèle : réinsérer un compte via
   * `User.create` le ferait re-valider et re-hacher: le décor reviendrait
   * différent de ce qu'il était. Ici, les documents sont retirés puis remis
   * À L'IDENTIQUE — c'est un décor de test, pas une opération métier.
   */
  const natifs = await User.collection.find({ role: 'DEV' }).toArray();
  await User.collection.deleteMany({ role: 'DEV' });
  const sansNatif = await resolveProjectDeveloperRecipients();
  check('§17 un projet sans DEV local reste joignable par ses fédérés',
    sansNatif.recipients.some((r) => r.email === 'federe@ly-solution.test'));
  check('§17 …et un projet sans DEV local n’a AUCUN destinataire via DEV_EMAILS',
    (await User.countDocuments({ role: 'DEV' })) === 0);
  if (natifs.length) await User.collection.insertMany(natifs);
}

// ═══════════════════════════════════════════════════════════════════════════
section('§24/§26 — l’incident technique est RAPPORTÉ au control plane (L12.1)');
await resetEnvois();
{
  /**
   * ══ CE QUE CETTE SECTION PROUVAIT, ET POURQUOI C'ÉTAIT FAUX ═══════════════
   *
   * Elle vérifiait que l'alerte `PLATFORM_INCIDENT_DEV_ALERT` atteignait les
   * développeurs natifs ET fédérés, en évitant les administrateurs du client.
   * Elle passait — parce qu'elle observait un dispatcher local, avec un envoi
   * simulé.
   *
   * En production, cet envoi n'a JAMAIS abouti : le modèle est de portée PANEL
   * (c'est L.Y Solution qui parle à l'équipe technique), et un projet ne peut
   * pas demander une portée PANEL. Chaque incident finissait en refus
   * silencieux. Un test vert sur un chemin mort — le pire résultat possible.
   *
   * ══ CE QU'ELLE PROUVE MAINTENANT ══════════════════════════════════════════
   *
   * Que ce projet RAPPORTE le fait, sans nommer de modèle ni de destinataire,
   * et qu'il n'envoie aucun e-mail lui-même. Le choix du contenu et des
   * destinataires appartient au Panel — sa moitié de la preuve est éprouvée
   * dans sa propre recette, sur son adaptateur d'envoi.
   */
  const incidents = [];
  const sync = await import('../services/projectBridge/projectSync.service.js');
  sync.configureProjectSync({
    enqueueProjection: async (change) => { incidents.push(change); return { queued: true }; },
    flush: () => {},
  });

  const { emitAndDispatch } = await import('../services/events/domainEvent.service.js');
  const chargeIncident = {
    kind: 'CAPABILITY_FAILURE',
    component: 'billing.checkout.create',
    environment: 'TEST',
    occurrences: 3,
    firstSeenAt: '2026-08-22T09:00:00.000Z',
    error: { code: 'BRIDGE_UNAVAILABLE', message: 'Le Panel n’a pas répondu après 3 tentatives.' },
  };

  await emitAndDispatch({
    type: 'platform.incident.raised',
    entityType: 'Platform',
    entityId: 'billing.checkout.create',
    payloadSafe: chargeIncident,
    idempotencyKey: 'recette-incident-1',
  });
  await processPendingEventActions();

  const rapportes = incidents.filter((c) => c.entityType === 'PLATFORM_INCIDENT');
  check('§24 l’incident est mis en file vers le control plane', rapportes.length === 1);
  check('§24 il porte les FAITS', rapportes[0]?.payload?.kind === 'CAPABILITY_FAILURE'
    && rapportes[0]?.payload?.component === 'billing.checkout.create');
  check('§24 il ne nomme AUCUN modèle',
    !JSON.stringify(rapportes[0]?.payload ?? {}).includes('TEMPLATE')
    && !('templateId' in (rapportes[0]?.payload ?? {})));
  check('§24 il ne nomme AUCUN destinataire',
    !('recipient' in (rapportes[0]?.payload ?? {}))
    && !JSON.stringify(rapportes[0]?.payload ?? {}).includes('@'));
  check('§24 il porte l’événement d’origine, pour la corrélation',
    typeof rapportes[0]?.payload?.eventId === 'string');

  /** §15 — AUCUN e-mail ne part du projet pour un incident technique. */
  check('§15 aucun e-mail n’est envoyé par ce projet',
    destinatairesDe('PLATFORM_INCIDENT_DEV_ALERT').length === 0);

  /**
   * §22 — LE MÊME INCIDENT CONVERGE SUR LA MÊME IDENTITÉ.
   *
   * L'`entityId` est dérivé des faits (nature, composant, première
   * observation, palier d'occurrences). Deux rapports identiques désignent donc
   * la même entité : la file les déduplique, et le Panel n'alerte qu'une fois.
   */
  await emitAndDispatch({
    type: 'platform.incident.raised',
    entityType: 'Platform',
    entityId: 'billing.checkout.create',
    payloadSafe: chargeIncident,
    idempotencyKey: 'recette-incident-2',
  });
  await processPendingEventActions();

  const tous = incidents.filter((c) => c.entityType === 'PLATFORM_INCIDENT');
  check('§22 un incident identique reprend la MÊME identité',
    tous.length === 2 && tous[0].entityId === tous[1].entityId);

  sync.resetProjectSync();
}

// ═══════════════════════════════════════════════════════════════════════════
section('§20 — chaque modèle ajouté sait se rendre avec des valeurs RÉELLES');
{
  const evenementPaiement = await DomainEvent.findOne({ type: 'launch_fee.paid' });
  const evenementImpaye = await DomainEvent.findOne({ type: 'contract.payment.overdue' });
  const evenementCritique = await DomainEvent.findOne({ type: 'contract.payment.overdue_critical' });
  const evenementClos = await DomainEvent.findOne({ type: 'contract.payment.recovered' });
  const evenementIncident = await DomainEvent.findOne({ type: 'platform.incident.raised' });

  const cas = [
    ['PAYMENT_CONFIRMED_ADMIN', evenementPaiement],
    ['CONTRACT_PAYMENT_OVERDUE_ADMIN', evenementImpaye],
    ['CONTRACT_PAYMENT_OVERDUE_CRITICAL_ADMIN', evenementCritique],
    ['CONTRACT_PAYMENT_RECOVERED_ADMIN', evenementClos],
  ];

  for (const [templateId, event] of cas) {
    const requises = PANEL_CONTRAT.variablesFor(templateId)
      .filter((v) => v.required).map((v) => v.key);
    let valeurs = null;
    try { valeurs = await resolveVariables({ templateId, context: { event } }); } catch { /* laissé null */ }
    check(`« ${templateId} » : toutes les variables obligatoires sont résolues`,
      Boolean(valeurs) && requises.every((k) => valeurs.has(k) && valeurs.get(k) !== undefined && valeurs.get(k) !== ''));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
section('§32/§49 — la recette se nettoie derrière elle');
{
  await Invoice.deleteMany({ externalInvoiceId: /^in_recette/ });
  await EventActionExecution.deleteMany({});
  await DomainEvent.deleteMany({
    type: {
      $in: [
        'launch_fee.paid', 'contract.payment.overdue',
        'contract.payment.overdue_critical', 'contract.payment.recovered',
        'platform.incident.raised',
      ],
    },
  });
  await PaymentDefaultIncident.deleteMany({ paymentDefaultId: INCIDENT });
  await Payment.deleteMany({ contractId: contrat._id });
  await Contract.deleteOne({ _id: contrat._id });
  await ExternalPrincipal.deleteMany({});

  check('§49 aucun contrat de recette restant', (await Contract.countDocuments()) === 0);
  check('§49 aucun paiement de recette restant', (await Payment.countDocuments()) === 0);
  check('§49 aucun incident de recette restant', (await PaymentDefaultIncident.countDocuments()) === 0);
  check('§35 aucune exécution d’action en attente',
    (await EventActionExecution.countDocuments({
      status: { $in: [EXECUTION_STATUS.PENDING, EXECUTION_STATUS.PROCESSING] },
    })) === 0);
}

// ---------------------------------------------------------------------------
await disconnectDatabase();
await mongod.stop();
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
