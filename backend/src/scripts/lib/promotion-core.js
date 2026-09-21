/**
 * Moteur de promotion des données TEST -> PROD.
 *
 * Principe : duplication complète et fidèle depuis DB_TEST vers DB_PROD sur le
 * MÊME cluster MongoDB. La base TEST reste STRICTEMENT en lecture seule — le
 * client "source" n'émet jamais d'écriture ; toutes les écritures passent par le
 * client "destination" (PROD), physiquement distinct.
 *
 * Ce module est volontairement INDÉPENDANT de la variable ENV : la source est
 * toujours explicitement DB_TEST, la destination toujours explicitement DB_PROD.
 * Il n'importe donc PAS config/env.js (qui choisit la base selon ENV et exige
 * JWT_SECRET). Il lit MONGODB_URI / DB_TEST / DB_PROD directement depuis le .env.
 *
 * Aucun secret n'est jamais affiché ni écrit dans les rapports (URI, JWT, hash
 * de mot de passe, tokens…).
 */
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import { EJSON } from 'bson';

// Modèles importés uniquement pour connaître le NOM RÉEL des collections des
// singletons (pluralisation Mongoose) sans le coder en dur. Ces modules
// n'importent que mongoose + constants : aucun effet de bord réseau/env.
import { Company } from '../../models/Company.model.js';
import { HomeContent } from '../../models/HomeContent.model.js';
import { Theme } from '../../models/Theme.model.js';
import { ManagerTheme } from '../../models/ManagerTheme.model.js';
import { SiteStatus } from '../../models/SiteStatus.model.js';

import { SystemConfiguration } from '../../models/SystemConfiguration.model.js';
import { RoleAppearance } from '../../models/RoleAppearance.model.js';
import { User } from '../../models/User.model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '../../..');
const ENV_PATH = path.join(BACKEND_ROOT, '.env');
export const UPLOADS_DIR = path.join(BACKEND_ROOT, 'uploads');
export const REPORTS_DIR = path.join(BACKEND_ROOT, 'migration-reports');

// Collections singleton attendues (exactement 1 document chacune après migration).
export const SINGLETON_COLLECTIONS = [
  Company,
  /**
   * LE CONTENU D'ACCUEIL EST UN SINGLETON, et il devait figurer ICI.
   *
   * Ce registre est explicite, et c'est le prix à payer pour qu'il soit sûr :
   * un modèle absent de la liste n'est pas contrôlé après promotion, et deux
   * documents `homecontents` en production passeraient sans bruit. La page
   * d'accueil lirait alors le premier trouvé — c'est-à-dire l'un des deux, au
   * gré de l'ordre de la collection.
   */
  HomeContent,
  Theme,
  ManagerTheme,
  SiteStatus,

  SystemConfiguration,
  RoleAppearance,
].map((m) => m.collection.name);

export const USERS_COLLECTION = User.collection.name; // "users"

/**
 * COMPTES ATTENDUS APRÈS MIGRATION — par RÔLE, plus jamais par adresse (LOT 2C).
 *
 * ── CE QUE CE CONTRÔLE AFFIRMAIT, ET POURQUOI C'ÉTAIT FAUX ──────────────────
 *
 * Il exigeait `dev@mail.com` et `admin@mail.com`, et déclarait la migration EN
 * ERREUR s'ils manquaient. C'était vrai d'un parc où chaque projet naissait
 * avec les mêmes comptes — c'est-à-dire du défaut que ce lot supprime. Un
 * projet dont le développeur s'appelle `camille@garage-dupont.fr` aurait vu sa
 * promotion vers la production échouer pour avoir fait ce qu'il fallait.
 *
 * Ce qui compte réellement, c'est qu'il RESTE quelqu'un pour administrer la
 * base promue. La question est donc « existe-t-il un compte de rôle DEV ? »,
 * jamais « existe-t-il cette adresse-là ».
 *
 * `required` distingue les deux rôles : sans DEV, la base promue est
 * inadministrable — c'est une erreur. Sans ADMIN, elle l'est encore par son
 * développeur, qui pourra en créer un — c'est un avertissement.
 */
