/* PROTECTION CONTRACTUELLE — le réglage qui décide si l'absence de contrat
 * suspend le site.
 *
 * ── CE QUE CE TEST DÉFEND ───────────────────────────────────────────────────
 * 1. La MATRICE : protection × état du contrat -> suspension contractuelle.
 * 2. La NON-INTERFÉRENCE : désactiver la protection ne lève AUCUNE autre cause
 *    de suspension. C'est l'erreur la plus coûteuse possible ici — un réglage
 *    contractuel qui rouvrirait un site en maintenance.
 * 3. L'AUTORITÉ UNIQUE : Manager (HTTP) et Panel (opération du pont) écrivent
 *    la même valeur, au même endroit, et la relisent identique.
 * 4. La PERMISSION : refusée côté BACKEND, pas seulement masquée à l'écran.
 * 5. La COMPATIBILITÉ : une fiche antérieure au champ se comporte comme avant.
 *
 * Runner autonome (Mongo en mémoire, Stripe/Yousign en stub). */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'protection_test';
process.env.DB_PROD = 'protection_prod';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.PORT = '4147';
process.env.CORS_ORIGINS = 'http://localhost:6062';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.SIGNATURE_PROVIDER = 'stub';
process.env.STRIPE_PROVIDER = 'stub';

let pass = 0;
let fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };
const section = (n) => console.log(`\n${n}`);

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
const { bootstrap } = await import('../config/bootstrap.js');
const { createApp } = await import('../app.js');
await connectDatabase();
await bootstrap();
// Le service est PRÊT : cette suite a fait elle-même tout ce que le démarrage fait.
await (await import("./helpers/serviceReady.helper.js")).markTestServiceReady();
// LOT 2C — le DÉCOR de recette (dev@mail.com, admin@mail.com) ne vient plus du
// produit : `bootstrap()` ne pose aucun mot de passe. Voir helpers/testAccounts.helper.js.
await (await import("./helpers/testAccounts.helper.js")).seedTestAccounts();

const app = createApp();
const server = app.listen(4147);
const base = 'http://localhost:4147';

const { Contract } = await import('../models/Contract.model.js');
const { SiteStatus } = await import('../models/SiteStatus.model.js');
const { getSingleton } = await import('../utils/singleton.js');
const {
  reconcileSiteStatus, setContractProtection, setTechnicalSuspension,
} = await import('../services/siteEnforcement.service.js');
const {
  invokeContractOperation, describeContractOperations, resetContractOperations,
} = await import('../services/projectBridge/contractOperations.js');

async function api(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(base + path, { method, headers, body: payload });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* réponse non-JSON */ }
  return { status: res.status, json };
}
async function login(email, password) {
  const r = await api('POST', '/api/auth/login', { body: { email, password } });
  return r.json?.data?.token;
}

/** Un contrat au statut voulu, sans passer par tout le parcours d'activation. */
async function makeContract(status, reference) {
  return Contract.create({
    reference,
    status,
    archived: false,
    // Le modèle exige l'environnement du contrat : ce test tourne en TEST.
    environment: 'TEST',
    pricing: { subscription: { enabled: true, amountIncludingTax: 100, currency: 'EUR', interval: 'MONTH' } },
  });
}
const wipeContracts = () => Contract.deleteMany({});

/** L'état effectif, relu depuis la base après réconciliation. */
async function etat() {
  await reconcileSiteStatus({});
  const s = await getSingleton(SiteStatus);
  return {
    status: s.status,
    source: s.suspensionSource,
    protection: Boolean(s.contractProtectionEnabled),
    // « suspendu POUR CAUSE CONTRACTUELLE » — la seule chose que la matrice
    // décrit. Un site suspendu techniquement ne compte pas ici.
    suspenduParContrat: s.status === 'SUSPENDED' && s.suspensionSource === 'CONTRACT',
  };
}

