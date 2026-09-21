/* ROUTAGE D'ENVIRONNEMENT — la révocation d'`activeMode` (lot L2).
 *
 * ── CE QUE CE FICHIER PROUVE ─────────────────────────────────────────────────
 *
 * Une seule chose, et elle vaut tout le lot :
 *
 *     l'environnement du runtime décide du monde fournisseur, et rien d'autre.
 *
 * On le prouve au niveau des VRAIS services — pas seulement du résolveur. Un
 * résolveur juste que personne n'appelle ne protège rien : ce sont
 * `getCredential`, le provider Stripe et la vérification de webhook qu'il faut
 * mettre en défaut.
 *
 * ── LE PIÈGE QU'ON TEND ──────────────────────────────────────────────────────
 *
 * Dans chaque cas, `activeMode` est positionné à l'OPPOSÉ de l'environnement,
 * et les DEUX jeux d'identifiants sont renseignés — de sorte qu'un repli
 * réussirait silencieusement. Si le routage lisait encore `activeMode`, ces
 * tests passeraient au vert avec la mauvaise clé ; ils échouent parce qu'on
 * compare la clé RENDUE, pas seulement l'absence d'exception.
 *
 * Aucun appel réseau : le transport Stripe est instrumenté.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'routing_test';
process.env.DB_PROD = 'routing_prod';
process.env.JWT_SECRET = 'test-secret-jwt-routing';
process.env.PORT = '4137';
process.env.CORS_ORIGINS = 'http://localhost:6061';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); } else { fail += 1; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

const mongoose = (await import('mongoose')).default;
await mongoose.connect(process.env.MONGODB_URI, { dbName: 'routing_test' });

const { IntegratedApi } = await import('../models/IntegratedApi.model.js');
const { encryptSecret } = await import('../utils/integratedApiCrypto.js');
const routage = await import('../services/integratedApiEnvironment.js');
const coffre = await import('../services/integratedApi.service.js');

/** Sentinelles : la clé RENDUE désigne sans ambiguïté le monde d'où elle vient. */
const CLE = Object.freeze({
  STRIPE_TEST: 'sk_test_SENTINELLE_MONDE_TEST',
  STRIPE_PROD: 'sk_live_SENTINELLE_MONDE_PROD',
  SIGNATURE_TEST: 'SIGNATURE_SENTINELLE_TEST',
  SIGNATURE_PROD: 'SIGNATURE_SENTINELLE_PROD',
  BREVO_TEST: 'xkeysib-SENTINELLE_TEST',
  BREVO_PROD: 'xkeysib-SENTINELLE_PROD',
});

const cred = (v) => ({ encryptedValue: encryptSecret(v), lastFour: v.slice(-4) });

/**
 * Le parc de test : les DEUX mondes renseignés partout, et `activeMode`
 * systématiquement à l'opposé de l'environnement courant (TEST).
 */
async function semer() {
  await IntegratedApi.deleteMany({});
  await IntegratedApi.create([
    {
      provider: 'STRIPE', displayName: 'Stripe', enabled: true,
      activeMode: 'PROD', // ← le piège
      modes: {
        TEST: { credentials: new Map([['secretKey', cred(CLE.STRIPE_TEST)], ['webhookSecret', cred('whsec_TEST_SENTINELLE')]]), configured: true },
        PROD: { credentials: new Map([['secretKey', cred(CLE.STRIPE_PROD)], ['webhookSecret', cred('whsec_PROD_SENTINELLE')]]), configured: true },
      },
    },
    {
      provider: 'SIGNATURE', displayName: 'Signature électronique', enabled: true,
      activeMode: 'PROD',
      modes: {
        TEST: { credentials: new Map([['apiKey', cred(CLE.SIGNATURE_TEST)], ['webhookSecret', cred('SIG_TEST')]]), configured: true },
        PROD: { credentials: new Map([['apiKey', cred(CLE.SIGNATURE_PROD)], ['webhookSecret', cred('SIG_PROD')]]), configured: true },
      },
    },
    {
      provider: 'BREVO', displayName: 'Brevo', enabled: true,
      activeMode: 'PROD',
      modes: {
        TEST: { credentials: new Map([['apiKey', cred(CLE.BREVO_TEST)]]), configured: true },
        PROD: { credentials: new Map([['apiKey', cred(CLE.BREVO_PROD)]]), configured: true },
      },
    },
    {
      provider: 'HOSTINGER', displayName: 'Hostinger', enabled: true,
      activeMode: 'PROD',
      modes: {
        TEST: { credentials: new Map([['apiToken', cred('HOSTINGER_UNIQUE')]]), configured: true },
        PROD: { credentials: new Map(), configured: false },
      },
    },
  ]);
}
await semer();

