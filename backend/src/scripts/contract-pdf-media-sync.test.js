/**
 * LE PDF D'UN CONTRAT N'A QU'UN SEUL DOMICILE — autorité et relais.
 *
 * ══ LE DÉFAUT QUE CETTE SUITE VERROUILLE ════════════════════════════════════
 *
 * Les documents de contrat s'écrivaient sur le DISQUE de l'instance qui
 * recevait l'import. Un PDF déposé depuis un poste de développement n'existait
 * que sur ce poste : le Manager déployé ne l'avait jamais vu, et son éditeur de
 * zones ouvrait un document introuvable. Inversement, un PDF déposé sur le
 * déployé restait invisible en local.
 *
 * Deux disques, deux vérités. Les médias IMAGE avaient déjà tranché — une seule
 * instance stocke, les autres relaient — et c'est cette règle-là qu'on applique,
 * plutôt qu'une synchronisation propre aux contrats qui aurait ses propres
 * conflits et sa propre façon d'échouer.
 *
 * ══ CE QUI EST ÉPROUVÉ ══════════════════════════════════════════════════════
 *
 *   · l'autorité se résout sur le DOMAINE, pas sur la chaîne d'adresse ;
 *   · une instance cliente RELAIE et n'écrit rien sur son disque ;
 *   · un relais indisponible REFUSE — il ne se rabat jamais en local ;
 *   · le contrôle d'accès s'applique AVANT toute décision de relais ;
 *   · aucune adresse de poste ni chemin disque ne fuit dans les données.
 */
import { strict as assert } from 'node:assert';

const { MongoMemoryServer } = await import('mongodb-memory-server');
const mongoose = (await import('mongoose')).default;
const os = await import('node:os');
const path = await import('node:path');
const fs = await import('node:fs/promises');

const serveur = await MongoMemoryServer.create();
process.env.MONGODB_URI = serveur.getUri();
process.env.DB_TEST = 'sb_contract_pdf_sync';
const DOSSIER = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-contract-pdf-'));
process.env.CONTRACT_STORAGE_DIR = DOSSIER;

const { config } = await import('../config/env.js');
await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_TEST });

const autorite = await import('../services/media/projectMediaAuthority.js');
const documents = await import('../services/contractDocument.service.js');
const { default: SystemConfiguration } = await import('../models/SystemConfiguration.model.js');

/**
 * On pilote la VRAIE source de l'adresse canonique — `SystemConfiguration.network`
 * — plutôt qu'une doublure du lecteur. Un module ESM est en lecture seule, et
 * c'est tant mieux : le test emprunte ainsi exactement le chemin du runtime.
 */
async function poserAdresseCanonique(backendUrl) {
  await SystemConfiguration.findOneAndUpdate(
    {}, { $set: { 'network.backendUrl': backendUrl } }, { upsert: true, new: true },
  );
}

let pass = 0;
let fail = 0;
const check = (libelle, condition) => {
  if (condition) { pass += 1; console.log(`  ✓ ${libelle}`); } else { fail += 1; console.error(`  ✗ ${libelle}`); }
};
const section = (t) => console.log(`\n${t}`);