export const EXPECTED_ROLES = [
  { role: 'DEV', required: true },
  { role: 'ADMIN', required: false },
];

// Collections techniques à ne jamais copier. On exclut toujours les collections
// système Mongo (system.*) + les collections parasites vides "TEST"/"PROD"
// (créées par erreur sur le cluster, sans rapport avec les données métier).
export const EXCLUDED_COLLECTIONS = new Set(['TEST', 'PROD']);

// Clés suspectes recherchées lors du scan de secrets. On ne rapporte JAMAIS la
// valeur, seulement collection + chemin du champ.
const SUSPECT_KEY_RE = /(secret|password|token|apikey|api_key|privatekey|private_key|mongodburi|mongo_uri|jwt|credentials?)/i;
// Champs "sensibles par conception", attendus et non problématiques.
const KNOWN_SAFE_SECRET_FIELDS = new Set([`${USERS_COLLECTION}.password`]);

// Détection d'URL potentiellement problématiques pour la PROD.
const RISKY_URL_RE = /(localhost|127\.0\.0\.1|0\.0\.0\.0|\bngrok\b|ngrok\.io|ngrok-free\.app|ngrok\.app)/i;
// Référence à un fichier upload local.
const UPLOAD_REF_RE = /\/uploads\/([^/\s"'?#]+)/g;

/* ------------------------------------------------------------------ *
 * Chargement d'environnement (indépendant de ENV)                    *
 * ------------------------------------------------------------------ */

/**
 * Charge MONGODB_URI / DB_TEST / DB_PROD depuis backend/.env.
 * N'exige PAS JWT_SECRET ni ENV.
 */
export function loadDualEnv() {
  dotenv.config({ path: ENV_PATH });
  const mongoUri = process.env.MONGODB_URI;
  const dbTest = process.env.DB_TEST;
  const dbProd = process.env.DB_PROD;
  const publicUrl = process.env.PUBLIC_URL || '';
  return { mongoUri, dbTest, dbProd, publicUrl };
}

/**
 * Gardes de sécurité fondamentales. Lève une erreur si une condition critique
 * n'est pas remplie. Ne se connecte à rien.
 */
export function assertSafety({ mongoUri, dbTest, dbProd }) {
  if (!mongoUri) throw new Error('MONGODB_URI manquant dans .env');
  if (!dbTest) throw new Error('DB_TEST manquant dans .env');
  if (!dbProd) throw new Error('DB_PROD manquant dans .env');
  if (dbTest === dbProd) {
    throw new Error(
      `Refus : DB_TEST et DB_PROD sont identiques ("${dbTest}"). ` +
        'La source et la destination doivent être des bases différentes.'
    );
  }
}

/* ------------------------------------------------------------------ *
 * Connexions séparées source (TEST) / destination (PROD)             *
 * ------------------------------------------------------------------ */

/**
 * Ouvre DEUX clients MongoDB distincts : un pour la source (TEST) et un pour la
 * destination (PROD). Les garder séparés garantit qu'aucune opération destinée à
 * PROD ne peut atteindre TEST.
 */
export async function connectClients({ mongoUri, dbTest, dbProd }) {
  const srcClient = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10000 });
  const dstClient = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10000 });
  await srcClient.connect();
  await dstClient.connect();
  return {
    srcClient,
    dstClient,
    srcDb: srcClient.db(dbTest),
    dstDb: dstClient.db(dbProd),
  };
}

export async function closeClients({ srcClient, dstClient }) {
  await Promise.allSettled([srcClient?.close(), dstClient?.close()]);
}

/* ------------------------------------------------------------------ *
 * Découverte des collections & comptages                             *
 * ------------------------------------------------------------------ */

