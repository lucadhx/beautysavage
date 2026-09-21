/**
 * LA REPRISE AUTOMATIQUE DES ENVOIS — et le message qui a cessé d'être vrai.
 *
 * ══ LES DEUX DÉFAUTS QUE CES CONTRÔLES FERMENT ══════════════════════════════
 *
 * 1. Un envoi temporairement refusé attendait le PROCHAIN DÉMARRAGE du
 *    processus. Toute la mécanique existait — `availableAt`, backoff borné,
 *    verrou atomique — mais personne ne regardait l'heure. Une relance
 *    d'impayé pouvait donc dormir des semaines, pour un message dont l'intérêt
 *    est d'arriver AVANT l'échéance de suspension.
 *
 * 2. Une relance créée, différée, puis rattrapée après que le client a payé
 *    partait quand même : « nous n'avons toujours pas reçu votre règlement »,
 *    à quelqu'un qui venait de régler. Ce n'est pas un défaut d'idempotence —
 *    rien n'était jamais parti. C'est un message devenu FAUX en attendant.
 *
 * ══ CE QUI EST DIFFICILE, ET DONC CE QUI EST TESTÉ ══════════════════════════
 *
 * Distinguer « réessayer » de « renvoyer ». Un test qui compterait seulement
 * « un envoi a fini par réussir » validerait aussi bien la version qui en
 * envoie trois.
 */
