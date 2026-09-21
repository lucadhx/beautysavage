/**
 * TÉLÉCHARGEMENT D'UN CONTRAT — le même comportement, quelle que soit la racine.
 *
 * ── CE QUE CE TEST VERROUILLE ───────────────────────────────────────────────
 * Le défaut à empêcher n'est pas « le téléchargement ne marche pas » : c'est
 * « il marche en local et pas en production ». La cause d'un tel écart est
 * toujours la même — deux façons de résoudre un chemin, ou un stockage qui
 * n'est pas au même endroit après un redéploiement.
 *
 * Ce runner exécute donc EXACTEMENT le même scénario DEUX FOIS, dans deux
 * processus, avec deux racines de stockage :
 *
 *   · une racine locale, comme sur un poste de développement ;
 *   · une racine imitant `shared/storage` d'un serveur, celle vers laquelle le
 *     déploiement fait pointer `backend/storage`.
 *
 * Puis il compare les deux comptes rendus. Ils doivent être IDENTIQUES : mêmes
 * en-têtes, même nom de fichier, même taille, même refus quand le fichier
 * n'est plus là. Toute divergence signalerait un chemin calculé ailleurs.
 *
 * Aucune base de données : le téléchargement ne lit que le disque et un
 * document de contrat. C'est précisément ce qu'on veut isoler.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';

const ICI = fileURLToPath(import.meta.url);
const ENFANT = process.env.DOWNLOAD_ROOT_LABEL ?? null;

/* ══════════════════════════ LE SCÉNARIO (enfant) ══════════════════════════ */

if (ENFANT) {
  process.env.ENV = 'TEST';
  process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/inutilise';
  process.env.DB_TEST = 'test_base';
  process.env.DB_PROD = 'prod_base';
  process.env.JWT_SECRET = 'test-secret-jwt';
  process.env.PORT = '4133';
  process.env.CORS_ORIGINS = 'http://localhost:6061';
  process.env.INTEGRATED_API_ENCRYPTION_KEY =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  const { config } = await import('../config/env.js');
  const doc = await import('../services/contractDocument.service.js');

  const racine = config.paths.contractStorage;
  const contractId = '000000000000000000000042';

  // Un PDF authentique : le stockage valide la signature %PDF et le charge.
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]);
  /**
   * ══ LE DOCUMENT DE RECETTE EST DÉTERMINISTE — SINON CE TEST L'EST PAS ═════
   *
   * Cette suite compare DEUX EXÉCUTIONS : la même opération sur une racine de
   * stockage locale, puis sur une racine imitant le stockage partagé d'un
   * serveur. Elle affirme qu'elles se comportent à l'identique — mêmes
   * en-têtes, même `Content-Length`.
   *
   * Or `PDFDocument.create()` horodate le document. Les deux exécutions étant
   * deux PROCESSUS distincts, lancés à quelques secondes d'écart, la longueur
   * textuelle de cette date pouvait différer : 576 octets ici, 577 là. La
   * suite dénonçait alors une divergence entre les deux racines qui n'existait
   * pas — le stockage était identique, c'était l'HORLOGE qui ne l'était pas.
   *
   * Elle échouait donc par intermittence, environ une fois sur deux. Elle
   * n'était pas dans la chaîne `npm test` ; elle y entre avec ce lot, et une
   * suite instable dans une chaîne est pire qu'une suite absente : elle
   * apprend à relancer sans lire.
   *
   * Les dates sont figées. Rien de ce que la suite éprouve n'en dépend : elle
   * teste le SERVICE de documents, pas la capacité de pdf-lib à lire l'heure.
   */
  pdf.setCreationDate(new Date(0));
  pdf.setModificationDate(new Date(0));
  const octets = Buffer.from(await pdf.save());

  const original = await doc.storeOriginalPdf(contractId, octets, { filename: 'contrat.pdf' });
  const signe = await doc.storeSignedPdf(contractId, octets, { filename: 'contrat-signe.pdf' });

  const contract = {
    _id: contractId,
    reference: 'CTR-2026-042',
    document: {
      originalFilename: original.originalFilename,
      signedFilename: signe.signedFilename,
    },
  };

  /** Une réponse HTTP factice : elle retient ses en-têtes et ses octets. */
  const fausseReponse = () => {
    const flux = new PassThrough();
    flux.headers = {};
    flux.setHeader = (nom, valeur) => { flux.headers[nom] = String(valeur); };
    flux.recu = new Promise((resolve) => {
      const morceaux = [];
      flux.on('data', (m) => morceaux.push(m));
      flux.on('end', () => resolve(Buffer.concat(morceaux)));
    });
    return flux;
  };

  const telecharger = async (variante) => {
    const res = fausseReponse();
    await doc.streamDocument(res, contract, variante);
    const corps = await res.recu;
    return { headers: res.headers, taille: corps.length, pdf: corps.subarray(0, 5).toString() };
  };

  const rapport = { racine, resultats: {}, erreurs: {} };
  rapport.resultats.ORIGINAL = await telecharger('ORIGINAL');
  rapport.resultats.SIGNED = await telecharger('SIGNED');
  rapport.cheminDansLaRacine = doc
    .resolveContractDocumentPath(contract, 'ORIGINAL')
    .startsWith(path.resolve(racine));
  rapport.tailleAttendue = octets.length;

  // Le fichier disparaît du disque, la base le référence toujours : c'est
  // exactement ce que produit une restauration partielle.
  await fs.rm(path.join(racine, contractId, original.originalFilename));
  try {
    await telecharger('ORIGINAL');
    rapport.erreurs.absent = { statut: 200, message: 'aucune erreur levée' };
  } catch (err) {
    rapport.erreurs.absent = {
      statut: err.statusCode,
      code: err.details?.code ?? null,
      message: err.message,
    };
  }

  // Variante jamais déposée : même refus, même code.
  try {
    await telecharger('SIGNED', { document: {} });
    await doc.streamDocument(fausseReponse(), { _id: contractId, document: {} }, 'SIGNED');
    rapport.erreurs.jamaisDepose = { statut: 200, message: 'aucune erreur levée' };
  } catch (err) {
    rapport.erreurs.jamaisDepose = {
      statut: err.statusCode,
      code: err.details?.code ?? null,
      message: err.message,
    };
  }

  await doc.deleteContractStorage(contractId);
  console.log(`##RAPPORT## ${JSON.stringify(rapport)}`);
  process.exit(0);
}

