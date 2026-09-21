/* Tests des événements métier : registre, sécurité des payloads, émission,
 * idempotence, dispatcher, retry, verrous, reprise, audit Brevo.
 * Fournisseur Brevo SIMULÉ. Runner autonome. */
import { MongoMemoryServer } from 'mongodb-memory-server';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
/*
  ══ LE NOMBRE DE DESTINATAIRES EST UNE DONNÉE DU DÉCOR ══════════════════════

  Cette recette compte les exécutions matérialisées : deux actions de
  résiliation, donc deux exécutions — une par destinataire résolu. Or le
  résolveur `DEV_EMAILS` rend TOUS les comptes développeur de la base, et
  l'amorçage en crée un de plus sur un poste de développement, dérivé du `.env`
  de la machine (`FIRST_DEV_EMAIL`). Trois exécutions au lieu de deux, et une
  assertion d'idempotence au rouge — chez le développeur uniquement.

  Le décor de recette pose lui-même les comptes qu'il attend : on neutralise
  donc l'identité de la machine. On VIDE plutôt qu'on ne supprime, `dotenv` ne
  remplaçant jamais une variable déjà posée.
*/
process.env.FIRST_DEV_EMAIL = '';
process.env.SEED_DEV_EMAIL = '';
process.env.FIRST_ADMIN_EMAIL = '';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'test_base';
process.env.DB_PROD = 'prod_base';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.PORT = '4140';
process.env.CORS_ORIGINS = 'http://localhost:6061,http://localhost:6062';
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
section('Sécurité des payloads');
const safety = await import('../utils/eventPayloadSafety.js');
const { assertSafePayload, EventPayloadError, maskEmail, isForbiddenKey, FORBIDDEN_PAYLOAD_KEYS, MAX_PAYLOAD_DEPTH } = safety;

function rejects(fn, code) {
  try { fn(); return false; } catch (e) { return e instanceof EventPayloadError && e.code === code; }
}

{
  check('payload simple accepté', assertSafePayload({ a: 1, b: 'x', c: true, d: null }) !== null);
  check('imbrication raisonnable acceptée', assertSafePayload({ a: { b: { c: 'x' } } }) !== null);
  check('tableau accepté', assertSafePayload({ list: ['a', 'b'] }) !== null);
  check('Date acceptée', assertSafePayload({ at: new Date() }) !== null);

  check('racine non-objet refusée', rejects(() => assertSafePayload('x'), 'INVALID_PAYLOAD'));
  check('racine tableau refusée', rejects(() => assertSafePayload([]), 'INVALID_PAYLOAD'));
  check('null refusé', rejects(() => assertSafePayload(null), 'INVALID_PAYLOAD'));

  // Le cœur : aucune clé sensible, à aucune profondeur.
  check('apiKey refusée', rejects(() => assertSafePayload({ apiKey: 'x' }), 'SENSITIVE_KEY'));
  check('api_key refusée (normalisation)', rejects(() => assertSafePayload({ api_key: 'x' }), 'SENSITIVE_KEY'));
  check('API-KEY refusée (casse)', rejects(() => assertSafePayload({ 'API-KEY': 'x' }), 'SENSITIVE_KEY'));
  check('otp refusé', rejects(() => assertSafePayload({ otp: '123456' }), 'SENSITIVE_KEY'));
  check('password refusé', rejects(() => assertSafePayload({ password: 'x' }), 'SENSITIVE_KEY'));
  check('token refusé', rejects(() => assertSafePayload({ token: 'x' }), 'SENSITIVE_KEY'));
  check('secret refusé', rejects(() => assertSafePayload({ secret: 'x' }), 'SENSITIVE_KEY'));
  check('authorization refusée', rejects(() => assertSafePayload({ authorization: 'x' }), 'SENSITIVE_KEY'));
  check('cookie refusé', rejects(() => assertSafePayload({ cookie: 'x' }), 'SENSITIVE_KEY'));
  check('html refusé', rejects(() => assertSafePayload({ html: '<b>' }), 'SENSITIVE_KEY'));
  check('rawPayload refusé', rejects(() => assertSafePayload({ rawPayload: {} }), 'SENSITIVE_KEY'));
  check('clé sensible IMBRIQUÉE refusée', rejects(() => assertSafePayload({ a: { b: { apiKey: 'x' } } }), 'SENSITIVE_KEY'));
  check('clé sensible DANS UN TABLEAU refusée', rejects(() => assertSafePayload({ l: [{ otp: '1' }] }), 'SENSITIVE_KEY'));
  // Sous-chaîne : stripeSecretKey contient « secret ».
  check('stripeSecretKey refusée (sous-chaîne)', rejects(() => assertSafePayload({ stripeSecretKey: 'x' }), 'SENSITIVE_KEY'));
  check('webhookSecret refusée', rejects(() => assertSafePayload({ webhookSecret: 'x' }), 'SENSITIVE_KEY'));
  check('htmlContent refusée', rejects(() => assertSafePayload({ htmlContent: 'x' }), 'SENSITIVE_KEY'));

  check('clé anodine acceptée', assertSafePayload({ domain: 'x.fr', status: 'OK' }) !== null);
  check('isForbiddenKey(apiKey)', isForbiddenKey('apiKey') === true);
  check('isForbiddenKey(domain)', isForbiddenKey('domain') === false);
  check('liste centralisée non vide', FORBIDDEN_PAYLOAD_KEYS.length > 10);

  // Profondeur et taille.
  const deep = { a: { b: { c: { d: { e: { f: 'trop' } } } } } };
  check('profondeur excessive refusée', rejects(() => assertSafePayload(deep), 'PAYLOAD_TOO_DEEP'));
  check('profondeur max cohérente', MAX_PAYLOAD_DEPTH >= 3 && MAX_PAYLOAD_DEPTH <= 8);
  check('taille excessive refusée', rejects(() => assertSafePayload({ big: 'x'.repeat(9000) }), 'PAYLOAD_TOO_LARGE'));
  const many = {};
  for (let i = 0; i < 300; i += 1) many[`k${i}`] = i;
  check('trop de nœuds refusé', rejects(() => assertSafePayload(many), 'PAYLOAD_TOO_LARGE'));

  // Jamais un objet d'erreur ni un objet fournisseur brut.
  check('objet Error refusé', rejects(() => assertSafePayload({ e: new Error('boom') }), 'INVALID_PAYLOAD'));
  check('fonction refusée', rejects(() => assertSafePayload({ f: () => {} }), 'INVALID_PAYLOAD'));
  check('Map refusée', rejects(() => assertSafePayload({ m: new Map() }), 'INVALID_PAYLOAD'));
  check('NaN refusé', rejects(() => assertSafePayload({ n: NaN }), 'INVALID_PAYLOAD'));
  check('undefined refusé', rejects(() => assertSafePayload({ u: undefined }), 'INVALID_PAYLOAD'));

  // Masquage.
  check('masque garde le domaine', maskEmail('support@lysolution.fr') === 's***@lysolution.fr');
  check('masque cache la boîte', !maskEmail('support@lysolution.fr').includes('upport'));
  check('masque adresse vide', maskEmail('') === '');
  check('masque adresse sans @', maskEmail('bizarre') === '***');
}

