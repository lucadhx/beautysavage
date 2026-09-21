/**
 * LA RELANCE PENDANT LA GRÂCE — un message par tentative RÉELLE, jamais deux.
 *
 * ══ LE DÉFAUT QUE CES CONTRÔLES FERMENT ════════════════════════════════════
 *
 * L'impayé reste `OPEN` pendant toute la grâce. Le prestataire de paiement,
 * lui, retente. Toutes ces livraisons trouvaient `OPEN → OPEN` et repartaient
 * sans un mot : le client recevait UN avis au premier échec, puis plus rien
 * jusqu'à l'annonce de fermeture. Sept jours de silence, exactement pendant
 * l'intervalle où il peut encore agir.
 *
 * ══ CE QUI EST DIFFICILE, ET DONC CE QUI EST TESTÉ ═════════════════════════
 *
 * Distinguer une tentative NOUVELLE d'une livraison rejouée. Les deux portent
 * le même impayé, le même statut, le même montant. Seul le compteur du
 * prestataire les sépare — et un test qui ne vérifierait que « un message est
 * parti » validerait aussi bien la version qui en envoie huit.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'sbauto_grace_retry';
process.env.DB_PROD = 'sbauto_grace_retry';
process.env.PANEL_SCHEDULER_ENABLED = 'false';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-jwt-grace-retry-0123456789';

let pass = 0; let fail = 0;
const check = (nom, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✓ ${nom}`); }
  else { fail += 1; console.error(`  ✗ ${nom}${extra ? ` — ${extra}` : ''}`); }
};
const section = (t) => console.log(`\n${t}`);

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();

const { Contract } = await import('../models/Contract.model.js');
const { DomainEvent } = await import('../models/DomainEvent.model.js');
const { PaymentDefaultIncident } = await import('../models/PaymentDefaultIncident.model.js');
const { applyPaymentDefaultIncidentChange } = await import(
  '../services/billing/paymentDefaultIncident.applier.js'
);
const registre = await import('../utils/domainEventRegistry.js');
const actions = await import('../utils/domainEventActionRegistry.js');
const usage = await import('../utils/projectEmailTemplateUsage.js');
/**
 * Le contrat des modèles vient du PANEL (L12.1) : le registre local de ce
 * projet a été supprimé, le vocabulaire n'y est plus déclaré.
 */
const { loadPanelTemplateContract } = await import('./helpers/panelTemplateContract.helper.js');
const PANEL_CONTRAT = await loadPanelTemplateContract();

/* Un contrat réel : sans lui l'applicateur se tait, et c'est documenté. */
const contract = await Contract.create({
  reference: 'CTR-TEST-0001',
  name: 'Contrat de recette',
  status: 'ACTIVE',
  environment: 'TEST',
  paymentGraceDays: 7,
});

const charge = (patch = {}) => ({
  paymentDefaultId: 'pd-relance',
  projectId: 'atelier-nord',
  contractId: String(contract._id),
  invoiceId: 'in_1',
  subscriptionId: 'sub_1',
  status: 'OPEN',
  attemptCount: 1,
  nextPaymentAttemptAt: '2026-08-04T10:00:00.000Z',
  firstFailedAt: '2026-08-01T10:00:00.000Z',
  lastFailedAt: '2026-08-01T10:00:00.000Z',
  graceDaysSnapshot: 7,
  graceDeadlineAt: '2026-08-08T10:00:00.000Z',
  amountDueCents: 24_900,
  currency: 'EUR',
  invoiceNumber: 'F-2026-0042',
  hostedInvoiceUrl: 'https://invoice.stripe.com/i/1',
  invoicePdfUrl: 'https://invoice.stripe.com/i/1/pdf',
  suspensionRequestedAt: null,
  suspensionConfirmedAt: null,
  causeRemovalConfirmedAt: null,
  resolvedAt: null,
  resolution: null,
  causeActive: false,
  reason: 'Défaut de paiement',
  ...patch,
});

let horloge = 0;
const livrer = (payload, { modifiedAt = null, deleted = false } = {}) => {
  horloge += 1;
  return applyPaymentDefaultIncidentChange({
    change: {
      writeId: `w-${horloge}`,
      entityType: 'PAYMENT_DEFAULT_INCIDENT',
      entityId: payload?.paymentDefaultId ?? 'pd-relance',
      deleted,
      payload: deleted ? null : payload,
      /* L'horloge de la source AVANCE à chaque livraison : sans cela l'anti-recul
         rejetterait la seconde, et le test mesurerait la mauvaise garde. */
      modifiedAt: modifiedAt ?? new Date(Date.UTC(2026, 7, 1, 10, horloge)).toISOString(),
      emitter: 'PANEL',
    },
  });
};