/* ══════════════════════════════════════════════════════════════════════════ */
section('ENVIRONMENT_IS_PROVIDER_ROUTING_AUTHORITY — ENV=TEST');
{
  check('le runtime sert TEST', routage.runtimeEnvironment() === 'TEST');
  for (const p of ['STRIPE', 'BREVO', 'SIGNATURE']) {
    check(`${p} résout TEST`, routage.resolveProviderEnvironment(p) === 'TEST');
  }
}

section('ACTIVE_MODE_IS_NOT_PROVIDER_ROUTING_AUTHORITY — au niveau des SERVICES');
{
  // `activeMode = PROD` partout, et les deux mondes sont configurés : un
  // routage resté sur `activeMode` rendrait la clé PROD sans lever.
  const stripe = await IntegratedApi.findOne({ provider: 'STRIPE' });
  check('le piège est bien posé : activeMode vaut PROD', stripe.activeMode === 'PROD');

  check('getCredential rend la clé du RUNTIME (TEST), pas de l’activeMode',
    (await coffre.getCredential('STRIPE', 'secretKey')) === CLE.STRIPE_TEST);
  check('…et surtout PAS la clé PROD',
    (await coffre.getCredential('STRIPE', 'secretKey')) !== CLE.STRIPE_PROD);

  /**
   * LA SIGNATURE SUIT LE MONDE DU RUNTIME, COMME LES AUTRES.
   *
   * Ce contrôle lisait `getCredential('YOUSIGN', 'apiKey')` et comparait à la
   * sentinelle TEST. Le nom a changé ; la règle éprouvée, elle, n'a pas bougé :
   * face à un `activeMode` PROD, c'est le monde du RUNTIME qui décide.
   *
   * On garde une lecture de coffre BRUTE ici — et pas la vue « autorité
   * plateforme », éprouvée juste après. Les deux disent des choses
   * différentes : celle-ci que le ROUTAGE choisit le bon monde, celle-là que
   * la CONFIGURATION ne rend rien au projet. Confondre les deux laisserait le
   * routage sans témoin le jour où la vue changerait.
   */
  check('la signature suit le runtime, jamais l’activeMode',
    (await coffre.getCredential('SIGNATURE', 'apiKey')) === CLE.SIGNATURE_TEST);
  check('…et surtout PAS la clé PROD',
    (await coffre.getCredential('SIGNATURE', 'apiKey')) !== CLE.SIGNATURE_PROD);
  check('Brevo suit le runtime',
    (await coffre.getCredential('BREVO', 'apiKey')) === CLE.BREVO_TEST);

  /**
   * R10.5C — LE TÉMOIN DE ROUTAGE A CHANGÉ DE FOURNISSEUR.
   *
   * Stripe puis Yousign sont passés sous autorité de la plateforme : ni l’un
   * ni l’autre n’expose plus de clé d’appel locale. Il faut pourtant un
   * fournisseur qui en ait encore une, sans quoi la règle éprouvée ici — le
   * MONDE DU RUNTIME est la seule autorité de routage, jamais `activeMode` —
   * n’aurait plus de témoin, et pourrait se briser sans que rien ne le dise.
   *
   * Brevo joue ce rôle : sa clé d’API reste détenue par ce projet.
   */
  const config = await coffre.getProviderConfiguration('BREVO');
  check('getProviderConfiguration sert le monde du runtime', config.mode === 'TEST');
  check('…tout en exposant l’activeMode hérité, pour le diagnostic',
    config.activeMode === 'PROD');

  /**
   * R11 — LE COFFRE LOCAL NE REND PLUS AUCUNE CLÉ.
   *
   * L'assertion d'avant lisait `values.apiKey` : Brevo était le dernier
   * fournisseur à en détenir une, et servait donc de témoin au routage par
   * monde. Il est passé sous autorité plateforme ; ce n'est plus un écart mais
   * la règle — et la version d'avant, laissée en place, aurait exigé le retour
   * de la clé qu'on vient de retirer.
   *
   * Le document de test contient TOUJOURS une clé chiffrée, semée directement
   * en base : c'est ce qui rend ce contrôle probant. Il ne constate pas une
   * absence de donnée, il constate que le coffre REFUSE de servir une donnée
   * qui existe encore.
   */
  check('…mais ne rend AUCUNE clé locale : autorité plateforme',
    Object.keys(config.values).length === 0);

  /**
   * LE ROUTAGE PAR MONDE RESTE ÉPROUVÉ — sur le mécanisme qui subsiste.
   *
   * Plus aucun fournisseur n'expose de clé locale : le témoin ne pouvait donc
   * plus en être une. Mais la règle défendue ici n'a jamais porté sur les
   * clés — elle porte sur l'AUTORITÉ DE ROUTAGE : le monde du RUNTIME décide,
   * `activeMode` ne décide rien. Ce mécanisme est intact, et toujours lu (le
   * mode Brevo des e-mails en dépend). On l'éprouve donc directement, sur le
   * piège déjà posé : un `activeMode` PROD face à un runtime TEST.
   */
  check('le monde du runtime reste la seule autorité de routage',
    routage.resolveProviderEnvironment('BREVO') === 'TEST');
  check('…et l’activeMode hérité ne la contredit pas',
    config.activeMode === 'PROD' && config.mode === 'TEST');

  const readiness = await coffre.getProviderReadiness('BREVO');
  check('la préparation de Brevo vient désormais de la PLATEFORME',
    readiness.authority === 'PANEL');
  check('…et son activeMode local n’est plus une autorité',
    readiness.activeMode === null && readiness.legacyModeMismatch === false);

  /**
   * ET LA SIGNATURE RÉPOND COMME STRIPE : depuis la plateforme. Son
   * `activeMode` local n’est plus une autorité — le monde qui compte est
   * celui du Panel, que ce projet ne choisit pas.
   */
  const sigReadiness = await coffre.getProviderReadiness('SIGNATURE');
  check('la préparation de la signature vient de la PLATEFORME',
    sigReadiness.authority === 'PANEL');
  check('…et son activeMode local n’est plus une autorité',
    sigReadiness.activeMode === null && sigReadiness.legacyModeMismatch === false);

  /**
   * STRIPE, LUI, NE RÉPOND PLUS DEPUIS LA BASE (L6.3 FINAL). Sa préparation
   * vient du Control Plane, et `activeMode` n'a plus de sens : le monde qui
   * compte est celui du Panel, que ce projet ne choisit pas.
   */
  const stripeReadiness = await coffre.getProviderReadiness('STRIPE');
  check('la préparation de Stripe vient de la PLATEFORME',
    stripeReadiness.authority === 'PANEL');
  check('…et son activeMode local n’est plus une autorité',
    stripeReadiness.activeMode === null && stripeReadiness.legacyModeMismatch === false);
}

