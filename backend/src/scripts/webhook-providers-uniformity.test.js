/*
 * UNIFORMISATION DES PROVIDERS DE WEBHOOKS — Stripe & Yousign gérés comme Brevo.
 *
 * Faux serveurs fournisseurs STATEFUL (mock de fetch) : création automatique,
 * mise à jour sur changement d'URL, dédoublonnage limité à NOS webhooks,
 * capture du secret à la création, recréation quand le secret local manque,
 * réparation, test-diagnostic, uniformité du contrat entre les trois providers,
 * isolation TEST/PROD, et SUPPRESSION du mode Stripe CLI (plus aucun skip
 * STRIPE_CLI_LOCAL : la seule raison de ne pas synchroniser est l'URL).
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.ENV = 'TEST';
process.env.DB_TEST = 'uniformity_test';
process.env.JWT_SECRET = 'x'.repeat(48);
process.env.INTEGRATED_API_ENCRYPTION_KEY = 'a'.repeat(64);
const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };
const section = (n) => console.log(`\n${n}`);

/* ── Faux fournisseurs STATEFUL ────────────────────────────────────────────── */

const realFetch = globalThis.fetch;
const jsonRes = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// Stripe : /v1/webhook_endpoints (form-encoded)
const stripeStore = new Map();
let stripeSeq = 0;
let stripeCreateCalls = 0;
function handleStripe(href, options) {
  const method = options.method || 'GET';
  const m = href.match(/\/v1\/webhook_endpoints(?:\/([^/?]+))?/);
  const id = m?.[1];
  const params = new URLSearchParams(options.body || '');
  if (method === 'GET') return jsonRes(200, { data: [...stripeStore.values()] });
  if (method === 'POST' && !id) {
    stripeCreateCalls += 1;
    const wid = `we_${++stripeSeq}`;
    const w = {
      id: wid,
      url: params.get('url'),
      description: params.get('description') || '',
      enabled_events: [...params.keys()].filter((k) => k.startsWith('enabled_events[')).map((k) => params.get(k)),
      status: 'enabled',
      api_version: params.get('api_version'),
      metadata: { managedBy: params.get('metadata[managedBy]') || '' },
      secret: `whsec_${wid}_secret`,
    };
    stripeStore.set(wid, w);
    return jsonRes(200, w);
  }
  if (method === 'POST' && id) {
    const w = stripeStore.get(id);
    if (!w) return jsonRes(404, { error: { message: 'No such webhook endpoint' } });
    w.url = params.get('url') || w.url;
    w.description = params.get('description') ?? w.description;
    const evts = [...params.keys()].filter((k) => k.startsWith('enabled_events[')).map((k) => params.get(k));
    if (evts.length) w.enabled_events = evts;
    return jsonRes(200, { ...w, secret: undefined }); // le secret n'est JAMAIS relivré
  }
  if (method === 'DELETE') { stripeStore.delete(id); return jsonRes(200, { deleted: true }); }
  return jsonRes(404, { error: { message: 'not found' } });
}

// Yousign : /v3/webhooks (JSON) — le POST /webhooks renvoie 404 pour éprouver
// le REPLI /webhooks/subscriptions (chemins divergents selon les docs).
const yousignStore = new Map();
let ysSeq = 0;
let ysUsedFallback = false;
function handleYousign(href, options) {
  const method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : {};
  if (method === 'GET' && /\/webhooks\/?$/.test(href)) return jsonRes(200, { data: [...yousignStore.values()] });
  if (method === 'POST' && /\/webhooks\/?$/.test(href)) return jsonRes(404, { detail: 'Not Found' });
  if (method === 'POST' && /\/webhooks\/subscriptions/.test(href)) {
    ysUsedFallback = true;
    const wid = `ys-${++ysSeq}`;
    const w = {
      id: wid,
      endpoint: body.endpoint,
      description: body.description || '',
      subscribed_events: body.subscribed_events || [],
      sandbox: body.sandbox,
      enabled: body.enabled !== false,
      secret_key: `sk-ys-${wid}`,
    };
    yousignStore.set(wid, w);
    return jsonRes(201, w);
  }
  const idm = href.match(/\/webhooks\/([^/?]+)$/);
  if (method === 'PATCH' && idm) {
    const w = yousignStore.get(idm[1]);
    if (!w) return jsonRes(404, { detail: 'Not Found' });
    if (body.endpoint) w.endpoint = body.endpoint;
    if (body.description !== undefined) w.description = body.description;
    if (body.subscribed_events) w.subscribed_events = body.subscribed_events;
    return jsonRes(200, { ...w, secret_key: undefined });
  }
  if (method === 'DELETE' && idm) { yousignStore.delete(idm[1]); return jsonRes(204, {}); }
  return jsonRes(404, { detail: 'not found' });
}