// ---------------------------------------------------------------------------
section('Registre');
const registry = await import('../utils/domainEventRegistry.js');
const { isKnownEventType, assertKnownEventType, validateEventPayload, describeRegistry, DOMAIN_EVENT_TYPES } = registry;
const actionRegistry = await import('../utils/domainEventActionRegistry.js');
{
  check('type connu', isKnownEventType('email.test.accepted') === true);
  check('type inconnu', isKnownEventType('nope.nope') === false);
  check('type inconnu refusé', rejects(() => assertKnownEventType('nope.nope'), 'UNKNOWN_EVENT_TYPE'));

  // Les types obligatoires du lot.
  const required = [
    'email.sender.updated', 'email.test.accepted', 'email.test.failed', 'contact.submitted',
    'contract.cancel_requested', 'contract.cancel_at_period_end', 'contract.ended',
  ];
  // Les parcours OTP et domaine ayant quitté le produit, leurs types ne doivent
  // plus exister : un vocabulaire qui survit à sa fonctionnalité invite à la
  // rebrancher « au cas où ».
  const removed = [
    'email.sender.verification_requested', 'email.sender.verified', 'email.sender.verification_failed',
    'email.domain.configuration_requested', 'email.domain.pending_dns', 'email.domain.authenticated',
    'email.domain.authentication_failed',
  ];
  check('types OTP/domaine retirés du registre', removed.every((t) => !isKnownEventType(t)));
  check('tous les types obligatoires déclarés', required.every((t) => isKnownEventType(t)));
  // Les réservés, déclarés pour figer le vocabulaire.
  const reserved = ['contract.created', 'contract.dev_signed', 'contract.client_signed', 'contract.fully_signed',
    'launch_fee.paid', 'subscription.activated', 'site.activated', 'site.suspended'];
  check('types réservés déclarés', reserved.every((t) => isKnownEventType(t)));

  check('chaque entrée a description/entityTypes/rétention',
    DOMAIN_EVENT_TYPES.every((t) => {
      const d = registry.eventDefinition(t);
      return d.description && d.entityTypes.length > 0 && d.retentionClass;
    }));
  check('introspection sûre (aucun schéma zod exposé)',
    describeRegistry().every((e) => !('payloadSchema' in e)));

  // Payloads.
  const good = {
    mode: 'TEST', provider: 'BREVO', senderEmailMasked: 's***@x.fr',
    recipientMasked: 'd***@x.fr', messageIdSafe: '<m@brevo>',
  };
  check('payload valide accepté',
    validateEventPayload('email.test.accepted', good).messageIdSafe === '<m@brevo>');
  check('payload invalide refusé', rejects(() => validateEventPayload('email.test.accepted', { mode: 'TEST' }), 'INVALID_PAYLOAD'));
  check('mode inconnu refusé', rejects(() => validateEventPayload('email.test.accepted', { ...good, mode: 'STAGING' }), 'INVALID_PAYLOAD'));
  check('clé en trop refusée (strict)', rejects(() => validateEventPayload('email.test.accepted', { ...good, extra: 1 }), 'INVALID_PAYLOAD'));

  check('registre d’actions cohérent', actionRegistry.validateActionRegistry().length === 0);
  check('événement d’audit sans action', actionRegistry.actionsForEvent('email.test.accepted').length === 0);
  check('contact.submitted a une action déclarée', actionRegistry.actionsForEvent('contact.submitted').length === 1);
  // ACTIVÉE depuis le lot contact : le template, son résolveur de variables et la
  // chaîne d'envoi existent. Couverte de bout en bout par contact.test.js.
  check('action contact ACTIVÉE (lot contact)',
    actionRegistry.actionsForEvent('contact.submitted')[0].enabled === true);
  // Les actions de résiliation, elles, attendent toujours leur lot.
  check('actions résiliation encore désactivées (lot résiliation)',
    actionRegistry.actionsForEvent('contract.cancel_at_period_end').every((a) => a.enabled === false));
  check('résiliation : deux actions, deux destinataires distincts',
    actionRegistry.actionsForEvent('contract.cancel_at_period_end').length === 2 &&
    new Set(actionRegistry.actionsForEvent('contract.cancel_at_period_end').map((a) => a.recipientResolver)).size === 2);
  check('résiliation : deux templates distincts',
    new Set(actionRegistry.actionsForEvent('contract.cancel_at_period_end').map((a) => a.templateId)).size === 2);
  check('aucune adresse e-mail dans le registre d’actions',
    !JSON.stringify(actionRegistry.DOMAIN_EVENT_ACTION_REGISTRY).includes('@'));
}

// ---------------------------------------------------------------------------
section('Émission');
const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
const { bootstrap } = await import('../config/bootstrap.js');
await connectDatabase();
await bootstrap();
// Le service est PRÊT : cette suite a fait elle-même tout ce que le démarrage fait.
await (await import("./helpers/serviceReady.helper.js")).markTestServiceReady();
// LOT 2C — le DÉCOR de recette (dev@mail.com, admin@mail.com) ne vient plus du
// produit : `bootstrap()` ne pose aucun mot de passe. Voir helpers/testAccounts.helper.js.
await (await import("./helpers/testAccounts.helper.js")).seedTestAccounts();

const { DomainEvent } = await import('../models/DomainEvent.model.js');
const { EventActionExecution } = await import('../models/EventActionExecution.model.js');
const events = await import('../services/events/domainEvent.service.js');
const dispatcher = await import('../services/events/domainEventDispatcher.service.js');
const { EXECUTION_STATUS, EVENT_DISPATCH_STATUS, ACTION_TYPE, SINGLE_RECIPIENT_KEY, nextBackoffMs } =
  await import('../utils/domainEventConstants.js');

