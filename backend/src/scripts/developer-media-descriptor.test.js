/**
 * DESCRIPTEURS MÉDIA DU DÉVELOPPEUR — ce que le projet fait de ce qu'il reçoit.
 *
 * ── LE DÉFAUT TRAITÉ ────────────────────────────────────────────────────────
 * Le pont ne transportait qu'une URL. Ce projet ne pouvait donc savoir ni si
 * l'image avait changé (aucune empreinte), ni son type réel, ni ses dimensions
 * — donc pas moyen de réserver la place et d'éviter le saut de mise en page —,
 * ni si la projection reçue était plus récente que celle déjà appliquée. Il ne
 * pouvait que recharger l'adresse et espérer.
 *
 * ── CE QUE CETTE SUITE VERROUILLE ───────────────────────────────────────────
 *  · le descripteur est CONSOMMÉ, jamais reconstruit à partir d'une URL ;
 *  · le fichier n'est JAMAIS recopié ici : le Panel reste l'autorité ;
 *  · une suppression publiée efface réellement l'ancien descripteur ;
 *  · une projection ANTÉRIEURE est refusée ;
 *  · un autre environnement est refusé ;
 *  · Panel hors ligne : la dernière projection persistée reste utilisable ;
 *  · média absent : aucun repli sur les médias du client.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'devmedia_test';
process.env.DB_PROD = 'devmedia_prod';
process.env.JWT_SECRET = 'test-secret-jwt-long-enough-32chars!!';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
process.env.PANEL_SCHEDULER_ENABLED = 'false';

let pass = 0;
let fail = 0;
const check = (nom, ok) => {
  if (ok) { pass += 1; console.log(`  ✓ ${nom}`); } else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (t) => console.log(`\n${t}`);

const mongoose = (await import('mongoose')).default;
await mongoose.connect(process.env.MONGODB_URI, { dbName: 'devmedia_test' });

const { PanelCompanyConfiguration } = await import('../models/PanelConfiguration.model.js');
const { applyCompanyProfile } = await import('../services/panelConfiguration/panelConfiguration.service.js');
const { getPublishedDeveloperIdentity } =
  await import('../services/panelConfiguration/developerIdentity.service.js');
const { mediaDescriptorSchema, companyProfileSchema } =
  await import('../services/panelBridge/bridgeContract.js');

const LOGO = {
  mediaId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  url: 'https://panel.ly-solution.com/uploads/logo-1.webp',
  mime: 'image/webp',
  size: 4210,
  width: 512,
  height: 128,
  sha256: 'a'.repeat(64),
  version: 1,
  updatedAt: '2026-08-06T09:00:00.000Z',
  role: 'logo',
};

const PORTRAIT = {
  ...LOGO,
  mediaId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',
  url: 'https://panel.ly-solution.com/uploads/team-1.webp',
  sha256: 'b'.repeat(64),
  width: 256,
  height: 256,
  role: 'team-photo',
};

/** Une publication du Panel, telle qu'elle arrive sur le pont. */
const profil = (patch = {}) => ({
  companyId: '11111111-1111-4111-8111-111111111111',
  slug: 'ly-solution',
  environment: 'TEST',
  version: 1,
  identity: { name: 'L.Y Solution' },
  branding: { logoUrl: LOGO.url, logo: LOGO, faviconUrl: null, favicon: null },
  domains: { websiteUrl: 'https://ly-solution.com' },
  references: [],
  team: [{
    firstName: 'Ada', lastName: 'L', role: 'Dev', email: null, phone: null,
    photoUrl: PORTRAIT.url, photo: PORTRAIT, active: true, order: 0, references: [],
  }],
  ...patch,
});

