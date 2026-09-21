// CYCLE DE VIE D'UN MÉDIA — LOCAL_ONLY → PUBLISHED → retrait → LOCAL_ONLY.
//
// ══ CE QUE CE TEST FERME ════════════════════════════════════════════════════
//
// Un média restait `PUBLISHED` avec, pour `publishedHost`, un hôte dont on
// venait d'effacer les fichiers. Le champ affirmait une présence CONSTATÉE sur
// un serveur qui ne sert plus rien — et toute décision prise ensuite sur cet
// état reposait sur une affirmation fausse.
//
// On vérifie donc le cycle ENTIER, y compris ses deux retours en arrière :
// le retrait, qui dépublie, et le redéploiement ailleurs, qui republie contre
// un AUTRE domaine sans qu'aucune fiche n'ait été réécrite.
//
// ══ ET CE QU'IL VÉRIFIE DE LA LECTURE ═══════════════════════════════════════
//
// Que les consommateurs lisent bien le DESCRIPTEUR, et l'ancienne chaîne
// seulement à défaut. L'ordre ne s'inverse jamais : un descripteur qui refuse
// de résoudre ne retombe pas sur l'URL historique — ce serait publier
// précisément l'adresse que la résolution vient d'écarter.
import { strict as assert } from 'node:assert';

process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'TEST';

const { MongoMemoryServer } = await import('mongodb-memory-server');
const mongoose = (await import('mongoose')).default;
const os = await import('node:os');
const path = await import('node:path');
const fs = await import('node:fs/promises');
const { createHash } = await import('node:crypto');

const serveur = await MongoMemoryServer.create();
process.env.MONGODB_URI = serveur.getUri();
await mongoose.connect(serveur.getUri(), { dbName: 'media-cycle-test' });

const DOSSIER = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-media-cycle-'));
const { config } = await import('../config/env.js');
config.paths = { ...(config.paths ?? {}), uploads: DOSSIER };
config.env = 'TEST';

const { ProjectMedia } = await import('../models/ProjectMedia.model.js');
const { DeploymentTarget } = await import('../models/DeploymentTarget.model.js');
const media = await import('../services/media/projectMedia.service.js');
const projection = await import('../services/media/mediaProjection.service.js');
const { FakeTransport } = await import('../deployment-engine/transport/FakeTransport.js');

const sharp = (await import('sharp')).default;
const image = async (r, g, b) => sharp({
  create: { width: 40, height: 24, channels: 3, background: { r, g, b } },
}).png().toBuffer();

let ok = 0;
let ko = 0;
const check = (libelle, condition) => {
  if (condition) { ok += 1; console.log(`  ✓ ${libelle}`); }
  else { ko += 1; console.log(`  ✗ ${libelle}`); }
};
const section = (titre) => console.log(`\n${titre}`);

await DeploymentTarget.init();

const PARTAGE = '/var/www/site/shared/uploads';

/**
 * UN VRAI SYSTÈME DE FICHIERS DISTANT, en mémoire.
 *
 * `sha256sum` et `stat` CALCULENT depuis les octets réellement déposés par
 * `uploadFile`. Un transfert oublié rend donc ABSENT, et un transfert corrompu
 * une autre empreinte — comme un serveur. Un double qui répondrait « oui »
 * prouverait qu'on a appelé une fonction, pas qu'un fichier est arrivé.
 */
function serveur_(prealables = new Map()) {
  const t = new FakeTransport();
  for (const [nom, contenu] of prealables) t.files.set(`${PARTAGE}/${nom}`, contenu);
  const original = t.exec.bind(t);
  t.exec = async (commande) => {
    t.commands.push({ command: commande });
    const sha = /sha256sum (\S+)/.exec(commande);
    if (sha) {
      const c = t.files.get(sha[1]);
      return { code: 0, stdout: c === undefined ? 'ABSENT\n' : `${createHash('sha256').update(c).digest('hex')}\n`, stderr: '' };
    }
    const stat = /stat -c %s (\S+)/.exec(commande);
    if (stat) {
      const c = t.files.get(stat[1]);
      return { code: 0, stdout: c === undefined ? 'ABSENT\n' : `${Buffer.from(c).length}\n`, stderr: '' };
    }
    return original(commande);
  };
  return t;
}

const destination = async (host, over = {}) => {
  const at = new Date();
  return DeploymentTarget.create({
    name: host, url: `https://${host}`, host, type: 'domain',
    environment: 'TEST', backendPort: 5201, lifecycleStatus: 'ACTIVE', state: 'DEPLOYED',
    createdAt: at, updatedAt: at, lastDeployedAt: at, ...over,
  });
};