section('IL N’Y A PLUS DE PROVIDER STRIPE À ROUTER (L6.3C)');
{
  /**
   * ══ CE QUE CETTE SECTION PROUVAIT, ET POURQUOI ELLE CHANGE ════════════════
   *
   * Elle instrumentait le pilote Stripe pour vérifier qu'il consommait bien la
   * clé du MONDE COURANT, et jamais celle de l'autre. C'était le contrôle le
   * plus concret du routage : le SDK recevait une clé, et on regardait laquelle.
   *
   * Le pilote n'existe plus. Le dernier appel métier est parti en L6.3C, et
   * avec lui le seul `import Stripe from 'stripe'` du projet.
   *
   * La question de routage reste posée pour les fournisseurs qui subsistent —
   * elle est vérifiée juste au-dessus, sur le coffre lui-même. Ce qu'on ajoute
   * ici est la seule affirmation qui vaille désormais pour Stripe : il n'y a
   * plus rien à router, parce qu'il n'y a plus d'appelant.
   */
  const fs = await import('node:fs');
  const path = await import('node:path');
  const url = await import('node:url');
  const racine = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

  for (const parti of ['services/stripe/stripe.provider.js', 'services/stripe/stripe.stub.js']) {
    check(`${parti} n’existe plus`, !fs.existsSync(path.join(racine, parti)));
  }

  const service = await import('../services/stripe/stripe.service.js');
  check('le service Stripe n’expose plus de pilote', service.getStripeProvider === undefined);
  check('…mais vérifie toujours les signatures entrantes',
    typeof service.verifyStripeWebhookAnyMode === 'function');

  /**
   * LA CLÉ RESTE ROUTÉE CORRECTEMENT PAR LE COFFRE — c'est encore vrai, et
   * c'est encore utile : le diagnostic de connexion la lit, et il ne doit
   * jamais lire celle de l'autre monde.
   */
  const cleUtilisee = await coffre.getCredential('STRIPE', 'secretKey');
  check('le coffre sert toujours la clé du monde COURANT', cleUtilisee === CLE.STRIPE_TEST);
  check('…jamais la clé live', cleUtilisee !== CLE.STRIPE_PROD);
}

