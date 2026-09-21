/*
 * ARCHITECTURE GÉNÉRIQUE DES WEBHOOKS — le moteur ne connaît aucun provider.
 *
 * Couvre :
 *  1. l'orchestrateur sur des providers FACTICES (0, 1, plusieurs webhooks,
 *     désactivé, en erreur, ordre stable, isolation des pannes, résumé) ;
 *  2. le registre RÉEL (Brevo synchronisable, Stripe/Yousign au dashboard) ;
 *  3. les descripteurs réels (DB en mémoire, aucun appel fournisseur) ;
 *  4. la GÉNÉRICITÉ du bootstrap et du moteur de déploiement (analyse source) ;
 *  5. la construction d'URL multi-providers.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.ENV = 'TEST';
process.env.DB_TEST = 'orchestrator_test';
process.env.JWT_SECRET = 'x'.repeat(48);
process.env.INTEGRATED_API_ENCRYPTION_KEY = 'a'.repeat(64);
// HERMÉTIQUE : un vrai tunnel ngrok sur la machine de dev ne doit pas
// influencer ces assertions (la détection vise une adresse morte).
process.env.NGROK_API_URL = 'http://127.0.0.1:1';
const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };
const section = (n) => console.log(`\n${n}`);

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { ensureAllWebhooks, ensureProviderWebhooks, describeAllManagedWebhooks } = await import(
  '../services/webhooks/webhookOrchestrator.service.js'
);
const { integrationWebhookProviders, providerByCode } = await import(
  '../services/webhooks/integrationWebhookProviders.js'
);
const { buildWebhookUrl } = await import('../services/webhooks/managedWebhookRegistry.js');

/* ------------------------------------------------------------------ */
section('1. Orchestrateur — providers factices (contrat)');
{
  const calls = [];
  const fake = (code, { supports = true, results = [], throws = null, list = [] } = {}) => ({
    providerCode: () => code,
    supportsWebhooks: () => supports,
    async listManagedWebhooks() { return list; },
    async ensureWebhooks(mode) {
      calls.push(`${code}:${mode}`);
      if (throws) throw throws;
      return results;
    },
    async repairWebhooks() { return results; },
    async getWebhookHealth() { return []; },
  });

  const none = fake('NONE', { supports: false }); // provider SANS webhook géré
  const one = fake('ONE', { results: [{ category: 'a', ok: true, created: true }] });
  const multi = fake('MULTI', {
    results: [
      { category: 'x', ok: true, updated: true },
      { category: 'y', skipped: true, reason: 'API_KEY_MISSING' }, // « désactivé »
    ],
  });
  const boom = fake('BOOM', { throws: Object.assign(new Error('panne'), { code: 'REMOTE_DOWN' }) });

  const report = await ensureAllWebhooks('TEST', { providers: [none, one, multi, boom] });

  check('ordre des providers = ordre du registre',
    report.providers.map((p) => p.provider).join(',') === 'NONE,ONE,MULTI,BOOM');
  check('provider sans webhook : sauté sans être appelé',
    report.providers[0].skipped === true && !calls.includes('NONE:TEST'));
  check('provider à UN webhook : réconcilié', report.providers[1].results[0].ok === true);
  check('provider à PLUSIEURS webhooks : chaque catégorie rapportée',
    report.providers[2].results.length === 2);
  check('provider en erreur : isolé (les autres ont tourné)',
    report.providers[3].error?.code === 'REMOTE_DOWN' && calls.join(',') === 'ONE:TEST,MULTI:TEST,BOOM:TEST');
  check('résumé : 2 réconciliés, 2 sautés (NONE + catégorie y), 1 échec',
    report.summary.ensured === 2 && report.summary.skipped === 2 && report.summary.failed === 1);
  check('le mode circule tel quel', report.mode === 'TEST');

  const alone = await ensureProviderWebhooks('ONE', 'PROD', { providers: [one] });
  check('ensureProviderWebhooks : un seul provider, bon mode',
    alone.provider === 'ONE' && calls.includes('ONE:PROD'));
  const unknown = await ensureProviderWebhooks('GHOST', 'TEST', { providers: [one] });
  check('provider inconnu : erreur structurée, jamais une exception',
    unknown.error?.code === 'UNKNOWN_PROVIDER');
}