const SENDER_PAYLOAD = { mode: 'TEST', provider: 'BREVO', senderEmailMasked: 's***@x.fr', emailChanged: true };
const base = {
  type: 'email.sender.updated',
  entityType: 'EmailConfiguration',
  entityId: 'email-configuration:TEST',
  payloadSafe: SENDER_PAYLOAD,
};

const { makeBrevoOperational } = await import('./helpers/brevoOperational.helper.js');

async function resetEvents() {
  await DomainEvent.deleteMany({});
  await EventActionExecution.deleteMany({});
  // Les actions d'envoi passent par le garde-fou « pas de suivi, pas d'envoi ».
  await makeBrevoOperational('TEST');
  await makeBrevoOperational('PROD');
}

{
  await resetEvents();
  const e = await events.emit(base);
  check('événement créé', Boolean(e.eventId));
  check('eventId au format UUID', /^[0-9a-f-]{36}$/.test(e.eventId));
  check('type conservé', e.type === 'email.sender.updated');
  check('rétention déduite du registre', e.retentionClass === 'AUDIT');
  check('occurredAt renseigné', e.occurredAt instanceof Date);
  check('statut initial PENDING', e.dispatchStatus === 'PENDING');
  check('acteur par défaut = system', e.actor.type === 'system');

  const e2 = await events.emit(base);
  check('deux émissions sans clé -> deux événements', e2.eventId !== e.eventId);

  const withActor = await events.emit({ ...base, actor: { type: 'user', id: '507f1f77bcf86cd799439011', role: 'DEV' } });
  check('acteur utilisateur conservé', withActor.actor.type === 'user' && withActor.actor.role === 'DEV');

  // Refus.
  let threw = null;
  try { await events.emit({ ...base, type: 'nope.nope' }); } catch (err) { threw = err; }
  check('type inconnu refusé à l’émission', threw?.code === 'UNKNOWN_EVENT_TYPE');
  threw = null;
  try { await events.emit({ ...base, entityType: 'Contract' }); } catch (err) { threw = err; }
  check('entité non autorisée refusée', threw?.code === 'INVALID_PAYLOAD');
  threw = null;
  try { await events.emit({ ...base, payloadSafe: { ...SENDER_PAYLOAD, apiKey: 'xkeysib-secret' } }); } catch (err) { threw = err; }
  check('clé sensible refusée à l’émission', threw?.code === 'SENSITIVE_KEY');
  check('aucun événement écrit sur refus', (await DomainEvent.countDocuments({ type: 'email.sender.updated' })) === 3);

  // emitSafe n'échoue jamais.
  const safe = await events.emitSafe({ ...base, type: 'nope.nope' });
  check('emitSafe renvoie null au lieu de lever', safe === null);
}

// ---------------------------------------------------------------------------
section('Idempotence d’émission');
{
  await resetEvents();
  const key = 'sender-verified:TEST:support@x.fr:2026-07-17T10:00:00.000Z';
  const a = await events.emit({ ...base, idempotencyKey: key });
  const b = await events.emit({ ...base, idempotencyKey: key });
  check('même clé -> même événement', a.eventId === b.eventId);
  check('même clé -> un seul document', (await DomainEvent.countDocuments({ idempotencyKey: key })) === 1);

  const c = await events.emit({ ...base, idempotencyKey: `${key}-autre` });
  check('clés différentes -> événements distincts', c.eventId !== a.eventId);

  const d1 = await events.emit(base);
  const d2 = await events.emit(base);
  check('sans clé -> pas de collision (partial index)', d1.eventId !== d2.eventId);
  check('deux sans clé coexistent', (await DomainEvent.countDocuments({ idempotencyKey: null })) === 2);

  // Concurrence sur la même clé : l'index unique tranche, emit renvoie le gagnant.
  await resetEvents();
  const k2 = 'concurrent-key';
  const results = await Promise.all([
    events.emit({ ...base, idempotencyKey: k2 }),
    events.emit({ ...base, idempotencyKey: k2 }),
    events.emit({ ...base, idempotencyKey: k2 }),
  ]);
  check('3 émissions concurrentes -> 1 seul événement', (await DomainEvent.countDocuments({ idempotencyKey: k2 })) === 1);
  check('toutes renvoient le même eventId', new Set(results.map((r) => r.eventId)).size === 1);
}

// ---------------------------------------------------------------------------
section('Matérialisation des actions');
{
  await resetEvents();
  // Zéro action (audit Brevo).
  const audit = await events.emit(base);
  const status = await dispatcher.dispatchEvent(audit.eventId);
  check('zéro action -> DISPATCHED', status === EVENT_DISPATCH_STATUS.DISPATCHED);
  check('zéro action -> aucune exécution', (await EventActionExecution.countDocuments({ eventId: audit.eventId })) === 0);

  // Deux actions (résiliation).
  const cancel = await events.emit({
    type: 'contract.cancel_at_period_end',
    entityType: 'Contract',
    entityId: '507f1f77bcf86cd799439011',
    payloadSafe: { reference: 'CTR-2026-0001', currentPeriodEnd: '2026-08-01T00:00:00.000Z' },
  });
  await dispatcher.dispatchEvent(cancel.eventId);
  const execs = await EventActionExecution.find({ eventId: cancel.eventId });
  check('deux actions -> deux exécutions', execs.length === 2);
  // Depuis le lot e-mail, le module enregistre son résolveur au bootstrap : les
  // clés ne sont plus `_single` mais l'empreinte de chaque destinataire résolu
  // (un ADMIN pour l'une, un DEV pour l'autre). C'est le mécanisme « une
  // exécution PAR destinataire » qui entre en service.
  check('recipientKey = empreinte du destinataire résolu (plus `_single`)',
    execs.every((x) => x.recipientKey !== SINGLE_RECIPIENT_KEY && /^[0-9a-f]{16}$/.test(x.recipientKey)));
  check('actions désactivées -> SKIPPED (trace, pas trou)',
    execs.every((x) => x.status === EXECUTION_STATUS.SKIPPED));
  check('templateId conservé', execs.every((x) => Boolean(x.templateId)));
  check('resolver conservé', execs.every((x) => Boolean(x.recipientResolver)));
  check('toutes SKIPPED -> DISPATCHED',
    (await DomainEvent.findOne({ eventId: cancel.eventId })).dispatchStatus === EVENT_DISPATCH_STATUS.DISPATCHED);

  // Matérialisation IDEMPOTENTE : re-dispatcher n'ajoute rien.
  await dispatcher.dispatchEvent(cancel.eventId);
  await dispatcher.dispatchEvent(cancel.eventId);
  check('re-dispatch -> toujours deux exécutions (index unique)',
    (await EventActionExecution.countDocuments({ eventId: cancel.eventId })) === 2);

  // L'index unique est structurel, pas applicatif. On duplique une exécution
  // RÉELLE : depuis le lot e-mail, sa `recipientKey` est l'empreinte du
  // destinataire — reprendre `_single` ne déclencherait plus l'index, et le test
  // passerait pour de mauvaises raisons.
  const existing = execs[0];
  let dup = false;
  try {
    await EventActionExecution.create({
      eventId: existing.eventId, eventType: existing.eventType,
      actionId: existing.actionId, actionType: existing.actionType,
      recipientKey: existing.recipientKey, maxAttempts: 1, availableAt: new Date(),
    });
  } catch (err) { dup = err.code === 11000; }
  check('doublon exécution refusé par la base', dup);
}

