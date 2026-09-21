/* Rapports d'exécution des actions webhook (LOT diagnostics) : masquage des
 * secrets, construction/rendu du rapport (génération + contenu copié),
 * scénarios erreur Yousign / succès Brevo / succès Stripe, persistance réelle
 * (memory-server) et relecture pour le Manager. Runner autonome. */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'wrr_test';
process.env.DB_PROD = 'wrr_prod';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

let pass = 0;
let fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };
const section = (n) => console.log(`\n${n}`);

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
const {
  maskSensitiveText,
  maskDeep,
  diagnoseErrorCode,
  buildRunReport,
  renderRunReportText,
  runProviderWebhookAction,
  getLastRunReports,
  persistRunReport,
} = await import('../services/webhooks/webhookRunReport.service.js');
const { IntegratedApi } = await import('../models/IntegratedApi.model.js');

await connectDatabase();

const NOW = new Date('2026-07-25T10:00:00.000Z');
const LATER = new Date('2026-07-25T10:00:00.512Z');

const CAPS = {
  createWebhook: true, updateWebhook: true, deleteWebhook: true,
  listWebhooks: true, repairWebhook: true, testWebhook: 'diagnostic',
};

function descriptor(overrides = {}) {
  return {
    provider: 'YOUSIGN', category: 'signature', mode: 'TEST',
    expectedUrl: 'https://abc.ngrok-free.app/api/webhooks/yousign',
    publicBackendUrl: 'https://abc.ngrok-free.app',
    publicUrlSource: 'ngrok',
    webhookReady: true,
    remoteStatus: 'ERROR',
    remoteWebhookId: null,
    lastSyncAt: null,
    lastReceivedEventAt: null,
    lastReceivedEventType: null,
    lastSyncError: { code: 'YOUSIGN_REMOTE_ERROR', message: 'Webhook limit reached' },
    secretConfigured: false,
    supportsRemoteSync: true,
    ...overrides,
  };
}