let healthReachable = true;
globalThis.fetch = async (input, options = {}) => {
  const href = typeof input === 'string' ? input : String(input?.url ?? input);
  if (href.includes('api.stripe.com')) return handleStripe(href, options);
  if (href.includes('yousign.app')) return handleYousign(href, options);
  if (href.endsWith('/health') && href.includes('/api/webhooks/')) {
    if (!healthReachable) throw new TypeError('fetch failed');
    return jsonRes(200, { ok: true });
  }
  if (href.includes('127.0.0.1:4040')) throw new TypeError('fetch failed'); // pas de ngrok
  return realFetch(input, options);
};

/* ── Bootstrap DB ──────────────────────────────────────────────────────────── */

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
const { bootstrap } = await import('../config/bootstrap.js');
await connectDatabase();
await bootstrap();
// Le service est PRÊT : cette suite a fait elle-même tout ce que le démarrage fait.
await (await import("./helpers/serviceReady.helper.js")).markTestServiceReady();

const { IntegratedApi } = await import('../models/IntegratedApi.model.js');
const { SystemConfiguration } = await import('../models/SystemConfiguration.model.js');
const { encryptSecret, lastFourOf } = await import('../utils/integratedApiCrypto.js');
const { tryGetCredential } = await import('../services/integratedApi.service.js');
const { providerByCode, integrationWebhookProviders } = await import('../services/webhooks/integrationWebhookProviders.js');
const { ensureAllWebhooks } = await import('../services/webhooks/webhookOrchestrator.service.js');
const { STRIPE_HANDLED_EVENTS } = await import('../utils/stripeEventRegistry.js');
const { managedWebhookSpec } = await import('../services/webhooks/managedWebhookRegistry.js');

const PUBLIC_1 = 'https://un.exemple-public.fr';
const PUBLIC_2 = 'https://deux.exemple-public.fr';

async function setBackendUrl(url) {
  await SystemConfiguration.updateOne({}, { $set: { 'network.backendUrl': url } }, { upsert: true });
}
function cred(v) { return { encryptedValue: encryptSecret(v), lastFour: lastFourOf(v), updatedAt: new Date() }; }
async function seedKey(provider, field, value) {
  const doc = await IntegratedApi.findOne({ provider });
  doc.modes.TEST.credentials.set(field, cred(value));
  doc.modes.PROD.credentials.set(field, cred(value));
  doc.enabled = true;
  await doc.save();
}
async function clearWebhookState(provider, mode) {
  await IntegratedApi.updateOne({ provider }, { $set: { [`modes.${mode}.webhook`]: {} } });
}
async function dropCredential(provider, mode, field) {
  const doc = await IntegratedApi.findOne({ provider });
  doc.modes[mode].credentials.delete(field);
  doc.markModified(`modes.${mode}.credentials`);
  await doc.save();
}

await setBackendUrl(PUBLIC_1);
await seedKey('STRIPE', 'secretKey', 'sk_test_0000000000000000');

const stripe = providerByCode('STRIPE');
/**
 * R10.5C — IL N’Y A PLUS DE DRIVER YOUSIGN À RÉCUPÉRER.
 *
 * `providerByCode` rendrait `undefined`, et chaque appel plus bas aurait
 * échoué sur une erreur de type — un échec qui parle du test, pas du code.
 * On nomme donc l’absence, une fois, et on l’éprouve.
 */
let yousign;
try { yousign = providerByCode('YOUSIGN'); } catch { yousign = undefined; }

