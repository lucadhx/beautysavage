// CROSS_AUTHORITY_MEDIA_DEPLOYMENT — deux autorités, jamais mélangées.
//
// ══ L'INCIDENT REPRODUIT ════════════════════════════════════════════════════
//
// Le média réel du 07/08 :
//
//   mediaId    7dda6e2d-1745-49df-9a1d-e1894aecb34b
//   objectKey  7dda6e2d-1745-49df-9a1d-e1894aecb34b-bd65e2ad257b.webp
//   autorité   PANEL
//   hôte       panel.ly-solution.com
//
// était transformé, à la lecture, en :
//
//   https://demo-sbauto06.ly-solution.com/uploads/7dda…-bd65e2ad257b.webp   → 404
//
// La cause tenait en une ligne : `if (descriptor?.objectKey)`. Cette condition
// confond « possède une clé d'objet » avec « appartient au projet ». Le Panel
// décrit les siens exactement de la même façon.
//
// ══ CE QUE CE TEST PROUVE ═══════════════════════════════════════════════════
//
// Que l'autorité est LUE, jamais déduite ; qu'un média du Panel garde l'hôte du
// Panel de bout en bout ; qu'un média du projet suit la destination active ; et
// qu'aucun repli ne fait passer l'un pour l'autre.
import { strict as assert } from 'node:assert';

process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'TEST';

const { MongoMemoryServer } = await import('mongodb-memory-server');
const mongoose = (await import('mongoose')).default;
const os = await import('node:os');
const path = await import('node:path');
const fs = await import('node:fs/promises');

const serveur = await MongoMemoryServer.create();
process.env.MONGODB_URI = serveur.getUri();
await mongoose.connect(serveur.getUri(), { dbName: 'cross-authority' });

const DOSSIER = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-cross-authority-'));
const { config } = await import('../config/env.js');
config.paths = { ...(config.paths ?? {}), uploads: DOSSIER };
config.env = 'TEST';

const { ProjectMedia } = await import('../models/ProjectMedia.model.js');
const { DeploymentTarget } = await import('../models/DeploymentTarget.model.js');
const { PanelCompanyConfiguration } = await import('../models/PanelConfiguration.model.js');
const autorite = await import('../services/media/mediaAuthority.js');
const projection = await import('../services/media/mediaProjection.service.js');
const projectMedia = await import('../services/media/projectMedia.service.js');
const { checkPublicMedia } = await import('../deployment-engine/health.js');
const { FakeTransport } = await import('../deployment-engine/transport/FakeTransport.js');

let ok = 0;
let ko = 0;
const check = (libelle, condition) => {
  if (condition) { ok += 1; console.log(`  ✓ ${libelle}`); }
  else { ko += 1; console.log(`  ✗ ${libelle}`); }
};
const section = (t) => console.log(`\n${t}`);

await DeploymentTarget.init();

/* ══ LES DEUX MÉDIAS RÉELS ══════════════════════════════════════════════════ */

const PANEL_HOTE = 'panel.ly-solution.com';
const SB_HOTE = 'demo-sbauto06.ly-solution.com';

/** Le média du 07/08, à l'identique. */
const MEDIA_PANEL = {
  authority: 'PANEL',
  mediaId: '7dda6e2d-1745-49df-9a1d-e1894aecb34b',
  objectKey: '7dda6e2d-1745-49df-9a1d-e1894aecb34b-bd65e2ad257b.webp',
  url: `https://${PANEL_HOTE}/uploads/7dda6e2d-1745-49df-9a1d-e1894aecb34b-bd65e2ad257b.webp`,
  environment: 'TEST',
  publicationState: 'PUBLISHED',
  sha256: 'b'.repeat(64),
  mime: 'image/webp',
  size: 4321,
  width: 200,
  height: 80,
  version: 3,
  updatedAt: '2026-08-07T09:00:00.000Z',
};

const CLE_PROJET = 'garage.webp';

