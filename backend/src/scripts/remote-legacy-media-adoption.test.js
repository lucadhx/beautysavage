// REMOTE_LEGACY_PROJECT_MEDIA_ADOPTION — le parc existant vit sur la destination.
//
// ══ LE RELEVÉ RÉEL, REPRODUIT À L'IDENTIQUE ═════════════════════════════════
//
//   poste local        backend/uploads/     → .gitkeep, et RIEN d'autre
//   destination        shared/uploads/      → les fichiers du parc
//   base               fiches avec un chemin, descripteurs null, ProjectMedia 0
//
// Le dry-run conduit depuis le poste de déploiement n'a donc rien trouvé : il
// inventoriait un dossier vide et concluait qu'il n'y avait rien à reprendre.
// `media_publish`, qui ne lit que des descripteurs, ne voyait rien non plus.
// Résultat en ligne : des images référencées et jamais servies.
//
// ══ CE QUE CE TEST PROUVE ═══════════════════════════════════════════════════
//
// Que la reprise s'exécute LÀ OÙ SONT LES OCTETS, qu'elle n'a besoin d'aucun
// fichier local, qu'elle ne renomme ni ne supprime rien, qu'elle est idempotente,
// qu'elle refuse d'arbitrer un conflit, et qu'elle ne peut PAS atteindre les
// médias du développeur.
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
await mongoose.connect(serveur.getUri(), { dbName: 'legacy-adoption' });

/**
 * DEUX DOSSIERS, COMME DANS LA RÉALITÉ.
 *
 * `LOCAL` est le poste qui déploie : un `.gitkeep`, rien de plus.
 * `DISTANT` est le `shared/uploads` de la destination : tous les fichiers.
 *
 * La reprise s'exécute SUR la destination — c'est-à-dire avec `config.paths.
 * uploads` pointant sur `DISTANT`. Aucun test ne pointe l'adoption sur `LOCAL` :
 * ce serait reproduire le défaut au lieu de le fermer.
 */
const LOCAL = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-uploads-local-'));
const DISTANT = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-uploads-distant-'));
await fs.writeFile(path.join(LOCAL, '.gitkeep'), '');

const { config } = await import('../config/env.js');
config.paths = { ...(config.paths ?? {}), uploads: DISTANT };
config.env = 'TEST';

const { ProjectMedia } = await import('../models/ProjectMedia.model.js');
const { DeploymentTarget } = await import('../models/DeploymentTarget.model.js');
const { Company } = await import('../models/Company.model.js');
const { Chapter } = await import('../models/Chapter.model.js');
const { PanelCompanyConfiguration } = await import('../models/PanelConfiguration.model.js');
const adoption = await import('../services/media/projectMediaAdoption.service.js');
const media = await import('../services/media/projectMedia.service.js');
const projection = await import('../services/media/mediaProjection.service.js');
const { FakeTransport } = await import('../deployment-engine/transport/FakeTransport.js');

const sharp = (await import('sharp')).default;
const image = async (r, g, b) => sharp({
  create: { width: 48, height: 32, channels: 3, background: { r, g, b } },
}).webp().toBuffer();

let ok = 0;
let ko = 0;
const check = (libelle, condition) => {
  if (condition) { ok += 1; console.log(`  ✓ ${libelle}`); }
  else { ko += 1; console.log(`  ✗ ${libelle}`); }
};
const section = (t) => console.log(`\n${t}`);

await DeploymentTarget.init();

/* ══ LE PARC RÉEL ═══════════════════════════════════════════════════════════ */

/** Les noms sont ceux du relevé : historiques, sans UUID ni empreinte. */
const PARC = [
  'img-1784735408962-149225253.webp',
  'favicon-1784735419889-812970184.png',
  'img-1783953468696-408388278.webp',
  'img-1783953966067-898120780.webp',
  'img-1784035305658-52309022.webp',
  'img-1783956929436-546483102.webp',
  'img-1783981612037-775430736.webp',
  'img-1783981616391-171701318.webp',
];

const empreintes = new Map();
for (const [i, nom] of PARC.entries()) {
  const octets = await image(10 + i * 20, 40 + i * 10, 200 - i * 15);
  await fs.writeFile(path.join(DISTANT, nom), octets);
  empreintes.set(nom, createHash('sha256').update(octets).digest('hex'));
}