try {
  const devToken = await login('dev@mail.com', '123dev');
  const adminToken = await login('admin@mail.com', '123admin');
  check('jetons DEV et ADMIN obtenus', Boolean(devToken) && Boolean(adminToken));

  /* ─────────────────── 0. DÉFAUT : le comportement historique ─────────────── */
  section('0. Valeur par défaut');
  {
    const s = await getSingleton(SiteStatus);
    check('protection DÉSACTIVÉE par défaut (comportement historique)',
      Boolean(s.contractProtectionEnabled) === false);
    const e = await etat();
    check('aucun contrat + défaut -> site ACTIF (aucune suspension surprise)',
      e.status === 'ACTIVE' && !e.suspenduParContrat);
  }

  /* ─────────────────── 1-5. LA MATRICE ────────────────────────────────────── */
  section('1-5. Matrice protection × contrat');

  // 1. OFF + aucun contrat -> accessible
  await wipeContracts();
  await setContractProtection({ enabled: false });
  {
    const e = await etat();
    check('1. OFF + aucun contrat -> AUCUNE suspension contractuelle',
      !e.suspenduParContrat && e.status === 'ACTIVE');
  }

  // 5. OFF + contrat inactif -> accessible (pour la cause contractuelle)
  await wipeContracts();
  await makeContract('INACTIVE', 'CTR-OFF-INACTIF');
  {
    const e = await etat();
    check('5. OFF + contrat inactif -> AUCUNE suspension contractuelle',
      !e.suspenduParContrat && e.status === 'ACTIVE');
  }

  // OFF + contrat actif -> accessible
  await wipeContracts();
  await makeContract('ACTIVE', 'CTR-OFF-ACTIF');
  {
    const e = await etat();
    check('OFF + contrat actif -> accessible', !e.suspenduParContrat && e.status === 'ACTIVE');
  }

  // 2. ON + aucun contrat -> suspendu
  await wipeContracts();
  await setContractProtection({ enabled: true });
  {
    const e = await etat();
    check('2. ON + aucun contrat -> SUSPENDU (source CONTRACT)',
      e.suspenduParContrat && e.source === 'CONTRACT');
  }

  // 3. ON + contrat inactif -> suspendu
  await wipeContracts();
  await makeContract('INACTIVE', 'CTR-ON-INACTIF');
  {
    const e = await etat();
    check('3. ON + contrat inactif -> SUSPENDU (source CONTRACT)', e.suspenduParContrat);
  }

  // ON + contrat terminé -> suspendu
  await wipeContracts();
  await makeContract('ENDED', 'CTR-ON-ENDED');
  {
    const e = await etat();
    check('ON + contrat terminé (ENDED) -> SUSPENDU', e.suspenduParContrat);
  }

  // 4. ON + contrat actif -> accessible
  await wipeContracts();
  await makeContract('ACTIVE', 'CTR-ON-ACTIF');
  {
    const e = await etat();
    check('4. ON + contrat actif -> ACCESSIBLE', !e.suspenduParContrat && e.status === 'ACTIVE');
  }

  // ON + résilié en fin de période -> toujours servi (il est payé)
  await wipeContracts();
  await makeContract('CANCEL_AT_PERIOD_END', 'CTR-ON-CAPE');
  {
    const e = await etat();
    check('ON + résilié à l’échéance -> encore servi (contrat honoré)',
      !e.suspenduParContrat && e.status === 'ACTIVE');
  }

  /* ─────────── 6. LES AUTRES CAUSES NE SONT JAMAIS CONTOURNÉES ────────────── */
  section('6. Non-interférence avec les autres suspensions');
  {
    await wipeContracts();
    await makeContract('ACTIVE', 'CTR-TECH');
    await setContractProtection({ enabled: true });
    await setTechnicalSuspension({ active: true, reason: 'Maintenance', actorEmail: 'dev@mail.com' });

    let e = await etat();
    check('suspension technique posée -> SUSPENDU (source TECHNICAL)',
      e.status === 'SUSPENDED' && e.source === 'TECHNICAL');

    // LE cas qui compte : désactiver la protection ne doit RIEN rouvrir.
    await setContractProtection({ enabled: false });
    e = await etat();
    check('6. protection OFF + suspension manuelle -> TOUJOURS suspendu',
      e.status === 'SUSPENDED' && e.source === 'TECHNICAL');

    await wipeContracts();
    e = await etat();
    check('… et retirer le contrat ne change rien tant que la technique tient',
      e.status === 'SUSPENDED' && e.source === 'TECHNICAL');

    await setTechnicalSuspension({ active: false, actorEmail: 'dev@mail.com' });
    e = await etat();
    check('technique levée + protection OFF + aucun contrat -> ACTIF',
      e.status === 'ACTIVE' && e.source === 'NONE');
  }

  /* ─────────────────── TRANSITIONS IMMÉDIATES (A4) ────────────────────────── */
  section('Transitions immédiates');
  {
    // CAS 1 : contrat absent, protection OFF, site accessible -> on active.
    await wipeContracts();
    await setContractProtection({ enabled: false });
    check('CAS 1 — départ : site accessible', (await etat()).status === 'ACTIVE');
    await setContractProtection({ enabled: true });
    check('CAS 1 — activer la protection suspend IMMÉDIATEMENT',
      (await etat()).suspenduParContrat);

    // CAS 2 : désactiver fait disparaître la seule cause contractuelle.
    await setContractProtection({ enabled: false });
    const e2 = await etat();
    check('CAS 2 — désactiver lève la suspension contractuelle',
      e2.status === 'ACTIVE' && e2.source === 'NONE');

    // CAS 3 : protection ON, le contrat devient actif.
    await setContractProtection({ enabled: true });
    check('CAS 3 — départ : suspendu (aucun contrat)', (await etat()).suspenduParContrat);
    const vivant = await makeContract('ACTIVE', 'CTR-TRANS-3');
    check('CAS 3 — contrat actif -> la suspension contractuelle disparaît',
      !(await etat()).suspenduParContrat);

    // CAS 4 : le contrat actif expire.
    vivant.status = 'ENDED';
    await vivant.save();
    check('CAS 4 — contrat devenu inactif -> la suspension contractuelle réapparaît',
      (await etat()).suspenduParContrat);
  }

  /* ─────────────── 7-11. DEUX ÉCRANS, UNE SEULE VALEUR ────────────────────── */
  section('7-11. Manager et Panel écrivent la même valeur');
  {
    await wipeContracts();
    resetContractOperations();

    // 8. Désactivation depuis le MANAGER (HTTP, rôle DEV).
    const off = await api('POST', '/api/site-status/contract-protection', {
      token: devToken, body: { enabled: false },
    });
    check('8. Manager désactive -> 200', off.status === 200);
    check('8. … et la réponse porte la valeur appliquée',
      off.json?.data?.contractProtectionEnabled === false);
    check('8. … persistée en base',
      (await getSingleton(SiteStatus)).contractProtectionEnabled === false);

    // 11. Le PANEL lit la même valeur (catalogue d'opérations du pont).
    const vu1 = await describeContractOperations();
    check('11. le Panel LIT la valeur du projet (OFF)',
      vu1.contractProtection?.enabled === false);

    // 9. Activation depuis le PANEL (opération du pont).
    const r1 = await invokeContractOperation('contract.set_protection', {
      invocationId: 'inv-protection-1', params: { enabled: true },
    });
    check('9. Panel active -> opération réussie', r1.status === 'SUCCEEDED');
    check('9. … et rend l’état CONSTATÉ, pas la valeur demandée',
      r1.contractProtection?.enabled === true && r1.contractProtection?.siteStatus === 'SUSPENDED');
    check('9. … persistée en base',
      (await getSingleton(SiteStatus)).contractProtectionEnabled === true);

    // 11 (retour). Le MANAGER lit la valeur écrite par le Panel.
    const vuManager = await api('GET', '/api/site-status', { token: devToken });
    check('11. le Manager lit la valeur écrite par le Panel (ON)',
      vuManager.json?.data?.contractProtectionEnabled === true);
    check('11. … et les deux écrans voient le MÊME état',
      vuManager.json?.data?.contractProtectionEnabled
        === (await describeContractOperations()).contractProtection?.enabled);

    // 7. Activation depuis le Manager (déjà ON) : idempotent, pas d'à-coup.
    const on = await api('POST', '/api/site-status/contract-protection', {
      token: devToken, body: { enabled: true },
    });
    check('7. réactiver une protection déjà active est idempotent',
      on.status === 200 && on.json?.data?.contractProtectionEnabled === true);

    // 10. Désactivation depuis le Panel.
    const r2 = await invokeContractOperation('contract.set_protection', {
      invocationId: 'inv-protection-2', params: { enabled: false },
    });
    check('10. Panel désactive -> persistance réelle',
      r2.contractProtection?.enabled === false
      && (await getSingleton(SiteStatus)).contractProtectionEnabled === false);

    // Idempotence du pont : rejouer une invocation ne rebascule rien.
    await invokeContractOperation('contract.set_protection', {
      invocationId: 'inv-protection-1', params: { enabled: true },
    });
    check('rejouer un invocationId déjà vu ne réapplique pas le réglage',
      (await getSingleton(SiteStatus)).contractProtectionEnabled === false);
  }

  /* ─────────────── 12-13. ERREURS ET PERMISSIONS (BACKEND) ────────────────── */
  section('12-13. Refus explicites, côté backend');
  {
    const avant = (await getSingleton(SiteStatus)).contractProtectionEnabled;

    // 13. L'ADMIN (le client) ne décide pas si son contrat le protège.
    const admin = await api('POST', '/api/site-status/contract-protection', {
      token: adminToken, body: { enabled: true },
    });
    check('13. ADMIN refusé par le BACKEND (403)', admin.status === 403);
    check('13. … et la valeur n’a pas bougé',
      (await getSingleton(SiteStatus)).contractProtectionEnabled === avant);

    // Sans jeton du tout.
    const anon = await api('POST', '/api/site-status/contract-protection', { body: { enabled: true } });
    check('anonyme refusé (401)', anon.status === 401);

    // 12. Corps invalide : refusé, jamais interprété. Deviner « false » sur un
    // corps vide désactiverait la protection d'un site sur un appel malformé.
    const vide = await api('POST', '/api/site-status/contract-protection', {
      token: devToken, body: {},
    });
    check('12. corps sans « enabled » -> 400 (aucune interprétation)', vide.status === 400);
    const mauvais = await api('POST', '/api/site-status/contract-protection', {
      token: devToken, body: { enabled: 'oui' },
    });
    check('12. « enabled » non booléen -> 400', mauvais.status === 400);
    check('12. … et la valeur est restée intacte après les refus',
      (await getSingleton(SiteStatus)).contractProtectionEnabled === avant);

    // Le pont refuse lui aussi un paramètre manquant.
    let refus = false;
    try {
      await invokeContractOperation('contract.set_protection', { invocationId: 'inv-bad', params: {} });
    } catch { refus = true; }
    check('le pont refuse une demande sans « enabled »', refus);
  }

  /* ─────────── 14-15. COMPATIBILITÉ ET PERSISTANCE AU REDÉMARRAGE ─────────── */
  section('14-16. Ancienne fiche, redémarrage, propagation');
  {
    // 14. Une fiche antérieure au champ : on l'efface de la base pour simuler
    // un document écrit avant la migration.
    await SiteStatus.collection.updateMany({}, { $unset: { contractProtectionEnabled: '' } });
    const brut = await SiteStatus.collection.findOne({});
    check('14. le document ne porte PAS le champ (fiche historique)',
      brut.contractProtectionEnabled === undefined);

    const relu = await getSingleton(SiteStatus);
    check('14. relu par Mongoose -> false (comportement historique)',
      Boolean(relu.contractProtectionEnabled) === false);

    await wipeContracts();
    const e = await etat();
    check('14. … et un ancien projet sans contrat n’est PAS suspendu',
      e.status === 'ACTIVE' && !e.suspenduParContrat);

    // 15. « Redémarrage » : on relit depuis la base sans passer par le cache
    // du singleton. La valeur doit survivre.
    await setContractProtection({ enabled: true });
    const persiste = await SiteStatus.collection.findOne({});
    check('15. valeur écrite en base (survit à un redémarrage)',
      persiste.contractProtectionEnabled === true);

    // 16. Ce que le pont propage au Panel décrit l'état réel, cause comprise.
    const propage = await describeContractOperations();
    check('16. le pont propage la valeur ET la conséquence',
      propage.contractProtection?.enabled === true
      && propage.contractProtection?.suspendedByProtection === true);

    // Le catalogue publie l'opération MÊME sans contrat : c'est là qu'elle sert.
    const op = propage.operations.find((o) => o.id === 'contract.set_protection');
    check('16. l’opération est publiée même sans aucun contrat',
      Boolean(op) && op.available === true);
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} catch (err) {
  console.error('CONTRACT PROTECTION TEST CRASHED:', err);
  fail++;
} finally {
  server.close();
  await disconnectDatabase().catch(() => {});
  await mongod.stop().catch(() => {});
}

process.exit(fail === 0 ? 0 : 1);