/* ══════════════════════════════════════════════════════════════════════════ */
section('LOCAL_ONLY — un média importé avant tout déploiement');
let logo;
{
  await ProjectMedia.deleteMany({});
  await DeploymentTarget.deleteMany({});

  logo = await media.importProjectMedia(await image(200, 40, 40), { mediaType: 'company-logo' });

  check('le média est LOCAL_ONLY', logo.media.publicationState === 'LOCAL_ONLY');
  check('…estampillé de son environnement', logo.media.environment === 'TEST');
  check('…son adresse reste locale', logo.publicUrl === `/uploads/${logo.filename}`);
  check('…et le descripteur ne porte AUCUNE adresse', !('url' in logo.descriptor));
  check('rien n’est publiable vers le Panel',
    (await media.publishableProjectDescriptor(logo.url)) === null);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('PUBLISHED — premier déploiement : transfert, preuve, publication');
{
  const transport = serveur_();
  const distant = `${PARTAGE}/${logo.filename}`;
  check('la destination est vierge',
    (await transport.exec(`sha256sum ${distant}`)).stdout.trim() === 'ABSENT');

  const rapport = await media.publishProjectMediaOnDestination({
    transport, sharedUploads: PARTAGE, host: 'demo.old.com', environment: 'TEST',
  });

  check('le fichier est réellement TRANSFÉRÉ', rapport.transferred.includes(logo.filename));
  check('…et l’empreinte est relue SUR le serveur, après transfert',
    (await transport.exec(`sha256sum ${distant}`)).stdout.trim() === logo.media.sha256);
  check('…seulement alors il est publié', rapport.published === 1);

  const publie = await ProjectMedia.findOne({ objectKey: logo.filename }).lean();
  check('l’état passe à PUBLISHED', publie.publicationState === 'PUBLISHED');
  check('…sur l’hôte constaté', publie.publishedHost === 'demo.old.com');
  check('…et la date est posée', typeof publie.publishedAt === 'string');

  await destination('demo.old.com');
  const resolue = await media.resolveProjectMediaUrl(publie, 'TEST');
  check('l’adresse devient absolue', resolue.absolute === true);
  check('…sur la destination active', resolue.url === `https://demo.old.com/uploads/${logo.filename}`);
  check('…et le descripteur devient publiable au Panel',
    (await media.publishableProjectDescriptor(logo.url))?.sha256 === logo.media.sha256);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('RETRAIT — la destination ne sert plus : retour à LOCAL_ONLY');
{
  const rapport = await media.unpublishProjectMediaOfDestination({
    host: 'demo.old.com', environment: 'TEST',
  });
  check('le média est dépublié', rapport.unpublished === 1);

  const apres = await ProjectMedia.findOne({ objectKey: logo.filename }).lean();
  check('publicationState redevient LOCAL_ONLY', apres.publicationState === 'LOCAL_ONLY');
  check('publishedHost est effacé', apres.publishedHost === null);
  check('publishedAt est effacé', apres.publishedAt === null);
  check('…mais le DESCRIPTEUR survit intact',
    apres.sha256 === logo.media.sha256 && apres.mediaId === logo.media.mediaId);

  // La destination retirée ne sert plus d'adresse : le média redevient local.
  await DeploymentTarget.updateMany({ host: 'demo.old.com' }, { $set: { lifecycleStatus: 'EMPTY' } });
  const resolue = await media.resolveProjectMediaUrl(apres, 'TEST');
  check('l’ancienne adresse publique n’est plus résoluble comme vérité',
    resolue.absolute === false);
  check('…on retombe sur l’adresse locale, pas sur l’ancien domaine',
    resolue.url === `/uploads/${logo.filename}` && !String(resolue.url).includes('demo.old.com'));
  check('…et plus rien n’est publiable vers le Panel',
    (await media.publishableProjectDescriptor(logo.url)) === null);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('NOUVEAU DOMAINE — republication, sans qu’aucune fiche soit réécrite');
{
  await DeploymentTarget.deleteMany({});
  await destination('demo.new.com');

  const transport = serveur_();
  const rapport = await media.publishProjectMediaOnDestination({
    transport, sharedUploads: PARTAGE, host: 'demo.new.com', environment: 'TEST',
  });
  check('le média est retransféré sur le nouveau domaine',
    rapport.transferred.includes(logo.filename));
  check('…et republié après preuve', rapport.published === 1);

  const apres = await ProjectMedia.findOne({ objectKey: logo.filename }).lean();
  check('publishedHost suit le nouveau domaine', apres.publishedHost === 'demo.new.com');
  check('la clé d’objet n’a pas bougé d’un octet', apres.objectKey === logo.filename);
  check('…ni l’empreinte', apres.sha256 === logo.media.sha256);
  check('…ni la version : aucun réimport n’a eu lieu', apres.version === logo.media.version);

  const resolue = await media.resolveProjectMediaUrl(apres, 'TEST');
  check('l’adresse est celle du NOUVEAU domaine',
    resolue.url === `https://demo.new.com/uploads/${logo.filename}`);
  check('…et jamais celle de l’ancien', !resolue.url.includes('demo.old.com'));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LECTURE — le descripteur d’abord, l’ancienne chaîne à défaut SEULEMENT');
{
  // 1. Une fiche qui porte un DESCRIPTEUR : c'est lui qui décide.
  const avecDescripteur = await projection.projectCompanyMedia({
    name: 'Garage',
    logos: { header: '/uploads/valeur-historique-perimee.webp', favicon: '' },
    logosMedia: { header: logo.descriptor, favicon: null },
    heroImage: '',
  }, 'TEST');
  check('le descripteur gagne sur l’ancienne chaîne',
    avecDescripteur.logos.header === `https://demo.new.com/uploads/${logo.filename}`);
  check('…et l’ancienne valeur périmée n’apparaît jamais',
    !avecDescripteur.logos.header.includes('perimee'));

  // 2. Une fiche ANTÉRIEURE, sans descripteur : la chaîne sert de repli.
  const sansDescripteur = await projection.projectCompanyMedia({
    name: 'Garage',
    logos: { header: logo.url, favicon: '' },
    heroImage: '',
  }, 'TEST');
  check('sans descripteur, l’ancien chemin est résolu par le média retrouvé',
    sansDescripteur.logos.header === `https://demo.new.com/uploads/${logo.filename}`);

  const inconnu = await projection.projectCompanyMedia({
    name: 'Garage', logos: { header: '/uploads/jamais-vu.webp', favicon: '' }, heroImage: '',
  }, 'TEST');
  check('…et un chemin inconnu est rendu tel quel, sans invention',
    inconnu.logos.header === '/uploads/jamais-vu.webp');

  // 3. L'ORDRE NE S'INVERSE JAMAIS : un descripteur qui refuse de résoudre
  //    ne retombe pas sur l'URL historique.
  const croise = await projection.projectCompanyMedia({
    name: 'Garage',
    logos: { header: 'https://ancien.exemple.com/uploads/x.webp', favicon: '' },
    logosMedia: { header: { ...logo.descriptor, environment: 'PROD' }, favicon: null },
    heroImage: '',
  }, 'TEST');
  check('un descripteur d’un AUTRE environnement ne retombe pas sur l’ancienne URL',
    croise.logos.header === '');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LE BLOC DE RÉSOLUTION N’ÉCRASE AUCUN CHAMP STOCKÉ');
{
  const fiche = {
    name: 'Garage',
    logos: { header: logo.url, favicon: '' },
    logosMedia: { header: logo.descriptor, favicon: null },
    heroImage: '',
  };
  const bloc = await projection.companyMediaResolution(fiche, 'TEST');
  check('il rend une adresse pour le logo',
    bloc['logos.header'].url === `https://demo.new.com/uploads/${logo.filename}`);
  check('…en disant qu’elle vient du descripteur', bloc['logos.header'].fromDescriptor === true);
  check('…et qu’elle est servie par une destination', bloc['logos.header'].published === true);
  check('le champ STOCKÉ n’a pas été touché', fiche.logos.header === logo.url);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LE TYPE MÉTIER EST EXIGÉ — plus aucun « other »');
{
  const { MEDIA_TYPES } = await import('../controllers/upload.controller.js');
  for (const attendu of [
    'company-logo', 'company-favicon', 'hero', 'chapter-image',
    'page-image', 'gallery-image', 'team-photo',
  ]) {
    check(`« ${attendu} » est un type reconnu`, MEDIA_TYPES.has(attendu));
  }
  check('« other » n’en est PAS un', !MEDIA_TYPES.has('other'));
}

/* ══════════════════════════════════════════════════════════════════════════ */
console.log(`\n${ok} réussis, ${ko} échoués`);
await fs.rm(DOSSIER, { recursive: true, force: true });
await mongoose.disconnect();
await serveur.stop();
assert.equal(ko, 0, `${ko} vérification(s) en échec.`);
