/**
 * STOCKAGE DES CONTRATS — production simulée, reprise, et vérité affichée.
 *
 * ── LE DÉFAUT QU'IL VERROUILLE ──────────────────────────────────────────────
 * Un document référencé en base mais absent du disque produisait un bouton
 * « Télécharger le contrat » parfaitement visible, qui répondait 404 au clic.
 * L'écran affirmait ce que seul le disque peut confirmer.
 *
 * Le cas de production est reproduit tel quel : un serveur range ses fichiers
 * sous `shared/storage`, chaque release reçoit un lien vers ce dossier, et un
 * document déposé AVANT que ce lien n'existe reste dans la release de
 * l'époque. Il est toujours sur la machine — plus sur le chemin canonique.
 *
 * Aucune base de données ici : ce qui se joue est un chemin sur un disque.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';

const ICI = fileURLToPath(import.meta.url);

/* ══════════════════════════ SCÉNARIO (enfant) ═════════════════════════════ */

if (process.env.STORAGE_SCENARIO) {
  process.env.ENV = 'TEST';
  process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/inutilise';
  process.env.DB_TEST = 'test_base';
  process.env.DB_PROD = 'prod_base';
  process.env.JWT_SECRET = 'test-secret-jwt';
  process.env.PORT = '4134';
  process.env.CORS_ORIGINS = 'http://localhost:6061';
  process.env.INTEGRATED_API_ENCRYPTION_KEY =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  const docs = await import('../services/contractDocument.service.js');
  const { serializeContract } = await import('../services/contract.service.js');
  const { config } = await import('../config/env.js');

  const contractId = '000000000000000000000077';
  const nomFichier = process.env.STORAGE_FILENAME;
  const contract = {
    _id: contractId,
    reference: 'CTR-2026-077',
    status: 'ACTIVE',
    document: { originalFilename: nomFichier, pageCount: 1 },
    pricing: {},
    signatureConfiguration: {},
    yousign: {},
  };

  const rapport = { racine: config.paths.contractStorage };
  rapport.avant = {
    existe: docs.documentExistsSync(contract, 'ORIGINAL'),
    vue: serializeContract(contract, { role: 'ADMIN' }).document,
    stockage: await docs.inspectContractStorage(contract),
  };
  rapport.racinesCandidates = docs.candidateStorageRoots();

  if (process.env.STORAGE_SCENARIO === 'REPAIR') {
    rapport.reprise = await docs.adoptOrphanContractDocuments([contract]);
    rapport.apres = {
      existe: docs.documentExistsSync(contract, 'ORIGINAL'),
      vue: serializeContract(contract, { role: 'ADMIN' }).document,
    };
    // Une seconde passe ne doit plus rien avoir à reprendre.
    rapport.rejeu = await docs.adoptOrphanContractDocuments([contract]);
  }

  console.log(`##RAPPORT## ${JSON.stringify(rapport)}`);
  process.exit(0);
}

/* ══════════════════════════ MISE EN SCÈNE (parent) ════════════════════════ */