/* ────────────────────────────────────────────────────────────────────────── */
/*                                                                            */
/*  STRIPE — LE PROVISIONNEMENT A CHANGÉ DE MAIN (L6.3A)                      */
/*                                                                            */
/*  Huit sections vivaient ici : création, resynchronisation, dédoublonnage,  */
/*  secret perdu, réparation, mode CLI, migration, isolation TEST/PROD. Elles */
/*  éprouvaient toutes le même chemin — le projet appelant                    */
/*  `/v1/webhook_endpoints` avec SA clé.                                      */
/*                                                                            */
/*  Ce chemin n'existe plus. Ces comportements n'ont pas disparu : ils ont    */
/*  DÉMÉNAGÉ chez le Panel, qui les servait déjà pour ses propres endpoints,  */
/*  et ils y sont éprouvés par                                                */
/*  `Panel/tests/stripe-webhook-provisioning-e2e.test.js`.                    */
/*                                                                            */
/*  Les rejouer ici exigerait de simuler Stripe pour un code qui ne lui parle */
/*  plus : on prouverait le fonctionnement d'un faux serveur, pas celui du    */
/*  système. Ce qui reste vérifiable DE CE CÔTÉ, et qui compte, tient en      */
/*  trois questions — c'est la section ci-dessous.                            */
/* ────────────────────────────────────────────────────────────────────────── */
section('1. STRIPE — le projet DEMANDE, il n’appelle plus');
{
  await clearWebhookState('STRIPE', 'TEST');

  /**
   * Aucun Panel appairé dans cette suite : le provisionnement est donc SAUTÉ,
   * proprement, avec un motif qui nomme la vraie cause.
   *
   * C'est l'invariant le plus important du lot côté projet : là où l'absence
   * de clé locale faisait sauter le geste hier, c'est l'absence de PANEL qui
   * le fait sauter aujourd'hui. Le projet n'a plus aucun moyen de s'en passer.
   */
  const r = (await stripe.ensureWebhooks('TEST'))[0];
  check('sans Panel, le provisionnement est SAUTÉ', r.skipped === true);
  check('…et le motif nomme le Panel, pas une clé', r.reason === 'PANEL_NOT_PAIRED');

  /**
   * AUCUN APPEL SORTANT, et c'est le cœur : le faux Stripe de cette suite
   * compte ses créations. Il en comptait une par section ; il n'en compte
   * plus aucune, parce que plus rien ici ne sait lui parler.
   */
  check('AUCUN endpoint créé chez le fournisseur', stripeStore.size === 0);
  check('…et aucune tentative de création', stripeCreateCalls === 0);

  /**
   * LA CLÉ LOCALE N'EST PLUS REQUISE. Le driver l'annonce lui-même : c'est
   * cette déclaration que lit l'orchestrateur pour décider s'il peut agir.
   */
  check('le driver Stripe n’exige plus aucun credential local',
    stripe.requiredCredentialName() === null);
  /**
   * ET YOUSIGN N’EN EXIGE PLUS AUCUN NON PLUS — parce qu’il a quitté la
   * table. Un driver absent est plus fort qu’un driver qui déclare ne rien
   * exiger : il n’y a aucun chemin à emprunter, même par erreur.
   */
  check('le driver Yousign n’existe plus du tout', yousign === undefined);
}

section('2. STRIPE — le diagnostic dit ce qu’il SAIT, sans interroger Stripe');
{
  /**
   * `testWebhooks` interrogeait le fournisseur pour comparer l'état distant.
   * Il ne le peut plus, et le prétendre serait pire que de s'en passer : il
   * rend donc ce qu'il sait réellement — adresse attendue, présence d'un
   * secret de vérification, joignabilité de sa propre route.
   */
  const t = (await stripe.testWebhooks('TEST'))[0];
  check('le test ne lève pas et rend un diagnostic', typeof t.ok === 'boolean');
  check('…sans avoir appelé le fournisseur', stripeCreateCalls === 0);
  check('…il dit franchement qu’aucun endpoint n’est connu', t.remoteOk === false);
  check('…et il nomme l’écart', Array.isArray(t.differences));
}

section('3. STRIPE — le secret de vérification reste local, et reste un SECRET');
{
  /**
   * Le projet garde son `webhookSecret` : c'est lui qui vérifie les signatures
   * des événements que Stripe lui envoie. Ce que L6.3A change, c'est son
   * ORIGINE — il vient du Panel au lieu d'être capturé par le projet.
   *
   * Ce qui ne change pas : il ne sort d'aucun descripteur, d'aucun état,
   * d'aucun diagnostic.
   */
  const etat = (await stripe.listManagedWebhooks('TEST'))[0];
  check('l’état expose la RÉFÉRENCE du secret, jamais sa valeur',
    etat.secretReference === 'webhookSecret' && !JSON.stringify(etat).includes('whsec_'));
  check('…et dit seulement s’il est configuré', typeof etat.secretConfigured === 'boolean');
}

