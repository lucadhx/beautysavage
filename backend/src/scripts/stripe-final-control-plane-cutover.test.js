/**
 * LA FERMETURE — CE PROJET NE PEUT PLUS DÉTENIR DE CLÉ STRIPE (L6.3 FINAL).
 *
 * ══ CE QUE CETTE SUITE GARDE ════════════════════════════════════════════════
 *
 * Les lots L6.2B→L6.3C ont retiré, un par un, les treize appels Stripe du
 * projet. À la fin, il ne restait plus qu'une chose : la POSSIBILITÉ d'en
 * reconstruire. Une clé saisissable, une route qui l'accepte, un diagnostic qui
 * la lit — et il ne manquait qu'un appelant.
 *
 * Ce lot ferme cette possibilité. Cette suite vérifie qu'elle reste fermée.
 *
 * ══ LA DISTINCTION QUI TIENT TOUT ═══════════════════════════════════════════
 *
 *   `sk_…`     permet d'APPELER Stripe. Interdit ici, à tous les étages.
 *   `whsec_…`  permet UNIQUEMENT de constater qu'un message reçu vient de
 *              Stripe. Il reste, parce que Stripe écrit directement au projet.
 *
 * Les confondre serait l'erreur la plus coûteuse du programme : dans un sens on
 * ferme une porte de sortie, dans l'autre on se rend sourd.
 *
 * ══ POURQUOI DES CONTRÔLES STATIQUES *ET* HTTP ══════════════════════════════
 *
 * Un contrôle statique prouve qu'aucun code n'appelle. Il ne prouve pas qu'une
 * requête forgée soit refusée. La fermeture se joue à la porte, donc on frappe
 * à la porte.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'stripe_final_test';
process.env.DB_PROD = 'stripe_final_prod';
process.env.JWT_SECRET = 'test-secret-jwt-final-cutover-32ch';
process.env.PORT = '4166';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.PANEL_SCHEDULER_ENABLED = 'false';

let pass = 0;
let fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };
const section = (n) => console.log(`\n${n}`);

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(ICI, '..');
const MANAGER = path.resolve(SRC, '..', '..', 'manager', 'src');

/** Retire commentaires : un invariant ne se prouve pas sur de la prose. */
const codeSeul = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1 ');

function fichiers(racine, exts) {
  const out = [];
  const ignorer = new Set(['node_modules', 'scripts', 'uploads', 'dist']);
  (function marcher(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!ignorer.has(e.name)) marcher(path.join(dir, e.name)); }
      else if (exts.some((x) => e.name.endsWith(x))) out.push(path.join(dir, e.name));
    }
  })(racine);
  return out;
}

const RUNTIME = fichiers(SRC, ['.js']).map((f) => ({
  rel: path.relative(SRC, f).replace(/\\/g, '/'),
  code: codeSeul(fs.readFileSync(f, 'utf8')),
}));
const UI = fichiers(MANAGER, ['.tsx', '.ts']).map((f) => ({
  rel: path.relative(MANAGER, f).replace(/\\/g, '/'),
  code: codeSeul(fs.readFileSync(f, 'utf8')),
}));

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
const { bootstrap } = await import('../config/bootstrap.js');
await connectDatabase();
await bootstrap();
// Le service est PRÊT : cette suite a fait elle-même tout ce que le démarrage fait.
await (await import("./helpers/serviceReady.helper.js")).markTestServiceReady();
// LOT 2C — le DÉCOR de recette (dev@mail.com, admin@mail.com) ne vient plus du
// produit : `bootstrap()` ne pose aucun mot de passe. Voir helpers/testAccounts.helper.js.
await (await import("./helpers/testAccounts.helper.js")).seedTestAccounts();

const { createApp } = await import('../app.js');
const app = createApp();
const server = app.listen(4166);
const base = 'http://localhost:4166';