/* ══════════════════════════════════════════════════════════════════════════ */
section('CONTRAT — le descripteur est décrit, pas deviné');
{
  check('un descripteur complet est conforme',
    mediaDescriptorSchema.safeParse(LOGO).success === true);
  check('une URL relative est refusée',
    mediaDescriptorSchema.safeParse({ ...LOGO, url: '/uploads/logo.webp' }).success === false);
  check('un descripteur réduit à son URL reste conforme (média externe)',
    mediaDescriptorSchema.safeParse({ url: 'https://cdn.test/x.png' }).success === true);
  check('une charge utile portant des descripteurs reste conforme au contrat',
    companyProfileSchema.safeParse(profil()).success === true);
  check('…et une charge utile SANS descripteur l’est tout autant (Panel antérieur)',
    companyProfileSchema.safeParse(profil({
      branding: { logoUrl: LOGO.url },
      team: [{ firstName: 'Ada', photoUrl: PORTRAIT.url, active: true, order: 0 }],
    })).success === true);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('APPLICATION — le descripteur est stocké, le fichier ne l’est jamais');
{
  const res = await applyCompanyProfile(profil(), 'SYNC');
  check('la publication est appliquée', res.applied === true);

  const identite = await getPublishedDeveloperIdentity();
  check('le logo est lu depuis le descripteur', identite.logo?.url === LOGO.url);
  check('…avec son empreinte', identite.logo.sha256 === LOGO.sha256);
  check('…son type réel', identite.logo.mime === 'image/webp');
  check('…ses dimensions', identite.logo.width === 512 && identite.logo.height === 128);
  check('…et sa version', identite.logo.version === 1);
  check('l’URL historique reste disponible', identite.logoUrl === LOGO.url);

  check('le portrait d’équipe est lu depuis son descripteur',
    identite.team[0].photo?.sha256 === PORTRAIT.sha256);
  check('…et son URL aussi', identite.team[0].photoUrl === PORTRAIT.url);

  // AUCUNE COPIE : le projet ne stocke que l'adresse, jamais le contenu.
  const doc = await PanelCompanyConfiguration.findOne({ key: 'SINGLETON' }).lean();
  const brut = JSON.stringify(doc);
  check('aucun contenu binaire n’est stocké',
    !/base64|data:image/.test(brut));
  check('l’adresse stockée est celle du PANEL, pas une adresse locale',
    doc.branding.logo.url.startsWith('https://panel.'));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('REMPLACEMENT — une nouvelle image, une nouvelle adresse');
{
  const REMPLACANT = {
    ...LOGO,
    mediaId: 'cccccccc-3333-4333-8333-cccccccccccc',
    url: 'https://panel.ly-solution.com/uploads/logo-2.webp',
    sha256: 'c'.repeat(64),
    version: 1,
  };
  await applyCompanyProfile(profil({
    version: 2, branding: { logoUrl: REMPLACANT.url, logo: REMPLACANT },
  }), 'SYNC');

  const identite = await getPublishedDeveloperIdentity();
  check('le logo remplacé porte une NOUVELLE adresse', identite.logo.url === REMPLACANT.url);
  check('…et une nouvelle empreinte', identite.logo.sha256 !== LOGO.sha256);
  check('…l’ancienne adresse a disparu de la projection',
    identite.logoUrl !== LOGO.url);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('SUPPRESSION — publiée explicitement, elle EFFACE l’ancien descripteur');
{
  await applyCompanyProfile(profil({
    version: 3,
    branding: { logoUrl: null, logo: null, faviconUrl: null, favicon: null },
    team: [{
      firstName: 'Ada', lastName: 'L', role: 'Dev', email: null, phone: null,
      photoUrl: null, photo: null, active: true, order: 0, references: [],
    }],
  }), 'SYNC');

  const identite = await getPublishedDeveloperIdentity();
  check('un logo supprimé disparaît réellement', identite.logo === null);
  check('…y compris son URL historique', identite.logoUrl === null);
  check('un portrait supprimé disparaît lui aussi', identite.team[0].photo === null);
  check('…et son URL', identite.team[0].photoUrl === null);

  // AUCUN REPLI LOCAL : le projet n'a pas de logo de secours à afficher.
  check('aucun repli sur un média du projet', identite.logo === null && identite.logoUrl === null);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('PROJECTION ANTÉRIEURE — une version plus ancienne est refusée');
{
  const res = await applyCompanyProfile(profil({ version: 2 }), 'SYNC');
  check('une version antérieure est refusée', res.applied === false && res.reason === 'OLDER_VERSION');

  const identite = await getPublishedDeveloperIdentity();
  check('…et l’ancienne image ne réapparaît pas', identite.logo === null);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('AUTRE ENVIRONNEMENT — refusé, quelle que soit sa fraîcheur');
{
  const res = await applyCompanyProfile(profil({ version: 99, environment: 'PROD' }), 'SYNC');
  check('une publication d’un autre environnement est refusée',
    res.applied === false && res.reason === 'ENVIRONMENT_MISMATCH');

  const identite = await getPublishedDeveloperIdentity();
  check('…et rien n’a bougé', identite.logo === null);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('PANEL HORS LIGNE — la dernière projection reste utilisable');
{
  await applyCompanyProfile(profil({ version: 10 }), 'SYNC');

  // Aucune connexion n'est ouverte pour lire l'identité : c'est le point.
  const identite = await getPublishedDeveloperIdentity();
  check('l’identité se lit sans aucun accès au Panel', identite.logo?.url === LOGO.url);

  const fs = await import('node:fs/promises');
  const url = await import('node:url');
  const source = await fs.readFile(
    url.fileURLToPath(new URL('../services/panelConfiguration/developerIdentity.service.js', import.meta.url)),
    'utf8',
  );
  check('…et le module ne fait AUCUN appel réseau',
    !/fetch\(|axios|http\.request/.test(source));
  check('…ni aucune écriture de fichier',
    !/writeFile|createWriteStream|copyFile/.test(source));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('MÉDIA ABSENT — une adresse non absolue n’est jamais affichée');
{
  await applyCompanyProfile(profil({
    version: 11,
    branding: { logoUrl: '/uploads/logo.webp', logo: null },
  }), 'SYNC');

  const identite = await getPublishedDeveloperIdentity();
  check('un chemin relatif n’est pas retenu — il pointerait sur le site du client',
    identite.logoUrl === null && identite.logo === null);

  await applyCompanyProfile(profil({
    version: 12,
    branding: { logoUrl: null, logo: { url: 'not-a-url' } },
  }), 'SYNC');
  const suivante = await getPublishedDeveloperIdentity();
  check('un descripteur sans adresse absolue est ignoré', suivante.logo === null);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('VITRINE — le pied de page reçoit le descripteur, pas une supposition');
{
  await applyCompanyProfile(profil({ version: 20 }), 'SYNC');

  const fs = await import('node:fs/promises');
  const url = await import('node:url');
  const controleur = await fs.readFile(
    url.fileURLToPath(new URL('../controllers/public.controller.js', import.meta.url)),
    'utf8',
  );
  check('la vitrine publie le descripteur du logo',
    /logo: logo/.test(controleur) || /logo,/.test(controleur));
  check('…en retombant sur l’URL historique si besoin',
    /urlOnlyDescriptor/.test(controleur));
  check('…et jamais sur un média du client',
    !/company\.logos/.test(controleur.slice(controleur.indexOf('function publicDeveloper'), controleur.indexOf('function descriptorOf'))));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('CACHE — une ancienne image ne peut pas ressusciter');
{
  // Un navigateur qui a mis EN CACHE l'ancienne adresse continue de la
  // détenir : c'est normal, et sans danger, parce que la nouvelle image a une
  // ADRESSE DIFFÉRENTE. Rien ne peut donc réafficher l'ancienne.
  const V1 = { ...LOGO, url: 'https://panel.ly-solution.com/uploads/aaaa-1111.webp', sha256: 'd'.repeat(64) };
  const V2 = { ...LOGO, url: 'https://panel.ly-solution.com/uploads/bbbb-2222.webp', sha256: 'e'.repeat(64) };

  await applyCompanyProfile(profil({ version: 30, branding: { logoUrl: V1.url, logo: V1 } }), 'SYNC');
  const avant = await getPublishedDeveloperIdentity();

  await applyCompanyProfile(profil({ version: 31, branding: { logoUrl: V2.url, logo: V2 } }), 'SYNC');
  const apres = await getPublishedDeveloperIdentity();

  check('la nouvelle version porte une AUTRE adresse', apres.logo.url !== avant.logo.url);
  check('…un cache de l’ancienne adresse ne peut donc rien réafficher',
    apres.logo.url !== V1.url);
  check('…et l’empreinte le confirme', apres.logo.sha256 !== avant.logo.sha256);

  // AUCUN PARAMÈTRE ANTI-CACHE : une adresse qui change sans que l'image
  // change serait un cache qui ne sert jamais.
  check('l’adresse ne porte aucun paramètre temporel',
    !apres.logo.url.includes('?') && !apres.logoUrl.includes('?'));

  const fs = await import('node:fs/promises');
  const url = await import('node:url');
  for (const [libelle, chemin] of [
    ['le service d’identité', '../services/panelConfiguration/developerIdentity.service.js'],
    ['le contrôleur public', '../controllers/public.controller.js'],
  ]) {
    const source = await fs.readFile(
      url.fileURLToPath(new URL(chemin, import.meta.url)), 'utf8',
    );
    check(`${libelle} n’ajoute aucun paramètre anti-cache`,
      !/\?v=|\?t=|cacheBust|Date\.now\(\)/.test(source));
  }

  const carte = await fs.readFile(
    url.fileURLToPath(new URL('../../../manager/src/components/dev/TeamMemberCard.tsx', import.meta.url)),
    'utf8',
  );
  check('le Manager n’ajoute aucun paramètre anti-cache à une photo',
    !/\?v=|\?t=|Date\.now\(\)/.test(carte));
  check('…et n’en conserve aucune URL blob', !/createObjectURL/.test(carte));
  check('…un média absent a un repli propre', /onError=/.test(carte));
}

console.log(`\n${pass} réussis, ${fail} échoués`);
await mongoose.disconnect();
await mongod.stop();
process.exit(fail === 0 ? 0 : 1);