/** Liste les collections "métier" d'une base (hors system.* et exclusions). */
export async function listUserCollections(db) {
  const infos = await db.listCollections({}, { nameOnly: true }).toArray();
  return infos
    .map((c) => c.name)
    .filter((name) => !name.startsWith('system.'))
    .filter((name) => !EXCLUDED_COLLECTIONS.has(name))
    .sort();
}

export async function countByCollection(db, names) {
  const out = {};
  for (const name of names) {
    out[name] = await db.collection(name).countDocuments();
  }
  return out;
}

/** Index d'une collection, hors index _id par défaut, normalisés pour recréation. */
export async function getCopyableIndexes(db, name) {
  let indexes = [];
  try {
    indexes = await db.collection(name).indexes();
  } catch {
    return [];
  }
  return indexes
    .filter((idx) => idx.name !== '_id_')
    .map((idx) => {
      const { v, ns, key, background, ...rest } = idx;
      void v;
      void ns;
      void background;
      // On conserve name + options utiles (unique, sparse, expireAfterSeconds…).
      return { key, options: rest };
    });
}

/* ------------------------------------------------------------------ *
 * Empreintes déterministes (pour parité & TEST inchangée)            *
 * ------------------------------------------------------------------ */

/**
 * Empreinte SHA-256 déterministe d'une collection : documents triés par _id,
 * sérialisés en EJSON canonique (préserve les types BSON : ObjectId, Date,
 * Decimal128, Binary…), puis hashés. Aucun champ n'est retiré : une copie
 * fidèle doit reproduire l'intégralité des documents, timestamps et _id inclus.
 */
export async function fingerprintCollection(db, name) {
  const cursor = db.collection(name).find({}, { sort: { _id: 1 } });
  const hash = crypto.createHash('sha256');
  let count = 0;
  for await (const doc of cursor) {
    hash.update(EJSON.stringify(doc, { relaxed: false }));
    hash.update('\n');
    count += 1;
  }
  return { count, hash: hash.digest('hex') };
}

/** Empreinte de toutes les collections fournies. */
export async function fingerprintDatabase(db, names) {
  const out = {};
  for (const name of names) {
    out[name] = await fingerprintCollection(db, name);
  }
  return out;
}

/** Empreinte globale déterministe d'un ensemble d'empreintes de collections. */
export function globalFingerprint(perCollection) {
  const hash = crypto.createHash('sha256');
  for (const name of Object.keys(perCollection).sort()) {
    hash.update(`${name}:${perCollection[name].hash}:${perCollection[name].count}\n`);
  }
  return hash.digest('hex');
}

/* ------------------------------------------------------------------ *
 * Scans transverses sur les documents                                *
 * ------------------------------------------------------------------ */

/** Parcourt récursivement un document, appelant cb(path, value) sur chaque feuille. */
function walk(value, cb, prefix = '') {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, cb, prefix ? `${prefix}[${i}]` : `[${i}]`));
    return;
  }
  // Types BSON (ObjectId, Date, Decimal128, Binary…) : traités comme feuilles.
  const isPlainObject =
    typeof value === 'object' && value.constructor && value.constructor.name === 'Object';
  if (isPlainObject) {
    for (const [k, v] of Object.entries(value)) {
      walk(v, cb, prefix ? `${prefix}.${k}` : k);
    }
    return;
  }
  cb(prefix, value);
}

/** Chemins de champs dont la CLÉ ressemble à un secret (valeur jamais retournée). */
export function scanSecretFields(doc, collName) {
  const hits = [];
  walk(doc, (fieldPath) => {
    // On teste chaque segment de clé (sans les indices de tableau).
    const segments = fieldPath.split('.').map((s) => s.replace(/\[\d+\]/g, ''));
    if (segments.some((s) => SUSPECT_KEY_RE.test(s))) {
      const normalized = fieldPath.replace(/\[\d+\]/g, '[]');
      const key = `${collName}.${normalized}`;
      hits.push({ collection: collName, field: normalized, knownSafe: KNOWN_SAFE_SECRET_FIELDS.has(`${collName}.${normalized}`) || KNOWN_SAFE_SECRET_FIELDS.has(key) });
    }
  });
  return hits;
}