/* ------------------------------------------------------------------ */
section('2. Registre RÉEL — DEUX providers depuis R10.5C');
{
  const providers = integrationWebhookProviders();
  /**
   * YOUSIGN A QUITTÉ LE REGISTRE (R10.5C) — et l'ordre reste écrit en dur.
   *
   * Ce n'est pas de la rigidité gratuite : l'orchestrateur parcourt cette
   * liste, et un provider qui disparaîtrait par accident ne produirait
   * AUCUNE erreur — juste un webhook qu'on cesse de provisionner, en
   * silence. Le jour où la liste change, on veut relire pourquoi.
   */
  /*
   * R11 — BREVO A QUITTE LE REGISTRE, comme Yousign avant lui : les evenements
   * de livraison suivent le COMPTE, et le compte est celui du Panel. Provisionner
   * d'ici une adresse locale enregistrerait chez le fournisseur une URL qui rend
   * 404 — rompre le chemin retour en croyant le reparer.
   */
  check('registre : STRIPE seul, dans un ordre stable',
    providers.map((p) => p.providerCode()).join(',') === 'STRIPE');
  check('aucun driver Brevo ne subsiste',
    (() => { try { providerByCode('BREVO'); return false; } catch { return true; } })());
  check('Stripe gère ses webhooks à distance (uniformisation)', providerByCode('STRIPE').supportsWebhooks() === true);
  /**
   * Le webhook Yousign arrive désormais au PANEL. Provisionner d'ici une
   * adresse locale reviendrait à enregistrer chez le fournisseur une URL
   * qui rend 404 — rompre le chemin retour en croyant le réparer.
   */
  let ysAbsent = false;
  try { providerByCode('YOUSIGN'); } catch { ysAbsent = true; }
  check('Yousign n’est plus un provider de webhooks local', ysAbsent);
  let threw = false;
  try { providerByCode('GHOST'); } catch { threw = true; }
  check('providerByCode inconnu : lève explicitement', threw);
}

/* ------------------------------------------------------------------ */
section('3. Descripteurs RÉELS (DB mémoire, zéro appel fournisseur)');
{
  const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
  const { bootstrap } = await import('../config/bootstrap.js');
  await connectDatabase();
  await bootstrap();
// Le service est PRÊT : cette suite a fait elle-même tout ce que le démarrage fait.
await (await import("./helpers/serviceReady.helper.js")).markTestServiceReady();

  const { SystemConfiguration } = await import('../models/SystemConfiguration.model.js');
  await SystemConfiguration.updateOne(
    {}, { $set: { 'network.backendUrl': 'https://demo.exemple-public.fr' } }, { upsert: true }
  );

  const all = await describeAllManagedWebhooks('TEST');
  const brevo = all.find((p) => p.provider === 'BREVO');
  const stripe = all.find((p) => p.provider === 'STRIPE');
  const yousign = all.find((p) => p.provider === 'YOUSIGN');

  check('describe : Stripe seul est décrit', Boolean(stripe) && all.length === 1);
  check('…Yousign n’y figure plus', yousign === undefined);
  check('…et Brevo non plus', brevo === undefined);
  check('Stripe : référence de secret, jamais le secret',
    stripe.webhooks[0].secretReference === 'webhookSecret'
    && !JSON.stringify(stripe.webhooks).match(/encryptedValue|xkeysib|Bearer /));
  check('Stripe : descripteur synchronisable (URL calculée, jamais installé ici)',
    stripe.webhooks[0].expectedUrl === 'https://demo.exemple-public.fr/api/webhooks/stripe' &&
    stripe.webhooks[0].supportsRemoteSync === true &&
    stripe.webhooks[0].remoteStatus === 'NOT_CONFIGURED');

  check('capacités exposées par la liste', Boolean(stripe.capabilities && stripe.capabilities.createWebhook === true));
  check('describe PROD : le mode est reflété sans changer l’URL Stripe',
    (await describeAllManagedWebhooks('PROD')).find((p) => p.provider === 'STRIPE')
      .webhooks[0].expectedUrl === 'https://demo.exemple-public.fr/api/webhooks/stripe');

  // ensureAllWebhooks réel : Brevo saute (pas de clé API), Stripe/Yousign non synchronisables.
  const report = await ensureAllWebhooks('TEST');
  check('ensureAll réel : aucun provisionnement Brevo n’est même tenté',
    report.providers.every((p) => p.provider !== 'BREVO'));
  const stripeR = report.providers.find((p) => p.provider === 'STRIPE');
  /**
   * L6.3A — Stripe saute pour une raison NOUVELLE, et c'est le lot en une
   * ligne : hier il lui manquait une clé locale, aujourd'hui il lui manque un
   * Panel. Le geste sauté est le même ; ce qui l'autorisait a changé de main.
   */
  check('ensureAll réel : Stripe saute proprement', stripeR.results[0].skipped === true);
  check('…parce qu’aucun Panel n’est appairé, plus faute de clé locale',
    stripeR.results[0].reason === 'PANEL_NOT_PAIRED');

  /**
   * YOUSIGN, LUI, N'EST PLUS ORCHESTRÉ DU TOUT (R10.5C).
   *
   * La nuance compte : un fournisseur systématiquement « sauté » finit par
   * ressembler à une panne qu'on cherchera à réparer. Absent, il ne pose
   * aucune question.
   */
  check('…et Yousign n’apparaît plus dans le rapport',
    report.providers.every((p) => p.provider !== 'YOUSIGN'));
  check('ensureAll réel : aucun échec', report.summary.failed === 0);

  await disconnectDatabase();
}