section('MISSING_CREDENTIAL_NEVER_FALLS_BACK');
{
  // On vide le monde TEST de Brevo. Le monde PROD reste plein : un repli
  // réussirait — et c'est précisément ce qu'on interdit.
  await IntegratedApi.updateOne({ provider: 'BREVO' }, { $set: { 'modes.TEST.credentials': {} } });
  let code = null;
  try { await coffre.getCredential('BREVO', 'apiKey'); } catch (err) { code = err.code; }
  check('le monde courant vide → erreur typée', code === 'UNFILLED');
  check('…et AUCUN repli sur l’autre monde',
    (await coffre.tryGetCredential('BREVO', 'apiKey')) === null);
  const encore = await IntegratedApi.findOne({ provider: 'BREVO' });
  check('…alors que la clé de l’autre monde est bien là',
    Boolean(encore.modes.PROD.credentials.get('apiKey')));
  await semer();
}

section('HOSTINGER — PANEL_GLOBAL, hors de toute logique TEST/PROD');
{
  check('sa portée est globale', routage.providerScope('HOSTINGER') === 'PANEL_GLOBAL');
  check('il résout la même case quel que soit le runtime',
    routage.resolveProviderEnvironment('HOSTINGER') === 'TEST');
  check('sa clé unique est lisible',
    (await coffre.getCredential('HOSTINGER', 'apiToken')) === 'HOSTINGER_UNIQUE');

  /**
   * LE SERVICE HOSTINGER LOCAL N'EXISTE PLUS (lot L9.2).
   *
   * Cette ligne vérifiait qu'il « se chargeait sans exiger un monde ». Elle
   * n'avait plus d'objet le jour où le module a été supprimé — et, écrite avec
   * un `catch` qui rendait `null`, elle aurait continué de passer indéfiniment
   * sur un module absent. On éprouve donc l'INVERSE, qui est le fait du lot :
   * plus aucun chemin de ce projet ne peut fabriquer un client Hostinger.
   */
  const chargeable = await import('../integrations/hostinger/hostinger.service.js')
    .then(() => true).catch(() => false);
  check('le service Hostinger local a bien disparu du projet', chargeable === false);

  const { resolveDnsProvider, DNS_PATH } = await import('../integrations/hostinger/dnsProviderResolution.js');
  const sansPanel = await resolveDnsProvider({ siteHost: 'demo.lycarz.com', invoke: null });
  check('…et sans plateforme, le DNS n’a AUCUN chemin de repli',
    sansPanel.path === DNS_PATH.NONE && sansPanel.provider === null);
}