// ---------------------------------------------------------------------------
section('Dispatch : succès, retry, dead letter');
/*
 * On pilote les scénarios via le registre RÉEL :
 *  - `registerHandler` remplace l'implémentation d'un type d'action (le seam prévu
 *    pour le lot e-mail) ;
 *  - `enabled` des actions déclarées est basculé le temps du test.
 * Le registre lui-même n'est jamais étendu : `Object.freeze` l'interdit — c'est
 * précisément ce qu'on veut d'un registre code-first.
 */
const handlerRegistry = await import('../services/events/eventActionHandlerRegistry.js');
const { ActionHandlerError, registerHandler } = handlerRegistry;
const CONTACT_ACTION = actionRegistry.actionsForEvent('contact.submitted')[0];
const CANCEL_ACTIONS = actionRegistry.actionsForEvent('contract.cancel_at_period_end');

// Le payload s'est enrichi au lot contact (submissionId, contactName, contactCompany, source).
// Il reste sans donnée personnelle complète : e-mail MASQUÉ, message ABSENT.
const CONTACT_EVENT = {
  type: 'contact.submitted',
  entityType: 'ContactSubmission',
  entityId: '507f1f77bcf86cd799439099',
  payloadSafe: {
    submissionId: '507f1f77bcf86cd799439099',
    contactName: 'Jean Dupont',
    contactEmailMasked: 'j***@x.fr',
    // L'entreprise fait partie du payload depuis que le formulaire l'exige.
    contactCompany: 'Atelier Dupont',
    reason: 'QUOTE',
    submittedAt: '2026-07-17T10:00:00.000Z',
    source: 'PUBLIC_WEBSITE',
  },
};
const CANCEL_EVENT = {
  type: 'contract.cancel_at_period_end',
  entityType: 'Contract',
  entityId: '507f1f77bcf86cd799439011',
  payloadSafe: { reference: 'CTR-2026-0001', currentPeriodEnd: '2026-08-01T00:00:00.000Z' },
};