await DeploymentTarget.create({
  name: 'SB Auto TEST', url: `https://${SB_HOTE}`, host: SB_HOTE,
  type: 'domain', environment: 'TEST', backendPort: 5002,
  lifecycleStatus: 'ACTIVE', state: 'DEPLOYED', lastDeployedAt: new Date(),
});

const mediaProjet = await ProjectMedia.create({
  mediaId: 'aaaaaaaa-1111-2222-3333-444444444444',
  mediaType: 'logo',
  environment: 'TEST',
  publicationState: 'PUBLISHED',
  publishedHost: SB_HOTE,
  objectKey: CLE_PROJET,
  path: `/uploads/${CLE_PROJET}`,
  mime: 'image/webp',
  size: 1234,
  width: 100,
  height: 40,
  sha256: 'a'.repeat(64),
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const DESCRIPTEUR_PROJET = projectMedia.stableDescriptorOf(mediaProjet.toObject());

/* ══════════════════════════════════════════════════════════════════════════ */
section('L’AUTORITÉ EST LUE, JAMAIS DÉDUITE');
{
  check('un descripteur PANEL est reconnu PANEL',
    autorite.authorityOf(MEDIA_PANEL) === 'PANEL');
  check('un descripteur PROJECT est reconnu PROJECT',
    autorite.authorityOf(DESCRIPTEUR_PROJET) === 'PROJECT');

  // La clé d'objet ne dit RIEN de l'autorité : les deux en portent une.
  check('les deux descripteurs portent une clé d’objet',
    Boolean(MEDIA_PANEL.objectKey) && Boolean(DESCRIPTEUR_PROJET.objectKey));
  check('…et pourtant leurs autorités diffèrent',
    autorite.authorityOf(MEDIA_PANEL) !== autorite.authorityOf(DESCRIPTEUR_PROJET));

  // Aucune déduction depuis l'hôte, le type métier ou l'identifiant.
  const sansAutorite = { ...MEDIA_PANEL, authority: undefined };
  check('sans autorité déclarée ni contexte : INCONNUE (fail closed)',
    autorite.authorityOf(sansAutorite) === null);
  check('…et la résolution rend null, jamais une adresse approchante',
    (await autorite.resolveMediaUrl(sansAutorite, { environment: 'TEST' })).url === null);
  check('…avec une raison explicite',
    (await autorite.resolveMediaUrl(sansAutorite, { environment: 'TEST' })).reason === 'AUTORITE_INCONNUE');

  // La compatibilité de lecture vient du SCHÉMA du champ, déclaré par l'appelant.
  check('compatibilité legacy : le contexte du champ donne l’autorité',
    autorite.authorityOf(sansAutorite, { legacyAuthority: 'PROJECT' }) === 'PROJECT');
  check('…et une autorité DÉCLARÉE l’emporte toujours sur le contexte',
    autorite.authorityOf(MEDIA_PANEL, { legacyAuthority: 'PROJECT' }) === 'PANEL');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LE MÉDIA 7dda… GARDE L’HÔTE DU PANEL');
{
  const r = await autorite.resolveMediaUrl(MEDIA_PANEL, { environment: 'TEST' });
  check('l’adresse rendue est exactement celle publiée par le Panel',
    r.url === MEDIA_PANEL.url);
  check('…c’est-à-dire l’hôte du Panel', new URL(r.url).hostname === PANEL_HOTE);
  check('…et JAMAIS le domaine de SB Auto', !String(r.url).includes(SB_HOTE));

  // Le cœur de l'incident : la destination ACTIVE de SB Auto existe, est
  // DEPLOYED, et ne doit pourtant rien changer à cette adresse.
  const destination = await projectMedia.activeProjectDestination('TEST');
  check('une destination SB Auto active existe bien pendant ce test',
    destination?.host === SB_HOTE);
  check('…et l’adresse du média Panel n’en dépend pas',
    (await autorite.resolveMediaUrl(MEDIA_PANEL, { environment: 'TEST' })).url === MEDIA_PANEL.url);

  // Aucun ProjectMedia n'a été créé au passage.
  check('aucun ProjectMedia créé pour le média du Panel',
    (await ProjectMedia.countDocuments({ objectKey: MEDIA_PANEL.objectKey })) === 0);
  check('…et aucun fichier déposé dans les médias du projet',
    (await fs.readdir(DOSSIER)).length === 0);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LE MÉDIA DU PROJET SUIT LA DESTINATION ACTIVE');
{
  const r = await autorite.resolveMediaUrl(DESCRIPTEUR_PROJET, { environment: 'TEST' });
  check('l’adresse est composée contre la destination de SB Auto',
    r.url === `https://${SB_HOTE}/uploads/${CLE_PROJET}`);
  check('…et jamais contre le Panel', !String(r.url).includes(PANEL_HOTE));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('AUCUN REPLI D’UNE AUTORITÉ SUR L’AUTRE');
{
  // Un média PANEL non publié n'est PAS rattrapé par une résolution projet.
  const local = { ...MEDIA_PANEL, publicationState: 'LOCAL_ONLY' };
  const r1 = await autorite.resolveMediaUrl(local, { environment: 'TEST' });
  check('PANEL non publié → refusé', r1.url === null && r1.reason === 'PANEL_NON_PUBLIE');
  check('…et surtout PAS recomposé contre SB Auto', !String(r1.url ?? '').includes(SB_HOTE));

  // Une adresse en clair hors boucle locale est refusée (Mixed Content).
  const clair = { ...MEDIA_PANEL, url: `http://${PANEL_HOTE}/uploads/x.webp` };
  check('PANEL sans TLS → refusé',
    (await autorite.resolveMediaUrl(clair, { environment: 'TEST' })).reason === 'PANEL_SANS_TLS');

  // Un média PANEL d'un autre environnement ne traverse pas la frontière.
  const prod = { ...MEDIA_PANEL, environment: 'PROD' };
  check('PANEL d’un autre environnement → refusé',
    (await autorite.resolveMediaUrl(prod, { environment: 'TEST' })).reason === 'ENVIRONNEMENT_DIFFERENT');

  // Et symétriquement : un descripteur projet n'emprunte jamais l'URL du Panel.
  const hybride = { ...DESCRIPTEUR_PROJET, url: MEDIA_PANEL.url };
  const r2 = await autorite.resolveMediaUrl(hybride, { environment: 'TEST' });
  check('PROJECT porteur d’une URL de Panel → l’URL est IGNORÉE',
    r2.url === `https://${SB_HOTE}/uploads/${CLE_PROJET}`);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LA PROJECTION DES FICHES NE CONFOND PLUS LES DEUX');
{
  // La fiche entreprise porte un descripteur PROJET (c'est ce que son schéma
  // autorise) : il se résout contre SB Auto.
  const fiche = await projection.projectCompanyMedia({
    name: 'Garage', logos: { header: '/uploads/ancien.webp' },
    logosMedia: { header: DESCRIPTEUR_PROJET },
  }, 'TEST');
  check('logo métier → domaine SB Auto',
    fiche.logos.header === `https://${SB_HOTE}/uploads/${CLE_PROJET}`);

  // Le même champ, s'il portait par accident un descripteur PANEL, garderait
  // l'hôte du Panel — c'est précisément la ligne qui manquait.
  const accident = await projection.projectCompanyMedia({
    name: 'Garage', logos: { header: '/uploads/ancien.webp' },
    logosMedia: { header: MEDIA_PANEL },
  }, 'TEST');
  check('descripteur PANEL dans une fiche → hôte du Panel conservé',
    accident.logos.header === MEDIA_PANEL.url);
  check('…jamais réécrit vers SB Auto', !accident.logos.header.includes(SB_HOTE));

  // Le bloc d'affichage nomme l'autorité : un écran doit pouvoir expliquer
  // pourquoi une adresse ne bouge pas quand la destination change.
  const bloc = await projection.companyMediaResolution({
    logos: { header: '' }, logosMedia: { header: DESCRIPTEUR_PROJET },
  }, 'TEST');
  check('le bloc de résolution publie l’autorité',
    bloc['logos.header'].authority === 'PROJECT');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LE BLOC DÉVELOPPEUR REFUSE UN MÉDIA DU PROJET');
{
  await PanelCompanyConfiguration.deleteMany({});
  await PanelCompanyConfiguration.create({
    key: 'SINGLETON', companyId: '11111111-1111-1111-1111-111111111111', slug: 'agence',
    environment: 'TEST', version: 2,
    identity: { name: 'L.Y Solution' },
    branding: { logo: MEDIA_PANEL },
    domains: { websiteUrl: 'https://ly-solution.com' },
  });

  const { getPublishedDeveloperIdentity } = await import('../services/panelConfiguration/developerIdentity.service.js');
  const identite = await getPublishedDeveloperIdentity();
  check('le logo développeur garde l’hôte du Panel', identite.logoUrl === MEDIA_PANEL.url);
  check('…et son descripteur DÉCLARE l’autorité PANEL', identite.logo.authority === 'PANEL');

  // Un descripteur qui se déclarerait PROJECT dans le branding du Panel est une
  // violation de contrat : refusée, pas corrigée en silence.
  await PanelCompanyConfiguration.updateOne({ key: 'SINGLETON' }, {
    $set: { branding: { logo: { ...MEDIA_PANEL, authority: 'PROJECT' } } },
  });
  const viole = await getPublishedDeveloperIdentity();
  check('descripteur PROJECT dans le branding Panel → REFUSÉ', viole.logo === null);
  check('…et aucun repli sur les médias du client', viole.logoUrl === null);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LE HEALTHCHECK TESTE L’ADRESSE EXPOSÉE, PAS UNE ADRESSE RECOMPOSÉE');
{
  /**
   * Un vrai serveur : le Panel sert son média, SB Auto sert le sien, et
   * AUCUN des deux ne sert celui de l'autre. Un contrôle qui recomposerait
   * l'adresse obtiendrait donc un 404 — exactement l'échec du 07/08.
   */
  const RELATIF = '/uploads/hero-relatif.webp';
  const t = new FakeTransport();
  const servis = new Set([
    MEDIA_PANEL.url,
    `https://${SB_HOTE}/uploads/${CLE_PROJET}`,
    `https://${SB_HOTE}${RELATIF}`,
    `https://manager.${SB_HOTE}${RELATIF}`,
  ]);
  const sondes = [];
  t.exec = async (commande) => {
    t.commands.push({ command: commande });
    if (commande.includes('/api/public/bootstrap')) {
      // Une projection RÉELLE : le logo métier résolu en absolu contre la
      // destination, le logo développeur en absolu contre le Panel, et un champ
      // encore relatif (aucune destination ne le servait à l'écriture).
      return {
        code: 0,
        stdout: JSON.stringify({
          company: { logos: { header: `https://${SB_HOTE}/uploads/${CLE_PROJET}` }, heroImage: RELATIF },
          developer: { logo: { authority: 'PANEL', url: MEDIA_PANEL.url } },
        }),
        stderr: '',
      };
    }
    const url = /'(https:\/\/[^']+)'/.exec(commande)?.[1];
    if (url) {
      sondes.push(url);
      return { code: 0, stdout: servis.has(url) ? '200 image/webp' : '404 text/html', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  const rapport = await checkPublicMedia(t, SB_HOTE, {
    origins: [{ label: 'vitrine', host: SB_HOTE }, { label: 'manager', host: `manager.${SB_HOTE}` }],
  });

  check('le contrôle a bien sondé', rapport.probed && rapport.reachable);
  check('l’adresse du Panel a été testée TELLE QUELLE',
    sondes.includes(MEDIA_PANEL.url));
  check('…et jamais recomposée contre SB Auto',
    !sondes.some((u) => u === `https://${SB_HOTE}/uploads/${MEDIA_PANEL.objectKey}`));
  check('…ni contre aucune autre origine servie',
    !sondes.some((u) => u.includes(MEDIA_PANEL.objectKey) && !u.includes(PANEL_HOTE)));
  check('…et testée UNE seule fois, pas une par origine',
    sondes.filter((u) => u === MEDIA_PANEL.url).length === 1);

  // Le média métier, exposé en ABSOLU, est lui aussi testé sur son propre hôte.
  check('le média métier absolu est testé sur son hôte',
    sondes.filter((u) => u === `https://${SB_HOTE}/uploads/${CLE_PROJET}`).length === 1);
  check('…et jamais porté sur l’origine du Panel',
    !sondes.includes(`https://${PANEL_HOTE}/uploads/${CLE_PROJET}`));

  // Un chemin RELATIF, lui, se charge relativement à chaque origine servie :
  // c'est ainsi qu'un navigateur le résout, et le contrôle doit le refléter.
  check('un chemin relatif est testé depuis CHAQUE origine',
    sondes.filter((u) => u.endsWith(RELATIF)).length === 2);

  check('aucun média cassé', rapport.brokenCount === 0 && rapport.ok === true);
  check('l’adresse absolue est rapportée sous son propre hôte',
    rapport.checked.some((c) => c.absolute && Object.keys(c.origins)[0] === PANEL_HOTE));

  /**
   * LA RÉGRESSION ELLE-MÊME : si le Panel ne servait plus ce média, le contrôle
   * doit le voir — mais en interrogeant le PANEL, jamais SB Auto.
   */
  servis.delete(MEDIA_PANEL.url);
  const casse = await checkPublicMedia(t, SB_HOTE, {
    origins: [{ label: 'vitrine', host: SB_HOTE }],
  });
  check('un média Panel réellement absent est détecté', casse.ok === false && casse.brokenCount === 1);
  check('…et c’est bien l’adresse du Panel qui est incriminée',
    casse.checked.some((c) => !c.ok && c.path === MEDIA_PANEL.url));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('MATRICE AUTORITÉ × ENVIRONNEMENT — aucun croisement');
{
  await DeploymentTarget.deleteMany({});
  const hotes = { TEST: SB_HOTE, PROD: 'sbauto06.ly-solution.com' };
  for (const env of ['TEST', 'PROD']) {
    await DeploymentTarget.create({
      name: `SB ${env}`, url: `https://${hotes[env]}`, host: hotes[env],
      type: 'domain', environment: env, backendPort: env === 'PROD' ? 5003 : 5002,
      lifecycleStatus: 'ACTIVE', state: 'DEPLOYED', lastDeployedAt: new Date(),
    });
  }

  for (const env of ['TEST', 'PROD']) {
    const panel = { ...MEDIA_PANEL, environment: env };
    const r = await autorite.resolveMediaUrl(panel, { environment: env });
    check(`PANEL + ${env} → hôte du Panel`, new URL(r.url).hostname === PANEL_HOTE);

    await ProjectMedia.updateOne({ objectKey: CLE_PROJET }, { $set: { environment: env } });
    const projet = { ...DESCRIPTEUR_PROJET, environment: env };
    const rp = await autorite.resolveMediaUrl(projet, { environment: env });
    check(`PROJECT + ${env} → hôte de SB Auto (${hotes[env]})`,
      new URL(rp.url).hostname === hotes[env]);

    const autre = env === 'TEST' ? 'PROD' : 'TEST';
    check(`PANEL ${env} lu depuis ${autre} → refusé`,
      (await autorite.resolveMediaUrl(panel, { environment: autre })).url === null);
    check(`PROJECT ${env} lu depuis ${autre} → refusé`,
      (await autorite.resolveMediaUrl(projet, { environment: autre })).url === null);
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('SB AUTO EN LOCAL — le proxy /uploads ne détourne pas un média Panel');
{
  await DeploymentTarget.deleteMany({});
  // Aucune destination : le projet n'est déployé nulle part. Ses propres médias
  // deviennent des chemins locaux ; ceux du Panel, non.
  const rp = await autorite.resolveMediaUrl(
    { ...DESCRIPTEUR_PROJET, environment: 'TEST' }, { environment: 'TEST' },
  );
  check('média du projet en local → chemin relatif servi par ce backend',
    rp.url === `/uploads/${CLE_PROJET}` && rp.absolute === false);

  const rpanel = await autorite.resolveMediaUrl(MEDIA_PANEL, { environment: 'TEST' });
  check('média du Panel en local → toujours l’URL absolue du Panel',
    rpanel.url === MEDIA_PANEL.url);
  check('…jamais transformé en /uploads/… servi par SB Auto localhost',
    !String(rpanel.url).startsWith('/uploads/'));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('CHANGEMENT DE DESTINATION — le Panel ne bouge pas');
{
  const NOUVEAU = 'sbauto06-v2.ly-solution.com';
  await DeploymentTarget.deleteMany({});
  await DeploymentTarget.create({
    name: 'SB Auto TEST v2', url: `https://${NOUVEAU}`, host: NOUVEAU,
    type: 'domain', environment: 'TEST', backendPort: 5004,
    lifecycleStatus: 'ACTIVE', state: 'DEPLOYED', lastDeployedAt: new Date(),
  });

  const rp = await autorite.resolveMediaUrl(
    { ...DESCRIPTEUR_PROJET, environment: 'TEST' }, { environment: 'TEST' },
  );
  check('le média du projet suit la NOUVELLE destination',
    rp.url === `https://${NOUVEAU}/uploads/${CLE_PROJET}`);
  check('…sans qu’aucune fiche ait été réécrite',
    DESCRIPTEUR_PROJET.objectKey === CLE_PROJET);

  const rpanel = await autorite.resolveMediaUrl(MEDIA_PANEL, { environment: 'TEST' });
  check('le média du Panel est INCHANGÉ par le changement de destination',
    rpanel.url === MEDIA_PANEL.url);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LES IMAGES D’UN CHAPITRE SONT DES MÉDIAS COMME LES AUTRES');
{
  /**
   * ══ LE CONTRAT TENU ICI ═══════════════════════════════════════════════════
   *
   * Tout média métier passe par LE MÊME résolveur : descripteur d'abord,
   * ancienne chaîne en repli, adresse dérivée à la lecture. Le défaut que
   * cette section garde fermé n'a rien de théorique — une image de galerie
   * était autrefois le SEUL média à ne jamais lui être soumise, et elle
   * sortait en `/uploads/…` brut. Un lecteur qui n'est pas l'autorité média —
   * un Manager de développement, dont le backend local ne détient aucun octet
   * — la demandait alors à son propre dossier, vide, et l'image s'affichait
   * cassée sans que rien ne dise pourquoi.
   *
   * Les galeries de catégorie ont disparu avec le catalogue ; ce qui reste à
   * garder est la RÈGLE, sur les médias que ce projet porte réellement :
   * l'image de tête d'un chapitre, et celles de ses volets.
   */
  /**
   * L'ATTENDU EST DÉRIVÉ DU RÉSOLVEUR, PAS ÉPELÉ.
   *
   * Une section précédente a déplacé la destination : épeler un hôte ici
   * ferait échouer la garde pour une raison qui n'est pas la sienne.
   */
  const { url: ADRESSE } = await autorite.resolveMediaUrl(DESCRIPTEUR_PROJET, { environment: 'TEST' });

  const chapitre = await projection.projectChapterMedia({
    slug: 'conception',
    title: 'Conception',
    heroImage: '/uploads/ancienne-tete.webp',
    heroImageMedia: DESCRIPTEUR_PROJET,
    items: [
      { title: 'Identité', image: '/uploads/ancien-chemin.webp', imageMedia: DESCRIPTEUR_PROJET, order: 10 },
      { title: 'Direction', image: `/uploads/${CLE_PROJET}`, imageMedia: null, order: 20 },
    ],
  }, 'TEST');

  check('l’image de tête PORTANT un descripteur est résolue',
    chapitre.heroImage === ADRESSE);
  check('l’image d’un volet aussi', chapitre.items[0]?.image === ADRESSE);
  check('…et l’ancienne chaîne passe par le résolveur commun (repli)',
    chapitre.items[1]?.image === await projection.resolveOne(null, `/uploads/${CLE_PROJET}`, 'TEST'));
  check('l’ordre des volets est préservé',
    chapitre.items[0]?.order === 10 && chapitre.items[1]?.order === 20);

  /**
   * UN VOLET DONT L'IMAGE NE RÉSOUT PAS GARDE SON OBJET, et perd seulement son
   * adresse. Le retirer ferait disparaître SON TEXTE — qui, lui, était bon.
   * C'est l'inverse du choix fait pour une galerie, où une entrée sans image
   * n'est plus rien.
   */
  const troue = await projection.projectChapterMedia({
    slug: 'x', title: 'X', items: [{ title: 'Sans image', image: '', imageMedia: null, order: 10 }],
  }, 'TEST');
  check('un volet sans image garde son titre et perd son adresse',
    troue.items.length === 1 && troue.items[0].title === 'Sans image' && troue.items[0].image === '');

  /** Un chapitre sans volet ne doit pas casser la projection. */
  const nu2 = await projection.projectChapterMedia({ slug: 'y', title: 'Sans volet' }, 'TEST');
  check('un chapitre sans volet se projette sans lever',
    Array.isArray(nu2.items) && nu2.items.length === 0);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('L’ÉCRAN DIT CE QUE L’IMAGE REPRÉSENTE — sinon l’import est refusé');
{
  const fsSync = await import('node:fs');
  const url = await import('node:url');
  const racine = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '../../../manager/src');
  const lire = (rel) => fsSync.readFileSync(path.join(racine, rel), 'utf8');

  /**
   * LE TYPE MÉTIER EST TRANSMIS À L'IMPORT — écran par écran.
   *
   * `GalleryManager` a disparu avec les écrans de catalogue qui l'utilisaient.
   * Ce qui reste à garder est la RÈGLE, pas le composant : tout appel à
   * `ImageUpload` nomme ce que l'image REPRÉSENTE. Un défaut sur ce paramètre
   * est ce qui avait produit six mille médias `other` — on vérifie donc qu'il
   * n'en existe aucun, et que chaque écran déclare le sien.
   */
  const upload = lire('components/fields/ImageUpload.tsx');
  check('`mediaType` est EXIGÉ, sans valeur par défaut',
    /mediaType: MediaType;/.test(upload) && !/mediaType\s*=\s*['`]/.test(upload));
  check('…et le descripteur rendu par l’import remonte au parent',
    /descriptor: StoredMediaDescriptor \| null/.test(upload));

  /**
   * UN ÉCRAN PEUT DÉCLARER PLUSIEURS TYPES, et c'est même souhaitable.
   *
   * La fiche d'une page éditoriale importe des images de bloc (`page-image`,
   * 1920 px) ET des portraits de son bloc « équipe » (`team-photo`, 800 px).
   * Les servir tous en `page-image` ferait peser un portrait quatre fois son
   * utilité sur une page qui en aligne cinq — et le type dit ce que l'image
   * REPRÉSENTE, pas quel écran l'a envoyée.
   */
  const ecrans = [
    ['pages/CompanyPage.tsx', 'company-logo'],
    ['pages/SitePageEditPage.tsx', 'page-image'],
    ['pages/SitePageEditPage.tsx', 'team-photo'],
    ['pages/ChapterEditPage.tsx', 'chapter-image'],
    ['pages/HomeContentPage.tsx', 'page-image'],
    ['pages/HomeContentPage.tsx', 'hero'],
  ];
  for (const [fichier, type] of ecrans) {
    check(`${fichier} déclare \`${type}\``, new RegExp(`mediaType="${type}"`).test(lire(fichier)));
  }
}

assert.equal(typeof autorite.resolveMediaUrl, 'function');

console.log(`\n${ok} réussis, ${ko} échoués`);
await mongoose.disconnect();
await serveur.stop();
await fs.rm(DOSSIER, { recursive: true, force: true });
process.exit(ko === 0 ? 0 : 1);