section('FAIL CLOSED — demander explicitement l’autre monde');
{
  const refuse = (fn, code) => { try { fn(); return false; } catch (e) { return e?.code === code; } };
  check('demander PROD depuis une instance TEST est refusé',
    refuse(() => routage.assertEnvironmentServed('STRIPE', 'PROD'),
      routage.INTEGRATED_API_ENVIRONMENT_MISMATCH));
  check('demander TEST est accepté',
    routage.assertEnvironmentServed('STRIPE', 'TEST') === 'TEST');
  check('ne rien demander rend le monde du runtime',
    routage.assertEnvironmentServed('STRIPE', null) === 'TEST');
}

section('COMMERCIAL_STATE / HOSTNAME / providerMode N’INFLUENCENT RIEN');
{
  const source = routage.resolveProviderEnvironment.toString()
    + routage.runtimeEnvironment.toString();
  check('le résolveur ne lit aucun état commercial', !/commercial|preopening|live/i.test(source));
  check('…aucun hostname ni domaine', !/hostname|host\b|domain|origin/i.test(source));
  check('…aucun providerMode historique', !/providerMode/i.test(source));
  check('…aucun activeMode', !/activeMode/i.test(source));

  // Et le tour complet : le module de routage n'importe rien du commerce.
  const fs = await import('node:fs/promises');
  const fichier = await fs.readFile(new URL('../services/integratedApiEnvironment.js', import.meta.url), 'utf8');
  const codeSeul = fichier.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('le module ne lit jamais activeMode', !/activeMode/.test(codeSeul));
  check('…et ne connaît que config.env', /config\.env/.test(codeSeul));
}

section('AUCUN SERVICE MÉTIER NE ROUTE PLUS PAR activeMode');
{
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  // `fileURLToPath` et non `.pathname` : ce dernier laisse les séquences
  // percent-encodées d'un chemin contenant des espaces (« Dev Web »), et
  // `readdir` échoue alors sur un dossier qui existe pourtant.
  const racine = fileURLToPath(new URL('../', import.meta.url));

  async function fichiersJs(dossier) {
    const out = [];
    for (const e of await fs.readdir(dossier, { withFileTypes: true })) {
      const complet = path.join(dossier, e.name);
      if (e.isDirectory()) out.push(...await fichiersJs(complet));
      else if (e.name.endsWith('.js') && !e.name.endsWith('.test.js')) out.push(complet);
    }
    return out;
  }

  const surveilles = [];
  for (const d of ['services', 'controllers', 'integrations']) {
    surveilles.push(...await fichiersJs(path.join(racine, d)));
  }

  const fautifs = [];
  for (const f of surveilles) {
    const brut = await fs.readFile(f, 'utf8');
    // On ignore les commentaires : ils EXPLIQUENT la révocation, c'est leur rôle.
    const code = brut.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // La seule définition tolérée est celle du getter déprécié lui-même.
    const estLeGetter = f.endsWith(path.join('services', 'integratedApi.service.js'));
    if (/getActiveMode\s*\(/.test(code) && !estLeGetter) fautifs.push(path.relative(racine, f));
    // Un `activeMode` utilisé pour LIRE un jeu d'identifiants.
    if (/modes\s*\[\s*[^\]]*activeMode/.test(code)) fautifs.push(path.relative(racine, f));
  }

  check(`aucun service ne route par activeMode${fautifs.length ? ` (fautifs : ${fautifs.join(', ')})` : ''}`,
    fautifs.length === 0);
  check('…et le nombre de fichiers surveillés est significatif', surveilles.length > 40);
}

console.log(`\n${pass} réussis, ${fail} échoués`);
await mongoose.disconnect();
await mongod.stop();
process.exit(fail === 0 ? 0 : 1);