{
  // --- Action désactivée -> SKIPPED, sans jamais appeler le handler ---------
  //
  // La fixture est CANCEL_EVENT : `contact.submitted` a été ACTIVÉ au lot contact,
  // il ne peut donc plus servir à tester le comportement d'une action désactivée.
  // Les actions de résiliation, elles, attendent toujours leur lot.
  await resetEvents();
  let handlerCalls = 0;
  let restore = registerHandler(ACTION_TYPE.SEND_EMAIL, async () => { handlerCalls += 1; return { status: 'SUCCEEDED' }; });
  const disabled = await events.emit(CANCEL_EVENT);
  await dispatcher.dispatchEvent(disabled.eventId);
  let x = await EventActionExecution.findOne({ eventId: disabled.eventId });
  check('action désactivée -> SKIPPED', x.status === EXECUTION_STATUS.SKIPPED);
  check('action désactivée -> handler JAMAIS appelé', handlerCalls === 0);
  check('action désactivée -> raison tracée', x.lastErrorSafe.code === 'ACTION_DISABLED');
  check('action désactivée -> événement DISPATCHED',
    (await DomainEvent.findOne({ eventId: disabled.eventId })).dispatchStatus === EVENT_DISPATCH_STATUS.DISPATCHED);
  restore();

  // --- Succès --------------------------------------------------------------
  await resetEvents();
  CONTACT_ACTION.enabled = true;
  restore = registerHandler(ACTION_TYPE.SEND_EMAIL, async () => ({ status: 'SUCCEEDED', providerMessageId: 'msg-1' }));
  const ok1 = await events.emit(CONTACT_EVENT);
  await dispatcher.dispatchEvent(ok1.eventId);
  x = await EventActionExecution.findOne({ eventId: ok1.eventId });
  check('succès -> SUCCEEDED', x.status === EXECUTION_STATUS.SUCCEEDED);
  check('succès -> messageId conservé', x.providerMessageId === 'msg-1');
  check('succès -> une tentative', x.attempts === 1);
  check('succès -> verrou libéré', x.lockId === null && x.lockExpiresAt === null);
  check('succès -> événement DISPATCHED',
    (await DomainEvent.findOne({ eventId: ok1.eventId })).dispatchStatus === EVENT_DISPATCH_STATUS.DISPATCHED);
  restore();

  // --- Échec RETRYABLE -----------------------------------------------------
  await resetEvents();
  restore = registerHandler(ACTION_TYPE.SEND_EMAIL, async () => {
    throw new ActionHandlerError('TEMP', 'panne passagère', true);
  });
  const ko = await events.emit(CONTACT_EVENT);
  await dispatcher.dispatchEvent(ko.eventId);
  x = await EventActionExecution.findOne({ eventId: ko.eventId });
  check('échec retryable -> FAILED (pas DEAD_LETTER)', x.status === EXECUTION_STATUS.FAILED);
  check('échec retryable -> erreur sûre', x.lastErrorSafe.code === 'TEMP' && x.lastErrorSafe.retryable === true);
  check('échec retryable -> prochaine tentative planifiée', x.availableAt.getTime() > Date.now());
  check('backoff = 30 s après la 1re tentative', Math.abs(x.availableAt.getTime() - Date.now() - 30_000) < 5_000);
  // L'ÉVÉNEMENT ne doit pas être FAILED : une tentative est encore prévue.
  check('événement DISPATCHING tant qu’un retry est prévu (jamais FAILED trop tôt)',
    (await DomainEvent.findOne({ eventId: ko.eventId })).dispatchStatus === EVENT_DISPATCH_STATUS.DISPATCHING);

  // Épuisement -> DEAD_LETTER.
  for (let i = 0; i < 6; i += 1) {
    await EventActionExecution.updateOne({ _id: x._id }, { $set: { availableAt: new Date(Date.now() - 1000) } });
    await dispatcher.processPendingEventActions();
    x = await EventActionExecution.findOne({ _id: x._id });
    if (x.status === EXECUTION_STATUS.DEAD_LETTER) break;
  }
  check('tentatives épuisées -> DEAD_LETTER', x.status === EXECUTION_STATUS.DEAD_LETTER);
  check('tentatives plafonnées à maxAttempts', x.attempts === x.maxAttempts);
  check('toutes en échec terminal -> événement FAILED',
    (await DomainEvent.findOne({ eventId: ko.eventId })).dispatchStatus === EVENT_DISPATCH_STATUS.FAILED);
  restore();

  // --- Échec NON RETRYABLE -> DEAD_LETTER immédiat -------------------------
  await resetEvents();
  restore = registerHandler(ACTION_TYPE.SEND_EMAIL, async () => {
    throw new ActionHandlerError('NOPE', 'définitif', false);
  });
  const perm = await events.emit(CONTACT_EVENT);
  await dispatcher.dispatchEvent(perm.eventId);
  x = await EventActionExecution.findOne({ eventId: perm.eventId });
  check('non retryable -> DEAD_LETTER dès la 1re tentative', x.status === EXECUTION_STATUS.DEAD_LETTER);
  check('non retryable -> une seule tentative (pas d’acharnement)', x.attempts === 1);
  restore();

  // --- SEND_EMAIL réel : IMPLÉMENTÉ, mais template pas encore branché ------
  //
  // Depuis le lot e-mail, le handler EXISTE. Ce qui manque à `contact.submitted`,
  // c'est son résolveur de VARIABLES (lot contact). Le filet de sécurité doit
  // donc toujours tenir, pour une autre raison qu'avant : activer une action dont
  // le template n'est pas branché au métier ne doit jamais produire un e-mail
  // vide — mais un refus franc et visible.
  await resetEvents();
  // Un destinataire doit exister pour que la résolution AVANCE jusqu'au résolveur
  // de variables (le point testé ici) : sinon c'est l'absence de destinataire qui
  // remonterait. On configure une adresse métier de notification.
  const { Company } = await import('../models/Company.model.js');
  await Company.updateOne({}, { $set: { contactNotificationRecipients: ['contact@commerce.fr'] } }, { upsert: true });
  const notImpl = await events.emit(CONTACT_EVENT);
  await dispatcher.dispatchEvent(notImpl.eventId);
  x = await EventActionExecution.findOne({ eventId: notImpl.eventId });
  check('template sans résolveur de variables -> DEAD_LETTER explicite', x.status === EXECUTION_STATUS.DEAD_LETTER);
  check('template sans résolveur -> code parlant',
    x.lastErrorSafe.code === 'UNKNOWN_RESOLVER');
  check('template sans résolveur -> une seule tentative (non retryable)', x.attempts === 1);
  check('template sans résolveur -> JAMAIS SUCCEEDED (aucun faux envoi)',
    x.status !== EXECUTION_STATUS.SUCCEEDED);
  CONTACT_ACTION.enabled = false;

  // --- Succès PARTIEL : deux actions, une réussit, l'autre échoue ----------
  await resetEvents();
  CANCEL_ACTIONS.forEach((a) => { a.enabled = true; });
  restore = registerHandler(ACTION_TYPE.SEND_EMAIL, async ({ action }) => {
    if (action.actionId === 'notify-admins-cancellation') return { status: 'SUCCEEDED' };
    throw new ActionHandlerError('NOPE', 'destinataire dev injoignable', false);
  });
  const partial = await events.emit(CANCEL_EVENT);
  await dispatcher.dispatchEvent(partial.eventId);
  const both = await EventActionExecution.find({ eventId: partial.eventId }).sort({ actionId: 1 });
  check('deux actions -> deux exécutions distinctes', both.length === 2);
  check('l’une réussit', both.some((b) => b.status === EXECUTION_STATUS.SUCCEEDED));
  check('l’autre échoue', both.some((b) => b.status === EXECUTION_STATUS.DEAD_LETTER));
  check('un échec ne masque pas le succès (et inversement)',
    both.filter((b) => b.status === EXECUTION_STATUS.SUCCEEDED).length === 1);
  check('succès partiel -> PARTIAL_FAILURE',
    (await DomainEvent.findOne({ eventId: partial.eventId })).dispatchStatus === EVENT_DISPATCH_STATUS.PARTIAL_FAILURE);
  restore();
  CANCEL_ACTIONS.forEach((a) => { a.enabled = false; });

  // --- Backoff déterministe ------------------------------------------------
  check('backoff SEND_EMAIL : 30 s', nextBackoffMs('SEND_EMAIL', 1) === 30_000);
  check('backoff SEND_EMAIL : 2 min', nextBackoffMs('SEND_EMAIL', 2) === 120_000);
  check('backoff SEND_EMAIL : 10 min', nextBackoffMs('SEND_EMAIL', 3) === 600_000);
  check('backoff plafonné (pas de croissance infinie)', nextBackoffMs('SEND_EMAIL', 99) === 600_000);
  check('backoff déterministe (deux appels identiques)',
    nextBackoffMs('SEND_EMAIL', 2) === nextBackoffMs('SEND_EMAIL', 2));
  check('NO_OP sans backoff', nextBackoffMs('NO_OP', 1) === 0);
}