try {
  /* ------------------------------ 1. Masquage ------------------------------ */
  section('1. Masquage des secrets');
  check('whsec_ masqué', !maskSensitiveText('secret whsec_abcDEF123456 fin').includes('whsec_abcDEF123456'));
  check('sk_test_ masqué', !maskSensitiveText('key sk_test_51Abc99Xyz').includes('sk_test_51Abc99Xyz'));
  check('sk_live_ masqué', !maskSensitiveText('key sk_live_51Abc99Xyz').includes('sk_live_51Abc99Xyz'));
  check('clé Brevo xkeysib masquée', !maskSensitiveText('xkeysib-0a1b2c3d4e5f-XYZ').includes('xkeysib-0a1b2c3d4e5f'));
  check('Bearer masqué', !maskSensitiveText('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig').includes('eyJhbGci'));
  const longToken = 'A'.repeat(48);
  check('token long opaque masqué', !maskSensitiveText(`token ${longToken}`).includes(longToken));
  check('texte normal intact', maskSensitiveText('URL https://x.fr/api/webhooks/yousign : erreur 403') === 'URL https://x.fr/api/webhooks/yousign : erreur 403');
  const deep = maskDeep({ a: ['whsec_abcDEF123456'], b: { c: 'ok' } });
  check('maskDeep : masque en profondeur', deep.a[0] === '***' && deep.b.c === 'ok');

  /* --------------------------- 2. Diagnostics codes --------------------------- */
  section('2. Diagnostics par code');
  check('URL_NOT_PUBLIC → ngrok/déploiement', diagnoseErrorCode('URL_NOT_PUBLIC').fix.includes('ngrok'));
  /*
   * R11 — LE CONSEIL NE PEUT PLUS DESIGNER UN ECRAN SUPPRIME.
   *
   * Il envoyait saisir la cle dans « Integrations API ». Cette page n'existe
   * plus : les quatre fournisseurs sont administres par la plateforme. Un
   * conseil qui nomme un ecran disparu fait tourner en rond exactement au
   * moment ou l'on cherche a reparer.
   */
  check('API_KEY_MISSING → renvoie vers la plateforme',
    /plateforme|Panel/i.test(diagnoseErrorCode('API_KEY_MISSING').fix));
  check('YOUSIGN_API_UNAUTHORIZED → clé refusée (suffixe)', diagnoseErrorCode('YOUSIGN_API_UNAUTHORIZED').diagnostic.includes('refuse la clé'));
  check('STRIPE_REMOTE_ERROR → erreur distante (suffixe)', diagnoseErrorCode('STRIPE_REMOTE_ERROR').diagnostic.includes('rejeté'));
  check('code inconnu → repli honnête', diagnoseErrorCode('MYSTERY').fix.includes('rapport'));

  /* ------------------- 3. Rapport ÉCHEC Yousign (génération) ------------------- */
  section('3. Rapport : erreur Yousign');
  const yousignFail = buildRunReport({
    provider: 'YOUSIGN', mode: 'TEST', action: 'sync',
    startedAt: NOW, finishedAt: LATER,
    actionReport: {
      provider: 'YOUSIGN', supportsWebhooks: true,
      results: [{ category: 'signature', skipped: false, ok: false, error: { code: 'YOUSIGN_REMOTE_ERROR', message: 'Webhook limit reached (whsec_abcDEF123456)' } }],
    },
    descriptor: descriptor(),
    capabilities: CAPS,
    credential: 'OK',
  });
  check('statut FAILED', yousignFail.status === 'FAILED');
  check('durée calculée', yousignFail.durationMs === 512);
  check('code d\'erreur remonté', yousignFail.error?.code === 'YOUSIGN_REMOTE_ERROR');
  check('diagnostic présent', yousignFail.diagnostic.length > 10);
  check('correction suggérée présente', yousignFail.suggestedFix.length > 10);
  check('secret masqué dans l\'erreur', !JSON.stringify(yousignFail).includes('whsec_abcDEF123456'));
  const text = yousignFail.text;
  check('texte : provider', text.includes('Provider : YOUSIGN'));
  check('texte : mode', text.includes('Mode : TEST'));
  check('texte : action libellée', text.includes('Action : Synchroniser'));
  check('texte : résultat', text.includes('Résultat : FAILED'));
  check('texte : backend URL', text.includes('Backend URL : https://abc.ngrok-free.app'));
  check('texte : webhook URL', text.includes('Webhook URL : https://abc.ngrok-free.app/api/webhooks/yousign'));
  check('texte : capabilities', text.includes('Capabilities :'));
  check('texte : credentials OK', text.includes('Credentials : OK'));
  check('texte : diagnostic', text.includes('Diagnostic :'));
  check('texte : correction', text.includes('Correction suggérée :'));
  check('texte : durée', text.includes('Durée : 512 ms'));
  check('texte = contenu copié (renderRunReportText)', renderRunReportText(yousignFail) === text);

  /* --------------------- 4. Rapports SUCCÈS Brevo & Stripe --------------------- */
  section('4. Rapports : succès Brevo / Stripe');
  const brevoOk = buildRunReport({
    provider: 'BREVO', mode: 'TEST', action: 'test',
    startedAt: NOW, finishedAt: LATER,
    actionReport: { provider: 'BREVO', results: [{ category: 'transactional', ok: true, remoteOk: true, secretConfigured: true, reachable: true }] },
    descriptor: descriptor({ provider: 'BREVO', category: 'transactional', remoteStatus: 'CONFIGURED', remoteWebhookId: '42', secretConfigured: true, lastSyncError: null }),
    capabilities: CAPS,
    credential: 'OK',
  });
  check('Brevo : SUCCESS', brevoOk.status === 'SUCCESS');
  check('Brevo : aucune exception', brevoOk.error === null);
  check('Brevo : diagnostic sain', brevoOk.diagnostic.includes('Aucune anomalie'));
  check('Brevo : texte Tester', brevoOk.text.includes('Action : Tester'));

  const stripeOk = buildRunReport({
    provider: 'STRIPE', mode: 'TEST', action: 'sync',
    startedAt: NOW, finishedAt: LATER,
    actionReport: { provider: 'STRIPE', results: [{ category: 'payment', ok: true, created: true, secretCaptured: true, deletedDuplicates: 0 }] },
    descriptor: descriptor({ provider: 'STRIPE', category: 'payment', remoteStatus: 'CONFIGURED', remoteWebhookId: 'we_1', secretConfigured: true, lastSyncError: null, expectedUrl: 'https://abc.ngrok-free.app/api/webhooks/stripe' }),
    capabilities: CAPS,
    credential: 'OK',
  });
  check('Stripe : SUCCESS', stripeOk.status === 'SUCCESS');
  check('Stripe : création tracée', stripeOk.text.includes('webhook créé'));
  check('Stripe : capture du secret tracée sans le secret', stripeOk.text.includes('secret capturé') && !stripeOk.text.includes('whsec_'));

  /* ----------------------- 5. Exception levée (stack masquée) ----------------------- */
  section('5. Exception inattendue');
  const err = new Error('boom sk_test_51Abc99Xyz');
  err.code = 'REMOTE_UNREACHABLE';
  const thrownReport = buildRunReport({
    provider: 'YOUSIGN', mode: 'TEST', action: 'repair',
    startedAt: NOW, finishedAt: LATER,
    actionReport: { provider: 'YOUSIGN', results: [] },
    thrown: err,
    descriptor: descriptor(),
    capabilities: CAPS,
    credential: 'MISSING',
  });
  check('exception : FAILED', thrownReport.status === 'FAILED');
  check('exception : stack incluse', thrownReport.error.stack.length > 0);
  check('exception : clé masquée partout', !JSON.stringify(thrownReport).includes('sk_test_51Abc99Xyz'));
  check('exception : credentials ABSENTES dans le texte', thrownReport.text.includes('Credentials : ABSENTES'));

  /* ---------------- 6. Exécution instrumentée + persistance réelle ---------------- */
  section('6. runProviderWebhookAction + persistance');
  await IntegratedApi.create({ provider: 'YOUSIGN', displayName: 'Yousign' });

  const fakeYousign = {
    providerCode: () => 'YOUSIGN',
    supportsWebhooks: () => true,
    capabilities: () => ({ ...CAPS }),
    requiredCredentialName: () => 'apiKey',
    listManagedWebhooks: async () => [descriptor()],
    ensureWebhooks: async () => [{ category: 'signature', skipped: false, ok: false, error: { code: 'YOUSIGN_REMOTE_ERROR', message: 'Webhook limit reached' } }],
    repairWebhooks: async () => [{ category: 'signature', skipped: false, ok: true, created: false, updated: false }],
    testWebhooks: async () => [{ category: 'signature', ok: true, remoteOk: true, secretConfigured: true, reachable: true }],
  };

  const fail1 = await runProviderWebhookAction('YOUSIGN', 'TEST', 'sync', { providers: [fakeYousign] });
  check('sync : rapport FAILED', fail1.runReport.status === 'FAILED');
  check('sync : actionReport conservé (compatibilité)', Array.isArray(fail1.actionReport.results));
  let doc = await IntegratedApi.findOne({ provider: 'YOUSIGN' });
  check('persisté : lastRunReport', doc.modes.TEST.webhook.lastRunReport?.status === 'FAILED');
  check('persisté : lastAttemptAt', Boolean(doc.modes.TEST.webhook.lastAttemptAt));
  check('persisté : PAS de lastSuccessAt après échec', !doc.modes.TEST.webhook.lastSuccessAt);

  const ok2 = await runProviderWebhookAction('YOUSIGN', 'TEST', 'test', { providers: [fakeYousign] });
  check('test : rapport SUCCESS', ok2.runReport.status === 'SUCCESS');
  doc = await IntegratedApi.findOne({ provider: 'YOUSIGN' });
  check('persisté : lastSuccessAt après succès', Boolean(doc.modes.TEST.webhook.lastSuccessAt));
  check('persisté : dernier rapport = test', doc.modes.TEST.webhook.lastRunReport?.action === 'test');

  const reports = await getLastRunReports('TEST');
  check('getLastRunReports : rapport relu pour le Manager', reports.YOUSIGN?.lastRunReport?.action === 'test');
  check('getLastRunReports : dates exposées', Boolean(reports.YOUSIGN.lastAttemptAt && reports.YOUSIGN.lastSuccessAt));

  // Persistance directe : provider absent → best-effort sans exception.
  check('persistRunReport : provider inconnu → false sans lever', (await persistRunReport('STRIPE', 'TEST', yousignFail)) === false);

  // L'état webhook préexistant n'est pas écrasé par la persistance du rapport.
  doc = await IntegratedApi.findOne({ provider: 'YOUSIGN' });
  doc.modes.TEST.webhook = { ...(doc.modes.TEST.webhook.toObject?.() || doc.modes.TEST.webhook), webhookId: 'wh_keep' };
  doc.markModified('modes.TEST.webhook');
  await doc.save();
  await runProviderWebhookAction('YOUSIGN', 'TEST', 'test', { providers: [fakeYousign] });
  doc = await IntegratedApi.findOne({ provider: 'YOUSIGN' });
  check('persistance : webhookId préservé', doc.modes.TEST.webhook.webhookId === 'wh_keep');

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
} catch (err) {
  console.error('WEBHOOK RUN REPORT TEST CRASHED:', err);
  fail++;
} finally {
  await disconnectDatabase().catch(() => {});
  await mongod.stop();
  process.exit(fail === 0 ? 0 : 1);
}