/** Un PDF minimal mais VRAI — la validation lit les octets, pas l'extension. */
const { PDFDocument } = await import('pdf-lib');
async function pdfReel(pages = 1) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) doc.addPage([595, 842]);
  return Buffer.from(await doc.save());
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('1 · L’autorité se résout sur le DOMAINE, jamais sur la chaîne');
{
  const originel = config.publicUrl;

  /** Le déployé se reconnaît malgré le préfixe d'API — sinon il se relaierait à lui-même. */
  await poserAdresseCanonique('https://api.demo.exemple.com');
  config.publicUrl = 'https://demo.exemple.com';
  let r = await autorite.resolveProjectMediaAuthority();
  check('le backend déployé se reconnaît comme AUTORITÉ (préfixe api. retiré)',
    r.isAuthority === true && r.reason === 'MEME_DOMAINE');

  /** Un poste de développement partage la base : il y lit l'adresse du déployé. */
  config.publicUrl = 'http://localhost:6070';
  r = await autorite.resolveProjectMediaAuthority();
  check('un poste local est une instance CLIENTE',
    r.isAuthority === false && r.reason === 'INSTANCE_CLIENTE');
  check('…et il connaît l’adresse à laquelle relayer',
    r.authority === 'https://api.demo.exemple.com');

  /** Projet jamais déployé : le poste est seul, il se suffit. */
  await poserAdresseCanonique('http://localhost:6070');
  r = await autorite.resolveProjectMediaAuthority();
  check('sans déploiement, le poste local EST l’autorité (aucun relais à vide)',
    r.isAuthority === true);

  config.publicUrl = originel;
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('2 · L’autorité STOCKE — validation sur les octets, empreinte persistée');
{
  const buffer = await pdfReel(2);
  const meta = await documents.storeOriginalPdf('contrat-autorite', buffer, { filename: 'c.pdf' });

  check('le PDF est accepté et stocké', Boolean(meta.originalFilename));
  check('le nombre de pages est relevé', meta.pageCount === 2);
  check('une empreinte SHA-256 est persistée',
    typeof meta.originalChecksum === 'string' && meta.originalChecksum.length === 64);

  const surDisque = await fs.readdir(path.join(DOSSIER, 'contrat-autorite'));
  check('le fichier existe chez l’autorité', surDisque.length === 1);

  /** §14 — le type se prouve sur les OCTETS, jamais sur le nom. */
  const menteur = Buffer.from('GIF89a ceci n’est pas un PDF');
  let refuse = false;
  try { await documents.validatePdfBuffer(menteur, { filename: 'piege.pdf' }); } catch { refuse = true; }
  check('un fichier nommé .pdf qui n’en est pas un est REFUSÉ', refuse);

  /** Le même contenu donne la même empreinte : c'est ce qui rend les deux côtés comparables. */
  const a = await documents.validatePdfBuffer(buffer);
  const b = await documents.validatePdfBuffer(Buffer.from(buffer));
  check('la même version est identifiable des deux côtés (empreinte stable)',
    a.checksum === b.checksum);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('3 · Une instance CLIENTE relaie, et n’écrit RIEN localement');
{
  const originel = config.publicUrl;
  await poserAdresseCanonique('https://api.demo.exemple.com');
  config.publicUrl = 'http://localhost:6070';

  const appels = [];
  const fetchOriginel = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    appels.push({ url: String(url), method: opts?.method ?? 'GET', auth: opts?.headers?.authorization ?? null });
    return new Response(JSON.stringify({ success: true, data: { relaye: true } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };

  const { authority, isAuthority } = await autorite.resolveProjectMediaAuthority();
  check('cette instance se sait cliente', isAuthority === false);

  const reponse = await autorite.relayToProjectAuthority(authority, '/api/contracts/abc/documents/original', {
    method: 'GET', headers: { authorization: 'Bearer jeton-de-appelant' },
  });
  check('le relais atteint l’AUTORITÉ, pas la machine locale',
    appels[0]?.url === 'https://api.demo.exemple.com/api/contracts/abc/documents/original');
  check('…en portant le jeton de l’appelant (aucun secret stocké)',
    appels[0]?.auth === 'Bearer jeton-de-appelant');
  check('…et la réponse de l’autorité fait foi', reponse.status === 200);

  const avant = await fs.readdir(DOSSIER);
  check('aucun dossier de contrat n’a été créé localement par le relais',
    !avant.includes('abc'));

  globalThis.fetch = fetchOriginel;
  config.publicUrl = originel;
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('4 · Autorité INJOIGNABLE — on refuse, on ne se rabat pas');
{
  const fetchOriginel = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };

  let echoue = false;
  try {
    await autorite.relayToProjectAuthority('https://api.demo.exemple.com', '/api/contracts/x/documents/original', {});
  } catch { echoue = true; }
  check('un relais impossible LÈVE — il ne rend pas un succès silencieux', echoue);

  const contenu = await fs.readdir(DOSSIER);
  check('rien n’a été écrit localement pendant l’échec', !contenu.includes('x'));

  globalThis.fetch = fetchOriginel;
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('5 · Aucune adresse de poste ni chemin disque dans le code de relais');
{
  const fsSync = await import('node:fs');
  const lus = [
    '../controllers/contractDocument.controller.js',
    '../controllers/contract.dev.controller.js',
  ].map((rel) => fsSync.readFileSync(new URL(rel, import.meta.url), 'utf8'));

  for (const [i, source] of lus.entries()) {
    /** On ne regarde que le CODE : les commentaires expliquent les interdits. */
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const nom = ['contractDocument.controller', 'contract.dev.controller'][i];
    check(`${nom} : aucune adresse localhost codée en dur`, !/localhost:\d+/.test(code));
    check(`${nom} : aucun chemin disque absolu`, !/[A-Za-z]:\\\\|\/tmp\/|file:\/\//.test(code));
    check(`${nom} : l’adresse d’autorité vient du résolveur`,
      /resolveProjectMediaAuthority/.test(code));
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('6 · Le contrôle d’accès précède le relais');
{
  const fsSync = await import('node:fs');
  const source = fsSync.readFileSync(
    new URL('../controllers/contractDocument.controller.js', import.meta.url), 'utf8',
  );
  const corps = source.slice(source.indexOf('async function servirDocument'));
  const posAcces = corps.indexOf('loadWithAccess');
  const posRelais = corps.indexOf('resolveProjectMediaAuthority');
  check('l’accès est vérifié AVANT de décider du relais',
    posAcces !== -1 && posRelais !== -1 && posAcces < posRelais);
}

await mongoose.disconnect();
await serveur.stop();
await fs.rm(DOSSIER, { recursive: true, force: true });

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
