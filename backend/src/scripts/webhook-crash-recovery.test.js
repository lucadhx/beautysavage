/**
 * ══ UNE LIGNE QUI EXISTE N'EST PAS UN TRAVAIL FAIT ══════════════════════════
 *
 * ── LE DÉFAUT QUE CETTE RECETTE VERROUILLE ─────────────────────────────────
 *
 * `WebhookEvent` servait de verrou par son index unique, et le refus E11000
 * valait « doublon » :
 *
 *     webhook  →  ligne PENDING  →  CRASH  →  Stripe rejoue  →  « doublon »
 *                                                            →  effet PERDU
 *
 * La protection contre le rejeu était parfaite. Le rattrapage après incident
 * était nul — et c'est le rejeu du fournisseur, la seule réparation gratuite
 * qui existe, que nous refusions.
 *
 * ── CE QU'ON PROUVE ICI, ET SUR QUOI ───────────────────────────────────────
 *
 * Sur une VRAIE base (Mongo en mémoire), avec de VRAIES écritures concurrentes.
 * Une recette qui simulerait la base ne prouverait rien du seul point qui
 * compte : que la réclamation est atomique. C'est Mongo qui arbitre, pas nous.
 *
 *   A  neuf                         → PROCESSING → PROCESSED
 *   B  PROCESSED rejoué             → doublon terminal, aucun effet
 *   C  PENDING ancien               → repris, PAS un doublon
 *   D  PROCESSING sous bail valide  → un second n'entre pas
 *   E  PROCESSING bail expiré       → repris
 *   F  crash AVANT l'effet          → reprise → effet appliqué UNE fois
 *   G  crash APRÈS l'effet          → reprise → l'idempotence métier tient
 *   H  panne reprenable             → FAILED → reprise → succès
 *   I  erreur terminale             → DEAD_LETTER, aucune boucle
 *   J  événement toxique            → plafond → DEAD_LETTER supervisé
 *   K  deux processus concurrents   → 1 claim, 1 effet
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.ENV = 'TEST';
process.env.DB_TEST = 'webhook_crash_recovery_test';
process.env.JWT_SECRET = 'x'.repeat(48);
process.env.INTEGRATED_API_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NGROK_API_URL = 'http://127.0.0.1:1';
/** Bail très court : la recette doit pouvoir le laisser EXPIRER pour de vrai. */
process.env.WEBHOOK_LEASE_TTL_MS = '400';
process.env.WEBHOOK_STALE_PENDING_MS = '400';
process.env.WEBHOOK_MAX_ATTEMPTS = '3';

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();

let pass = 0;
let fail = 0;
const check = (nom, condition, extra = '') => {
  if (condition) { pass += 1; console.log(`  ✓ ${nom}`); }
  else { fail += 1; console.error(`  ✗ ${nom}${extra ? ` — ${extra}` : ''}`); }
};
const section = (titre) => console.log(`\n${titre}`);
const dormir = (ms) => new Promise((r) => { setTimeout(r, ms); });

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();

const { WebhookEvent } = await import('../models/WebhookEvent.model.js');
const { WEBHOOK_PROCESSING_STATUS: ST, WEBHOOK_TERMINAL_STATUSES } = await import(
  '../utils/contractConstants.js'
);
const bail = await import('../services/webhooks/webhookLease.js');
const { recoverAbandonedWebhookEvents } = await import('../services/webhooks/webhookRecovery.js');

const {
  claimWebhookEvent, settleWebhookEvent, classifyWebhookError,
  statusAfterFailure, CLAIM_OUTCOME, LEASE_TTL_MS, MAX_PROCESSING_ATTEMPTS,
} = bail;

const lire = (id) => WebhookEvent.findOne({ provider: 'STRIPE', externalEventId: id }).lean();
const reclamer = (id, type = 'invoice.paid') => claimWebhookEvent({
  provider: 'STRIPE', externalEventId: id, eventType: type, environment: 'TEST',
});

/**
 * ══ L'EFFET MÉTIER, RÉDUIT À CE QU'IL A DE PROUVABLE ════════════════════════
 *
 * Un compteur idempotent gardé par une clé unique en base — la même forme que
 * la vraie barrière (`uniq_provider_external_object` côté Panel, la clé
 * canonique d'un fait financier). Ce qu'on éprouve n'est pas le contenu de
 * l'effet, c'est qu'un RETRAITEMENT n'en produit pas un second.
 */