// ---------------------------------------------------------------------------
section('Statut global');
{
  const { computeDispatchStatus } = dispatcher;
  const S = EXECUTION_STATUS;
  check('aucune action -> DISPATCHED', computeDispatchStatus([]) === EVENT_DISPATCH_STATUS.DISPATCHED);
  check('tout SUCCEEDED -> DISPATCHED',
    computeDispatchStatus([{ status: S.SUCCEEDED }, { status: S.SUCCEEDED }]) === EVENT_DISPATCH_STATUS.DISPATCHED);
  check('SUCCEEDED + SKIPPED -> DISPATCHED',
    computeDispatchStatus([{ status: S.SUCCEEDED }, { status: S.SKIPPED }]) === EVENT_DISPATCH_STATUS.DISPATCHED);
  check('tout DEAD_LETTER -> FAILED',
    computeDispatchStatus([{ status: S.DEAD_LETTER }, { status: S.DEAD_LETTER }]) === EVENT_DISPATCH_STATUS.FAILED);
  check('succès + échec terminal -> PARTIAL_FAILURE',
    computeDispatchStatus([{ status: S.SUCCEEDED }, { status: S.DEAD_LETTER }]) === EVENT_DISPATCH_STATUS.PARTIAL_FAILURE);
  check('SKIPPED + DEAD_LETTER -> PARTIAL_FAILURE',
    computeDispatchStatus([{ status: S.SKIPPED }, { status: S.DEAD_LETTER }]) === EVENT_DISPATCH_STATUS.PARTIAL_FAILURE);
  check('un retry en attente -> DISPATCHING (jamais FAILED)',
    computeDispatchStatus([{ status: S.FAILED }, { status: S.SUCCEEDED }]) === EVENT_DISPATCH_STATUS.DISPATCHING);
  check('PENDING -> DISPATCHING', computeDispatchStatus([{ status: S.PENDING }]) === EVENT_DISPATCH_STATUS.DISPATCHING);
  check('PROCESSING -> DISPATCHING', computeDispatchStatus([{ status: S.PROCESSING }]) === EVENT_DISPATCH_STATUS.DISPATCHING);
}

// ---------------------------------------------------------------------------
section('Concurrence et verrous');
{
  await resetEvents();
  CONTACT_ACTION.enabled = true;
  const restoreLock = registerHandler(ACTION_TYPE.SEND_EMAIL, async () => ({ status: 'SUCCEEDED' }));
  const e = await events.emit(CONTACT_EVENT);
  await dispatcher.materializeExecutions(await DomainEvent.findOne({ eventId: e.eventId }));
  const x = await EventActionExecution.findOne({ eventId: e.eventId });

  // Deux « workers » tentent la même exécution : un seul peut gagner.
  const [c1, c2] = await Promise.all([dispatcher.claimExecution(x._id), dispatcher.claimExecution(x._id)]);
  const winners = [c1, c2].filter(Boolean);
  check('deux workers -> un seul obtient le verrou', winners.length === 1);
  check('le gagnant est PROCESSING', winners[0].status === EXECUTION_STATUS.PROCESSING);
  check('le gagnant porte un lockId', Boolean(winners[0].lockId));
  check('lockExpiresAt dans le futur', winners[0].lockExpiresAt.getTime() > Date.now());
  check('attempts incrémenté une seule fois', winners[0].attempts === 1);

  // Un verrou vivant bloque une nouvelle prise.
  check('verrou vivant -> prise refusée', (await dispatcher.claimExecution(x._id)) === null);

  // Une exécution PROCESSING n'est PAS directement prenable, même verrou expiré :
  // seul `processPendingEventActions` la récupère (il la repasse d'abord FAILED).
  // C'est ce qui empêche deux passages de se marcher dessus sur un travail en vol.
  await EventActionExecution.updateOne({ _id: x._id }, { $set: { lockExpiresAt: new Date(Date.now() - 1000) } });
  check('PROCESSING au verrou expiré -> pas prenable directement',
    (await dispatcher.claimExecution(x._id)) === null);

  // Une fois repassée en état prenable, la reprise fonctionne.
  await EventActionExecution.updateOne({ _id: x._id }, {
    $set: { status: EXECUTION_STATUS.FAILED, lockId: null, lockExpiresAt: null },
  });
  const reclaimed = await dispatcher.claimExecution(x._id);
  check('FAILED éligible -> repris', reclaimed !== null);
  check('reprise -> nouveau lockId', reclaimed.lockId !== winners[0].lockId);
  check('reprise -> attempts incrémenté', reclaimed.attempts === 2);

  // Une exécution dont le backoff n'est pas échu n'est pas prenable.
  await EventActionExecution.updateOne({ _id: x._id }, {
    $set: { status: EXECUTION_STATUS.FAILED, lockId: null, lockExpiresAt: null, availableAt: new Date(Date.now() + 60_000) },
  });
  check('backoff non échu -> prise refusée', (await dispatcher.claimExecution(x._id)) === null);
  await EventActionExecution.updateOne({ _id: x._id }, { $set: { availableAt: new Date() } });

  // Finalisation avec un verrou périmé : refusée.
  const stale = { _id: x._id, lockId: winners[0].lockId };
  const before = await EventActionExecution.findOne({ _id: x._id });
  await EventActionExecution.findOneAndUpdate(
    { _id: stale._id, lockId: stale.lockId },
    { $set: { status: EXECUTION_STATUS.SUCCEEDED } }
  );
  const after = await EventActionExecution.findOne({ _id: x._id });
  check('finalisation avec un mauvais verrou -> aucune écriture', after.status === before.status);
  restoreLock();
  CONTACT_ACTION.enabled = false;
}

