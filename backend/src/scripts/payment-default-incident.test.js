/**
 * L10.6B-3 — L'INCIDENT ARRIVE, ET IL NE FERME RIEN.
 *
 * ══ CE QUE CES CONTRÔLES VERROUILLENT ══════════════════════════════════════
 *
 *   · qu'un incident reçu pendant la GRÂCE ne suspende AUCUN site — c'est très
 *     exactement ce que le délai de grâce existe pour garantir ;
 *   · que l'applicateur d'incident ne touche jamais le moteur d'accessibilité,
 *     et que le code le prouve (aucun import, aucun appel) ;
 *   · que `null` reste `null` et `0` reste `0` sur toute la chaîne ;
 *   · que huit livraisons identiques ne produisent aucun second effet ;
 *   · qu'une livraison PLUS ANCIENNE arrivée après une récente ne fasse
 *     RÉGRESSER aucun état ;
 *   · que le chemin hors ligne converge par le MÊME applicateur que le direct ;
 *   · qu'une lecture ne mute rien.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = process.env.DB_TEST || 'sbauto_payment_default_incident';
process.env.DB_PROD = process.env.DB_PROD || 'sbauto_payment_default_incident';
process.env.PANEL_SCHEDULER_ENABLED = 'false';
process.env.JWT_SECRET = process.env.JWT_SECRET
  || 'test-payment-default-incident-0123456789abcdef';

let pass = 0; let fail = 0;
const check = (nom, cond) => {
  if (cond) { pass += 1; console.log(`  ✓ ${nom}`); }
  else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (t) => console.log(`\n${t}`);

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();

const { SiteStatus } = await import('../models/SiteStatus.model.js');
const { PaymentDefaultIncident } = await import('../models/PaymentDefaultIncident.model.js');
const { getSingleton } = await import('../utils/singleton.js');
const { reconcileSiteStatus } = await import('../services/siteEnforcement.service.js');
const { applyPaymentDefaultIncidentChange } = await import(
  '../services/billing/paymentDefaultIncident.applier.js'
);
const { applyPaymentDefaultCause } = await import(
  '../services/billing/paymentDefaultCause.applier.js'
);
const { listPaymentDefaultIncidents } = await import(
  '../services/billing/paymentDefaultIncident.service.js'
);
const contrat = await import('../services/panelBridge/bridgeContract.js');

/** Un incident tel que le Panel le publie. État COMPLET, jamais un delta. */
const charge = (patch = {}) => ({
  paymentDefaultId: 'pd-1',
  projectId: 'atelier-nord',
  contractId: 'ct-1',
  invoiceId: 'in_1',
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

const ecriture = (payload, { modifiedAt = '2026-08-01T10:00:00.000Z', deleted = false } = {}) => ({
  change: {
    writeId: `w-${Math.round(Math.random() * 1e9)}`,
    entityType: 'PAYMENT_DEFAULT_INCIDENT',
    entityId: payload?.paymentDefaultId ?? 'pd-1',
    deleted,
    payload: deleted ? null : payload,
    modifiedAt,
    emitter: 'PANEL',
  },
});

/** Remet le site à zéro : aucune cause, accessible. */
async function siteNeuf({ technical = false } = {}) {
  const site = await getSingleton(SiteStatus);
  site.technicalSuspension = technical
    ? { active: true, reason: 'Maintenance', suspendedAt: new Date(), suspendedBy: 'dev@test' }
    : { active: false, reason: '', suspendedAt: null, suspendedBy: '' };
  site.contractProtectionEnabled = false;
  site.paymentDefault = {
    active: false, reason: '', since: null, paymentDefaultId: null, amountDueCents: 0,
  };
  await site.save();
  return reconcileSiteStatus({ actor: 'test' });
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('A+T. Premier échec pendant la grâce — l’incident arrive, le site RESTE OUVERT');
{
  const avant = await siteNeuf();
  check('le site est ouvert au départ', avant.status === 'ACTIVE');

  await applyPaymentDefaultIncidentChange(ecriture(charge()));

  const incident = await PaymentDefaultIncident.findOne({ paymentDefaultId: 'pd-1' }).lean();
  check('L’INCIDENT EST ENREGISTRÉ dès le premier échec', incident !== null);
  check('…avec le statut OPEN', incident.status === 'OPEN');
  check('…et la cause inactive', incident.causeActive === false);

  /**
   * ══ LE CŒUR DU LOT ═══════════════════════════════════════════════════════
   *
   * L'incident existe, la cause n'est pas active, le site répond. Les TROIS
   * sont vraies en même temps. Si l'applicateur d'incident touchait le moteur,
   * ce contrôle rougirait — et les sites fermeraient pendant leur grâce.
   */
  const apres = await getSingleton(SiteStatus);
  check('LE SITE N’EST PAS SUSPENDU', apres.status === 'ACTIVE');
  check('…et aucune cause financière n’a été posée',
    apres.paymentDefault.active === false);
  check('…ni dans l’instantané des causes', apres.causes.paymentDefault === false);
  check('…et la source de suspension n’a pas bougé', apres.suspensionSource === 'NONE');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('B. Le délai FIGÉ et son échéance sont reçus, jamais recalculés');
{
  const i = await PaymentDefaultIncident.findOne({ paymentDefaultId: 'pd-1' }).lean();
  check('le délai figé est 7', i.graceDaysSnapshot === 7);
  check('l’échéance est celle reçue',
    i.graceDeadlineAt.toISOString() === '2026-08-08T10:00:00.000Z');

  /**
   * Recalculée depuis `firstFailedAt + 7 jours`, elle tomberait au même
   * instant ici — c'est justement pourquoi le contrôle porte sur la SOURCE :
   * on vérifie que le champ reçu est stocké tel quel, pas qu'un calcul local
   * donne le bon résultat par chance.
   */
  await applyPaymentDefaultIncidentChange(ecriture(
    charge({ graceDeadlineAt: '2026-08-31T23:00:00.000Z' }),
    { modifiedAt: '2026-08-02T10:00:00.000Z' },
  ));
  const j = await PaymentDefaultIncident.findOne({ paymentDefaultId: 'pd-1' }).lean();
  check('UNE ÉCHÉANCE INCOHÉRENTE AVEC LE DÉLAI EST STOCKÉE TELLE QUELLE',
    j.graceDeadlineAt.toISOString() === '2026-08-31T23:00:00.000Z');
  check('…preuve qu’elle n’est pas dérivée localement', j.graceDaysSnapshot === 7);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('C+U. Les observations Stripe évoluent — l’état complet remplace');
{
  await applyPaymentDefaultIncidentChange(ecriture(
    charge({ attemptCount: 2, nextPaymentAttemptAt: '2026-08-06T10:00:00.000Z' }),
    { modifiedAt: '2026-08-04T10:00:00.000Z' },
  ));

  const i = await PaymentDefaultIncident.findOne({ paymentDefaultId: 'pd-1' }).lean();
  check('attemptCount a convergé', i.attemptCount === 2);
  check('nextPaymentAttemptAt a convergé',
    i.nextPaymentAttemptAt.toISOString() === '2026-08-06T10:00:00.000Z');
  check('le premier échec n’a pas bougé',
    i.firstFailedAt.toISOString() === '2026-08-01T10:00:00.000Z');
  check('…ni le délai figé', i.graceDaysSnapshot === 7);

  const site = await getSingleton(SiteStatus);
  check('et le site est TOUJOURS ouvert', site.status === 'ACTIVE');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('D. Prochaine tentative inconnue — aucune date inventée');
{
  await applyPaymentDefaultIncidentChange(ecriture(
    charge({ nextPaymentAttemptAt: null }),
    { modifiedAt: '2026-08-05T10:00:00.000Z' },
  ));
  const i = await PaymentDefaultIncident.findOne({ paymentDefaultId: 'pd-1' }).lean();
  check('la date reste NULLE', i.nextPaymentAttemptAt === null);

  const { items } = await listPaymentDefaultIncidents();
  const vue = items.find((x) => x.paymentDefaultId === 'pd-1');
  check('…et la lecture le DIT au lieu de l’inventer', vue.nextAttemptKnown === false);
  check('…sans fabriquer de date', vue.nextPaymentAttemptAt === null);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('K. Aucune politique de grâce — `null` reste `null`');
{
  await applyPaymentDefaultIncidentChange(ecriture(
    charge({ paymentDefaultId: 'pd-null', graceDaysSnapshot: null, graceDeadlineAt: null }),
    { modifiedAt: '2026-08-01T10:00:00.000Z' },
  ));
  const i = await PaymentDefaultIncident.findOne({ paymentDefaultId: 'pd-null' }).lean();

  /**
   * UN `?? 0` ICI transformerait « aucune politique n'a été fixée » en
   * « aucune clémence », et l'écran promettrait au client une suspension
   * automatique que personne n'a décidée.
   */
  check('graceDaysSnapshot vaut NULL', i.graceDaysSnapshot === null);
  check('…et surtout pas zéro', i.graceDaysSnapshot !== 0);
  check('aucune échéance', i.graceDeadlineAt === null);

  const { items } = await listPaymentDefaultIncidents();
  const vue = items.find((x) => x.paymentDefaultId === 'pd-null');
  check('la lecture expose graceConfigured = false', vue.graceConfigured === false);
  check('…avec le délai à null', vue.graceDaysSnapshot === null);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('L. Grâce de ZÉRO jour — le zéro survit');
{
  await applyPaymentDefaultIncidentChange(ecriture(
    charge({
      paymentDefaultId: 'pd-zero', graceDaysSnapshot: 0,
      graceDeadlineAt: '2026-08-01T10:00:00.000Z',
    }),
    { modifiedAt: '2026-08-01T10:00:00.000Z' },
  ));
  const i = await PaymentDefaultIncident.findOne({ paymentDefaultId: 'pd-zero' }).lean();
  check('graceDaysSnapshot vaut ZÉRO', i.graceDaysSnapshot === 0);
  check('…et ce n’est pas null', i.graceDaysSnapshot !== null);

  const { items } = await listPaymentDefaultIncidents();
  const vue = items.find((x) => x.paymentDefaultId === 'pd-zero');
  /**
   * `graceConfigured` EST VRAI POUR ZÉRO. C'est tout l'intérêt du booléen :
   * un `if (graceDaysSnapshot)` dans React fusionnerait ce cas avec `null` et
   * afficherait « aucun délai de grâce » à un client qui peut être suspendu
   * dès l'échec.
   */
  check('graceConfigured est VRAI pour zéro', vue.graceConfigured === true);
  check('…avec le délai à 0', vue.graceDaysSnapshot === 0);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('E. Expiration — demandée, PAS confirmée. Toujours aucune suspension ici.');
{
  await siteNeuf();
  await applyPaymentDefaultIncidentChange(ecriture(
    charge({
      status: 'GRACE_EXPIRED',
      suspensionRequestedAt: '2026-08-08T10:00:00.000Z',
      causeActive: true,
    }),
    { modifiedAt: '2026-08-08T10:00:00.000Z' },
  ));

  const i = await PaymentDefaultIncident.findOne({ paymentDefaultId: 'pd-1' }).lean();
  check('la demande est enregistrée', i.suspensionRequestedAt !== null);
  check('LA CONFIRMATION MANQUE', i.suspensionConfirmedAt === null);
  check('causeActive est reçu à vrai', i.causeActive === true);

  /**
   * ══ ET POURTANT LE SITE RESTE OUVERT ═════════════════════════════════════
   *
   * `causeActive: true` dans l'INCIDENT n'a aucune autorité : c'est une
   * observation. Seul `PAYMENT_DEFAULT_CAUSE` ferme un site, et il n'est pas
   * encore arrivé. C'est la garantie que les deux types restent orthogonaux.
   */
  const site = await getSingleton(SiteStatus);
  check('L’INCIDENT SEUL NE SUSPEND RIEN', site.status === 'ACTIVE');
  check('…la cause du moteur est toujours inactive', site.paymentDefault.active === false);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('E (suite). C’est la CAUSE — et elle seule — qui ferme le site');
{
  await applyPaymentDefaultCause({
    change: {
      entityType: 'PAYMENT_DEFAULT_CAUSE',
      entityId: 'pd-1',
      deleted: false,
      payload: {
        paymentDefaultId: 'pd-1', active: true, reason: 'Défaut de paiement',
        since: '2026-08-08T10:00:00.000Z', amountDueCents: 24_900,
      },
    },
  });

  const site = await getSingleton(SiteStatus);
  check('MAINTENANT le site est suspendu', site.status === 'SUSPENDED');
  check('…par la cause financière', site.causes.paymentDefault === true);
  check('…et c’est elle qui prime à l’affichage',
    site.suspensionSource === 'PAYMENT_DEFAULT');

  /** L'incident, lui, n'a pas changé : il n'a rien à voir avec cette écriture. */
  const i = await PaymentDefaultIncident.findOne({ paymentDefaultId: 'pd-1' }).lean();
  check('l’incident n’a pas été touché par la cause', i.suspensionConfirmedAt === null);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('F+X. Confirmation reçue sous maintenance TECHNIQUE');
{
  await applyPaymentDefaultIncidentChange(ecriture(
    charge({
      status: 'GRACE_EXPIRED',
      suspensionRequestedAt: '2026-08-08T10:00:00.000Z',
      suspensionConfirmedAt: '2026-08-09T11:00:00.000Z',
      causeActive: true,
    }),
    { modifiedAt: '2026-08-09T11:00:00.000Z' },
  ));

  const i = await PaymentDefaultIncident.findOne({ paymentDefaultId: 'pd-1' }).lean();
  check('LA CONFIRMATION EST ARRIVÉE',
    i.suspensionConfirmedAt.toISOString() === '2026-08-09T11:00:00.000Z');
  check('…à côté de la demande, qui reste distincte',
    i.suspensionRequestedAt.toISOString() === '2026-08-08T10:00:00.000Z');
  check('…et les deux dates sont DIFFÉRENTES',
    i.suspensionRequestedAt.getTime() !== i.suspensionConfirmedAt.getTime());
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('I+Y. Résolution sous maintenance — payé, cause retirée, site FERMÉ');
{
  /** Une maintenance technique s'ajoute pendant que l'impayé court. */
  const site = await getSingleton(SiteStatus);
  site.technicalSuspension = {
    active: true, reason: 'Maintenance', suspendedAt: new Date(), suspendedBy: 'dev@test',
  };
  await site.save();
  await reconcileSiteStatus({ actor: 'test' });

  /** Le client régularise : l'incident se résout, la cause est retirée. */
  await applyPaymentDefaultIncidentChange(ecriture(
    charge({
      status: 'RESOLVED',
      suspensionRequestedAt: '2026-08-08T10:00:00.000Z',
      suspensionConfirmedAt: '2026-08-09T11:00:00.000Z',
      causeRemovalConfirmedAt: '2026-08-10T10:00:00.000Z',
      resolvedAt: '2026-08-10T09:00:00.000Z',
      resolution: 'PAID_AFTER_GRACE',
      causeActive: false,
    }),
    { modifiedAt: '2026-08-10T10:00:00.000Z' },
  ));
  await applyPaymentDefaultCause({
    change: {
      entityType: 'PAYMENT_DEFAULT_CAUSE', entityId: 'pd-1', deleted: false,
      payload: { paymentDefaultId: 'pd-1', active: false, reason: 'Défaut de paiement' },
    },
  });

  const i = await PaymentDefaultIncident.findOne({ paymentDefaultId: 'pd-1' }).lean();
  check('l’incident est RÉSOLU', i.status === 'RESOLVED');
  check('…la cause financière est retirée', i.causeActive === false);
  check('…et le retrait est daté',
    i.causeRemovalConfirmedAt.toISOString() === '2026-08-10T10:00:00.000Z');

  /**
   * ══ « RÉSOLU » NE VEUT PAS DIRE « ACCESSIBLE » ═══════════════════════════
   *
   * Le cas obligatoire du cahier des charges. Le paiement est régularisé, la
   * cause financière est retirée, et le site reste FERMÉ pour maintenance. En
   * déduire une réactivation rouvrirait un site que personne n'a décidé de
   * rouvrir.
   */
  const apres = await getSingleton(SiteStatus);
  check('LE SITE RESTE SUSPENDU', apres.status === 'SUSPENDED');
  check('…la cause financière n’y est plus', apres.causes.paymentDefault === false);
  check('…mais la maintenance, si', apres.causes.technical === true);
  check('…et c’est elle qui prime désormais', apres.suspensionSource === 'TECHNICAL');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('V. Duplication ×8 — aucun second effet');
{
  /**
   * L'ÉTAT REJOUÉ EST L'ÉTAT COMPLET, celui que la section précédente a
   * établi. Rejouer une charge amputée ne prouverait pas l'idempotence : elle
   * effacerait des champs, et c'est le comportement NORMAL d'un remplacement.
   */
  const ecrit = ecriture(
    charge({
      status: 'RESOLVED',
      suspensionRequestedAt: '2026-08-08T10:00:00.000Z',
      suspensionConfirmedAt: '2026-08-09T11:00:00.000Z',
      causeRemovalConfirmedAt: '2026-08-10T10:00:00.000Z',
      resolvedAt: '2026-08-10T09:00:00.000Z',
      resolution: 'PAID_AFTER_GRACE',
      causeActive: false,
    }),
    { modifiedAt: '2026-08-10T10:00:00.000Z' },
  );

  await applyPaymentDefaultIncidentChange(ecrit);
  const apres1 = await PaymentDefaultIncident.findOne({ paymentDefaultId: 'pd-1' }).lean();

  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await applyPaymentDefaultIncidentChange(ecrit);
  }
  const apres8 = await PaymentDefaultIncident.findOne({ paymentDefaultId: 'pd-1' }).lean();

  const comparable = (d) => {
    const { receivedAt, updatedAt, ...reste } = d;
    return JSON.stringify(reste);
  };
  check('HUIT LIVRAISONS = UNE SEULE', comparable(apres1) === comparable(apres8));

  const total = await PaymentDefaultIncident.countDocuments({ paymentDefaultId: 'pd-1' });
  check('…et il n’y a toujours qu’UN document', total === 1);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('W. Désordre — une livraison ANCIENNE ne fait RÉGRESSER aucun état');
{
  const avant = await PaymentDefaultIncident.findOne({ paymentDefaultId: 'pd-1' }).lean();
  check('l’état de départ est RESOLVED', avant.status === 'RESOLVED');

  /**
   * ══ CE QUE LE PONT NE PROTÈGE PAS ════════════════════════════════════════
   *
   * Le pont dédoublonne par `writeId` : il reconnaît la MÊME livraison
   * rejouée. Il ne reconnaît pas deux écritures DISTINCTES livrées à l'envers
   * — cas banal après un rattrapage, où le journal se rejoue pendant que le
   * direct reprend.
   *
   * Sans garde, l'ancienne gagnerait : l'incident résolu repasserait « en
   * échec » sous les yeux du client, et une suspension confirmée redeviendrait
   * « en cours d'application ».
   */
  await applyPaymentDefaultIncidentChange(ecriture(
    charge({ status: 'OPEN', attemptCount: 1, causeActive: false }),
    { modifiedAt: '2026-08-01T10:00:00.000Z' },
  ));

  const apres = await PaymentDefaultIncident.findOne({ paymentDefaultId: 'pd-1' }).lean();
  check('L’ÉTAT N’A PAS RÉGRESSÉ', apres.status === 'RESOLVED');
  check('…la résolution est intacte', apres.resolvedAt !== null);
  check('…et la confirmation aussi', apres.suspensionConfirmedAt !== null);

  /** À égalité d'horodatage, on applique : deux écritures peuvent le partager. */
  await applyPaymentDefaultIncidentChange(ecriture(
    charge({
      status: 'RESOLVED',
      suspensionRequestedAt: '2026-08-08T10:00:00.000Z',
      suspensionConfirmedAt: '2026-08-09T11:00:00.000Z',
      resolvedAt: '2026-08-10T09:00:00.000Z',
      invoiceNumber: 'F-BIS',
    }),
    { modifiedAt: apres.sourceModifiedAt.toISOString() },
  ));
  const egal = await PaymentDefaultIncident.findOne({ paymentDefaultId: 'pd-1' }).lean();
  check('à égalité d’horodatage, l’écriture est APPLIQUÉE', egal.invoiceNumber === 'F-BIS');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('N+O. Historique — deux incidents restent DEUX incidents');
{
  await applyPaymentDefaultIncidentChange(ecriture(
    charge({
      paymentDefaultId: 'pd-2', invoiceId: 'in_2', contractId: 'ct-1',
      firstFailedAt: '2026-09-01T10:00:00.000Z', status: 'OPEN', causeActive: false,
    }),
    { modifiedAt: '2026-09-01T10:00:00.000Z' },
  ));

  const { items, active } = await listPaymentDefaultIncidents();
  const memeContrat = items.filter((i) => i.contractId === 'ct-1');
  check('DEUX incidents sur le MÊME contrat', memeContrat.length >= 2);
  check('…et ils ne sont pas fusionnés',
    new Set(memeContrat.map((i) => i.paymentDefaultId)).size === memeContrat.length);

  check('l’incident ACTIF est le vivant le plus récent', active?.paymentDefaultId === 'pd-2');
  check('…et l’incident résolu reste consultable',
    items.some((i) => i.paymentDefaultId === 'pd-1' && i.status === 'RESOLVED'));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('R. Une LECTURE ne mute rien');
{
  const avant = await PaymentDefaultIncident.find({}).sort({ paymentDefaultId: 1 }).lean();
  const siteAvant = await getSingleton(SiteStatus);
  const etatAvant = { status: siteAvant.status, source: siteAvant.suspensionSource };

  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await listPaymentDefaultIncidents();
  }

  const apres = await PaymentDefaultIncident.find({}).sort({ paymentDefaultId: 1 }).lean();
  const siteApres = await getSingleton(SiteStatus);

  check('AUCUN incident n’a été muté', JSON.stringify(avant) === JSON.stringify(apres));
  check('…et l’état du site n’a pas bougé',
    siteApres.status === etatAvant.status && siteApres.suspensionSource === etatAvant.source);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('Une TOMBE clôt l’incident sans l’effacer');
{
  await applyPaymentDefaultIncidentChange(ecriture(charge({ paymentDefaultId: 'pd-2' }), {
    deleted: true, modifiedAt: '2026-09-02T10:00:00.000Z',
  }));

  const i = await PaymentDefaultIncident.findOne({ paymentDefaultId: 'pd-2' }).lean();
  /**
   * EFFACER SERAIT PIRE. Un impayé retiré de l'historique du client ferait
   * disparaître l'explication d'une suspension passée — et c'est exactement ce
   * qu'un espace de facturation ne doit jamais faire.
   */
  check('l’incident EXISTE toujours', i !== null);
  check('…mais il est clos', i.status === 'CLOSED');
  check('…et n’explique plus aucune suspension', i.causeActive === false);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('GARDE-FOUS STATIQUES — l’incident ne peut PAS fermer un site');
{
  const ici = path.dirname(fileURLToPath(import.meta.url));
  const racine = path.resolve(ici, '../..');

  /**
   * LA GARDE LIT LE CODE, PAS LA PROSE. Ces fichiers expliquent longuement
   * pourquoi ils ne réconcilient rien ; une garde naïve rougirait sur la
   * documentation de l'interdit qu'elle défend, et quelqu'un supprimerait le
   * commentaire pour faire passer le test.
   */
  const codeSeul = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ');

  const applicateur = codeSeul(fs.readFileSync(
    path.join(racine, 'src/services/billing/paymentDefaultIncident.applier.js'), 'utf8',
  ));

  /**
   * ══ L'INTERDIT QUI TIENT TOUT LE LOT ═════════════════════════════════════
   *
   * Si quelqu'un ajoute une réconciliation ici « pour que ça se voie », il
   * fermera les sites pendant leur délai de grâce. C'est un geste qui paraît
   * anodin, qui ne planterait nulle part, et dont la conséquence est qu'un
   * client verrait son site coupé le jour où sa carte expire.
   */
  check('l’applicateur d’incident n’importe PAS le moteur d’accessibilité',
    !/siteEnforcement|reconcileSiteStatus/.test(applicateur));
  check('…ni le modèle SiteStatus', !/SiteStatus/.test(applicateur));
  check('…et n’écrit aucune cause de suspension',
    !/paymentDefault\s*=|causes\s*=/.test(applicateur));

  /** L'applicateur de CAUSE, lui, DOIT réconcilier — c'est son rôle. */
  const cause = codeSeul(fs.readFileSync(
    path.join(racine, 'src/services/billing/paymentDefaultCause.applier.js'), 'utf8',
  ));
  check('l’applicateur de CAUSE, lui, appelle bien le moteur',
    /reconcileSiteStatus/.test(cause));

  /** Aucun ordonnanceur local de tentatives, nulle part dans le lot. */
  const FICHIERS = [
    'src/services/billing/paymentDefaultIncident.applier.js',
    'src/services/billing/paymentDefaultIncident.service.js',
    'src/models/PaymentDefaultIncident.model.js',
    'src/routes/billing.routes.js',
    '../manager/src/components/contracts/SubscriptionIncidentCard.tsx',
  ];
  const INTERDITS = [
    { motif: /require\(['"]stripe['"]\)|from ['"]stripe['"]/, quoi: 'le SDK Stripe' },
    { motif: /\bsecretKey\b|sk_(test|live)_/, quoi: 'une clé secrète' },
    { motif: /retryNow|retryInterval|scheduleRetry/, quoi: 'un ordonnanceur local' },
    { motif: /invoices?\.pay\b|invoices\/[^'"]*\/pay/, quoi: 'un ordre de paiement' },
  ];
  for (const relatif of FICHIERS) {
    const source = codeSeul(fs.readFileSync(path.join(racine, relatif), 'utf8'));
    for (const { motif, quoi } of INTERDITS) {
      check(`${path.basename(relatif)} ne contient pas ${quoi}`, !motif.test(source));
    }
  }

  /**
   * ══ LE MANAGER NE RECONSTRUIT AUCUN ÉTAT MÉTIER ══════════════════════════
   *
   * `suspensionSource === 'PAYMENT_DEFAULT'` comme preuve est FAUX sous
   * maintenance : la dominante reste TECHNICAL alors que notre cause EST
   * appliquée. La preuve est `causes.paymentDefault`, et l'écran doit la lire
   * plutôt que la déduire.
   */
  const ui = codeSeul(fs.readFileSync(
    path.join(racine, '../manager/src/components/contracts/SubscriptionIncidentCard.tsx'), 'utf8',
  ));
  check('le Manager n’utilise pas suspensionSource comme preuve',
    !/suspensionSource\s*===/.test(ui));
  check('…il lit causes.paymentDefault ou l’état du site',
    /causes\?\.|status === 'ACTIVE'/.test(ui));
  check('le Manager ne recalcule aucune échéance de grâce',
    !/graceDays[\s\S]{0,40}\*\s*(24|86400)/.test(ui));
  check('le Manager ne recalcule aucune accessibilité',
    !/!\s*technical\s*&&/.test(ui));
  /** `null` vs `0` : le test doit passer par le booléen du serveur. */
  check('le Manager distingue null de zéro par graceConfigured',
    /i\.graceConfigured/.test(ui));

  /** Aucun verbe d'écriture sur la surface des incidents. */
  const routes = codeSeul(fs.readFileSync(path.join(racine, 'src/routes/billing.routes.js'), 'utf8'));
  check('la surface des incidents est montée en lecture',
    /myInvoicesRouter\.get\('\/subscription-incidents'/.test(routes));
  check('…et n’expose AUCUN verbe d’écriture',
    !/myInvoicesRouter\.(post|patch|put|delete)\([^)]*subscription-incidents/.test(routes));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('Le contrat déclare le type, et le projet l’APPLIQUE réellement');
{
  check('PAYMENT_DEFAULT_INCIDENT est déclaré au contrat',
    contrat.SYNC_ENTITY_TYPES.includes('PAYMENT_DEFAULT_INCIDENT'));
  check('…et il est APPLIQUÉ par ce projet',
    contrat.APPLIED_ENTITY_TYPES.includes('PAYMENT_DEFAULT_INCIDENT'));
  check('la CAUSE reste déclarée et appliquée elle aussi',
    contrat.SYNC_ENTITY_TYPES.includes('PAYMENT_DEFAULT_CAUSE')
    && contrat.APPLIED_ENTITY_TYPES.includes('PAYMENT_DEFAULT_CAUSE'));

  /**
   * ══ LES DEUX CHEMINS D'ARRIVÉE, ET IL FAUT LES DEUX ══════════════════════
   *
   * `changeAppliers` sert quand le Panel LIVRE ; `applyHandlers` sert quand le
   * projet TIRE. Un type inscrit dans un seul des deux fonctionne tant que le
   * projet est en ligne, puis disparaît silencieusement dès qu'il a été absent
   * — soit exactement le cas que le rattrapage existe pour couvrir.
   */
  const bootstrap = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../config/bootstrap.js'), 'utf8',
  );
  /**
   * ══ LA GARDE PORTE SUR LA PROPRIÉTÉ, PLUS SUR SON ANCIENNE EMPREINTE ══════
   *
   * Elle exigeait DEUX inscriptions littérales — une par registre — parce que
   * le bootstrap recopiait la même table d'applicateurs à deux endroits.
   *
   * Il ne la recopie plus : une table UNIQUE alimente les deux registres.
   * Continuer à compter deux occurrences reviendrait à exiger le retour de la
   * duplication, c'est-à-dire à exiger le défaut que cette garde attrape — un
   * type inscrit d'un seul côté, qui fonctionne tant que le projet est en
   * ligne puis disparaît silencieusement dès qu'il a été absent.
   *
   * On vérifie donc que le type est déclaré une fois, et que les DEUX
   * registres reçoivent LA MÊME table — sans citer son nom, pour qu'un
   * renommage ne casse pas une garde qui porte sur la structure.
   */
  const occurrences = bootstrap.match(/PAYMENT_DEFAULT_INCIDENT:/g) ?? [];
  check('l’applicateur est déclaré une fois, dans la table d’applicateurs',
    occurrences.length === 1);
  const livraison = bootstrap.match(/changeAppliers:\s*\{\s*\.\.\.\s*(\w+)/);
  const tirage = bootstrap.match(/applyHandlers:\s*\{\s*\.\.\.\s*(\w+)/);
  check('l’applicateur est branché sur les DEUX registres (livraison ET tirage)',
    Boolean(livraison && tirage && livraison[1] === tirage[1]));
}

await disconnectDatabase();
await mongod.stop();
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