/* ------------------------------------------------------------------ */
section('4. GÉNÉRICITÉ — bootstrap et moteur ne citent aucun provider');
{
  const bootstrapSrc = await fs.readFile(path.join(SRC, 'config/bootstrap.js'), 'utf8');
  check('bootstrap : plus d’import du service Brevo webhook',
    !bootstrapSrc.includes('brevoWebhookConfig.service'));
  check('bootstrap : plus d’appel ensureBrevoTransactionalWebhook',
    !bootstrapSrc.includes('ensureBrevoTransactionalWebhook'));
  check('bootstrap : passe par l’orchestrateur générique',
    bootstrapSrc.includes('ensureAllWebhooks'));

  const deploymentFiles = await fs.readdir(path.join(SRC, 'deployment-engine'));
  let engineMentions = 0;
  for (const f of deploymentFiles.filter((f) => f.endsWith('.js'))) {
    const src = await fs.readFile(path.join(SRC, 'deployment-engine', f), 'utf8');
    if (/brevo|stripe|yousign/i.test(src)) engineMentions += 1;
  }
  check('moteur de déploiement : AUCUNE mention d’un provider de webhooks', engineMentions === 0);
}

/* ------------------------------------------------------------------ */
section('5. buildWebhookUrl — un seul fabricant d’URL, multi-providers');
{
  const base = 'https://api.demo-sbauto.lycarz.com';
  /*
   * L'URL Stripe NE PORTE PAS LE MODE — TEST et PROD partagent la meme route,
   * l'aiguillage etant cryptographique. C'est precisement ce que ces deux
   * controles verrouillent : le fabricant d'URL ne doit pas se mettre a
   * inventer un segment de mode parce qu'on lui en passe un.
   */
  check('Stripe (mode TEST) — le mode ne change pas la route',
    buildWebhookUrl({ provider: 'STRIPE', category: 'payment', mode: 'TEST', publicBackendUrl: base })
    === `${base}/api/webhooks/stripe`);
  check('Stripe (mode PROD) — idem',
    buildWebhookUrl({ provider: 'STRIPE', category: 'payment', mode: 'PROD', publicBackendUrl: base })
    === `${base}/api/webhooks/stripe`);
  check('Stripe (route réelle sans mode)', buildWebhookUrl({ provider: 'STRIPE', category: 'payment', mode: 'PROD', publicBackendUrl: base })
    === `${base}/api/webhooks/stripe`);
  /** Yousign : plus aucune adresse locale fabricable — la route a disparu. */
  let ysUrl = false;
  try { buildWebhookUrl({ provider: 'YOUSIGN', category: 'signature', mode: 'TEST', publicBackendUrl: base }); } catch { ysUrl = true; }
  check('Yousign : plus aucune URL locale fabricable', ysUrl);
  let threw = false;
  try { buildWebhookUrl({ provider: 'GHOST', category: 'x', mode: 'TEST', publicBackendUrl: base }); } catch { threw = true; }
  check('provider inconnu : lève (jamais une URL inventée)', threw);
}

await mongod.stop();
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