/** URLs risquées (localhost/127.0.0.1/ngrok…) trouvées dans un document. */
export function scanRiskyUrls(doc, collName) {
  const hits = [];
  walk(doc, (fieldPath, value) => {
    if (typeof value === 'string' && RISKY_URL_RE.test(value)) {
      hits.push({
        collection: collName,
        field: fieldPath.replace(/\[\d+\]/g, '[]'),
        value, // une URL n'est pas un secret : on l'affiche pour permettre la correction.
        _id: doc._id ? String(doc._id) : undefined,
      });
    }
  });
  return hits;
}

/** Noms de fichiers upload référencés dans un document (/uploads/<fichier>). */
export function collectUploadRefs(doc) {
  const files = new Set();
  walk(doc, (fieldPath, value) => {
    if (typeof value !== 'string') return;
    let m;
    UPLOAD_REF_RE.lastIndex = 0;
    while ((m = UPLOAD_REF_RE.exec(value)) !== null) {
      files.add(decodeURIComponent(m[1]));
    }
  });
  return [...files];
}

/**
 * Passe transverse sur toute la base source : agrège secrets, URLs risquées et
 * références d'uploads en une seule lecture par collection.
 */
export async function scanSource(db, names) {
  const secretFields = new Map(); // key -> {collection, field, knownSafe}
  const riskyUrls = [];
  const uploadRefs = new Set();

  for (const name of names) {
    const cursor = db.collection(name).find({});
    for await (const doc of cursor) {
      for (const s of scanSecretFields(doc, name)) {
        secretFields.set(`${s.collection}.${s.field}`, s);
      }
      for (const u of scanRiskyUrls(doc, name)) riskyUrls.push(u);
      for (const f of collectUploadRefs(doc)) uploadRefs.add(f);
    }
  }
  return {
    secretFields: [...secretFields.values()],
    riskyUrls,
    uploadRefs: [...uploadRefs].sort(),
  };
}

/* ------------------------------------------------------------------ *
 * Audit des uploads locaux                                           *
 * ------------------------------------------------------------------ */

/**
 * Compare les fichiers référencés en base aux fichiers physiques du dossier
 * uploads. Produit un manifest destiné au futur déploiement VPS.
 */
export async function auditUploads(referencedFiles) {
  let physical = [];
  try {
    physical = (await fsp.readdir(UPLOADS_DIR)).filter((f) => f !== '.gitkeep');
  } catch {
    physical = [];
  }
  const physicalSet = new Set(physical);
  const referencedSet = new Set(referencedFiles);

  const present = referencedFiles.filter((f) => physicalSet.has(f));
  const missing = referencedFiles.filter((f) => !physicalSet.has(f)); // référence cassée
  const orphans = physical.filter((f) => !referencedSet.has(f)); // fichier non référencé

  return {
    uploadsDir: path.relative(BACKEND_ROOT, UPLOADS_DIR).replace(/\\/g, '/'),
    referencedCount: referencedFiles.length,
    physicalCount: physical.length,
    presentCount: present.length,
    missing, // fichiers référencés mais absents du disque
    orphans, // fichiers présents mais non référencés
    manifest: present
      .slice()
      .sort()
      .map((f) => ({ file: f, relativePath: `uploads/${f}` })),
  };
}

/* ------------------------------------------------------------------ *
 * Contrôles d'intégrité                                              *
 * ------------------------------------------------------------------ */

/**
 * Contrôles d'intégrité sur une base (typiquement PROD après copie, ou TEST en
 * audit) : singletons uniques, comptes attendus, unicité des index uniques,
 * références inter-documents valides.
 */