// ---------------------------------------------------------------------------
section('Reprise après crash');
{
  await resetEvents();
  CONTACT_ACTION.enabled = true;
  const restoreRec = registerHandler(ACTION_TYPE.SEND_EMAIL, async () => ({ status: 'SUCCEEDED' }));
  const e = await events.emit(CONTACT_EVENT);
  await dispatcher.materializeExecutions(await DomainEvent.findOne({ eventId: e.eventId }));
  const x = await EventActionExecution.findOne({ eventId: e.eventId });

  // Simule un processus tué en plein traitement : PROCESSING + verrou expiré.
  await EventActionExecution.updateOne({ _id: x._id }, {
    $set: {
      status: EXECUTION_STATUS.PROCESSING,
      lockId: 'mort',
      lockExpiresAt: new Date(Date.now() - 60_000),
      processingStartedAt: new Date(Date.now() - 120_000),
    },
  });
  const { processed } = await dispatcher.processPendingEventActions();
  const after = await EventActionExecution.findOne({ _id: x._id });
  check('exécution orpheline reprise', processed === 1);
  check('orpheline -> terminée', after.status === EXECUTION_STATUS.SUCCEEDED);
  check('orpheline -> verrou nettoyé', after.lockId === null);

  // Une exécution PROCESSING au verrou VIVANT ne doit pas être volée.
  await EventActionExecution.updateOne({ _id: x._id }, {
    $set: { status: EXECUTION_STATUS.PROCESSING, lockId: 'vivant', lockExpiresAt: new Date(Date.now() + 60_000) },
  });
  const r2 = await dispatcher.processPendingEventActions();
  check('verrou vivant -> non repris', r2.processed === 0);
  await EventActionExecution.updateOne({ _id: x._id }, { $set: { status: EXECUTION_STATUS.SUCCEEDED, lockId: null, lockExpiresAt: null } });

  // Retry manuel.
  await EventActionExecution.updateOne({ _id: x._id }, {
    $set: { status: EXECUTION_STATUS.DEAD_LETTER, attempts: 4, processedAt: new Date() },
  });
  const retried = await dispatcher.retryEventActions(e.eventId);
  const afterRetry = await EventActionExecution.findOne({ _id: x._id });
  check('retry manuel relance un DEAD_LETTER', retried === 1);
  check('retry manuel -> compteur remis à zéro puis rejoué', afterRetry.status === EXECUTION_STATUS.SUCCEEDED);

  // Un succès n'est JAMAIS rejoué (sinon : double envoi).
  const noRetry = await dispatcher.retryEventActions(e.eventId);
  check('retry ne rejoue pas un succès', noRetry === 0);
  restoreRec();
  CONTACT_ACTION.enabled = false;
}

// ---------------------------------------------------------------------------
section('Audit e-mail branché');
//
// Trois faits seulement : l'identité a changé, un test a réussi, un test a
// échoué. Les anciens événements OTP/domaine ont disparu avec leurs parcours.
// Le fournisseur simulé n'expose QUE `/smtp/email` : si le service tentait
// encore un `/senders` ou un `/domains`, l'appel tomberait en 404 et le test le
// verrait immédiatement.
const realFetch = globalThis.fetch;
let smtpCalls = [];
let forcedSmtp = null;
function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
globalThis.fetch = async (input, options = {}) => {
  const href = typeof input === 'string' ? input : String(input?.url ?? input);
  if (!/^https?:\/\/[^/]*brevo/.test(href)) return realFetch(input, options);
  const method = options.method || 'GET';
  const path = decodeURIComponent(href.replace(/^https?:\/\/[^/]*\/v3/, ''));
  const body = options.body ? JSON.parse(options.body) : undefined;

  if (method === 'POST' && path === '/smtp/email') {
    smtpCalls.push(body);
    if (forcedSmtp) { const f = forcedSmtp; forcedSmtp = null; return f; }
    return json(201, { messageId: '<msg-1@brevo>' });
  }
  if (method === 'GET' && path === '/account') return json(200, { companyName: 'X', email: 'a@b.fr' });
  return json(404, { code: 'not_found', message: path });
};

const { IntegratedApi } = await import('../models/IntegratedApi.model.js');
const { EmailConfiguration } = await import('../models/EmailConfiguration.model.js');
const { encryptSecret, lastFourOf } = await import('../utils/integratedApiCrypto.js');
const emailSvc = await import('../services/emailConfiguration.service.js');
{
  const brevo = await IntegratedApi.findOne({ provider: 'BREVO' });
  brevo.modes.TEST.credentials.set('apiKey', {
    encryptedValue: encryptSecret('xkeysib-events-TEST-000000000000000000000000aaaa'),
    lastFour: lastFourOf('xkeysib-events-TEST-000000000000000000000000aaaa'),
  });
  brevo.activeMode = 'TEST';
  brevo.recomputeAll();
  await brevo.save();
}

async function eventsOfType(type) {
  return DomainEvent.find({ type }).sort({ occurredAt: 1 }).lean();
}

{
  /**
   * ══ LES ÉVÉNEMENTS E-MAIL LOCAUX N’ONT PLUS D’ÉMETTEUR (R10.5A/B) ════════
   *
   * Ce bloc éprouvait les événements émis par `updateSender` et
   * `sendTestEmail` : enregistrement de l'expéditeur, test accepté, test
   * refusé. Les trois fonctions ont été supprimées — le From du parc est
   * détenu par le Panel, et le test d'expédition y vit désormais.
   *
   * ── POURQUOI LE VOCABULAIRE RESTE, LUI ───────────────────────────────────
   *
   * On ne retire PAS ces types du registre. Des `DomainEvent` déjà écrits les
   * portent : sans leur définition, le Manager ne saurait plus afficher un
   * historique qu'il affiche aujourd'hui. Un vocabulaire sans émetteur reste
   * lisible ; un événement sans vocabulaire devient illisible.
   *
   * Ce que le garde-fou vérifie, c'est donc l'absence d'ÉMETTEUR, pas
   * l'absence de mot.
   */
  await resetEvents();
  await EmailConfiguration.deleteMany({});
  smtpCalls = [];

  check('NO_LOCAL_FROM — updateSender n’existe plus', emailSvc.updateSender === undefined);
  check('NO_LOCAL_TEST_SEND — sendTestEmail non plus', emailSvc.sendTestEmail === undefined);

  /**
   * AUCUN de ces trois événements ne peut plus naître d'une action locale.
   * On le prouve en cherchant un émetteur dans TOUT le code d'exécution :
   * une absence d'appel est ce qui se contourne le plus difficilement.
   */
  const srcRoot = fileURLToPath(new URL('../', import.meta.url));
  const jsFiles = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (entry.name.endsWith('.js') && !full.includes('scripts')) jsFiles.push(full);
    }
  };
  walk(srcRoot);

  for (const type of ['email.sender.updated', 'email.test.accepted', 'email.test.failed']) {
    const emitters = jsFiles.filter((f) => {
      const src = readFileSync(f, 'utf8');
      // Un ÉMETTEUR, pas une simple mention : le type doit apparaître dans un
      // littéral de chaîne hors du registre qui le déclare.
      return src.includes(`'${type}'`) && !f.includes('domainEventRegistry');
    });
    check(`NO_EMITTER — plus aucun code n’émet « ${type} »`, emitters.length === 0);
  }

  check('…et aucun appel Brevo n’a eu lieu', smtpCalls.length === 0);

  /**
   * L'exigence de minimisation, elle, ne dépend d'aucun émetteur : on la
   * vérifie sur le journal tel qu’il est, quels que soient les faits écrits.
   */
  const all = JSON.stringify(await DomainEvent.find({}).lean());
  check('aucune clé API dans le journal', !all.includes('xkeysib'));
  check('aucune adresse complète dans le journal', !/support@[a-z]/i.test(all));
  check('aucune stack dans le journal', !all.includes('at Object.'));
}

