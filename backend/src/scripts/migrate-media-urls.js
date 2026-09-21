/**
 * Migration idempotente des URLs de médias : convertit les anciennes URLs
 * ABSOLUES locales/non sûres `http://localhost:6060/uploads/x.webp` (ou ngrok…)
 * en chemins RELATIFS `/uploads/x.webp`. Les URLs EXTERNES légitimes (CDN https)
 * sont PRÉSERVÉES. Les chemins déjà relatifs sont inchangés (idempotent).
 *
 * Cause : `upload.service.js` figeait autrefois `config.publicUrl` (fallback
 * localhost) dans les documents → Mixed Content sur le site déployé en HTTPS.
 *
 * Usage :
 *   node src/scripts/migrate-media-urls.js --env=PROD            # dry-run (défaut)
 *   node src/scripts/migrate-media-urls.js --env=PROD --apply
 *   node src/scripts/migrate-media-urls.js --env=PROD --verify
 *   node src/scripts/migrate-media-urls.js --db=sbauto06_prod --apply
 *
 * Ne révèle aucune valeur sensible (seules des URLs de médias sont affichées).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/* -------------------------------------------------------------------------- */
/*  Transformation PURE (testable sans base)                                  */
/* -------------------------------------------------------------------------- */

const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)(:\d+)?$/i;
const NGROK_RE = /ngrok/i;

/**
 * Si `value` est une URL absolue locale/non sûre pointant vers /uploads/, renvoie
 * son chemin relatif. Sinon renvoie null (préserve tout le reste : externes,
 * data:, chemins déjà relatifs, valeurs non-string).
 */
export function rewriteLocalUpload(value) {
  if (typeof value !== 'string') return null;
  const m = value.match(/^https?:\/\/([^/]+)(\/{1,}uploads\/[^\s"']*)$/i);
  if (!m) return null;
  const host = m[1].toLowerCase();
  const isLocal = LOCAL_HOST_RE.test(host) || NGROK_RE.test(host);
  if (!isLocal) return null; // URL externe légitime → préservée
  // Normalise les doubles slash éventuels dans le chemin.
  return m[2].replace(/\/{2,}/g, '/');
}

/** Parcourt récursivement un document et collecte les $set { dottedPath: newValue }. */
export function collectMediaRewrites(value, prefix = '', sets = {}) {
  if (value === null || value === undefined) return sets;
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectMediaRewrites(v, prefix ? `${prefix}.${i}` : `${i}`, sets));
    return sets;
  }
  const isPlainObject = typeof value === 'object' && value.constructor && value.constructor.name === 'Object';
  if (isPlainObject) {
    for (const [k, v] of Object.entries(value)) {
      collectMediaRewrites(v, prefix ? `${prefix}.${k}` : k, sets);
    }
    return sets;
  }
  const rewritten = rewriteLocalUpload(value);
  if (rewritten !== null && rewritten !== value) sets[prefix] = rewritten;
  return sets;
}

/** { changed:boolean, sets:{path:newValue} } pour un document. */
export function rewriteDocMedia(doc) {
  const sets = collectMediaRewrites(doc);
  return { changed: Object.keys(sets).length > 0, sets };
}

/* -------------------------------------------------------------------------- */
/*  Runner (native driver)                                                    */
/* -------------------------------------------------------------------------- */

async function run() {
  const args = process.argv.slice(2);
  const has = (f) => args.includes(f);
  const val = (f) => { const a = args.find((x) => x.startsWith(`${f}=`)); return a ? a.split('=')[1] : null; };
  const apply = has('--apply');
  const verify = has('--verify');
  const envArg = (val('--env') || '').toUpperCase();
  const dbName = val('--db') || (envArg === 'PROD' ? process.env.DB_PROD : envArg === 'TEST' ? process.env.DB_TEST : null);
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) { console.error('MONGODB_URI manquant (.env).'); process.exit(1); }
  if (!dbName) { console.error('Base non résolue : passez --env=TEST|PROD ou --db=<nom>.'); process.exit(1); }

  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(dbName);
  const mode = apply ? 'APPLY' : verify ? 'VERIFY' : 'DRY-RUN';
  console.log(`\n=== Migration médias — base ${dbName} — mode ${mode} ===\n`);

  let totalDocs = 0, totalRewrites = 0, remaining = 0;
  try {
    const collections = await db.listCollections().toArray();
    for (const { name } of collections) {
      if (name.startsWith('system.')) continue;
      const coll = db.collection(name);
      const cursor = coll.find({}, { projection: {} });
      for await (const doc of cursor) {
        const { changed, sets } = rewriteDocMedia(doc);
        if (!changed) continue;
        totalDocs += 1;
        totalRewrites += Object.keys(sets).length;
        for (const [p, v] of Object.entries(sets)) console.log(`  ${name}/${doc._id} · ${p} → ${v}`);
        if (verify) { remaining += Object.keys(sets).length; continue; }
        if (apply) await coll.updateOne({ _id: doc._id }, { $set: sets });
      }
    }
  } finally {
    await client.close();
  }

  console.log(`\nRésumé : ${totalDocs} document(s), ${totalRewrites} URL(s) locale(s) d'upload.`);
  if (verify) {
    if (remaining > 0) { console.error(`VERIFY: ${remaining} URL(s) locale(s) restante(s) → migration incomplète.`); process.exit(1); }
    console.log('VERIFY: aucune URL locale d\'upload restante. ✓');
  } else if (!apply) {
    console.log('(dry-run — relancez avec --apply pour écrire.)');
  } else {
    console.log('APPLY terminé. ✓');
  }
}

// Exécuté directement (pas importé par un test).
if (process.argv[1] && process.argv[1].endsWith('migrate-media-urls.js')) {
  run().catch((err) => { console.error('MIGRATION MÉDIAS ÉCHOUÉE:', err.message); process.exit(1); });
}
