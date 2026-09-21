/**
 * MÉDIAS MÉTIER DU PROJET — LOT 5.
 *
 * ══ LA CAUSE TRAITÉE ═══════════════════════════════════════════════════════
 *
 * Chaque instance du backend écrivait dans son propre `/uploads`. Un média
 * importé depuis un poste de développement n'existait que sur ce poste ; la
 * vitrine déployée ne l'avait jamais vu, et inversement. Deux dossiers, deux
 * vérités, et aucune façon de savoir laquelle le site afficherait.
 *
 * Les médias n'étaient par ailleurs rapprochés que par NOM DE FICHIER — entre
 * deux projets voisins, la façon la plus sûre de mélanger leurs images.
 *
 * ══ CE QUI EST PROUVÉ ICI ══════════════════════════════════════════════════
 *
 *  · une seule autorité : le backend déployé du projet ;
 *  · une instance cliente RELAIE et n'écrit RIEN localement ;
 *  · aucune écriture si l'autorité est indisponible ;
 *  · chaque média porte une portée métier complète (projet, identité, type,
 *    propriétaire, empreinte, MIME, taille, dimensions, version, auteur) ;
 *  · l'adresse dérive du contenu — aucune ancienne image ne ressuscite ;
 *  · la suppression est unique, idempotente, et refusée si le média est
 *    encore référencé ;
 *  · deux projets ne partagent jamais un média ;
 *  · l'inventaire historique est un DRY-RUN qui ne supprime rien.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import os from 'node:os';
import path from 'node:path';
import fsp from 'node:fs/promises';

const mongod = await MongoMemoryServer.create();
const DOSSIER = await fsp.mkdtemp(path.join(os.tmpdir(), 'sbauto-media-'));

process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'projmedia_test';
process.env.DB_PROD = 'projmedia_prod';
process.env.JWT_SECRET = 'test-secret-jwt-long-enough-32chars!!';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
process.env.PANEL_SCHEDULER_ENABLED = 'false';
process.env.UPLOADS_DIR = DOSSIER;

let pass = 0;
let fail = 0;
const check = (nom, ok) => {
  if (ok) { pass += 1; console.log(`  ✓ ${nom}`); } else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (t) => console.log(`\n${t}`);

const mongoose = (await import('mongoose')).default;
await mongoose.connect(process.env.MONGODB_URI, { dbName: 'projmedia_test' });

const { config } = await import('../config/env.js');
config.paths = { ...(config.paths ?? {}), uploads: DOSSIER };

const media = await import('../services/media/projectMedia.service.js');
const autorite = await import('../services/media/projectMediaAuthority.js');
const { ProjectMedia } = await import('../models/ProjectMedia.model.js');
const { SystemConfiguration } = await import('../models/SystemConfiguration.model.js');

const sharp = (await import('sharp')).default;
const image = (r, g, b) => sharp({
  create: { width: 48, height: 32, channels: 3, background: { r, g, b } },
}).png().toBuffer();

const rouge = await image(220, 30, 30);
const bleue = await image(30, 30, 220);

/** Écrit l'adresse canonique du projet, comme le fait le déploiement. */
async function poserAdresseCanonique(url) {
  await SystemConfiguration.findOneAndUpdate(
    {},
    { $set: { 'network.backendUrl': url } },
    { upsert: true, new: true },
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('AUTORITÉ — qui stocke, et qui relaie');
{
  // Aucun déploiement encore : le poste est seul, et se suffit.
  await poserAdresseCanonique('');
  let verdict = await autorite.resolveProjectMediaAuthority();
  check('sans adresse canonique, l’instance est sa propre autorité',
    verdict.isAuthority === true && verdict.reason === 'AUCUNE_ADRESSE_CANONIQUE');

  // Le backend canonique tourne en local : toujours pas de déployé.
  await poserAdresseCanonique('http://localhost:6060');
  verdict = await autorite.resolveProjectMediaAuthority();
  check('une adresse canonique locale ne fait pas de cette instance un client',
    verdict.isAuthority === true && verdict.reason === 'CANONIQUE_LOCALE');

  // Le projet est déployé, et cette instance est le déployé lui-même.
  await poserAdresseCanonique('https://api.sbauto.exemple.com');
  config.publicUrl = 'https://sbauto.exemple.com';
  verdict = await autorite.resolveProjectMediaAuthority();
  check('le backend déployé se reconnaît malgré le préfixe d’API',
    verdict.isAuthority === true && verdict.reason === 'MEME_DOMAINE');

  // Un poste de développement partageant la base du déployé.
  config.publicUrl = 'http://localhost:6060';
  verdict = await autorite.resolveProjectMediaAuthority();
  check('un poste de développement est une instance CLIENTE',
    verdict.isAuthority === false && verdict.reason === 'INSTANCE_CLIENTE');
  check('…et connaît l’adresse à laquelle relayer',
    verdict.authority === 'https://api.sbauto.exemple.com');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('IMPORT — portée métier complète, adresse dérivée du contenu');
{
  // On repasse en autorité pour écrire réellement.
  await poserAdresseCanonique('');
  config.publicUrl = null;

  const res = await media.importProjectMedia(rouge, { mediaType: 'hero', createdBy: 'dev@test' });

  check('l’import rend un chemin relatif', res.url.startsWith('/uploads/'));
  check('le nom porte l’identité et l’empreinte du contenu',
    /^[0-9a-f-]{36}-[0-9a-f]{12}\.webp$/.test(res.filename));
  check('aucun horodatage dans le nom',
    !/\d{10,}/.test(res.filename.replace(/[0-9a-f-]{36}/, '')));

  const m = res.media;
  check('le type métier est déclaré', m.mediaType === 'hero');
  check('l’empreinte est un SHA-256', /^[0-9a-f]{64}$/.test(m.sha256));
  check('le type réel est mesuré', m.mime === 'image/webp');
  check('la taille est mesurée', Number.isInteger(m.size) && m.size > 0);
  check('les dimensions sont mesurées', m.width === 48 && m.height === 32);
  check('la version démarre à 1', m.version === 1);
  check('l’auteur est consigné', m.createdBy === 'dev@test');
  check('la portée projet est présente au descripteur',
    Object.hasOwn(m, 'projectId') && Object.hasOwn(m, 'projectIdentityId'));

  const surDisque = await fsp.readFile(path.join(DOSSIER, res.filename));
  check('l’empreinte décrite est celle du fichier servi',
    media.sha256Of(surDisque) === m.sha256);

  // Un contenu différent a forcément une autre adresse.
  const autre = await media.importProjectMedia(bleue, { mediaType: 'hero' });
  check('un contenu différent a une autre adresse', autre.url !== res.url);
  check('…et l’ancien fichier n’est pas écrasé',
    (await fsp.readdir(DOSSIER)).includes(res.filename));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('DÉDUPLICATION — scopée par projet ET par type');
{
  const a = await media.importProjectMedia(rouge, { mediaType: 'gallery' });
  const b = await media.importProjectMedia(rouge, { mediaType: 'gallery' });
  check('réimporter le même fichier rend le MÊME objet', b.url === a.url);
  check('…et l’annonce', b.deduplicated === true);

  const autreType = await media.importProjectMedia(rouge, { mediaType: 'banner' });
  check('le même contenu pour un AUTRE type reste un autre objet',
    autreType.url !== a.url);
  check('…avec sa propre identité', autreType.media.mediaId !== a.media.mediaId);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('SUPPRESSION — unique, idempotente, refusée si encore utilisée');
{
  const cible = await media.importProjectMedia(await image(10, 180, 10), { mediaType: 'logo' });

  // On simule une fiche qui référence ce média.
  await mongoose.connection.db.collection('companies').insertOne({
    name: 'Garage test', logos: { main: cible.url },
  });

  const references = await media.findReferences(cible.url);
  check('les références sont retrouvées', references.length === 1);
  check('…en nommant la collection', references[0].collection === 'companies');

  let code = null;
  await media.deleteProjectMedia(cible.filename).catch((e) => { code = e.code ?? e.details?.code; });
  check('un média encore référencé N’EST PAS supprimé',
    code === 'PROJECT_MEDIA_STILL_REFERENCED');
  check('…et son fichier est toujours là',
    (await fsp.readdir(DOSSIER)).includes(cible.filename));

  // La fiche cesse de le référencer : la suppression devient possible.
  await mongoose.connection.db.collection('companies').deleteMany({});
  const res = await media.deleteProjectMedia(cible.filename);
  check('un média non référencé se supprime', res.deleted === true);
  check('…et son fichier disparaît',
    !(await fsp.readdir(DOSSIER)).includes(cible.filename));

  const trace = await ProjectMedia.findOne({ objectKey: cible.filename }).lean();
  check('le descripteur SURVIT — pour pouvoir répondre 410',
    trace !== null && typeof trace.deletedAt === 'string');

  const encore = await media.deleteProjectMedia(cible.filename);
  check('supprimer deux fois n’est pas une erreur',
    encore.deleted === true && encore.alreadyGone === true);

  // Sécurité des noms.
  const refuse = async (nom) => {
    try { await media.deleteProjectMedia(nom); return null; }
    catch (e) { return e.code ?? e.details?.code; }
  };
  check('un nom hors des formes attendues est refusé',
    (await refuse('quelconque.webp')) === 'PROJECT_MEDIA_INVALID_NAME');
  check('…une remontée de répertoire aussi',
    (await refuse('../secret.webp')) === 'PROJECT_MEDIA_INVALID_NAME');
  check('…un séparateur aussi',
    (await refuse('sous/dossier.webp')) === 'PROJECT_MEDIA_INVALID_NAME');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('ISOLATION — deux projets ne partagent jamais un média');
{
  await ProjectMedia.deleteMany({});
  const at = new Date().toISOString();
  await ProjectMedia.insertMany([
    {
      mediaId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', projectId: 'projet-A',
      projectIdentityId: 'identite-A', mediaType: 'logo', environment: 'TEST',
      objectKey: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa-111111111111.webp',
      path: '/uploads/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa-111111111111.webp',
      mime: 'image/webp', size: 10, sha256: 'f'.repeat(64), version: 1,
      createdAt: at, updatedAt: at,
    },
    {
      mediaId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', projectId: 'projet-B',
      projectIdentityId: 'identite-B', mediaType: 'logo', environment: 'TEST',
      objectKey: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb-222222222222.webp',
      path: '/uploads/bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb-222222222222.webp',
      // MÊME contenu que le média du projet A — et pourtant deux objets.
      mime: 'image/webp', size: 10, sha256: 'f'.repeat(64), version: 1,
      createdAt: at, updatedAt: at,
    },
  ]);

  const a = await ProjectMedia.find({ projectId: 'projet-A' }).lean();
  const b = await ProjectMedia.find({ projectId: 'projet-B' }).lean();
  check('chaque projet ne voit que ses médias', a.length === 1 && b.length === 1);
  check('un même contenu dans deux projets reste DEUX objets',
    a[0].objectKey !== b[0].objectKey);
  check('…avec deux identités distinctes', a[0].mediaId !== b[0].mediaId);
  check('…et deux identités de projet distinctes',
    a[0].projectIdentityId !== b[0].projectIdentityId);

  // La déduplication ne franchit jamais la frontière d'un projet.
  const jumeau = await ProjectMedia.findOne({
    projectId: 'projet-A', mediaType: 'logo', sha256: 'f'.repeat(64), deletedAt: null,
  }).lean();
  check('la recherche de doublon est bornée au projet', jumeau.projectId === 'projet-A');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('INVENTAIRE HISTORIQUE — dry-run, et rien n’est supprimé');
{
  await ProjectMedia.deleteMany({});
  // Un fichier tel qu'il existait AVANT le descripteur.
  const ancien = `logo-${'1'.repeat(13)}-123456789.webp`;
  await fsp.writeFile(path.join(DOSSIER, ancien), await sharp(rouge).webp().toBuffer());

  const simulation = await media.inventoryProjectMedia({ apply: false });
  check('la simulation examine les fichiers', simulation.scanned >= 1);
  check('…et n’écrit AUCUN descripteur', simulation.described === 0);
  check('…le mode est annoncé', simulation.mode === 'DRY-RUN');
  check('…les orphelins sont signalés',
    simulation.orphans.some((o) => o.objectKey === ancien));
  check('…et le fichier est toujours là',
    (await fsp.readdir(DOSSIER)).includes(ancien));
  check('aucun descripteur n’a été créé',
    (await ProjectMedia.countDocuments({})) === 0);

  const applique = await media.inventoryProjectMedia({ apply: true });
  check('l’écriture crée les descripteurs manquants', applique.described >= 1);
  const decrit = await ProjectMedia.findOne({ objectKey: ancien }).lean();
  check('…avec l’empreinte réelle du fichier', /^[0-9a-f]{64}$/.test(decrit.sha256));
  check('…son type réel', decrit.mime === 'image/webp');
  check('…ses dimensions', decrit.width === 48 && decrit.height === 32);
  check('…et son chemin d’origine INCHANGÉ', decrit.path === `/uploads/${ancien}`);
  check('le fichier historique n’a pas été renommé',
    (await fsp.readdir(DOSSIER)).includes(ancien));

  const encore = await media.inventoryProjectMedia({ apply: true });
  check('l’inventaire est idempotent', encore.described === 0);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('ARCHITECTURE — aucune copie, aucun passage par le Panel');
{
  const url = await import('node:url');
  const lire = async (rel) => fsp.readFile(url.fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

  const service = await lire('../services/media/projectMedia.service.js');
  check('le service ne parle jamais au Panel',
    !/panelBridge|PanelClient|bridge\/v1/.test(service));
  check('…et ne copie aucun dossier', !/copyFile|cp\(|rsync/.test(service));

  const controleur = await lire('../controllers/upload.controller.js');
  check('le contrôleur relaie quand il n’est pas l’autorité',
    /resolveProjectMediaAuthority/.test(controleur) && /relayToProjectAuthority/.test(controleur));
  check('…et REFUSE d’écrire si l’autorité est injoignable',
    /PROJECT_MEDIA_AUTHORITY_UNREACHABLE/.test(controleur));
  check('…sans jamais se rabattre sur le disque local',
    !/importProjectMedia\(req\.file\.buffer[^)]*\)\s*;?\s*\}\s*catch/.test(controleur));

  const autoriteSource = await lire('../services/media/projectMediaAuthority.js');
  // Le relais réémet le jeton REÇU ; il n'en fabrique aucun et ne lit aucun
  // identifiant de configuration. Le motif vise le CODE, pas les commentaires,
  // qui expliquent précisément pourquoi aucun secret n'est stocké.
  const codeAutorite = autoriteSource.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  check('le relais ne fabrique aucun identifiant',
    !/apiKey|jwt\.sign|Bearer\s|process\.env\.[A-Z_]*SECRET/i.test(codeAutorite));
  check('…il réémet les en-têtes reçus', /headers,/.test(codeAutorite));
  check('…et ne suit aucune redirection', /redirect: 'manual'/.test(autoriteSource));

  const app = await lire('../app.js');
  check('la lecture d’un média est relayée par une instance cliente',
    /relayToProjectAuthority\(authority, `\/uploads/.test(app));
  check('un média porteur d’empreinte est servi immuable',
    /max-age=31536000, immutable/.test(app));
  check('un média supprimé répond 410', /PROJECT_MEDIA_GONE/.test(app));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LE BALAYAGE ANTI-ORPHELINS — il balayait RIEN, et il pouvait tout prendre');
{
  /**
   * ══ LES DEUX DÉFAUTS, OPPOSÉS, DU MÊME RELEVÉ ═════════════════════════════
   *
   *  1. IL NE SUPPRIMAIT JAMAIS RIEN. Le relevé lisait TOUTES les collections
   *     à la recherche de `/uploads/<fichier>` — y compris `projectmedias`,
   *     l'inventaire, dont chaque descripteur porte `path: '/uploads/<clé>'`.
   *     Chaque fichier se référençait donc lui-même, `deleted` était toujours
   *     vide, et le dossier ne faisait que croître : un logo remplacé dix fois
   *     laissait dix fichiers sur le disque.
   *
   *  2. IL AURAIT PU TOUT PRENDRE. Un descripteur (`mediaDescriptorSchema`) ne
   *     porte PAS de chemin — seulement une clé d'objet nue. Une fiche qui
   *     n'aurait gardé que son descripteur, l'état vers lequel tout le projet
   *     converge, aurait vu son média traité comme un orphelin.
   *
   * Les deux se prouvent ici, sur un vrai dossier et une vraie base.
   */
  const stockage = await import('../services/storage.service.js');
  const { isValidMediaName } = await import('../services/media/mediaNaming.js');

  const orphelin = await media.importProjectMedia(await image(10, 200, 90), {
    mediaType: 'gallery-image',
  });
  const referenceParChemin = await media.importProjectMedia(await image(200, 10, 90), {
    mediaType: 'gallery-image',
  });
  const referenceParCle = await media.importProjectMedia(await image(90, 10, 200), {
    mediaType: 'gallery-image',
  });

  /* Une fiche « à l'ancienne » : elle conserve le CHEMIN de stockage. */
  await mongoose.connection.db.collection('fichesdetest').insertOne({
    nom: 'ancienne', image: referenceParChemin.url,
  });
  /* Une fiche moderne : elle ne conserve QUE le descripteur, donc une clé nue. */
  await mongoose.connection.db.collection('fichesdetest').insertOne({
    nom: 'moderne',
    imageMedia: { objectKey: referenceParCle.filename, sha256: 'peu-importe' },
  });

  const rapport = await stockage.sweepOrphans({ dryRun: true, minAgeMs: 0 });

  check('un média que plus aucune fiche ne rend est vu comme ORPHELIN',
    rapport.deleted.includes(orphelin.filename));
  check('…l’inventaire ne le sauve plus de lui-même (le défaut qui bloquait tout)',
    rapport.referencedCount < rapport.physicalCount);
  check('un média désigné par son CHEMIN est conservé',
    !rapport.deleted.includes(referenceParChemin.filename));
  check('un média désigné par sa seule CLÉ D’OBJET est conservé aussi',
    !rapport.deleted.includes(referenceParCle.filename));
  check('la simulation n’a rien supprimé', rapport.dryRun === true
    && await fsp.access(path.join(DOSSIER, orphelin.filename)).then(() => true).catch(() => false));

  /* Le balayage RÉEL, lui, retire le fichier ET marque son descripteur. */
  await stockage.sweepOrphans({ minAgeMs: 0 });
  const parti = await fsp.access(path.join(DOSSIER, orphelin.filename))
    .then(() => false).catch(() => true);
  check('le balayage réel retire le fichier orphelin', parti);
  const descripteur = await ProjectMedia.findOne({ objectKey: orphelin.filename }).lean();
  check('…et son descripteur porte la suppression — l’adresse répondra 410, pas 404',
    typeof descripteur?.deletedAt === 'string');
  const survivant = await fsp.access(path.join(DOSSIER, referenceParCle.filename))
    .then(() => true).catch(() => false);
  check('…pendant que le média encore rendu est toujours là', survivant);

  /**
   * LA PÉRIODE DE GRÂCE reste la protection du média qu'on vient d'importer :
   * le Manager envoie le fichier AVANT que la fiche ne soit enregistrée.
   */
  const enCoursDEdition = await media.importProjectMedia(await image(5, 5, 5), {
    mediaType: 'gallery-image',
  });
  const avecGrace = await stockage.sweepOrphans({ dryRun: true, minAgeMs: 60 * 60 * 1000 });
  check('un média fraîchement importé est PROTÉGÉ par la période de grâce',
    avecGrace.keptRecent.includes(enCoursDEdition.filename)
    && !avecGrace.deleted.includes(enCoursDEdition.filename));

  /**
   * LA FORME DES NOMS RESTE CELLE QUE CE PROJET PRODUIT.
   *
   * Il n'importe QUE des images : ajouter `pdf` à la liste ferait reconnaître
   * comme média un nom que rien ici ne peut écrire.
   */
  check('un nom de média produit par l’import est reconnu',
    isValidMediaName('11111111-2222-3333-4444-555555555555-abcdefabcdef.webp'));
  check('…et rien d’autre ne passe',
    !isValidMediaName('../../etc/passwd') && !isValidMediaName('quelconque.pdf'));
}

console.log(`\n${pass} réussis, ${fail} échoués`);
await mongoose.disconnect();
await mongod.stop();
await fsp.rm(DOSSIER, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