const Effet = (await import('mongoose')).default.model('EffetRecette', new (await import('mongoose')).default.Schema({
  cle: { type: String, required: true, unique: true },
  appliqueA: { type: Date, default: Date.now },
}));

const appliquerEffet = async (cle) => {
  try {
    await Effet.create({ cle });
    return 'APPLIQUÉ';
  } catch (e) {
    if (e.code === 11000) return 'DÉJÀ APPLIQUÉ';
    throw e;
  }
};
const compterEffets = (cle) => Effet.countDocuments({ cle });

/* ══════════════════════════════════════════════════════════════════════════ */
section('0. LES SEUILS SONT MESURÉS, PAS DEVINÉS');
{
  check(`le bail est configurable (ici ${LEASE_TTL_MS} ms pour la recette)`, LEASE_TTL_MS === 400);
  check(`le plafond de tentatives est configurable (ici ${MAX_PROCESSING_ATTEMPTS})`, MAX_PROCESSING_ATTEMPTS === 3);
  check('l’identité de processus porte un nonce de démarrage',
    /^[^:]+:\d+:[0-9a-f]{12}$/.test(bail.PROCESS_IDENTITY));
  check('…ce qui distingue un processus de son propre fantôme (pid réutilisé)',
    bail.PROCESS_IDENTITY.split(':')[2] !== '000000000000');
  check('PROCESSED, IGNORED et DEAD_LETTER sont les SEULS états terminaux',
    WEBHOOK_TERMINAL_STATUSES.length === 3
    && WEBHOOK_TERMINAL_STATUSES.includes(ST.PROCESSED)
    && WEBHOOK_TERMINAL_STATUSES.includes(ST.IGNORED)
    && WEBHOOK_TERMINAL_STATUSES.includes(ST.DEAD_LETTER));
  check('…PENDING n’en fait PAS partie — c’est tout le lot',
    !WEBHOOK_TERMINAL_STATUSES.includes(ST.PENDING));
  check('…FAILED non plus', !WEBHOOK_TERMINAL_STATUSES.includes(ST.FAILED));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('A. UN ÉVÉNEMENT NEUF — PROCESSING sous bail, puis PROCESSED');
{
  const r = await reclamer('evt_A');
  check('première réclamation : CLAIMED', r.outcome === CLAIM_OUTCOME.CLAIMED);
  check('…tentative 1', r.attempts === 1);

  const enCours = await lire('evt_A');
  check('la ligne NAÎT PROCESSING, jamais PENDING',
    enCours.processingStatus === ST.PROCESSING,
    `état ${enCours.processingStatus}`);
  check('…avec un bail daté', enCours.leaseExpiresAt instanceof Date);
  check('…et un propriétaire', enCours.leaseOwner === bail.PROCESS_IDENTITY);
  check('il n’existe AUCUNE fenêtre où la ligne existe sans bail',
    enCours.leaseOwner !== null && enCours.leaseExpiresAt !== null);

  await settleWebhookEvent({ provider: 'STRIPE', externalEventId: 'evt_A', status: ST.PROCESSED });
  const fini = await lire('evt_A');
  check('conclusion : PROCESSED', fini.processingStatus === ST.PROCESSED);
  check('…le bail est rendu', fini.leaseOwner === null && fini.leaseExpiresAt === null);
  check('…et l’instant de fin est daté', fini.processedAt instanceof Date);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('B. UN ÉVÉNEMENT CONCLU, REJOUÉ — doublon terminal, aucun effet');
{
  const r = await reclamer('evt_A');
  check('rejeu d’un PROCESSED : TERMINAL', r.outcome === CLAIM_OUTCOME.TERMINAL);
  const doc = await lire('evt_A');
  check('…le compteur de tentatives n’a PAS bougé', doc.processingAttempts === 1,
    `${doc.processingAttempts} tentative(s)`);
  check('…l’état n’a pas bougé non plus', doc.processingStatus === ST.PROCESSED);

  /** IGNORED et DEAD_LETTER sont terminaux au même titre. */
  await reclamer('evt_B_ignore');
  await settleWebhookEvent({ provider: 'STRIPE', externalEventId: 'evt_B_ignore', status: ST.IGNORED });
  check('un IGNORED rejoué est terminal aussi',
    (await reclamer('evt_B_ignore')).outcome === CLAIM_OUTCOME.TERMINAL);

  await reclamer('evt_B_mort');
  await settleWebhookEvent({
    provider: 'STRIPE', externalEventId: 'evt_B_mort', status: ST.DEAD_LETTER,
    error: { code: 'X', message: 'x', retryable: false },
  });
  check('un DEAD_LETTER rejoué est terminal — pas de boucle',
    (await reclamer('evt_B_mort')).outcome === CLAIM_OUTCOME.TERMINAL);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('C. UN PENDING ANCIEN — repris, et surtout PAS un doublon');
{
  /**
   * On reconstitue une ligne HÉRITÉE : c'est exactement ce que l'ancien code
   * écrivait, et ce que la base contient déjà en production.
   */
  await WebhookEvent.create({
    provider: 'STRIPE',
    externalEventId: 'evt_C',
    eventType: 'customer.subscription.deleted',
    environment: 'TEST',
    processingStatus: ST.PENDING,
    receivedAt: new Date(Date.now() - 60_000),
  });

  const r = await reclamer('evt_C', 'customer.subscription.deleted');
  check('un PENDING ancien est REPRIS, pas éconduit', r.outcome === CLAIM_OUTCOME.RECLAIMED,
    `issue ${r.outcome}`);
  check('…et le compteur de tentatives monte', r.attempts === 1);

  const doc = await lire('evt_C');
  check('…il passe sous bail', doc.processingStatus === ST.PROCESSING);
  await settleWebhookEvent({ provider: 'STRIPE', externalEventId: 'evt_C', status: ST.PROCESSED });
  check('…et se conclut normalement', (await lire('evt_C')).processingStatus === ST.PROCESSED);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('D. UN BAIL VALIDE — le second n’entre pas');
{
  await reclamer('evt_D');
  const second = await reclamer('evt_D');
  check('bail encore valide : IN_FLIGHT, pas RECLAIMED', second.outcome === CLAIM_OUTCOME.IN_FLIGHT,
    `issue ${second.outcome}`);
  const doc = await lire('evt_D');
  check('…aucune seconde tentative n’a été comptée', doc.processingAttempts === 1,
    `${doc.processingAttempts}`);
  check('…et le bail appartient toujours au premier', doc.leaseOwner === bail.PROCESS_IDENTITY);

  /**
   * IN_FLIGHT n'est PAS « déjà traité », et la distinction compte : le premier
   * peut encore échouer. On la vérifie sur le mot rendu, pas sur un booléen.
   */
  check('IN_FLIGHT et TERMINAL sont deux mots distincts',
    CLAIM_OUTCOME.IN_FLIGHT !== CLAIM_OUTCOME.TERMINAL);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('E. UN BAIL EXPIRÉ — le travail est réputé abandonné, on reprend');
{
  await reclamer('evt_E');
  await dormir(LEASE_TTL_MS + 120);
  const r = await reclamer('evt_E');
  check('bail expiré : RECLAIMED', r.outcome === CLAIM_OUTCOME.RECLAIMED, `issue ${r.outcome}`);
  check('…tentative 2', r.attempts === 2, `${r.attempts}`);
  const doc = await lire('evt_E');
  check('…le bail est réarmé', doc.leaseExpiresAt.getTime() > Date.now());
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('F. CRASH AVANT L’EFFET MÉTIER — la reprise l’applique UNE fois');
{
  const ID = 'evt_F';
  const CLE = 'facture_F';

  /** Le processus « meurt » ici : réclamé, rien d'appliqué, rien de conclu. */
  await reclamer(ID);
  check('après le crash, l’état durable est PROCESSING (pas PROCESSED)',
    (await lire(ID)).processingStatus === ST.PROCESSING);
  check('…et AUCUN effet métier n’existe', (await compterEffets(CLE)) === 0);

  await dormir(LEASE_TTL_MS + 120);

  /** Redémarrage : Stripe rejoue, ou le balayage reprend. */
  const r = await reclamer(ID);
  check('le rejeu REPREND au lieu de répondre « doublon »', r.outcome === CLAIM_OUTCOME.RECLAIMED);
  const applique = await appliquerEffet(CLE);
  await settleWebhookEvent({ provider: 'STRIPE', externalEventId: ID, status: ST.PROCESSED });

  check('…l’effet est appliqué', applique === 'APPLIQUÉ');
  check('…exactement UNE fois', (await compterEffets(CLE)) === 1);
  check('…et l’événement finit PROCESSED', (await lire(ID)).processingStatus === ST.PROCESSED);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('G. CRASH APRÈS L’EFFET, AVANT LE MARQUAGE — l’idempotence métier tient');
{
  const ID = 'evt_G';
  const CLE = 'facture_G';

  await reclamer(ID);
  const premier = await appliquerEffet(CLE);
  /** Le processus meurt ICI : l'effet existe, l'événement n'est pas conclu. */
  check('l’effet métier a bien eu lieu', premier === 'APPLIQUÉ');
  check('…mais l’événement reste PROCESSING', (await lire(ID)).processingStatus === ST.PROCESSING);

  await dormir(LEASE_TTL_MS + 120);

  const r = await reclamer(ID);
  check('le rejeu reprend', r.outcome === CLAIM_OUTCOME.RECLAIMED);
  const second = await appliquerEffet(CLE);
  await settleWebhookEvent({ provider: 'STRIPE', externalEventId: ID, status: ST.PROCESSED });

  check('…et la BARRIÈRE FINALE tient : rien n’est appliqué deux fois',
    second === 'DÉJÀ APPLIQUÉ');
  check('…un seul effet en base', (await compterEffets(CLE)) === 1);
  check('…l’événement finit PROCESSED', (await lire(ID)).processingStatus === ST.PROCESSED);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('H. PANNE REPRENABLE — FAILED, puis reprise, puis succès');
{
  const ID = 'evt_H';
  const r1 = await reclamer(ID);
  const panne = Object.assign(new Error('Panel injoignable'), { code: 'BRIDGE_UNAVAILABLE' });
  const cause = classifyWebhookError(panne);
  check('une panne de dépendance est REPRENABLE par défaut', cause.retryable === true);

  const statut = statusAfterFailure({ retryable: cause.retryable, attempts: r1.attempts });
  check('…elle donne FAILED, pas DEAD_LETTER', statut === ST.FAILED);
  await settleWebhookEvent({ provider: 'STRIPE', externalEventId: ID, status: statut, error: cause });

  const doc = await lire(ID);
  check('…la cause est consignée avec sa classification',
    doc.lastError?.code === 'BRIDGE_UNAVAILABLE' && doc.lastError?.retryable === true);

  const r2 = await reclamer(ID);
  check('un FAILED reprenable est REPRIS immédiatement — sans attendre le bail',
    r2.outcome === CLAIM_OUTCOME.RECLAIMED, `issue ${r2.outcome}`);
  await settleWebhookEvent({ provider: 'STRIPE', externalEventId: ID, status: ST.PROCESSED });
  check('…et la seconde tentative conclut', (await lire(ID)).processingStatus === ST.PROCESSED);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('I. ERREUR TERMINALE — DEAD_LETTER, et AUCUNE boucle');
{
  const ID = 'evt_I';
  const r1 = await reclamer(ID);
  const vice = Object.assign(new Error('corps illisible'), { code: 'WEBHOOK_PAYLOAD_INVALID' });
  const cause = classifyWebhookError(vice);
  check('un corps illisible est TERMINAL', cause.retryable === false);

  const statut = statusAfterFailure({ retryable: cause.retryable, attempts: r1.attempts });
  check('…dès la PREMIÈRE tentative', statut === ST.DEAD_LETTER);
  await settleWebhookEvent({ provider: 'STRIPE', externalEventId: ID, status: statut, error: cause });

  const r2 = await reclamer(ID);
  check('un DEAD_LETTER n’est jamais repris — la boucle est impossible',
    r2.outcome === CLAIM_OUTCOME.TERMINAL, `issue ${r2.outcome}`);
  const doc = await lire(ID);
  check('…et il DIT pourquoi', doc.lastError?.code === 'WEBHOOK_PAYLOAD_INVALID'
    && doc.lastError?.retryable === false);
  check('…le message est conservé, tronqué', typeof doc.errorMessage === 'string' && doc.errorMessage.length > 0);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('J. ÉVÉNEMENT TOXIQUE — le plafond est atteint, et il est VISIBLE');
{
  const ID = 'evt_J';
  const panne = Object.assign(new Error('la même panne, encore'), { code: 'BRIDGE_UNAVAILABLE' });
  const cause = classifyWebhookError(panne);

  let dernierStatut = null;
  for (let i = 0; i < MAX_PROCESSING_ATTEMPTS; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const r = await reclamer(ID);
    dernierStatut = statusAfterFailure({ retryable: cause.retryable, attempts: r.attempts });
    // eslint-disable-next-line no-await-in-loop
    await settleWebhookEvent({ provider: 'STRIPE', externalEventId: ID, status: dernierStatut, error: cause });
  }
  check(`après ${MAX_PROCESSING_ATTEMPTS} tentatives : DEAD_LETTER`, dernierStatut === ST.DEAD_LETTER);

  const doc = await lire(ID);
  check('…le compteur porte la preuve', doc.processingAttempts === MAX_PROCESSING_ATTEMPTS,
    `${doc.processingAttempts}`);
  check('…il n’est plus repris', (await reclamer(ID)).outcome === CLAIM_OUTCOME.TERMINAL);
  check('…et il n’a JAMAIS été jeté en silence : l’état, le compte et la cause sont en base',
    doc.processingStatus === ST.DEAD_LETTER && doc.lastError?.code === 'BRIDGE_UNAVAILABLE');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('K. DEUX PROCESSUS CONCURRENTS — un seul claim, un seul effet');
{
  const ID = 'evt_K';
  const CLE = 'facture_K';

  /**
   * ══ LA CONCURRENCE EST RÉELLE, PAS MISE EN SCÈNE ═════════════════════════
   *
   * Huit réclamations partent ENSEMBLE sur une base réelle. Aucune n'attend les
   * autres : c'est l'index unique et l'écriture conditionnelle qui arbitrent.
   * Un `findOne` suivi d'un `if` échouerait ici, et c'est précisément le motif
   * que ce lot a supprimé.
   */
  const issues = await Promise.all(Array.from({ length: 8 }, () => reclamer(ID)));
  const gagnants = issues.filter((r) => r.outcome === CLAIM_OUTCOME.CLAIMED
    || r.outcome === CLAIM_OUTCOME.RECLAIMED);
  check('exactement UNE réclamation aboutit', gagnants.length === 1,
    `${gagnants.length} gagnant(s) : ${issues.map((r) => r.outcome).join(', ')}`);
  check('…les sept autres voient un bail actif',
    issues.filter((r) => r.outcome === CLAIM_OUTCOME.IN_FLIGHT).length === 7);

  const doc = await lire(ID);
  check('…et le compteur ne monte qu’une fois', doc.processingAttempts === 1,
    `${doc.processingAttempts}`);

  /** Seul le gagnant applique — donc un seul effet métier. */
  for (const r of gagnants) {
    // eslint-disable-next-line no-await-in-loop
    await appliquerEffet(CLE);
  }
  check('effet métier appliqué exactement 1 fois', (await compterEffets(CLE)) === 1);

  /**
   * LE GARDE DE PROPRIÉTÉ — un traitement dépassé n'écrase pas son successeur.
   */
  await WebhookEvent.updateOne({ externalEventId: ID }, { $set: { leaseOwner: 'un-autre-processus' } });
  const ecriture = await settleWebhookEvent({
    provider: 'STRIPE', externalEventId: ID, status: ST.PROCESSED,
  });
  check('un processus qui n’a plus le bail n’écrit RIEN', ecriture.written === false);
  check('…et l’état reste celui du titulaire', (await lire(ID)).processingStatus === ST.PROCESSING);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('L. LE BALAYAGE D’AMORÇAGE — remet en file, abandonne, réconcilie');
{
  await WebhookEvent.deleteMany({});
  await Effet.deleteMany({});

  /** Trois abandonnés de natures différentes, et un conclu qui ne doit PAS bouger. */
  await WebhookEvent.create([
    {
      provider: 'STRIPE', externalEventId: 'evt_L1', eventType: 'invoice.paid', environment: 'TEST',
      processingStatus: ST.PROCESSING, processingAttempts: 1,
      receivedAt: new Date(Date.now() - 60_000), leaseExpiresAt: new Date(Date.now() - 30_000),
      leaseOwner: 'processus-mort',
    },
    {
      provider: 'STRIPE', externalEventId: 'evt_L2', eventType: 'customer.subscription.deleted',
      environment: 'TEST', processingStatus: ST.PENDING, receivedAt: new Date(Date.now() - 60_000),
    },
    {
      provider: 'STRIPE', externalEventId: 'evt_L3', eventType: 'invoice.paid', environment: 'TEST',
      processingStatus: ST.PROCESSING, processingAttempts: MAX_PROCESSING_ATTEMPTS,
      receivedAt: new Date(Date.now() - 60_000), leaseExpiresAt: new Date(Date.now() - 30_000),
    },
    {
      provider: 'STRIPE', externalEventId: 'evt_L4', eventType: 'invoice.paid', environment: 'TEST',
      processingStatus: ST.PROCESSED, receivedAt: new Date(Date.now() - 60_000),
    },
  ]);

  let reconcilie = 0;
  const bilan = await recoverAbandonedWebhookEvents({
    reconcile: async () => { reconcilie += 1; },
  });

  check('le balayage trouve les TROIS abandonnés', bilan.scanned === 3, `${bilan.scanned}`);
  check('…et ignore le conclu', (await lire('evt_L4')).processingStatus === ST.PROCESSED);
  check('un PROCESSING périmé est remis en file',
    (await lire('evt_L1')).processingStatus === ST.PENDING);
  check('…son bail mort est retiré', (await lire('evt_L1')).leaseOwner === null);
  check('…et son compteur de tentatives est CONSERVÉ',
    (await lire('evt_L1')).processingAttempts === 1);
  check('un PENDING ancien est remis en file',
    (await lire('evt_L2')).processingStatus === ST.PENDING);
  check('celui qui a épuisé ses tentatives est ABANDONNÉ, pas remis en boucle',
    (await lire('evt_L3')).processingStatus === ST.DEAD_LETTER);
  check('…avec un motif nommé',
    (await lire('evt_L3')).lastError?.code === 'WEBHOOK_ATTEMPTS_EXHAUSTED');
  check('le bilan compte juste', bilan.rearmed === 2 && bilan.deadLettered === 1,
    `${bilan.rearmed}/${bilan.deadLettered}`);
  check('la réconciliation est déclenchée UNE fois pour tout le lot', reconcilie === 1);
  check('…et le balayage le rapporte', bilan.reconciled === true);
  check('l’âge du plus ancien est rapporté', bilan.oldestAgeSeconds >= 59);

  /** Les remis en file sont réellement reprenables — c'est le but. */
  const r = await reclamer('evt_L2', 'customer.subscription.deleted');
  check('un événement remis en file est REPRIS au rejeu suivant',
    r.outcome === CLAIM_OUTCOME.RECLAIMED, `issue ${r.outcome}`);

  /** Un second balayage ne doit pas dégénérer. */
  await settleWebhookEvent({ provider: 'STRIPE', externalEventId: 'evt_L2', status: ST.PROCESSED });
  const bilan2 = await recoverAbandonedWebhookEvents({ reconcile: async () => { reconcilie += 1; } });
  check('un second balayage ne reprend pas ce qui est conclu', bilan2.scanned === 1,
    `${bilan2.scanned} — seul evt_L1 reste en file`);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('N. LA BARRIÈRE FINALE — invoice.paid, et ce que l’audit y a trouvé');
{
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  const abonnement = await fs.readFile(path.join(SRC, 'services/subscription.service.js'), 'utf8');
  const bloc = abonnement.slice(abonnement.indexOf('export async function markInvoicePaid'));
  const corps = bloc.slice(0, bloc.indexOf('\nexport '));

  /**
   * ══ LA GARDE D'IDEMPOTENCE, D'ABORD ═══════════════════════════════════════
   *
   * C'est elle qui rend un RETRAITEMENT sûr — la question posée par ce lot.
   */
  check('un règlement d’abonnement est cherché AVANT d’être créé',
    /Payment\.findOne\(\{[\s\S]{0,140}externalInvoiceId: invoice\.id/.test(corps));
  check('…et la clé est la FACTURE, pas la date ni le montant',
    /externalInvoiceId: invoice\.id/.test(corps));

  /**
   * ══ CE QUE L'AUDIT A TROUVÉ EN BASE ═══════════════════════════════════════
   *
   *     facture in_1U7KPu… · amount_paid 0 · enregistrée 1 007,86 € TTC
   *
   * `invoice.amount_paid || invoice.total || sub.amountIncludingTax` : les deux
   * premiers termes sont FAUX quand la facture vaut zéro — essai, coupon à
   * 100 %, avoir de proratisation. Le repli s'appliquait, et le paiement était
   * inscrit au prix du CONTRAT. De l'argent jamais encaissé, au dossier d'un
   * client.
   */
  /**
   * ON LIT LE CODE, PAS LES COMMENTAIRES. Le docblock CITE l'ancienne
   * expression pour expliquer le défaut — la chercher telle quelle ferait
   * échouer la recette sur l'explication du correctif.
   */
  const sansCommentaires = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const codeSeul = sansCommentaires(corps);
  check('le montant ne retombe JAMAIS sur le prix du contrat',
    !/amount_paid \|\|/.test(codeSeul) && !/\|\| sub\.amountIncludingTax/.test(codeSeul));
  check('…il vient de la facture, et zéro y est un montant (`??`, pas `||`)',
    /invoice\.amount_paid \?\? invoice\.total \?\? 0/.test(corps));
  check('…et la ventilation ne s’applique que si le montant EST celui du contrat',
    /memePrix/.test(corps));

  /**
   * ══ ET L'APPARTENANCE, QUI L'AVAIT LAISSÉ ENTRER ══════════════════════════
   *
   * La facture nommait un abonnement qu'aucun contrat ne portait ; le repli par
   * CLIENT a désigné le contrat de démonstration. Deux abonnements chez un même
   * client Stripe suffisent — rien d'exotique.
   */
  const facturation = await fs.readFile(path.join(SRC, 'services/billing.service.js'), 'utf8');
  const resolution = facturation.slice(
    facturation.indexOf('export async function resolveContractForInvoice'),
  ).slice(0, 2200);
  const resolutionSeule = sansCommentaires(resolution);
  const blocSub = resolutionSeule.slice(
    resolutionSeule.indexOf('if (subId)'), resolutionSeule.indexOf('const custId'),
  );
  check('une facture qui nomme un AUTRE abonnement n’est pas attribuée',
    blocSub.includes('return null;'), blocSub.trim().slice(0, 120));
  check('…le repli par client ne sert plus qu’aux factures SANS abonnement',
    resolutionSeule.indexOf('const custId') > resolutionSeule.indexOf('if (subId)'));
  check('…et le refus est JOURNALISÉ, pas silencieux',
    /logger\.warn\([\s\S]{0,220}non attribuée/.test(resolution));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('M. LE MOTIF « la ligne existe donc c’est un doublon » A DISPARU');
{
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const source = await fs.readFile(path.join(SRC, 'services/contractWebhook.service.js'), 'utf8');

  check('plus aucun `code === 11000 → duplicate` dans le dispatcher',
    !/11000\s*\)\s*return\s*\{\s*event:\s*null,\s*duplicate:\s*true/.test(source));
  check('le dispatcher passe par la réclamation', /claimWebhookEvent\(/.test(source));
  check('…et distingue TERMINAL de IN_FLIGHT',
    /CLAIM_OUTCOME\.TERMINAL/.test(source) && /CLAIM_OUTCOME\.IN_FLIGHT/.test(source));
  check('un échec est CLASSÉ avant d’être écrit',
    /classifyWebhookError\(/.test(source) && /statusAfterFailure\(/.test(source));

  const amorcage = await fs.readFile(
    path.join(SRC, 'services/lifecycle/structuralRecovery.service.js'), 'utf8',
  );
  check('la reprise des webhooks est une étape des REPRISES STRUCTURELLES',
    /recoverAbandonedWebhookEvents\(/.test(amorcage));
}

/* ══════════════════════════════════════════════════════════════════════════ */
console.log(`\n${pass} réussis, ${fail} échoués`);
await disconnectDatabase();
await mongod.stop();
process.exit(fail === 0 ? 0 : 1);