section('7-8. YOUSIGN — le provisionnement local a été RETIRÉ (R10.5C)');
{
  /**
   * ══ CE QUE CES DEUX SECTIONS ÉPROUVAIENT ════════════════════════════════
   *
   * Création automatique du webhook chez Yousign, repli de chemin après 404,
   * description canonique, souscription des cinq événements, capture de la
   * `secret_key`, idempotence, PATCH sur changement d’URL, réparation, test.
   *
   * Tout cela supposait deux choses que le cutover a supprimées : une clé
   * d’API Yousign détenue par CE projet, et un point de terminaison local à
   * faire pointer. Yousign appelle désormais le PANEL, qui détient la clé et
   * vérifie la signature.
   *
   * ══ POURQUOI L’ABSENCE EST LA BONNE ASSERTION ═══════════════════════════
   *
   * On aurait pu laisser ces sections en les faisant passer sur un double.
   * Elles auraient été vertes en éprouvant un chemin que la production ne
   * prend plus — c’est-à-dire le pire résultat possible : une suite qui
   * rassure sur du code mort.
   */
  const codes = integrationWebhookProviders().map((p) => p.providerCode);
  check('YOUSIGN ne figure plus parmi les providers de webhooks',
    !codes.includes('YOUSIGN'));

  /** Aucune adresse locale n’est plus proposée pour la signature. */
  let refus = false;
  try { managedWebhookSpec('YOUSIGN', 'signature'); } catch { refus = true; }
  check('le registre des webhooks gérés ne connaît plus YOUSIGN/signature', refus);

  /**
   * ET AUCUN SECRET DE WEBHOOK N’EST REDEVENU NÉCESSAIRE. La vérification
   * a suivi le webhook : c’est le Panel qui la fait, avec un secret qu’il
   * détient. Un secret local ici serait un secret que personne n’utilise —
   * et que personne ne penserait à faire tourner.
   */
  const restant = await tryGetCredential('YOUSIGN', 'webhookSecret', { mode: 'TEST' });
  check('aucun secret de webhook Yousign local', !restant);
}
/* ────────────────────────────────────────────────────────────────────────── */
section('9. UNIFORMITÉ — même contrat, mêmes capacités, orchestrateur');
{
  const providers = integrationWebhookProviders();
  const surface = ['providerCode', 'supportsWebhooks', 'capabilities', 'listManagedWebhooks', 'ensureWebhooks', 'repairWebhooks', 'getWebhookHealth', 'testWebhooks'];
  check('les 3 providers exposent EXACTEMENT la même surface',
    providers.every((p) => surface.every((fn) => typeof p[fn] === 'function')));
  check('les 3 providers gèrent leurs webhooks à distance',
    providers.every((p) => p.supportsWebhooks() === true));
  const capsKeys = JSON.stringify(Object.keys(providers[0].capabilities()));
  check('capacités : mêmes clés pour tous',
    providers.every((p) => JSON.stringify(Object.keys(p.capabilities())) === capsKeys));
  check('aucune API n’offre d’événement de test officiel → diagnostic partout',
    providers.every((p) => p.capabilities().testWebhook === 'diagnostic'));

  const report = await ensureAllWebhooks('TEST');
  const byCode = Object.fromEntries(report.providers.map((p) => [p.provider, p]));
  /**
   * L6.3A — Stripe saute désormais lui aussi, mais pour une raison qui n'est
   * pas celle de Brevo : il ne lui manque pas une clé, il lui manque un Panel.
   * L'orchestrateur reste générique — il ne connaît ni l'une ni l'autre.
   */
  check('orchestrateur : Stripe saute proprement',
    byCode.STRIPE.results[0].skipped === true);
  /**
   * Et Yousign n’apparaît plus du tout dans le rapport : il n’est pas
   * « sauté », il n’est plus orchestré. La nuance compte — un fournisseur
   * systématiquement sauté finit par ressembler à une panne.
   */
  check('…et YOUSIGN n’est plus orchestré du tout', byCode.YOUSIGN === undefined);
  /*
   * R11 — BREVO NON PLUS. La nuance vaut d'etre dite : il n'est pas « saute »,
   * il n'est plus orchestre. Un fournisseur systematiquement saute finit par
   * ressembler a une panne ; un fournisseur absent de la table dit la verite —
   * ce projet ne provisionne plus rien chez lui.
   */
  check('…et BREVO n’est plus orchestré du tout', byCode.BREVO === undefined);
  check('…le motif de Stripe reste lisible',
    byCode.STRIPE.results[0].reason === 'PANEL_NOT_PAIRED');
  check('orchestrateur : aucun échec', report.summary.failed === 0);
}

section('10. Descripteurs — jamais de secret, référence seulement');
{
  const all = await Promise.all(integrationWebhookProviders().map((p) => p.listManagedWebhooks('TEST')));
  const dumped = JSON.stringify(all);
  check('aucun secret dans les descripteurs', !/whsec_|sk-ys-|encryptedValue|xkeysib/.test(dumped));
  check('la référence du secret est exposée', all.flat().every((d) => d.secretReference === 'webhookSecret'));
}

globalThis.fetch = realFetch;
await disconnectDatabase();
await mongod.stop();
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