process.env.NODE_ENV = 'test';
process.env.ENV = 'TEST';
process.env.JWT_SECRET = 'test-secret-jwt';

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let pass = 0; let fail = 0;
const check = (nom, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✓ ${nom}`); }
  else { fail += 1; console.error(`  ✗ ${nom}${extra ? ` — ${extra}` : ''}`); }
};
const section = (t) => console.log(`\n${t}`);

const memoire = await MongoMemoryServer.create();
await mongoose.connect(memoire.getUri(), { dbName: 'sbauto_event_retry' });

const { EventActionExecution } = await import('../models/EventActionExecution.model.js');
const { DomainEvent } = await import('../models/DomainEvent.model.js');
const { PaymentDefaultIncident } = await import('../models/PaymentDefaultIncident.model.js');
const constantes = await import('../utils/domainEventConstants.js');
const dispatcher = await import('../services/events/domainEventDispatcher.service.js');
const relevance = await import('../services/events/actionRelevance.js');
const ordonnanceur = await import('../services/events/eventActionScheduler.js');
const actions = await import('../services/events/eventActionHandlerRegistry.js');

const { EXECUTION_STATUS, ACTION_TYPE } = constantes;

/** Ce que le handler d'envoi fera, pilotable depuis le test. */
let comportement = 'OK';
const envois = [];

/* Le répartiteur lit `err.retryable` via `ActionHandlerError` : on emploie LA
   classe du produit, pour éprouver la classification réelle et non une copie. */
const { ActionHandlerError } = actions;

actions.registerHandler(ACTION_TYPE.SEND_EMAIL, async ({ event, execution }) => {
  if (comportement === 'TEMPORAIRE') {
    throw new ActionHandlerError(
      'PROVIDER_NOT_CONFIGURED', 'Plateforme d’envoi injoignable.', true,
    );
  }
  if (comportement === 'PERMANENT') {
    throw new ActionHandlerError(
      'TEMPLATE_UNKNOWN', 'Modèle inconnu.', false,
    );
  }
  envois.push({ eventId: event.eventId, executionId: String(execution._id) });
  return { providerMessageId: `msg-${envois.length}` };
});

const INCIDENT = 'pd-retry';
const creerEvenement = async (type = 'contract.payment.retry_failed') => {
  const eventId = `ev-${Math.random().toString(36).slice(2, 10)}`;
  await DomainEvent.create({
    eventId,
    type,
    entityType: 'Contract',
    entityId: 'c-1',
    actor: { type: 'system' },
    payloadSafe: { paymentDefaultId: INCIDENT },
    occurredAt: new Date(),
    retentionClass: 'OPERATIONAL',
  });
  return DomainEvent.findOne({ eventId });
};

const creerExecution = async (event) => EventActionExecution.create({
  eventId: event.eventId,
  eventType: event.type,
  actionId: 'notify-admins-payment-retry-failed',
  actionType: ACTION_TYPE.SEND_EMAIL,
  templateId: 'CONTRACT_PAYMENT_RETRY_FAILED_ADMIN',
  recipientResolver: 'ADMIN_EMAILS',
  recipientKey: 'admin@test.fr',
  status: EXECUTION_STATUS.PENDING,
  maxAttempts: 4,
  availableAt: new Date(),
});

/* Le registre d'actions doit connaître l'action, sinon elle est SKIPPED. */
const registre = await import('../utils/domainEventActionRegistry.js');
const actionConnue = registre.actionsForEvent('contract.payment.retry_failed')
  .some((a) => a.actionId === 'notify-admins-payment-retry-failed');

// ═══════════════════════════════════════════════════════════════════════════
section('0 · LE TERRAIN');
{
  check('l’action de relance existe au registre', actionConnue);
  check('le statut OBSOLETE existe', EXECUTION_STATUS.OBSOLETE === 'OBSOLETE');
  check('…et il est TERMINAL', constantes.TERMINAL_STATUSES.includes('OBSOLETE'));
  check('…il n’est donc jamais reprenable',
    !constantes.CLAIMABLE_STATUSES.includes('OBSOLETE'));
}

// ═══════════════════════════════════════════════════════════════════════════
section('1 · ÉCHEC TEMPORAIRE — l’action reste reprenable, avec une date');
{
  relevance.clearRelevanceGuards();
  await PaymentDefaultIncident.deleteMany({});
  await PaymentDefaultIncident.create({
    paymentDefaultId: INCIDENT, status: 'OPEN', attemptCount: 2, receivedAt: new Date().toISOString(),
  });

  comportement = 'TEMPORAIRE';
  const ev = await creerEvenement();
  const ex = await creerExecution(ev);
  await dispatcher.processPendingEventActions();

  const apres = await EventActionExecution.findById(ex._id).lean();
  check('l’action est en ÉCHEC, pas morte', apres.status === EXECUTION_STATUS.FAILED, apres.status);
  check('…une tentative a été comptée', apres.attempts === 1, String(apres.attempts));
  check('…une PROCHAINE tentative est datée', apres.availableAt > new Date(), String(apres.availableAt));
  check('…et la nature de l’erreur est conservée',
    apres.lastErrorSafe.retryable === true && apres.lastErrorSafe.code === 'PROVIDER_NOT_CONFIGURED');
  check('aucun envoi n’a eu lieu', envois.length === 0);
  globalThis.__ex = ex._id;
}

// ═══════════════════════════════════════════════════════════════════════════
section('2 · SANS AUCUN REDÉMARRAGE — l’ordonnanceur la reprend');
{
  const id = globalThis.__ex;
  /* On avance l'horloge de l'action plutôt que d'attendre le backoff : c'est
     la DATE qui décide, et c'est elle qu'on éprouve. */
  await EventActionExecution.updateOne({ _id: id }, { $set: { availableAt: new Date(Date.now() - 1000) } });

  comportement = 'OK';
  /* Le cycle du minuteur, appelé directement — même fonction, sans attendre. */
  const r = await ordonnanceur.runEventActionRetryCycle();
  check('le cycle a repris une action', r.processed === 1, JSON.stringify(r));

  const apres = await EventActionExecution.findById(id).lean();
  check('elle a RÉUSSI', apres.status === EXECUTION_STATUS.SUCCEEDED, apres.status);
  check('…à la deuxième tentative', apres.attempts === 2, String(apres.attempts));
  check('UN SEUL envoi logique', envois.length === 1, String(envois.length));
  check('…avec un identifiant de message', Boolean(apres.providerMessageId));
}

// ═══════════════════════════════════════════════════════════════════════════
section('3 · UN SUCCÈS NE SE REJOUE JAMAIS');
{
  const avant = envois.length;
  await ordonnanceur.runEventActionRetryCycle();
  await ordonnanceur.runEventActionRetryCycle();
  check('deux cycles de plus n’envoient rien', envois.length === avant, `${avant} → ${envois.length}`);
}

// ═══════════════════════════════════════════════════════════════════════════
section('4 · ÉCHEC PERMANENT — aucune tentative gaspillée');
{
  comportement = 'PERMANENT';
  const ev = await creerEvenement();
  const ex = await creerExecution(ev);
  await dispatcher.processPendingEventActions();

  const apres = await EventActionExecution.findById(ex._id).lean();
  check('l’action est morte TOUT DE SUITE', apres.status === EXECUTION_STATUS.DEAD_LETTER, apres.status);
  check('…après UNE seule tentative', apres.attempts === 1, String(apres.attempts));
  check('…et le motif est marqué non reprenable', apres.lastErrorSafe.retryable === false);

  const avant = envois.length;
  await ordonnanceur.runEventActionRetryCycle();
  check('l’ordonnanceur ne la reprend pas', envois.length === avant);
  check('…elle reste morte',
    (await EventActionExecution.findById(ex._id).lean()).attempts === 1);
}

// ═══════════════════════════════════════════════════════════════════════════
section('5 · LE MAIL DEVENU FAUX — payé pendant l’attente');
{
  const { relanceImpayeEncorePertinente } = await import('../services/email/billingVariableResolver.js');
  relevance.registerRelevanceGuard('contract.payment.retry_failed', relanceImpayeEncorePertinente);

  comportement = 'TEMPORAIRE';
  await PaymentDefaultIncident.updateOne({ paymentDefaultId: INCIDENT }, { $set: { status: 'OPEN' } });
  const ev = await creerEvenement();
  const ex = await creerExecution(ev);
  await dispatcher.processPendingEventActions();
  check('la relance échoue temporairement',
    (await EventActionExecution.findById(ex._id).lean()).status === EXECUTION_STATUS.FAILED);

  /* ── LE CLIENT PAIE PENDANT L'ATTENTE ─────────────────────────────────── */
  await PaymentDefaultIncident.updateOne(
    { paymentDefaultId: INCIDENT },
    { $set: { status: 'RESOLVED', resolution: 'PAID' } },
  );
  await EventActionExecution.updateOne({ _id: ex._id }, { $set: { availableAt: new Date(Date.now() - 1000) } });

  comportement = 'OK'; // la dépendance est rétablie : rien n'empêcherait l'envoi
  const avant = envois.length;
  await ordonnanceur.runEventActionRetryCycle();

  const apres = await EventActionExecution.findById(ex._id).lean();
  check('AUCUN mail trompeur n’est parti', envois.length === avant, `${avant} → ${envois.length}`);
  check('l’action est OBSOLETE', apres.status === EXECUTION_STATUS.OBSOLETE, apres.status);
  check('…et le motif nomme la raison',
    /RESOLVED/.test(apres.lastErrorSafe.message), apres.lastErrorSafe.message);
  check('…ce n’est ni un succès', apres.status !== EXECUTION_STATUS.SUCCEEDED);
  check('…ni une panne', apres.status !== EXECUTION_STATUS.DEAD_LETTER);
  check('…et elle ne sera plus reprise',
    !constantes.CLAIMABLE_STATUSES.includes(apres.status));
}

// ═══════════════════════════════════════════════════════════════════════════
section('6 · UNE DETTE TOUJOURS VIVANTE — la relance part');
{
  await PaymentDefaultIncident.updateOne(
    { paymentDefaultId: INCIDENT },
    { $set: { status: 'GRACE_EXPIRED', resolution: null } },
  );
  comportement = 'OK';
  const ev = await creerEvenement();
  const ex = await creerExecution(ev);
  const avant = envois.length;
  await dispatcher.processPendingEventActions();

  const apres = await EventActionExecution.findById(ex._id).lean();
  check('la grâce épuisée reste un impayé vivant',
    apres.status === EXECUTION_STATUS.SUCCEEDED, apres.status);
  check('…et le message part', envois.length === avant + 1);
}

// ═══════════════════════════════════════════════════════════════════════════
section('7 · UN INCIDENT INTROUVABLE NE FAIT PAS TAIRE LA RELANCE');
{
  /* « Introuvable » n'est pas « réglé » : se taire masquerait une donnée
     manquante derrière un « sans objet » rassurant. */
  await PaymentDefaultIncident.deleteMany({});
  comportement = 'OK';
  const ev = await creerEvenement();
  const ex = await creerExecution(ev);
  const avant = envois.length;
  await dispatcher.processPendingEventActions();
  check('le doute profite à l’envoi', envois.length === avant + 1);
  check('…et l’action réussit',
    (await EventActionExecution.findById(ex._id).lean()).status === EXECUTION_STATUS.SUCCEEDED);
}

// ═══════════════════════════════════════════════════════════════════════════
section('8 · L’ORDONNANCEUR — un seul cycle à la fois, et il se vidange');
{
  check('il n’est pas démarré par le simple import',
    ordonnanceur.isEventActionSchedulerRunning() === false);
  const { intervalMs } = ordonnanceur.startEventActionScheduler({ immediate: false });
  check('il démarre', ordonnanceur.isEventActionSchedulerRunning() === true);
  check('…à la maille du plus petit palier de backoff', intervalMs === 30_000, String(intervalMs));

  const vidange = await ordonnanceur.drainEventActionScheduler({ timeoutMs: 2000 });
  check('la vidange l’arrête', vidange.drained === true);
  check('…et le minuteur est bien coupé',
    ordonnanceur.isEventActionSchedulerRunning() === false);

  const src = (await import('node:fs')).readFileSync(
    new URL('../services/events/eventActionScheduler.js', import.meta.url), 'utf8',
  );
  /*
    IL N'INVENTE PAS UNE SECONDE MÉCANIQUE DE TÂCHES : il appelle la fonction
    existante. Un second moteur aurait divergé du premier au premier correctif.
  */
  check('il délègue au répartiteur existant', /processPendingEventActions\(\)/.test(src));
  check('…et n’écrit lui-même aucune exécution', !/EventActionExecution/.test(src));
}

await mongoose.disconnect();
await memoire.stop();

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