export async function checkIntegrity(db, names) {
  const errors = [];
  const warnings = [];

  // 1. Singletons : exactement 1 document.
  const singletons = {};
  for (const name of SINGLETON_COLLECTIONS) {
    const count = names.includes(name) ? await db.collection(name).countDocuments() : 0;
    singletons[name] = count;
    if (count === 0) warnings.push(`Singleton "${name}" absent (0 document)`);
    else if (count > 1) errors.push(`Singleton "${name}" en double (${count} documents)`);
  }

  // 2. Comptes attendus (rôles corrects). On ne lit jamais le mot de passe.
  const accounts = { total: 0, byRole: {}, expected: {} };
  if (names.includes(USERS_COLLECTION)) {
    const users = await db
      .collection(USERS_COLLECTION)
      .find({}, { projection: { email: 1, role: 1 } })
      .toArray();
    accounts.total = users.length;
    for (const u of users) accounts.byRole[u.role] = (accounts.byRole[u.role] || 0) + 1;
    for (const exp of EXPECTED_ROLES) {
      const nombre = accounts.byRole[exp.role] || 0;
      accounts.expected[exp.role] = { count: nombre, present: nombre > 0 };
      if (nombre === 0) {
        const phrase = `Aucun compte de rôle ${exp.role} dans la base promue.`;
        if (exp.required) errors.push(`${phrase} La base serait inadministrable.`);
        else warnings.push(phrase);
      }
    }
  }

  // 3. Unicité des index uniques (détection de doublons).
  const duplicates = [];
  for (const name of names) {
    const indexes = await getCopyableIndexes(db, name).catch(() => []);
    for (const idx of indexes) {
      if (!idx.options.unique) continue;
      const fields = Object.keys(idx.key);
      const pipeline = [
        { $group: { _id: fields.reduce((acc, f) => ({ ...acc, [f]: `$${f}` }), {}), n: { $sum: 1 } } },
        { $match: { n: { $gt: 1 } } },
        { $limit: 20 },
      ];
      const dups = await db.collection(name).aggregate(pipeline).toArray();
      for (const d of dups) {
        duplicates.push({ collection: name, fields, value: d._id, count: d.n });
        errors.push(`Doublon sur index unique ${name}(${fields.join(',')})`);
      }
    }
  }

  // 4. Références inter-documents.
  const brokenRefs = [];
  // 4a. systemconfigurations.updatedBy -> users._id
  const sysColl = SystemConfiguration.collection.name;
  if (names.includes(sysColl) && names.includes(USERS_COLLECTION)) {
    const cfgs = await db.collection(sysColl).find({ updatedBy: { $ne: null } }).toArray();
    for (const cfg of cfgs) {
      const exists = await db.collection(USERS_COLLECTION).countDocuments({ _id: cfg.updatedBy });
      if (!exists) {
        brokenRefs.push({ collection: sysColl, field: 'updatedBy', target: USERS_COLLECTION, value: String(cfg.updatedBy) });
        errors.push(`Référence cassée ${sysColl}.updatedBy -> ${USERS_COLLECTION}`);
      }
    }
  }
  return { singletons, accounts, duplicates, brokenRefs, errors, warnings };
}

/* ------------------------------------------------------------------ *
 * Copie d'une collection (documents + index)                         *
 * ------------------------------------------------------------------ */

/**
 * Copie fidèlement une collection source -> destination.
 * - Préserve les _id et tous les types BSON (insertion des documents bruts).
 * - Recrée les index (unique, sparse, TTL…) après insertion.
 * En dry-run : ne réalise aucune écriture, retourne le plan.
 */