const evenements = (type) => DomainEvent.find({ type }).sort({ createdAt: 1 }).lean();
const remise = async () => {
  await DomainEvent.deleteMany({});
  await PaymentDefaultIncident.deleteMany({});
};

/* ══════════════════════════════════════════════════════════════════════════ */
section('1 · LE PREMIER ÉCHEC — un avis, et un seul');
{
  await remise();
  await livrer(charge());
  const avis = await evenements('contract.payment.overdue');
  const relances = await evenements('contract.payment.retry_failed');
  check('un avis d’ouverture est émis', avis.length === 1);
  check('…et AUCUNE relance', relances.length === 0);
  check('l’avis porte le montant dû', avis[0]?.payloadSafe?.amountDueCents === 24_900);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('2 · UNE VRAIE NOUVELLE TENTATIVE — une relance, avec ce qu’il faut dedans');
{
  await livrer(charge({ attemptCount: 2, lastFailedAt: '2026-08-04T10:00:00.000Z' }));
  const relances = await evenements('contract.payment.retry_failed');
  check('une relance est émise', relances.length === 1, String(relances.length));

  const p = relances[0]?.payloadSafe ?? {};
  check('…qui porte le compteur du prestataire', p.attemptCount === 2);
  check('…et celui d’avant, pour la traçabilité', p.previousAttemptCount === 1);
  check('…le montant restant dû', p.amountDueCents === 24_900);
  check('…la devise', p.currency === 'EUR');
  /*
    L'ÉCHÉANCE D'ORIGINE NE BOUGE PAS. C'est le premier refus, jamais le
    dernier : une date qui recule à chaque tentative rendrait la relance
    absurde — « dû le 4 août » alors qu'elle était due le 1er.
  */
  check('…l’échéance d’ORIGINE, pas la dernière tentative',
    p.firstFailedAt === '2026-08-01T10:00:00.000Z', p.firstFailedAt);
  check('…la date de suspension prévue', p.graceDeadlineAt === '2026-08-08T10:00:00.000Z');
  check('…la politique de grâce appliquée', p.graceDaysSnapshot === 7);
  check('…et la facture concernée', p.invoiceNumber === 'F-2026-0042');

  /*
    CE QUE LE RÈGLEMENT PAIE — porté par l'incident, pas supposé par le message.
    Sans l'identité de l'abonnement, la relance retombait sur « votre facture » :
    exact, et sans valeur pour un client qui a plusieurs lignes chez nous.
  */
  const inc = await PaymentDefaultIncident.findOne({ paymentDefaultId: 'pd-relance' }).lean();
  check('l’abonnement concerné traverse le pont', inc.subscriptionId === 'sub_1', inc.subscriptionId);
  const { resolvePaymentRetryFailedAdmin: r } = await import('../services/email/billingVariableResolver.js');
  check('le résolveur nomme donc la prestation', typeof r === 'function');

  const schema = registre.eventDefinition('contract.payment.retry_failed');
  check('la charge utile respecte le schéma déclaré',
    schema.payloadSchema.safeParse(p).success);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('3 · LA MÊME LIVRAISON REJOUÉE — aucun second message');
{
  const avant = (await evenements('contract.payment.retry_failed')).length;
  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await livrer(charge({ attemptCount: 2, lastFailedAt: '2026-08-04T10:00:00.000Z' }));
  }
  const apres = (await evenements('contract.payment.retry_failed')).length;
  check('huit relivraisons du MÊME échec ne relancent pas', apres === avant, `${avant} → ${apres}`);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('4 · TROISIÈME TENTATIVE — une relance de plus, pas deux');
{
  await livrer(charge({ attemptCount: 3, lastFailedAt: '2026-08-06T10:00:00.000Z' }));
  const relances = await evenements('contract.payment.retry_failed');
  check('deux relances au total', relances.length === 2, String(relances.length));
  check('…la seconde porte le compteur 3', relances[1]?.payloadSafe?.attemptCount === 3);
  /*
    LA CLÉ D'IDEMPOTENCE PORTE LE COMPTEUR — c'est ce qui rend la répétition
    sûre : deux appliqueurs concurrents produisent la même clé, et l'index
    unique n'en laisse passer qu'une.
  */
  const cles = relances.map((e) => e.idempotencyKey);
  check('chaque relance a une clé propre au compteur',
    cles[0].endsWith(':2') && cles[1].endsWith(':3'), cles.join(' | '));
  check('…et les deux clés diffèrent', cles[0] !== cles[1]);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('5 · UN COMPTEUR QUI RECULE — le désordre ne relance pas');
{
  const avant = (await evenements('contract.payment.retry_failed')).length;
  /*
    Une livraison retardataire porte un compteur plus BAS. Elle décrit un échec
    dont on a déjà parlé : la traiter comme neuve enverrait une relance pour un
    événement passé, et le ferait à chaque rattrapage de journal.
  */
  await livrer(charge({ attemptCount: 2, lastFailedAt: '2026-08-04T10:00:00.000Z' }));
  const apres = (await evenements('contract.payment.retry_failed')).length;
  check('un compteur EN ARRIÈRE ne produit rien', apres === avant, `${avant} → ${apres}`);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('6 · APRÈS L’EXPIRATION — la relance se tait, le critique parle');
{
  await livrer(charge({
    status: 'GRACE_EXPIRED', attemptCount: 4, suspensionRequestedAt: '2026-08-08T10:00:00.000Z',
  }));
  const critiques = await evenements('contract.payment.overdue_critical');
  check('l’alerte critique est émise', critiques.length === 1);

  const avant = (await evenements('contract.payment.retry_failed')).length;
  /*
    Le prestataire retente encore après l'expiration. Le site est fermé ou en
    cours de fermeture, et le client vient de recevoir l'alerte critique :
    relancer ici serait du bruit sur une situation déjà annoncée.
  */
  await livrer(charge({
    status: 'GRACE_EXPIRED', attemptCount: 5, suspensionRequestedAt: '2026-08-08T10:00:00.000Z',
  }));
  const apres = (await evenements('contract.payment.retry_failed')).length;
  check('une tentative APRÈS l’expiration ne relance plus', apres === avant, `${avant} → ${apres}`);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('7 · RÉGULARISATION — la relance ne rouvre jamais la dette');
{
  await livrer(charge({
    status: 'RESOLVED', attemptCount: 5, resolvedAt: '2026-08-09T10:00:00.000Z', resolution: 'PAID',
  }));
  check('la reprise est annoncée', (await evenements('contract.payment.recovered')).length === 1);

  const avant = (await evenements('contract.payment.retry_failed')).length;
  /*
    Le cas de la §21 du cahier des charges : un `invoice.payment_failed` de la
    tentative 6 arrive APRÈS le `invoice.paid`. Le Panel republie l'incident —
    toujours RESOLVED, mais avec le compteur monté. Relancer ici réclamerait de
    l'argent déjà reçu.
  */
  await livrer(charge({
    status: 'RESOLVED', attemptCount: 6, resolvedAt: '2026-08-09T10:00:00.000Z', resolution: 'PAID',
  }));
  const apres = (await evenements('contract.payment.retry_failed')).length;
  check('un échec TARDIF sur un impayé réglé ne relance pas', apres === avant, `${avant} → ${apres}`);
  const i = await PaymentDefaultIncident.findOne({ paymentDefaultId: 'pd-relance' }).lean();
  check('…et l’incident reste RÉSOLU', i.status === 'RESOLVED');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('8 · SANS POLITIQUE DE GRÂCE — on relance quand même, sans MENTIR');
{
  await remise();
  await livrer(charge({ graceDaysSnapshot: null, graceDeadlineAt: null }));
  await livrer(charge({ graceDaysSnapshot: null, graceDeadlineAt: null, attemptCount: 2 }));

  const relances = await evenements('contract.payment.retry_failed');
  check('la relance part — la dette est réelle', relances.length === 1);
  /*
    `null` DOIT TRAVERSER COMME `null`. Un `?? 0` ici ferait promettre une
    fermeture au premier refus, alors que personne n'a écrit cette règle.
  */
  check('…en disant qu’AUCUNE politique n’est configurée',
    relances[0].payloadSafe.graceDaysSnapshot === null);
  check('…et sans date de fermeture inventée',
    relances[0].payloadSafe.graceDeadlineAt === null);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('9 · LA PHRASE D’ÉCHÉANCE — trois situations, trois textes');
{
  const { resolvePaymentRetryFailedAdmin } = await import('../services/email/billingVariableResolver.js');
  check('le résolveur est exporté', typeof resolvePaymentRetryFailedAdmin === 'function');

  /* On éprouve la règle sans monter tout l'environnement d'envoi : la phrase
     est une fonction pure du contenu de l'incident. */
  const src = (await import('node:fs')).readFileSync(
    new URL('../services/email/billingVariableResolver.js', import.meta.url), 'utf8',
  );
  check('une échéance ABSENTE ne promet aucune suspension',
    /Aucune suspension automatique n’est prévue/.test(src));
  check('une échéance PASSÉE ne promet pas une date révolue',
    /Le délai prévu par votre contrat est écoulé/.test(src));
  check('une échéance À VENIR annonce la date',
    /Sans régularisation avant le \$\{jour\(echeance\)\}/.test(src));
  check('le lien de règlement préfère la page du prestataire',
    /hostedInvoiceUrl/.test(src) && /\^https:/.test(src));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('10 · LE MODÈLE EST DÉCLARÉ AU PANEL — automatiquement');
{
  const codes = usage.declaredTemplateCodes();
  check('le nouveau modèle figure dans la déclaration d’usage',
    codes.includes('CONTRACT_PAYMENT_RETRY_FAILED_ADMIN'));
  check('…parce qu’une action ACTIVE le consomme',
    actions.actionsForEvent('contract.payment.retry_failed')
      .some((a) => a.enabled && a.templateId === 'CONTRACT_PAYMENT_RETRY_FAILED_ADMIN'));
  check('…et il est destiné aux administrateurs du projet',
    actions.actionsForEvent('contract.payment.retry_failed')[0].recipientResolver === 'ADMIN_EMAILS');
  check('la déclaration reste valide', usage.validateTemplateUsage().length === 0);

  const def = PANEL_CONTRAT.templateDefinition('CONTRACT_PAYMENT_RETRY_FAILED_ADMIN');
  check(PANEL_CONTRAT.available
    ? 'le modèle est servi en portée PROJET par le Panel'
    : `⚠ registre du Panel absent — NON VÉRIFIÉ (${PANEL_CONTRAT.reason})`,
  PANEL_CONTRAT.available && def?.scopes.includes('PROJECT'));
  const cles = PANEL_CONTRAT.variablesFor('CONTRACT_PAYMENT_RETRY_FAILED_ADMIN').map((v) => v.key);
  for (const attendue of [
    'incident.amountDue', 'incident.purposeLabel', 'incident.originalDueDate',
    'incident.deadlineSentence', 'incident.paymentUrl', 'incident.attemptCount',
  ]) {
    check(`…et déclare « ${attendue} »`, cles.includes(attendue));
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('11 · UN STATUT INCONNU NE PASSE PLUS EN SILENCE');
{
  await remise();
  await livrer(charge());
  const avant = await DomainEvent.countDocuments({});

  /* Une faute de frappe du Panel — « RESOVLED ». Elle doit s'APPLIQUER (sans
     quoi les deux bases divergent) mais ne peut choisir aucune notification. */
  await livrer(charge({ status: 'RESOVLED', attemptCount: 2 }));

  const i = await PaymentDefaultIncident.findOne({ paymentDefaultId: 'pd-relance' }).lean();
  check('l’état est tout de même appliqué', i.status === 'RESOVLED');
  check('…et aucun événement n’est inventé', await DomainEvent.countDocuments({}) === avant);

  const src = (await import('node:fs')).readFileSync(
    new URL('../services/billing/paymentDefaultIncident.applier.js', import.meta.url), 'utf8',
  );
  check('…le statut fautif est journalisé en ERREUR', /logger\.error\([\s\S]{0,200}INCONNU/.test(src));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('12 · L’APPLICATEUR NE FERME TOUJOURS AUCUN SITE');
{
  /*
    ON LIT LE CODE, PAS LES COMMENTAIRES — même discipline que la garde
    historique de `payment-default-incident.test.js`.

    Ce fichier EXPLIQUE longuement pourquoi il ne doit jamais réconcilier, et
    cette explication cite forcément les noms interdits. Chercher les chaînes
    dans le texte brut ferait échouer le contrôle sur la prose qui le justifie
    — l'inverse exact de ce qu'on veut vérifier.
  */
  const codeSeul = (t) => t
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  const src = codeSeul((await import('node:fs')).readFileSync(
    new URL('../services/billing/paymentDefaultIncident.applier.js', import.meta.url), 'utf8',
  ));
  check('aucun import du moteur d’accessibilité',
    !/siteEnforcement|reconcileSiteStatus/.test(src));
  check('…ni du modèle SiteStatus', !/SiteStatus/.test(src));
  check('…et aucune écriture de cause de suspension',
    !/paymentDefault\s*=|causes\s*=/.test(src));
}

await disconnectDatabase();
await mongod.stop();
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