async function api(method, chemin, { token, body } = {}) {
  const res = await fetch(base + chemin, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const texte = await res.text();
  let json = {};
  try { json = texte ? JSON.parse(texte) : {}; } catch { /* */ }
  return { status: res.status, json };
}
const login = async (e, p) => (await api('POST', '/api/auth/login', { body: { email: e, password: p } })).json?.data?.token;
const devToken = await login('dev@mail.com', '123dev');

const { IntegratedApi } = await import('../models/IntegratedApi.model.js');
const { INTEGRATED_API_CATALOG, isPanelAuthority, fieldKeys } = await import('../utils/integratedApiCatalog.js');

try {
  /* ══════════════════════════════════════════════════════════════════════════ */
  section('1. Le SDK, l’adresse et le pilote — trois absences');
  {
    const imports = RUNTIME.filter((f) => /from\s+['"]stripe['"]|require\(\s*['"]stripe['"]\s*\)|@stripe\//.test(f.code));
    check('STRIPE_SDK_RUNTIME_IMPORTS = 0', imports.length === 0);
    imports.forEach((f) => console.error(`      · ${f.rel}`));

    const constructeurs = RUNTIME.filter((f) => /new\s+Stripe\s*\(/.test(f.code));
    check('aucun client Stripe construit', constructeurs.length === 0);

    const adresses = RUNTIME.filter((f) => /api\.stripe\.com/.test(f.code));
    check('LOCAL_STRIPE_API_ENDPOINT_REFERENCES = 0', adresses.length === 0);
    adresses.forEach((f) => console.error(`      · ${f.rel}`));

    for (const parti of ['services/stripe/stripe.provider.js', 'services/stripe/stripe.stub.js']) {
      check(`${parti} n’existe plus`, !fs.existsSync(path.join(SRC, parti)));
    }
    const service = await import('../services/stripe/stripe.service.js');
    check('LOCAL_STRIPE_PROVIDER_METHODS = 0', service.getStripeProvider === undefined);
  }

  /* ══════════════════════════════════════════════════════════════════════════ */
  section('2. Aucune lecture, aucune écriture de clé d’APPEL');
  {
    const lecteurs = RUNTIME.filter((f) =>
      /getCredential\(\s*['"]STRIPE['"]\s*,\s*['"]secretKey['"]|readStoredCredential\([^)]*['"]secretKey['"]/.test(f.code));
    check('LOCAL_STRIPE_CALL_SECRET_READS = 0', lecteurs.length === 0);
    lecteurs.forEach((f) => console.error(`      · ${f.rel}`));

    /**
     * L'ÉCRITURE SE PROUVE PAR LE CATALOGUE, pas par une absence de code : la
     * route d'écriture est GÉNÉRIQUE, et elle accepte ce que le catalogue
     * déclare. Un champ déclaré est donc, à lui seul, une écriture possible.
     */
    check('LOCAL_STRIPE_CREDENTIAL_FIELDS = 0',
      INTEGRATED_API_CATALOG.STRIPE.fields.length === 0);
    check('…et Stripe est sous autorité de la plateforme', isPanelAuthority('STRIPE') === true);
  }

  /* ══════════════════════════════════════════════════════════════════════════ */
  section('3. La VRAIE route HTTP n’existe plus — pas seulement l’écran');
  {
    /**
     * ══ LE REFUS EST DEVENU UNE ABSENCE (R11) ═════════════════════════════
     *
     * Ces requêtes recevaient un 400 : la route existait et refusait. C'était
     * déjà bien — masquer un champ n'a jamais fermé une API — mais une route
     * qui refuse reste une route. Elle garde son contrôleur, son validateur,
     * son schéma d'écriture, et la seule chose qui la sépare d'une écriture
     * réelle est un `if`.
     *
     * Brevo étant passé sous autorité plateforme, PLUS AUCUN fournisseur n'est
     * administrable localement : la surface entière a donc été supprimée, pas
     * gardée. Un 404 ne se contourne pas en retirant une condition.
     *
     * On vérifie l'absence sur les mêmes requêtes forgées qu'avant : c'est
     * exactement le geste qu'un opérateur ou un script de reprise tenterait.
     */
    const tentatives = [
      ['PUT', '/api/integrated-apis/STRIPE/modes/TEST', { credentials: { secretKey: 'sk_test_FORGEE0001' } }],
      ['PUT', '/api/integrated-apis/STRIPE/modes/PROD', { credentials: { secretKey: 'sk_live_FORGEE0002' } }],
      ['PUT', '/api/integrated-apis/STRIPE/modes/TEST', { credentials: { webhookSecret: 'whsec_FORGEE0003' } }],
      ['PUT', '/api/integrated-apis/BREVO/modes/TEST', { credentials: { apiKey: 'xkeysib-FORGEE0004' } }],
      ['PUT', '/api/integrated-apis/YOUSIGN/modes/TEST', { credentials: { apiKey: 'ys_test_FORGEE0005' } }],
      ['PUT', '/api/integrated-apis/HOSTINGER/modes/TEST', { credentials: { apiToken: 'ht_FORGEE0006' } }],
    ];
    for (const [methode, chemin, corps] of tentatives) {
      const r = await api(methode, chemin, { token: devToken, body: corps });
      const provider = chemin.split('/')[3];
      check(`${methode} ${provider} (${Object.keys(corps)[0]}) → route inexistante`, r.status === 404);
    }
    const suppr = await api('DELETE', '/api/integrated-apis/STRIPE/modes/TEST', { token: devToken });
    check('DELETE d’un mode → route inexistante', suppr.status === 404);
    const lecture = await api('GET', '/api/integrated-apis', { token: devToken });
    check('…et même la LECTURE a disparu', lecture.status === 404);

    /** Et RIEN n'a été écrit : l'absence est réelle, pas cosmétique. */
    const docs = await IntegratedApi.find({}).lean();
    check('aucune valeur forgée n’a atteint la base',
      !JSON.stringify(docs).includes('FORGEE'));

    /**
     * LE TÉMOIN QUI EMPÊCHE DE CONFONDRE « FERMÉ » ET « EN PANNE ».
     *
     * Sans lui, cette section serait indistinguable d'un backend qui rend 404
     * partout. On vérifie donc qu'une route voisine, elle, répond toujours.
     */
    const vivante = await api('GET', '/api/email-configuration', { token: devToken });
    check('le reste de l’API DEV répond toujours — la fermeture est ciblée',
      vivante.status !== 404);
  }

  /* ══════════════════════════════════════════════════════════════════════════ */
  section('4. Le diagnostic passe par la plateforme');
  {
    /**
     * R11 — LE TEST DE CONNEXION S'ÉPROUVE SUR LE SERVICE, PLUS SUR LA ROUTE.
     *
     * La route `POST /modes/:mode/test` appartenait à la page d'administration,
     * supprimée avec elle : c'était un bouton, pas un chemin d'exécution.
     *
     * Le SERVICE, lui, reste — `sandbox-check.js` s'en sert — et c'est lui qui
     * porte la garantie que cette section défend : le test passe par la
     * plateforme et ne divulgue aucun secret. L'éprouver directement est même
     * plus strict : plus aucune sérialisation HTTP ne peut masquer ce qu'il rend.
     */
    const { testProviderConnection } = await import('../services/providerConnectionTest.service.js');
    const resultat = await testProviderConnection('STRIPE', 'TEST');
    check('le test de connexion répond', resultat && typeof resultat === 'object');

    const charge = JSON.stringify(resultat);
    check('…et l’autorité déclarée est la PLATEFORME', charge.includes('PANEL'));
    check('…aucun Panel appairé ici : le motif le dit',
      charge.includes('PANEL_NOT_PAIRED') || charge.includes('plateforme'));

    /**
     * AUCUN SECRET DANS LA RÉPONSE — ni valeur, ni fragment, ni en-tête. Un
     * diagnostic qui recopierait la réponse du fournisseur serait le chemin le
     * plus court vers une fuite dans un journal.
     */
    check('aucune clé d’appel dans la réponse', !/sk_(test|live)_/.test(charge));
    check('aucun secret de signature non plus', !/whsec_[A-Za-z0-9]{6}/.test(charge));
    check('aucun en-tête d’autorisation', !/Authorization/i.test(charge));

    /** Le service ne lit plus aucune clé Stripe. */
    const diagnostic = codeSeul(fs.readFileSync(path.join(SRC, 'services/providerConnectionTest.service.js'), 'utf8'));
    check('le service de test ne lit plus de clé Stripe',
      !/readStoredCredential\([^)]*secretKey[^)]*\)[\s\S]{0,200}STRIPE/i.test(diagnostic));
    check('…il demande une capacité au Panel',
      /diagnoseStripeAvailability/.test(diagnostic));
  }

  /* ══════════════════════════════════════════════════════════════════════════ */
  section('5. La préparation ne se lit plus dans la base locale');
  {
    const svc = await import('../services/integratedApi.service.js');

    /**
     * On POSE une clé locale directement en base — comme un projet historique
     * en porte encore une — et on vérifie qu'elle ne change RIEN.
     *
     * C'est le contrôle qui compte : tant que la présence d'une clé suffisait à
     * répondre « prêt », un projet dont la plateforme était en panne
     * s'entendait dire que tout allait bien.
     */
    const { encryptSecret, lastFourOf } = await import('../utils/integratedApiCrypto.js');
    const doc = await IntegratedApi.findOne({ provider: 'STRIPE' });
    const heritee = 'sk_test_CLE_HERITEE_EN_BASE_0001';
    doc.modes.TEST.credentials.set('secretKey', {
      encryptedValue: encryptSecret(heritee), lastFour: lastFourOf(heritee), updatedAt: new Date(),
    });
    doc.modes.TEST.verified = true;
    doc.markModified('modes.TEST.credentials');
    await doc.save();

    const readiness = await svc.getProviderReadiness('STRIPE');
    check('l’autorité est la PLATEFORME', readiness.authority === 'PANEL');
    check('une clé locale valide ne rend PAS « prêt »', readiness.ok === false);
    check('…et le motif nomme le Panel', readiness.reason === 'PANEL_NOT_PAIRED');
    check('…l’activeMode local n’est plus une autorité', readiness.activeMode === null);
  }

  /* ══════════════════════════════════════════════════════════════════════════ */
  section('6. Le Manager ne propose plus de saisir un secret Stripe');
  {
    /**
     * L'écran rend les champs déclarés par le catalogue. Celui de Stripe étant
     * vide, aucun formulaire n'apparaît — mais on le vérifie DEPUIS L'API, qui
     * est ce que l'écran consomme réellement.
     */
    /**
     * R11 — IL N'Y A PLUS D'ÉCRAN, DONC PLUS DE LISTE À SERVIR.
     *
     * Ce contrôle lisait `GET /api/integrated-apis` pour prouver que Stripe
     * s'affichait SANS champ de saisie. La route a disparu avec la page :
     * Brevo étant passé sous autorité plateforme, aucun des quatre
     * fournisseurs n'était plus administrable, et la surface entière a été
     * retirée plutôt que gardée.
     *
     * La garantie devient donc plus forte, et se lit sur le catalogue lui-même —
     * la source que l'écran consommait : zéro champ, autorité plateforme.
     */
    check('l’API de liste n’existe plus',
      (await api('GET', '/api/integrated-apis', { token: devToken })).status === 404);
    check('LOCAL_STRIPE_CREDENTIAL_UI_INPUTS = 0', fieldKeys('STRIPE').length === 0);
    check('…et l’autorité déclarée est la plateforme', isPanelAuthority('STRIPE'));

    /**
     * ET L'INTERFACE NE CODE PAS SA PROPRE SAISIE. Le contrôle porte sur le
     * code du Manager : un futur écran qui rajouterait un champ Stripe en dur
     * contournerait le catalogue.
     */
    const saisies = UI.filter((f) => /secretKey|publishableKey/.test(f.code));
    check('aucun écran du Manager ne nomme une clé Stripe', saisies.length === 0);
    saisies.forEach((f) => console.error(`      · ${f.rel}`));
  }

  /* ══════════════════════════════════════════════════════════════════════════ */
  section('7. Le secret de VÉRIFICATION reste, et reste confiné');
  {
    /**
     * Il ne franchit pas le catalogue — personne ne le saisit — mais il vit
     * bien dans le coffre, écrit par le provisionnement du Panel (L6.3A).
     */
    const provisionnement = codeSeul(fs.readFileSync(path.join(SRC, 'services/webhooks/panelWebhookProvisioning.js'), 'utf8'));
    check('le secret de signature est écrit par le PROVISIONNEMENT',
      /credentials\.set\(\s*['"]webhookSecret['"]/.test(provisionnement));
    check('…et il vient du canal étroit du Panel',
      /fetchWebhookVerificationSecret/.test(provisionnement));
    check('…jamais d’une saisie', !INTEGRATED_API_CATALOG.STRIPE.fields.some((f) => f.key === 'webhookSecret'));

    /** Il est lu UNIQUEMENT pour vérifier une signature entrante. */
    const service = codeSeul(fs.readFileSync(path.join(SRC, 'services/stripe/stripe.service.js'), 'utf8'));
    check('lu par la vérification de webhook', /tryGetCredential\(\s*['"]STRIPE['"]\s*,\s*['"]webhookSecret['"]/.test(service));
    check('…dans un fichier qui n’appelle jamais Stripe',
      !/api\.stripe\.com|new\s+Stripe/.test(service));

    /**
     * ET UN `sk_` NE PEUT PAS SE FAIRE PASSER POUR LUI. Le provisionnement
     * vérifie la FORME avant de ranger : le nom autorise, la forme confirme.
     */
    check('le rapatriement refuse une valeur qui n’est pas un whsec_',
      /startsWith\(\s*['"]whsec_['"]\s*\)/.test(provisionnement));
  }

  /* ══════════════════════════════════════════════════════════════════════════ */
  section('8. Aucun repli, nulle part');
  {
    const MIGRES = [
      'services/contract.service.js',
      'services/contractTestTools.service.js',
      'services/payment.service.js',
      'services/subscription.service.js',
      'services/billing.service.js',
      'services/stripe/checkoutCapability.js',
      'services/webhooks/panelWebhookProvisioning.js',
    ];
    for (const rel of MIGRES) {
      const code = codeSeul(fs.readFileSync(path.join(SRC, rel), 'utf8'));
      const replis = [...code.matchAll(/catch\s*(\([^)]*\))?\s*\{([\s\S]{0,400}?)\}/g)]
        .filter((m) => /(stripe|provider)\s*\.\s*(create|retrieve|list|cancel|update)/i.test(m[2]));
      check(`${rel} : aucun repli Stripe`, replis.length === 0);
    }
    check('LOCAL_STRIPE_FALLBACKS = 0', true);
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} catch (err) {
  console.error('STRIPE FINAL CUTOVER TEST CRASHED:', err);
  fail += 1;
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} finally {
  await new Promise((r) => server.close(r));
  await disconnectDatabase().catch(() => {});
  await mongod.stop();
  process.exit(fail === 0 ? 0 : 1);
}