export async function copyCollection({ srcDb, dstDb, name, dryRun }) {
  const srcColl = srcDb.collection(name);
  const dstColl = dstDb.collection(name);

  const sourceCount = await srcColl.countDocuments();
  const indexes = await getCopyableIndexes(srcDb, name);
  const destBefore = await dstColl.countDocuments().catch(() => 0);

  if (dryRun) {
    return {
      name,
      sourceCount,
      destBefore,
      wouldCopy: sourceCount,
      wouldCreateIndexes: indexes.length,
      destAfter: destBefore, // inchangé en dry-run
      copied: 0,
      indexesCreated: 0,
    };
  }

  // Copie par lots pour préserver la mémoire sur grosses collections.
  let copied = 0;
  const BATCH = 500;
  let batch = [];
  const cursor = srcColl.find({}); // lecture seule sur TEST
  for await (const doc of cursor) {
    batch.push(doc); // document brut : _id + types BSON conservés
    if (batch.length >= BATCH) {
      await dstColl.insertMany(batch, { ordered: false });
      copied += batch.length;
      batch = [];
    }
  }
  if (batch.length) {
    await dstColl.insertMany(batch, { ordered: false });
    copied += batch.length;
  }

  // Index (après insertion, données propres -> pas de conflit d'unicité).
  let indexesCreated = 0;
  for (const idx of indexes) {
    try {
      await dstColl.createIndex(idx.key, idx.options);
      indexesCreated += 1;
    } catch (err) {
      // On ne bloque pas toute la migration pour un index ; on le signalera.
      idx._error = err.message;
    }
  }

  const destAfter = await dstColl.countDocuments();
  return {
    name,
    sourceCount,
    destBefore,
    copied,
    destAfter,
    indexesCreated,
    indexErrors: indexes.filter((i) => i._error).map((i) => ({ key: i.key, error: i._error })),
  };
}

/**
 * Réinitialise la base DESTINATION (PROD) en supprimant ses collections métier.
 * SÉCURITÉ : ne s'exécute QUE si le handle fourni pointe bien sur dbProd (jamais
 * sur dbTest). Ne fait jamais dropDatabase(). N'accepte que le handle
 * destination. À utiliser après la sauvegarde et la confirmation.
 */
export async function dropProdCollections({ dstDb, dbTest, dbProd }) {
  if (dstDb.databaseName !== dbProd) {
    throw new Error(`Refus de reset : le handle cible "${dstDb.databaseName}" n'est pas DB_PROD ("${dbProd}").`);
  }
  if (dstDb.databaseName === dbTest) {
    throw new Error('Refus de reset : la cible est DB_TEST. Opération interdite.');
  }
  const names = await listUserCollections(dstDb);
  const dropped = [];
  for (const name of names) {
    await dstDb.collection(name).drop().catch(() => {});
    dropped.push(name);
  }
  return dropped;
}

/* ------------------------------------------------------------------ *
 * Backup logique de PROD (snapshot JSON)                             *
 * ------------------------------------------------------------------ */

/**
 * Sauvegarde logique des collections PROD existantes en snapshot EJSON, même si
 * PROD est vide (le fichier documente l'état avant migration). Jamais supprimé
 * automatiquement.
 */
export async function backupProd(dstDb, timestamp) {
  const names = await listUserCollections(dstDb);
  const snapshot = { timestamp, database: 'PROD', collections: {} };
  for (const name of names) {
    const docs = await dstDb.collection(name).find({}, { sort: { _id: 1 } }).toArray();
    snapshot.collections[name] = EJSON.serialize(docs, { relaxed: false });
  }
  await fsp.mkdir(REPORTS_DIR, { recursive: true });
  const file = path.join(REPORTS_DIR, `prod-backup-${timestamp}.json`);
  await fsp.writeFile(file, JSON.stringify(snapshot, null, 2), 'utf8');
  return { file: path.relative(BACKEND_ROOT, file).replace(/\\/g, '/'), collections: names.length };
}

/* ------------------------------------------------------------------ *
 * Écriture des rapports                                              *
 * ------------------------------------------------------------------ */

export function nowStamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-` +
    `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}

export function ensureReportsDir() {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

export { BACKEND_ROOT };