/* ══════════════════════════ LA COMPARAISON (parent) ══════════════════════ */

let pass = 0;
let fail = 0;
const check = (nom, ok) => {
  if (ok) { pass += 1; console.log(`  ✓ ${nom}`); } else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (titre) => console.log(`\n${titre}`);

const base = await fs.mkdtemp(path.join(os.tmpdir(), 'contrat-telechargement-'));
// Deux formes de stockage : celle d'un poste, celle d'un serveur déployé.
const RACINES = {
  LOCAL: path.join(base, 'poste', 'backend', 'storage', 'contracts'),
  PARTAGE: path.join(base, 'serveur', 'shared', 'storage', 'contracts'),
};

const rapports = {};
for (const [label, racine] of Object.entries(RACINES)) {
  await fs.mkdir(racine, { recursive: true });
  const run = spawnSync(process.execPath, [ICI], {
    encoding: 'utf8',
    env: { ...process.env, DOWNLOAD_ROOT_LABEL: label, CONTRACT_STORAGE_DIR: racine },
  });
  const ligne = (run.stdout || '').split('\n').find((l) => l.startsWith('##RAPPORT## '));
  if (run.status !== 0 || !ligne) {
    console.error(run.stdout);
    console.error(run.stderr);
    check(`le scénario s’exécute avec la racine ${label}`, false);
    break;
  }
  rapports[label] = JSON.parse(ligne.slice('##RAPPORT## '.length));
  check(`le scénario s’exécute avec la racine ${label}`, true);
}

const local = rapports.LOCAL;
const partage = rapports.PARTAGE;

if (local && partage) {
  section('1. Le fichier est réellement servi — des deux côtés');
  for (const [label, r] of [['locale', local], ['partagée', partage]]) {
    check(`racine ${label} : l’original est renvoyé en entier`,
      r.resultats.ORIGINAL.taille === r.tailleAttendue && r.resultats.ORIGINAL.taille > 0);
    check(`racine ${label} : c’est bien un PDF`, r.resultats.ORIGINAL.pdf === '%PDF-');
    check(`racine ${label} : le signé aussi`,
      r.resultats.SIGNED.taille === r.tailleAttendue && r.resultats.SIGNED.pdf === '%PDF-');
    check(`racine ${label} : le chemin résolu reste sous la racine configurée`,
      r.cheminDansLaRacine === true);
  }

  section('2. Les en-têtes DEMANDENT un téléchargement, pas un affichage');
  for (const [label, r] of [['locale', local], ['partagée', partage]]) {
    const h = r.resultats.ORIGINAL.headers;
    check(`racine ${label} : Content-Type application/pdf`, h['Content-Type'] === 'application/pdf');
    check(`racine ${label} : Content-Disposition attachment`,
      /^attachment; filename="/.test(h['Content-Disposition']));
    check(`racine ${label} : …avec un nom lisible`,
      /filename="contrat-CTR-2026-042-original\.pdf"/.test(h['Content-Disposition']));
    check(`racine ${label} : Content-Length posé`,
      h['Content-Length'] === String(r.tailleAttendue));
    check(`racine ${label} : jamais « inline »`, !/inline/.test(h['Content-Disposition']));
  }
  check('le signé porte son propre nom',
    /filename="contrat-CTR-2026-042-signed\.pdf"/.test(local.resultats.SIGNED.headers['Content-Disposition']));

  section('3. Fichier absent : un 404 nommé, jamais un 200 vide');
  for (const [label, r] of [['locale', local], ['partagée', partage]]) {
    check(`racine ${label} : référencé mais absent → 404`, r.erreurs.absent.statut === 404);
    check(`racine ${label} : …avec le code métier`,
      r.erreurs.absent.code === 'CONTRACT_DOCUMENT_NOT_FOUND');
    check(`racine ${label} : jamais déposé → même refus`,
      r.erreurs.jamaisDepose.statut === 404
      && r.erreurs.jamaisDepose.code === 'CONTRACT_DOCUMENT_NOT_FOUND');
  }

  section('4. Aucun chemin disque ne sort du serveur');
  for (const [label, r] of [['locale', local], ['partagée', partage]]) {
    const messages = [r.erreurs.absent.message, r.erreurs.jamaisDepose.message].join(' ');
    check(`racine ${label} : le message ne nomme aucun chemin`,
      !/[A-Za-z]:[\\/]|\/home\/|\/var\/www|storage[\\/]/.test(messages));
    check(`racine ${label} : ni la racine de stockage`, !messages.includes(r.racine));
  }

  section('5. Local et production se comportent À L’IDENTIQUE');
  check('mêmes en-têtes pour l’original',
    JSON.stringify(local.resultats.ORIGINAL.headers) === JSON.stringify(partage.resultats.ORIGINAL.headers));
  check('mêmes en-têtes pour le signé',
    JSON.stringify(local.resultats.SIGNED.headers) === JSON.stringify(partage.resultats.SIGNED.headers));
  check('même taille servie',
    local.resultats.ORIGINAL.taille === partage.resultats.ORIGINAL.taille);
  check('même refus quand le fichier manque',
    JSON.stringify(local.erreurs) === JSON.stringify(partage.erreurs));
  check('…et les deux racines étaient bien DIFFÉRENTES', local.racine !== partage.racine);
  check('…dont une imitant le stockage partagé d’un serveur',
    partage.racine.includes(`shared${path.sep}storage`));
}

section('6. Le code ne contient aucun chemin de poste ni release');
{
  const service = await fs.readFile(
    path.resolve(path.dirname(ICI), '../services/contractDocument.service.js'), 'utf8',
  );
  const env = await fs.readFile(path.resolve(path.dirname(ICI), '../config/env.js'), 'utf8');
  check('aucun chemin Windows en dur', !/[A-Za-z]:\\\\/.test(service + env));
  check('aucun chemin de release', !/\/current\//.test(service + env));
  check('aucun nom de domaine en dur dans la résolution',
    !/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(service));
  check('une seule fonction résout le chemin d’un document',
    (service.match(/export function resolveContractDocumentPath/g) || []).length === 1);
  check('…et la racine vient de la configuration',
    /config\.paths\.contractStorage/.test(service));
}

await fs.rm(base, { recursive: true, force: true });
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
