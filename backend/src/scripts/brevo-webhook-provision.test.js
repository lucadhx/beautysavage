/**
 * WEBHOOK BREVO DE L'INSTITUT — création au premier test d'un compte neuf.
 *
 * Incident du 23/11/2026 (PROD meli-nails.fr) : sur un compte Brevo sans aucun
 * webhook, la LISTE répond 400 « Webhook record does not exist » au lieu d'une
 * liste vide ; le site le prenait pour un refus et ne créait jamais le webhook.
 *
 *   1. compte neuf (liste 400 « does not exist ») : le webhook est CRÉÉ ;
 *   2. webhook déjà présent à notre adresse : RÉUTILISÉ, rien n'est créé ;
 *   3. clé refusée (401) : erreur, rien n'est créé.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'brevo_webhook_test';
process.env.DB_PROD = 'brevo_webhook_prod';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.PUBLIC_URL = 'https://institut.example.test';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.NGROK_API_URL = 'http://127.0.0.1:1';

let pass = 0;
let fail = 0;
const check = (n, c, detail = '') => {
  if (c) { pass += 1; console.log(`  ✓ ${n}`); } else { fail += 1; console.error(`  ✗ ${n}${detail ? ` — ${detail}` : ''}`); }
};

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();
const { InstituteIntegration } = await import('../models/InstituteIntegration.model.js');
const { encryptSecret } = await import('../utils/integratedApiCrypto.js');
const { provisionInstituteBrevoWebhook } = await import('../services/email/instituteEmail.service.js');

const reset = async () => {
  await InstituteIntegration.deleteMany({});
  await InstituteIntegration.create({ provider: 'BREVO_INSTITUTE', modes: { TEST: { secretKey: { encryptedValue: encryptSecret('xkeysib-recette'), lastFour: 'ette' } } } });
};
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
/** Un faux Brevo : `list` est la réponse de la liste ; les appels sont notés. */
const fakeBrevo = (list) => {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET' });
    if ((opts.method || 'GET') === 'GET') return list;
    if (opts.method === 'POST') return json(201, { id: 4242 });
    return json(204, {});
  };
  return { fetchImpl, calls };
};
const slot = async () => (await InstituteIntegration.findOne({ provider: 'BREVO_INSTITUTE' }).lean()).modes.TEST;

console.log('\n1. Compte neuf');
await reset();
let brevo = fakeBrevo(json(400, { code: 'document_not_found', message: 'Webhook record does not exist' }));
let result = await provisionInstituteBrevoWebhook({ fetchImpl: brevo.fetchImpl }).catch((err) => ({ error: err.message }));
check('pas d’erreur sur la liste « inexistante »', !result.error, result.error);
check('le webhook est créé (POST)', brevo.calls.some((c) => c.method === 'POST'));
let s = await slot();
check('son identifiant est noté', s.webhookEndpointId === '4242', s.webhookEndpointId);
check('son adresse est notée (la carte passe au vert)', s.webhookUrl === 'https://institut.example.test/api/webhooks/brevo-institute', s.webhookUrl);
check('aucune erreur restée sur la fiche', !s.webhookLastError);

console.log('\n2. Webhook déjà présent');
const url = `https://institut.example.test/api/webhooks/brevo-institute?token=${(await import('../utils/integratedApiCrypto.js')).decryptSecret(s.webhookSecret.encryptedValue)}`;
brevo = fakeBrevo(json(200, { webhooks: [{ id: 4242, url }] }));
result = await provisionInstituteBrevoWebhook({ fetchImpl: brevo.fetchImpl });
check('réutilisé', result.reused === true);
check('rien n’est créé ni modifié', !brevo.calls.some((c) => c.method !== 'GET'));

console.log('\n3. Clé refusée');
await reset();
brevo = fakeBrevo(json(401, { code: 'unauthorized', message: 'Key not found' }));
result = await provisionInstituteBrevoWebhook({ fetchImpl: brevo.fetchImpl }).catch((err) => ({ error: err.message }));
check('erreur remontée', /Key not found/.test(result.error || ''), result.error);
check('rien n’est créé', !brevo.calls.some((c) => c.method === 'POST'));

await disconnectDatabase();
await mongod.stop();
console.log(`\n${pass} réussi(s), ${fail} échoué(s)`);
process.exit(fail ? 1 : 0);