// ---------------------------------------------------------------------------
section('Résiliation : événement sans action');
{
  await resetEvents();
  const { Contract } = await import('../models/Contract.model.js');
  const contract = await Contract.create({
    reference: 'CTR-2026-0042', name: 'Test', status: 'ACTIVE', environment: 'TEST',
    stripe: { subscription: { currentPeriodEnd: new Date('2026-08-01T00:00:00.000Z') } },
  });
  const contractSvc = await import('../services/contract.service.js');
  await contractSvc.requestCancellation(contract, { _id: '507f1f77bcf86cd799439011', role: 'ADMIN' });

  const emitted = await eventsOfType('contract.cancel_requested');
  check('résiliation -> événement émis', emitted.length === 1);
  check('résiliation -> référence tracée', emitted[0].payloadSafe.reference === 'CTR-2026-0042');
  check('résiliation -> rôle tracé', emitted[0].payloadSafe.cancelledByRole === 'ADMIN');
  check('résiliation -> échéance tracée', emitted[0].payloadSafe.currentPeriodEnd === '2026-08-01T00:00:00.000Z');
  check('résiliation -> acteur tracé', emitted[0].actor.role === 'ADMIN');
  check('résiliation -> aucune action branchée (aucun e-mail)',
    (await EventActionExecution.countDocuments({ eventId: emitted[0].eventId })) === 0);
  // ENV=TEST : la résiliation est IMMÉDIATE (LOT recette) — contrat terminé.
  check('résiliation -> immédiate en TEST (contrat ENDED)', (await Contract.findById(contract._id)).status === 'ENDED');
  check('résiliation -> marquée immediate dans le payload', emitted[0].payloadSafe.immediate === true);

  // L'émission ne peut PAS casser la résiliation.
  const contract2 = await Contract.create({
    reference: 'CTR-2026-0043', name: 'Test 2', status: 'ACTIVE', environment: 'TEST',
    stripe: { subscription: { currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z') } },
  });
  const originalCreate = DomainEvent.create;
  DomainEvent.create = async () => { throw new Error('journal indisponible'); };
  let cancelThrew = null;
  try {
    await contractSvc.requestCancellation(contract2, { _id: '507f1f77bcf86cd799439011', role: 'DEV' });
  } catch (e) { cancelThrew = e; }
  DomainEvent.create = originalCreate;
  check('journal en panne -> la résiliation N’ÉCHOUE PAS', cancelThrew === null);
  check('journal en panne -> le contrat est bien résilié (immédiat en TEST)',
    (await Contract.findById(contract2._id)).status === 'ENDED');
}

// ---------------------------------------------------------------------------
section('HTTP (DEV only, lecture seule)');
const { createApp } = await import('../app.js');
const app = createApp();
const server = app.listen(4140);
async function api(method, path, { token, body } = {}) {
  const res = await realFetch(`http://localhost:4140${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let j = {};
  try { j = text ? JSON.parse(text) : {}; } catch { /* */ }
  return { status: res.status, json: j };
}
async function login(email, password) {
  return (await api('POST', '/api/auth/login', { body: { email, password } })).json?.data?.token;
}

{
  const devToken = await login('dev@mail.com', '123dev');
  const adminToken = await login('admin@mail.com', '123admin');

  check('liste sans token -> 401', (await api('GET', '/api/dev/domain-events')).status === 401);
  check('liste en ADMIN -> 403', (await api('GET', '/api/dev/domain-events', { token: adminToken })).status === 403);
  check('retry en ADMIN -> 403',
    (await api('POST', '/api/dev/domain-events/00000000-0000-4000-8000-000000000000/retry', { token: adminToken })).status === 403);

  const list = await api('GET', '/api/dev/domain-events', { token: devToken });
  check('liste en DEV -> 200', list.status === 200);
  check('liste renvoie des événements', Array.isArray(list.json.data.events));
  check('liste porte les compteurs d’actions', list.json.data.events.every((e) => e.actions && 'total' in e.actions));
  check('aucun lockId exposé', !JSON.stringify(list.json).includes('lockId'));

  const filtered = await api('GET', '/api/dev/domain-events?type=contract.cancel_requested', { token: devToken });
  check('filtre par type', filtered.json.data.events.every((e) => e.type === 'contract.cancel_requested'));
  check('type hors registre -> 400',
    (await api('GET', '/api/dev/domain-events?type=nope.nope', { token: devToken })).status === 400);
  check('paramètre inconnu -> 400 (strict, anti-injection)',
    (await api('GET', '/api/dev/domain-events?$where=1', { token: devToken })).status === 400);
  check('limite bornée -> 400 au-delà de 100',
    (await api('GET', '/api/dev/domain-events?limit=500', { token: devToken })).status === 400);

  const one = list.json.data.events[0];
  const detail = await api('GET', `/api/dev/domain-events/${one.eventId}`, { token: devToken });
  check('détail -> 200', detail.status === 200);
  check('détail expose les exécutions', Array.isArray(detail.json.data.executions));
  check('eventId inconnu -> 404',
    (await api('GET', '/api/dev/domain-events/00000000-0000-4000-8000-000000000000', { token: devToken })).status === 404);
  check('eventId mal formé -> 400',
    (await api('GET', '/api/dev/domain-events/pas-un-uuid', { token: devToken })).status === 400);

  const registryRes = await api('GET', '/api/dev/domain-events/registry', { token: devToken });
  check('introspection du registre -> 200', registryRes.status === 200);
  check('introspection liste les types', registryRes.json.data.events.length >= 11);
  check('introspection n’expose aucun schéma zod', !JSON.stringify(registryRes.json).includes('_def'));

  check('aucune route de création (POST liste -> 404)',
    (await api('POST', '/api/dev/domain-events', { token: devToken, body: { type: 'x' } })).status === 404);
}

server.close();
await disconnectDatabase();
await mongod.stop();
globalThis.fetch = realFetch;

console.log(`\n${fail === 0 ? '✅' : '❌'} Événements : ${pass} OK, ${fail} KO`);
process.exit(fail === 0 ? 0 : 1);