let pass = 0;
let fail = 0;
const check = (nom, ok) => {
  if (ok) { pass += 1; console.log(`  ✓ ${nom}`); } else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (titre) => console.log(`\n${titre}`);

const base = await fs.mkdtemp(path.join(os.tmpdir(), 'contrat-stockage-'));
const CONTRAT = '000000000000000000000077';
const NOM = 'original-11111111-2222-3333-4444-555555555555.pdf';

// Un VPS : /base/shared/storage/contracts, /base/releases/<x>/backend/storage,
// et la release courante dont le dossier `storage` est un lien vers le partagé.
const shared = path.join(base, 'shared', 'storage', 'contracts');
const ancienneRelease = path.join(base, 'releases', '20260701-120000', 'backend', 'storage', 'contracts');
const courante = path.join(base, 'releases', '20260804-090000', 'backend');
const courantStorage = path.join(courante, 'storage');

await fs.mkdir(shared, { recursive: true });
await fs.mkdir(path.join(ancienneRelease, CONTRAT), { recursive: true });
await fs.mkdir(courante, { recursive: true });

const pdf = await PDFDocument.create();
pdf.addPage([595, 842]);
const octets = Buffer.from(await pdf.save());
// LE FICHIER HISTORIQUE : déposé avant que le lien partagé n'existe.
await fs.writeFile(path.join(ancienneRelease, CONTRAT, NOM), octets);

// Le lien de production : backend/storage → shared/storage.
let lienPose = true;
try {
  await fs.symlink(path.join(base, 'shared', 'storage'), courantStorage, 'junction');
} catch {
  lienPose = false;
  await fs.mkdir(courantStorage, { recursive: true });
}

const lancer = (scenario, racine) => {
  const run = spawnSync(process.execPath, [ICI], {
    encoding: 'utf8',
    env: {
      ...process.env,
      STORAGE_SCENARIO: scenario,
      STORAGE_FILENAME: NOM,
      CONTRACT_STORAGE_DIR: racine,
    },
  });
  const ligne = (run.stdout || '').split('\n').find((l) => l.startsWith('##RAPPORT## '));
  if (!ligne) { console.error(run.stdout); console.error(run.stderr); return null; }
  return JSON.parse(ligne.slice('##RAPPORT## '.length));
};

// La racine canonique vue par l'application : le dossier lié, comme en prod.
const racineProd = path.join(courantStorage, 'contracts');

section('1. Production simulée : le lien partagé est bien la racine');
{
  check('le stockage de la release est un lien vers le dossier partagé', lienPose);
  const rapport = lancer('AUDIT', racineProd);
  check('le scénario s’exécute', rapport !== null);
  if (rapport) {
    check('le document référencé est INTROUVABLE sur le chemin canonique',
      rapport.avant.existe === false);
    check('…et le stockage le signale comme manquant',
      rapport.avant.stockage.original.exists === false);

    // Le point central : l'écran ne doit PAS proposer un téléchargement.
    check('le bouton du Manager disparaît', rapport.avant.vue.hasOriginal === false);
    check('…et l’URL de téléchargement n’est pas offerte',
      rapport.avant.vue.originalUrl === null);
    check('…mais la base garde la trace que le document a existé',
      rapport.avant.vue.referencedOriginal === true);

    check('la release précédente fait partie des endroits regardés',
      rapport.racinesCandidates.some((r) => r.includes(`releases${path.sep}20260701-120000`)));
    check('…ainsi que le stockage partagé',
      rapport.racinesCandidates.some((r) => r.includes(`shared${path.sep}storage${path.sep}contracts`)));
  }
}

section('2. Reprise : le fichier existe déjà sur la machine');
{
  const rapport = lancer('REPAIR', racineProd);
  check('la reprise s’exécute', rapport !== null);
  if (rapport) {
    check('un document est repris', rapport.reprise.repaired === 1);
    check('…depuis l’ancienne release',
      String(rapport.reprise.details[0]?.from ?? '').includes('20260701-120000'));
    check('…et aucun n’est déclaré perdu', rapport.reprise.missing === 0);

    check('le document devient lisible sur le chemin canonique',
      rapport.apres.existe === true);
    check('le bouton du Manager réapparaît', rapport.apres.vue.hasOriginal === true);
    check('…avec son URL', rapport.apres.vue.originalUrl?.endsWith('/documents/original') === true);

    check('relancer la reprise ne reprend plus rien', rapport.rejeu.repaired === 0);
    check('…et ne perd rien', rapport.rejeu.missing === 0);
  }

  // Le fichier a réellement atterri dans le dossier PARTAGÉ, pas dans la release.
  const cible = path.join(shared, CONTRAT, NOM);
  let taille = 0;
  try { taille = (await fs.stat(cible)).size; } catch { /* absent */ }
  check('le fichier est désormais dans le stockage partagé', taille === octets.length);
  check('…et l’original reste en place dans l’ancienne release',
    (await fs.stat(path.join(ancienneRelease, CONTRAT, NOM))).size === octets.length);
}

section('3. Fichier absent partout : rien n’est inventé');
{
  // Une machine VIERGE, à l'écart de la précédente : sans quoi la remontée
  // retrouverait le fichier de l'ancienne release — ce qu'elle doit faire.
  const autreMachine = await fs.mkdtemp(path.join(os.tmpdir(), 'contrat-vierge-'));
  const vide = path.join(autreMachine, 'shared', 'storage', 'contracts');
  await fs.mkdir(vide, { recursive: true });
  const rapport = lancer('REPAIR', vide);
  check('la reprise s’exécute', rapport !== null);
  if (rapport) {
    check('aucun fichier n’est fabriqué', rapport.reprise.repaired === 0);
    check('…et l’absence est comptée', rapport.reprise.missing === 1);
    check('le bouton reste masqué', rapport.apres.vue.hasOriginal === false);
    check('…et la trace en base demeure', rapport.apres.vue.referencedOriginal === true);
  }
}

section('4. Aucun chemin de release n’est écrit durablement');
{
  const service = await fs.readFile(
    path.resolve(path.dirname(ICI), '../services/contractDocument.service.js'), 'utf8');
  check('le code ne nomme aucune release', !/releases\/[0-9]{8}/.test(service));
  check('la reprise ne conserve le chemin d’origine que pour le rapport',
    /details\.push\(\{[^}]*from: path\.dirname\(source\)/.test(service));
  check('rien n’écrit un chemin absolu dans le contrat',
    !/document\.(original|signed)Path\s*=/.test(service));
  check('la racine reste celle de la configuration',
    /candidateStorageRoots\(canonique = config\.paths\.contractStorage\)/.test(service));
}

await fs.rm(base, { recursive: true, force: true });
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
