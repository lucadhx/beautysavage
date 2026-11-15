/**
 * APERÇU VIDÉO DU MANAGER (2026-11-15).
 *
 * L'institut colle une URL Streamable sur un module : l'aperçu passait par la
 * route PUBLIQUE, réservée aux clientes qui ont acheté — 401 à chaque fois.
 * Le Manager a désormais sa route, ouverte à tout compte connecté, et la
 * route publique garde intacte sa protection du contenu payant.
 *
 * Aucun appel réseau : la résolution Streamable est remplacée par un faux.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'manager_video_test';
process.env.DB_PROD = 'manager_video_prod';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.INTEGRATED_API_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.NGROK_API_URL = 'http://127.0.0.1:1';

let pass = 0;
let fail = 0;
const check = (n, c, detail = '') => {
  if (c) { pass += 1; console.log(`  ✓ ${n}`); } else { fail += 1; console.error(`  ✗ ${n}${detail ? ` — ${detail}` : ''}`); }
};

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();
const express = (await import('express')).default;
const jwt = (await import('jsonwebtoken')).default;
const { config } = await import('../config/env.js');
const { User } = await import('../models/User.model.js');
const { CommerceProduct } = await import('../models/CommerceProduct.model.js');
const commerce = await import('../services/commerce.service.js');
const { managerCommerceRoutes, publicCommerceRoutes } = await import('../routes/commerce.routes.js');
const { errorHandler } = await import('../middlewares/error.middleware.js').catch(() => ({}));

// Faux Streamable : on vérifie le chemin d'accès, pas le réseau.
let resolved = [];
const original = commerce.getStreamableTemporaryPlayback;
void original;

const admin = await User.create({ email: 'institut@test.local', password: 'Motdepasse-solide-1', name: 'Institut', role: 'ADMIN', status: 'ACTIVE' });
await CommerceProduct.create({
  kind: 'DISTANCE_TRAINING', title: 'Formation en ligne', name: 'Formation en ligne', slug: 'formation-en-ligne', status: 'DRAFT', price: { amountCents: 10000, currency: 'EUR' },
  modules: [{ title: 'Module 2', videos: [{ title: 'Analyse', provider: 'STREAMABLE', streamableShortcode: 'cv82qt', sourceUrl: 'https://streamable.com/cv82qt' }] }],
});

const app = express();
app.use('/api/commerce', managerCommerceRoutes);
app.use('/api/public/commerce', publicCommerceRoutes);
app.use(errorHandler || ((err, _req, res, _next) => res.status(err.statusCode || err.status || 500).json({ success: false, message: err.message })));
const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const token = jwt.sign({ sub: String(admin._id), role: 'ADMIN' }, config.jwt.secret, { algorithm: 'HS256', expiresIn: '1h' });

// Le service réel appelle Streamable : on l'intercepte au niveau de fetch.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith(base)) return realFetch(url, init);
  resolved.push(u);
  return new Response('<video src="https://cdn-cf-east.streamable.com/video/mp4/cv82qt.mp4?token=x"></video>', { status: 200, headers: { 'content-type': 'text/html' } });
};

console.log('\nAperçu vidéo du Manager');
let r = await realFetch(`${base}/api/commerce/videos/streamable/cv82qt/playback-url`);
check('sans connexion : refusé', r.status === 401, String(r.status));
r = await realFetch(`${base}/api/commerce/videos/streamable/cv82qt/playback-url`, { headers: { authorization: `Bearer ${token}` } });
check('compte ADMIN : la vidéo d’un module en brouillon passe le contrôle d’accès', r.status !== 401 && r.status !== 403, String(r.status));
check('… et la résolution Streamable est bien demandée', resolved.some((u) => u.includes('cv82qt')), resolved.join(' '));
r = await realFetch(`${base}/api/commerce/videos/streamable/a%24b/playback-url`, { headers: { authorization: `Bearer ${token}` } });
check('identifiant invalide : 400', r.status === 400, String(r.status));

console.log('\nRoute publique : contenu payant toujours protégé');
resolved = [];
r = await realFetch(`${base}/api/public/commerce/videos/streamable/cv82qt/playback-url`);
check('visiteur anonyme : 401', r.status === 401, String(r.status));
check('… sans même interroger Streamable', resolved.length === 0);

server.close();
globalThis.fetch = realFetch;
await disconnectDatabase();
await mongod.stop();
console.log(`\n${pass} réussi(s), ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