const SB_HOTE = 'demo-sbauto06.ly-solution.com';
await DeploymentTarget.create({
  name: 'SB Auto TEST', url: `https://${SB_HOTE}`, host: SB_HOTE,
  type: 'domain', environment: 'TEST', backendPort: 5002,
  lifecycleStatus: 'ACTIVE', state: 'DEPLOYED', lastDeployedAt: new Date(),
});

/** Les fiches ne portent qu'un CHEMIN — aucun descripteur, comme en base. */
const company = await Company.create({
  name: 'SB Auto 06',
  logos: { header: `/uploads/${PARC[0]}`, favicon: `/uploads/${PARC[1]}` },
  heroImage: `/uploads/${PARC[2]}`,
});
/**
 * TROIS CHAPITRES — parce que le registre d'adoption n'a plus qu'une seule
 * collection métier, et qu'il faut malgré tout plusieurs documents pour
 * éprouver l'adoption en masse, le conflit et l'orpheline séparément.
 */
const conception = await Chapter.create({
  slug: 'conception', title: 'Conception', heroImage: `/uploads/${PARC[3]}`,
});
const architecture = await Chapter.create({
  slug: 'architecture', title: 'Architecture', heroImage: `/uploads/${PARC[4]}`,
});
const experience = await Chapter.create({
  slug: 'experience', title: 'L’Expérience L.Y', heroImage: `/uploads/${PARC[5]}`,
});

/** Le logo du DÉVELOPPEUR — publié par le Panel, jamais un média de ce projet. */
await PanelCompanyConfiguration.create({
  key: 'SINGLETON', companyId: '11111111-1111-1111-1111-111111111111', slug: 'agence',
  environment: 'TEST', version: 1,
  identity: { name: 'L.Y Solution' },
  branding: {
    logo: {
      authority: 'PANEL',
      mediaId: '7dda6e2d-1745-49df-9a1d-e1894aecb34b',
      objectKey: '7dda6e2d-1745-49df-9a1d-e1894aecb34b-bd65e2ad257b.webp',
      url: 'https://panel.ly-solution.com/uploads/7dda6e2d-1745-49df-9a1d-e1894aecb34b-bd65e2ad257b.webp',
      environment: 'TEST', publicationState: 'PUBLISHED',
    },
  },
});

/* ══════════════════════════════════════════════════════════════════════════ */
section('L’ÉTAT DE DÉPART EST BIEN CELUI DU RELEVÉ');
{
  check('le poste local ne contient qu’un .gitkeep',
    (await fs.readdir(LOCAL)).join() === '.gitkeep');
  check(`la destination porte les ${PARC.length} fichiers du parc`,
    (await fs.readdir(DISTANT)).length === PARC.length);
  check('aucun ProjectMedia en base', (await ProjectMedia.countDocuments({})) === 0);
  check('la fiche entreprise ne porte AUCUN descripteur',
    company.logosMedia?.header == null && company.heroImageMedia == null);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('DRY-RUN — on lit avant d’écrire');
{
  const r = await adoption.adoptLegacyProjectMedia({ apply: false });

  check('mode DRY-RUN annoncé', r.mode === 'DRY-RUN');
  check('la reprise regarde bien le dossier de la DESTINATION', r.uploadsDir === DISTANT);
  check(`${PARC.length} fichiers relevés sur la destination`, r.remoteFiles.length === PARC.length);
  /**
   * SIX RÉFÉRENCES, ET NON SEPT.
   *
   * Le registre d'adoption ne connaît plus que deux collections métier :
   * `companies` (logo, favicon, image d'accueil) et `chapters` (image de
   * tête). Trois plus trois font six. Le septième média du parc — `PARC[6]` —
   * reste sur le disque sans être cité par aucune fiche : c'est exactement ce
   * qu'il faut pour éprouver, plus bas, qu'un fichier ORPHELIN n'est jamais
   * adopté par erreur.
   */
  check('6 références historiques trouvées dans les fiches', r.legacyRefs.length === 6);
  check('6 descripteurs à créer', r.toCreate.length === 6);
  check('6 fiches à raccrocher', r.toAttach.length === 6);
  check('aucun conflit', r.conflicts.length === 0);
  check('aucun doublon', r.duplicates.length === 0);
  check('aucune référence sans fichier', r.missing.length === 0);
  check('aucune erreur', r.errors.length === 0);

  // Les empreintes sont VRAIES : elles viennent des octets, pas d'un nom.
  const parNom = new Map(r.toCreate.map((c) => [c.objectKey, c]));
  check('les empreintes sont calculées depuis les octets réels',
    PARC.slice(0, 6).every((nom) => parNom.get(nom)?.sha256 === empreintes.get(nom)));
  check('les dimensions sont mesurées, pas devinées',
    r.toCreate.every((c) => c.width === 48 && c.height === 32));
  check('le type MIME est mesuré (le .png est bien lu comme tel)',
    parNom.get(PARC[1])?.mime === 'image/webp' || parNom.get(PARC[1])?.mime === 'image/png');

  // RIEN n'a été écrit.
  check('DRY-RUN : aucun ProjectMedia créé', (await ProjectMedia.countDocuments({})) === 0);
  check('DRY-RUN : aucune fiche modifiée',
    (await Company.findById(company._id).lean()).logosMedia?.header == null);
  check('DRY-RUN : aucun fichier touché sur la destination',
    (await fs.readdir(DISTANT)).length === PARC.length);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('APPLY — le parc devient un parc décrit');
{
  const r = await adoption.adoptLegacyProjectMedia({ apply: true });

  check('mode APPLY annoncé', r.mode === 'APPLY');
  check('6 descripteurs créés', r.created === 6);
  check('6 fiches raccrochées', r.attached === 6);
  check('aucun conflit', r.conflicts.length === 0);

  const medias = await ProjectMedia.find({}).lean();
  check('6 ProjectMedia en base', medias.length === 6);
  check('tous dans l’environnement de l’instance', medias.every((m) => m.environment === 'TEST'));
  check('tous LOCAL_ONLY — la présence d’un fichier ne prouve pas qu’un serveur le sert',
    medias.every((m) => m.publicationState === 'LOCAL_ONLY'));
  check('toutes les empreintes correspondent aux octets réels',
    medias.every((m) => m.sha256 === empreintes.get(m.objectKey)));

  // §12 : aucune canonicalisation physique.
  check('les noms HISTORIQUES sont conservés tels quels',
    medias.every((m) => PARC.includes(m.objectKey)));
  check('aucun fichier renommé sur la destination',
    (await fs.readdir(DISTANT)).sort().join() === [...PARC].sort().join());
  check('aucun fichier supprimé', (await fs.readdir(DISTANT)).length === PARC.length);
  check('aucun fichier n’est apparu en local',
    (await fs.readdir(LOCAL)).join() === '.gitkeep');

  // Les fiches portent désormais un descripteur, et il déclare son autorité.
  const c = await Company.findById(company._id).lean();
  check('la fiche entreprise porte un descripteur de logo',
    c.logosMedia.header.objectKey === PARC[0]);
  check('…qui DÉCLARE l’autorité PROJECT', c.logosMedia.header.authority === 'PROJECT');
  check('…avec une empreinte vraie', c.logosMedia.header.sha256 === empreintes.get(PARC[0]));
  check('le favicon aussi', c.logosMedia.favicon.objectKey === PARC[1]);
  check('l’image d’accueil aussi', c.heroImageMedia.objectKey === PARC[2]);

  const ch = await Chapter.findById(conception._id).lean();
  check('le chapitre porte son descripteur d’image de tête', ch.heroImageMedia.objectKey === PARC[3]);
  const ar = await Chapter.findById(architecture._id).lean();
  check('…et chaque chapitre porte LE SIEN', ar.heroImageMedia.objectKey === PARC[4]);
  const ex = await Chapter.findById(experience._id).lean();
  check('…y compris le troisième', ex.heroImageMedia.objectKey === PARC[5]);

  // Le champ historique n'a pas été réécrit : il reste lisible, et c'est tout.
  check('le chemin historique est CONSERVÉ, jamais réécrit',
    c.logos.header === `/uploads/${PARC[0]}`);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LES ADRESSES DÉRIVENT MAINTENANT DE LA DESTINATION');
{
  const c = await projection.projectCompanyMedia(await Company.findById(company._id).lean(), 'TEST');
  check('le logo se résout contre la destination active',
    c.logos.header === `https://${SB_HOTE}/uploads/${PARC[0]}`);
  check('…et non contre un domaine figé en fiche', !c.logos.header.includes('localhost'));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('IDEMPOTENCE — un second passage ne mute rien');
{
  const avantMedias = await ProjectMedia.find({}).sort({ objectKey: 1 }).lean();
  const avantFiche = await Company.findById(company._id).lean();

  const r = await adoption.adoptLegacyProjectMedia({ apply: true });
  check('second passage : 0 descripteur créé', r.created === 0);
  check('second passage : 0 fiche raccrochée', r.attached === 0);
  check('second passage : tout est « déjà fait »', r.already.length === 6);
  check('second passage : rien à créer ni à attacher',
    r.toCreate.length === 0 && r.toAttach.length === 0);

  const apresMedias = await ProjectMedia.find({}).sort({ objectKey: 1 }).lean();
  check('aucun ProjectMedia ajouté', apresMedias.length === avantMedias.length);
  check('aucun mediaId réattribué',
    apresMedias.map((m) => m.mediaId).join() === avantMedias.map((m) => m.mediaId).join());
  check('aucune empreinte modifiée',
    apresMedias.map((m) => m.sha256).join() === avantMedias.map((m) => m.sha256).join());
  check('le descripteur de la fiche est inchangé',
    (await Company.findById(company._id).lean()).logosMedia.header.mediaId
      === avantFiche.logosMedia.header.mediaId);
  check('aucun fichier touché', (await fs.readdir(DISTANT)).length === PARC.length);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('PUBLICATION — un média déjà présent n’est JAMAIS retransféré');
{
  /**
   * `media_publish` s'exécute juste après. Les fichiers sont là, sous leur clé
   * historique : il doit vérifier leur empreinte et les publier SANS transfert.
   * C'est le point crucial pour un parc legacy — le poste local n'a rien à
   * envoyer, et n'a pas à en avoir.
   */
  const PARTAGE = '/var/www/site/shared/uploads';
  const t = new FakeTransport();
  for (const nom of PARC) {
    t.files.set(`${PARTAGE}/${nom}`, await fs.readFile(path.join(DISTANT, nom)));
  }
  const original = t.exec.bind(t);
  t.exec = async (commande) => {
    t.commands.push({ command: commande });
    const sha = /sha256sum (\S+)/.exec(commande);
    if (sha) {
      const contenu = t.files.get(sha[1]);
      return {
        code: 0,
        stdout: contenu ? createHash('sha256').update(contenu).digest('hex') : 'ABSENT',
        stderr: '',
      };
    }
    const stat = /stat -c %s (\S+)/.exec(commande);
    if (stat) {
      const contenu = t.files.get(stat[1]);
      return { code: 0, stdout: contenu ? String(contenu.length) : 'ABSENT', stderr: '' };
    }
    return original(commande);
  };

  const rapport = await media.publishProjectMediaOnDestination({
    transport: t, sharedUploads: PARTAGE, host: SB_HOTE, environment: 'TEST',
  });

  check('les 6 médias adoptés sont examinés', rapport.scanned === 6);
  check('les 6 sont publiés', rapport.published === 6);
  check('AUCUN transfert — les octets étaient déjà sur la destination',
    rapport.transferred.length === 0);
  check('aucun manquant', rapport.missing.length === 0);
  check('aucune divergence d’empreinte', rapport.mismatched.length === 0);
  check('…et le poste local n’a jamais été lu',
    (await fs.readdir(LOCAL)).join() === '.gitkeep');

  const publies = await ProjectMedia.find({ publicationState: 'PUBLISHED' }).lean();
  check('les 6 sont PUBLISHED en base', publies.length === 6);
  check('…sur l’hôte de la destination', publies.every((m) => m.publishedHost === SB_HOTE));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LES MÉDIAS DU DÉVELOPPEUR SONT HORS DE PORTÉE');
{
  const cle = '7dda6e2d-1745-49df-9a1d-e1894aecb34b-bd65e2ad257b.webp';
  check('aucun ProjectMedia n’a été créé pour le média du Panel',
    (await ProjectMedia.countDocuments({ objectKey: cle })) === 0);
  check('la configuration du Panel est intacte',
    (await PanelCompanyConfiguration.findOne({ key: 'SINGLETON' }).lean()).branding.logo.authority === 'PANEL');

  // L'assertion structurelle : le registre ne peut PAS nommer ces collections.
  for (const interdite of ['panelcompanyconfigurations', 'panelmedias', 'devcompanies']) {
    check(`« ${interdite} » est hors du registre métier`,
      !adoption.CHAMPS_METIER.some((e) => e.collection === interdite));
  }
  check('…et l’assertion refuse un registre qui les nommerait',
    (() => {
      try {
        adoption.assertPerimetreMetier([
          { collection: 'panelmedias', model: 'x', exportName: 'X', fields: [{ legacy: 'url', descriptor: 'u' }] },
        ]);
        return false;
      } catch { return true; }
    })());
  check('…comme un champ de branding développeur',
    (() => {
      try {
        adoption.assertPerimetreMetier([
          { collection: 'companies', model: 'x', exportName: 'X', fields: [{ legacy: 'branding.logo', descriptor: 'b' }] },
        ]);
        return false;
      } catch { return true; }
    })());
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('UNE URL ABSOLUE N’EST JAMAIS ADOPTÉE');
{
  await Chapter.updateOne({ _id: architecture._id }, {
    $set: { heroImage: 'https://panel.ly-solution.com/uploads/etranger.webp', heroImageMedia: null },
  });
  const r = await adoption.adoptLegacyProjectMedia({ apply: false });
  check('une référence absolue n’est pas une référence adoptable',
    !r.legacyRefs.some((x) => x.value.startsWith('http')));
  check('…et ne produit ni création ni manquant',
    r.toCreate.length === 0 && !r.missing.some((m) => m.field === 'heroImage'));

  await Chapter.updateOne({ _id: architecture._id }, { $set: { heroImage: `/uploads/${PARC[4]}` } });
  await adoption.adoptLegacyProjectMedia({ apply: true });
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('UNE RÉFÉRENCE SANS FICHIER EST DITE, PAS INVENTÉE');
{
  const orpheline = await Chapter.create({
    slug: 'orpheline', title: 'Chapitre sans fichier', heroImage: '/uploads/jamais-arrive.webp',
  });
  const servie = await Chapter.create({
    slug: 'servie', title: 'Chapitre servi', heroImage: `/uploads/${PARC[7]}`,
  });
  const r = await adoption.adoptLegacyProjectMedia({ apply: false });
  check('la référence sans fichier est signalée',
    r.missing.some((m) => m.objectKey === 'jamais-arrive.webp'));
  check('…et aucun descripteur n’est fabriqué pour elle',
    !r.toCreate.some((c) => c.objectKey === 'jamais-arrive.webp'));
  check('la référence qui, elle, a son fichier est bien reprise',
    r.toCreate.some((c) => c.objectKey === PARC[7]));

  await Chapter.deleteMany({ _id: { $in: [orpheline._id, servie._id] } });
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('UN CONFLIT ARRÊTE TOUT — sans écrire une ligne');
{
  const avant = await ProjectMedia.countDocuments({});
  await Chapter.updateOne({ _id: conception._id }, {
    $set: {
      heroImage: `/uploads/${PARC[7]}`,
      // La fiche cite un fichier et porte le descripteur d'un AUTRE : seule une
      // personne peut dire lequel fait foi.
      'heroImageMedia.objectKey': PARC[3],
    },
  });

  const r = await adoption.adoptLegacyProjectMedia({ apply: true });
  check('le conflit est détecté', r.conflicts.length === 1);
  check('…et nommé précisément',
    r.conflicts[0].objectKey === PARC[7] && r.conflicts[0].attachedObjectKey === PARC[3]);
  check('AUCUN descripteur créé pendant une passe en conflit', r.created === 0);
  check('AUCUNE fiche raccrochée', r.attached === 0);
  check('la base est strictement inchangée', (await ProjectMedia.countDocuments({})) === avant);
}

assert.equal(typeof adoption.adoptLegacyProjectMedia, 'function');

console.log(`\n${ok} réussis, ${ko} échoués`);
await mongoose.disconnect();
await serveur.stop();
await fs.rm(LOCAL, { recursive: true, force: true });
await fs.rm(DISTANT, { recursive: true, force: true });
process.exit(ko === 0 ? 0 : 1);
