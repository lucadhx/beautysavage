/**
 * IDENTITÉ DE PROJET ET MIGRATION DES MÉDIAS — ce qui autorise une copie.
 *
 * ── LE DÉFAUT QUI A COÛTÉ HUIT MÉDIAS ───────────────────────────────────────
 * Un projet change de domaine. Sa base le suit, ses fichiers persistants non :
 * ils restent dans le `shared/uploads` de l'ancienne destination. La nouvelle
 * vitrine référençait huit médias qui n'existaient pas chez elle et répondait
 * 404 sur chacun.
 *
 * La tentation était de rapprocher les deux destinations automatiquement —
 * même base, domaines proches, même serveur. Ces contrôles verrouillent le
 * refus de cette facilité : deux projets distincts peuvent partager les trois,
 * et une copie faite à tort déplacerait les médias d'un client chez un autre.
 *
 * Ce qui est vérifié ici : la parenté est déclarée, jamais déduite ; la copie
 * ne détruit rien ; elle se rejoue sans effet ; et un désaccord de contenu
 * arrête tout au lieu de trancher en silence.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'identity_test';
process.env.DB_PROD = 'identity_prod';
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
await mongoose.connect(process.env.MONGODB_URI, { dbName: 'identity_test' });

const { DeploymentTarget } = await import('../models/DeploymentTarget.model.js');
const { ProjectIdentity } = await import('../models/ProjectIdentity.model.js');
const { DeploymentLocationHistory } = await import('../models/DeploymentLocationHistory.model.js');
const identity = await import('../services/projectIdentity.service.js');
const { migrateUploads, inventoryUploads, assertUploadsPath } = await import('../deployment-engine/uploads.js');

/**
 * Crée une destination minimale, sans identité.
 *
 * `environment` est OBLIGATOIRE sur le modèle, et ce n'est pas une formalité :
 * la destination porte son environnement, il n'est jamais choisi au moment de
 * déployer. Ces fixtures le laissaient vide — elles précédaient l'invariant —
 * et le refus du modèle faisait tomber la suite entière avant sa première
 * assertion.
 *
 * La valeur par défaut est TEST parce que ces scénarios ne parlent pas
 * d'environnement : ils vérifient que l'identité ne se DÉDUIT de rien. Un
 * environnement identique partout est d'ailleurs une heuristique de plus que
 * le service doit refuser d'utiliser. Les scénarios qui, eux, opposent deux
 * environnements le passent explicitement.
 */
let port = 5001;
const creerCible = (host, extra = {}) => DeploymentTarget.create({
  name: host, url: `https://${host}`, host, type: 'domain',
  registrableDomain: host, backendPort: port++, remoteRoot: '/var/www',
  state: 'DEPLOYED', environment: 'TEST', ...extra,
});

/* ────────────────────────────────────────────────────────────────────────── */
section('1. L’IDENTITÉ EST DÉCLARÉE, JAMAIS DÉDUITE');
{
  // Tout ce qui pourrait servir d'heuristique est identique : même base, même
  // serveur, même préfixe de domaine, même environnement.
  const a = await creerCible('demo-x.exemple.com', { dbName: 'partagee', sshHost: '10.0.0.1' });
  const b = await creerCible('demo-x.autre.com', { dbName: 'partagee', sshHost: '10.0.0.1' });

  const idA = await identity.ensureOwnIdentity(a);
  const idB = await identity.ensureOwnIdentity(b);

  check('chaque destination reçoit une identité', Boolean(idA.identityId && idB.identityId));
  check('base partagée : AUCUNE fusion', idA.identityId !== idB.identityId);
  check('serveur partagé : AUCUNE fusion', idA.identityId !== idB.identityId);
  check('l’identité est opaque (UUID, ni nom ni domaine)',
    /^[0-9a-f-]{36}$/.test(idA.identityId)
    && !idA.identityId.includes('demo')
    && !idA.identityId.includes('exemple'));

  // Rejouable : un second appel ne crée pas une seconde identité.
  const encore = await identity.ensureOwnIdentity(await DeploymentTarget.findById(a._id));
  check('rejouable : la même identité est retrouvée', encore.identityId === idA.identityId);
  check('…et aucune identité en double', await ProjectIdentity.countDocuments() === 2);

  // Le journal de rattachement est écrit : la parenté reste explicable.
  check('le rattachement est journalisé', idA.links.length === 1 && idA.links[0].host === a.host);

  /**
   * PROJECT_IDENTITY_ENVIRONMENT_IS_EXPLICIT.
   *
   * Une destination sans environnement n'existe pas. Le modèle la refuse, et
   * c'est ce refus qui rend impossible la classe de défaut d'origine : la même
   * destination déployée en TEST puis en PROD — deux bases, deux jeux de
   * médias, un seul domaine — sans que rien ne le signale.
   */
  const sansEnv = await DeploymentTarget.create({
    name: 'sans-env.exemple.com', url: 'https://sans-env.exemple.com',
    host: 'sans-env.exemple.com', type: 'domain', registrableDomain: 'exemple.com',
    backendPort: port++, remoteRoot: '/var/www', state: 'DEPLOYED',
  }).then(() => null).catch((err) => err);
  check('PROJECT_IDENTITY_ENVIRONMENT_IS_EXPLICIT : une destination sans environnement est refusée',
    sansEnv !== null && /environment/.test(String(sansEnv.message)));

  /**
   * PROJECT_IDENTITY_DOES_NOT_INFER_ENV_FROM_HOSTNAME.
   *
   * Deux hôtes dont le NOM suggère l'inverse de ce qu'ils déclarent. Si la
   * moindre déduction existait quelque part, c'est ici qu'elle se verrait.
   */
  const nommeProd = await creerCible('prod.exemple.com', { environment: 'TEST' });
  const nommeTest = await creerCible('test.exemple.com', { environment: 'PROD' });
  check('PROJECT_IDENTITY_DOES_NOT_INFER_ENV_FROM_HOSTNAME',
    nommeProd.environment === 'TEST' && nommeTest.environment === 'PROD');

  /**
   * PROJECT_IDENTITY_TEST / PROJECT_IDENTITY_PROD / _TEST_PROD_ISOLATED.
   *
   * Deux instances du même produit, tout partagé sauf l'environnement. Elles
   * reçoivent deux identités distinctes : l'environnement ne fusionne pas
   * davantage que la base ou le serveur.
   */
  const enTest = await creerCible('jumeau.exemple.com', {
    environment: 'TEST', dbName: 'jumeau', sshHost: '10.0.0.2',
  });
  const enProd = await creerCible('jumeau-prod.exemple.com', {
    environment: 'PROD', dbName: 'jumeau', sshHost: '10.0.0.2',
  });
  const idTest = await identity.ensureOwnIdentity(enTest);
  const idProd = await identity.ensureOwnIdentity(enProd);
  check('PROJECT_IDENTITY_TEST : l’instance TEST a la sienne',
    Boolean(idTest.identityId) && enTest.environment === 'TEST');
  check('PROJECT_IDENTITY_PROD : l’instance PROD a la sienne',
    Boolean(idProd.identityId) && enProd.environment === 'PROD');
  check('PROJECT_IDENTITY_TEST_PROD_ISOLATED : aucune fusion entre les deux',
    idTest.identityId !== idProd.identityId);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('2. RATTACHER À UN PROJET EXISTANT — et refuser de réécrire un parent');
{
  const parent = await creerCible('projet-parent.exemple.com');
  const suite = await creerCible('projet-suite.exemple.com');
  const etranger = await creerCible('projet-etranger.exemple.com');

  const idParent = await identity.ensureOwnIdentity(parent);
  await identity.ensureOwnIdentity(etranger);

  const r = await identity.attachTargetToIdentity(suite, idParent.identityId, { actor: 'ops@exemple.fr', reason: 'changement de domaine' });
  check('une destination neuve peut être déclarée enfant', r.alreadyLinked === false);
  check('…et porte l’identité du parent',
    (await DeploymentTarget.findById(suite._id)).projectIdentityId === idParent.identityId);
  check('…l’acte est journalisé avec son auteur',
    r.identity.links.some((l) => l.host === suite.host && l.actor === 'ops@exemple.fr' && l.origin === 'DECLARED'));

  const rejeu = await identity.attachTargetToIdentity(await DeploymentTarget.findById(suite._id), idParent.identityId);
  check('rejouable sans effet', rejeu.alreadyLinked === true);
  check('…sans doubler le journal',
    (await ProjectIdentity.findOne({ identityId: idParent.identityId })).links.filter((l) => l.host === suite.host).length === 1);

  // Réécrire un parent ouvrirait un droit de copie entre deux projets qui n'en
  // ont jamais partagé.
  let refus = null;
  await identity.attachTargetToIdentity(
    await DeploymentTarget.findById(etranger._id), idParent.identityId,
  ).catch((e) => { refus = e; });
  check('réécrire un parent déjà déclaré est REFUSÉ', refus !== null && refus.statusCode === 409);
  check('…et la destination garde son parent d’origine',
    (await DeploymentTarget.findById(etranger._id)).projectIdentityId !== idParent.identityId);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('3. SOURCES DE MIGRATION — même identité, sain, et ailleurs');
{
  const ancien = await creerCible('ancien.exemple.com');
  const actuel = await creerCible('actuel.exemple.com');
  const autre = await creerCible('autre-projet.exemple.com');

  const id = await identity.ensureOwnIdentity(ancien);
  await identity.attachTargetToIdentity(actuel, id.identityId);
  const idAutre = await identity.ensureOwnIdentity(autre);

  const loc = await identity.recordLocation({
    projectIdentityId: id.identityId, deploymentTargetId: ancien._id, host: ancien.host,
    siteRoot: '/var/www/ancien.exemple.com', sharedUploadsPath: '/var/www/ancien.exemple.com/shared/uploads',
    environment: 'PROD', deploymentRunId: 'run-1',
  });
  // Un emplacement en échec ne doit jamais servir de source : il n'a peut-être
  // reçu aucun fichier.
  const echoue = await identity.recordLocation({
    projectIdentityId: id.identityId, deploymentTargetId: ancien._id, host: ancien.host,
    siteRoot: '/var/www/ancien-rate.exemple.com', sharedUploadsPath: '/var/www/ancien-rate.exemple.com/shared/uploads',
    environment: 'PROD', deploymentRunId: 'run-rate',
  });
  await identity.markLocationFailed(echoue._id);
  // Un emplacement d'un AUTRE projet, sain.
  const voisin = await identity.recordLocation({
    projectIdentityId: idAutre.identityId, deploymentTargetId: autre._id, host: autre.host,
    siteRoot: '/var/www/autre-projet.exemple.com', sharedUploadsPath: '/var/www/autre-projet.exemple.com/shared/uploads',
    environment: 'PROD', deploymentRunId: 'run-2',
  });
  await identity.markLocationHealthy(voisin._id);

  check('un emplacement naît « en cours », pas « sain »', loc.status === 'DEPLOYING');
  const avant = await identity.resolveUploadsSources({
    projectIdentityId: id.identityId, deploymentTargetId: actuel._id,
    sharedUploadsPath: '/var/www/actuel.exemple.com/shared/uploads',
  });
  check('un emplacement non validé n’est PAS une source', avant.sources.length === 0);

  await identity.markLocationHealthy(loc._id, { deploymentRunId: 'run-1' });
  const apres = await identity.resolveUploadsSources({
    projectIdentityId: id.identityId, deploymentTargetId: actuel._id,
    sharedUploadsPath: '/var/www/actuel.exemple.com/shared/uploads',
  });
  check('une fois validé, il devient une source', apres.sources.length === 1);
  check('…et c’est bien l’ancien emplacement',
    apres.sources[0].sharedUploadsPath === '/var/www/ancien.exemple.com/shared/uploads');
  check('l’emplacement EN ÉCHEC reste exclu',
    !apres.sources.some((s) => s.sharedUploadsPath.includes('ancien-rate')));
  check('l’emplacement d’un AUTRE projet reste exclu',
    !apres.sources.some((s) => s.sharedUploadsPath.includes('autre-projet')));

  // Une destination sans parenté n'hérite de rien.
  const orpheline = await identity.resolveUploadsSources({
    projectIdentityId: null, deploymentTargetId: actuel._id, sharedUploadsPath: '/var/www/x/shared/uploads',
  });
  check('sans identité déclarée : AUCUNE source', orpheline.sources.length === 0);

  // La validation renseigne aussi l'emplacement courant de la destination.
  const rechargee = await DeploymentTarget.findById(ancien._id);
  check('la destination mémorise son emplacement courant',
    rechargee.currentSiteRoot === '/var/www/ancien.exemple.com');
  check('…et le run qui l’a validée', rechargee.lastHealthyDeploymentRunId === 'run-1');

  // Rejeu du même run : pas de doublon d'emplacement.
  await identity.recordLocation({
    projectIdentityId: id.identityId, deploymentTargetId: ancien._id, host: ancien.host,
    siteRoot: '/var/www/ancien.exemple.com', sharedUploadsPath: '/var/www/ancien.exemple.com/shared/uploads',
    environment: 'PROD', deploymentRunId: 'run-1',
  });
  check('rejouer un run n’ajoute pas d’emplacement',
    await DeploymentLocationHistory.countDocuments({ deploymentTargetId: ancien._id, deploymentRunId: 'run-1' }) === 1);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('4. CHEMINS — une remontée de répertoire n’est jamais « nettoyée »');
{
  const refuse = (p) => {
    try { assertUploadsPath(p, { remoteRoot: '/var/www' }); return false; } catch { return true; }
  };
  check('accepte un chemin canonique sous la racine',
    assertUploadsPath('/var/www/site.fr/shared/uploads') === '/var/www/site.fr/shared/uploads');
  check('refuse une remontée `..`', refuse('/var/www/../etc/shadow'));
  check('refuse une remontée enfouie', refuse('/var/www/site.fr/../../etc'));
  check('refuse un chemin relatif', refuse('site.fr/shared/uploads'));
  check('refuse la racine elle-même', refuse('/var/www'));
  check('refuse hors de la racine', refuse('/etc/letsencrypt'));
  check('refuse un métacaractère shell', refuse('/var/www/site;rm -rf /'));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('5. MIGRATION — copier sans jamais écraser, et s’arrêter au désaccord');
{
  /**
   * VPS simulé par un système de fichiers en mémoire : chemin absolu → contenu.
   * `exec` implémente le strict nécessaire (find/sha256sum, mkdir -p, cp -n).
   */
  const { createHash } = await import('node:crypto');
  const sha = (s) => createHash('sha256').update(s).digest('hex');

  const faireVps = (fichiers) => {
    const fs = new Map(Object.entries(fichiers));
    const copies = [];
    return {
      fs, copies,
      async exec(cmd) {
        const inv = cmd.match(/^if \[ -d '(.+?)' \]; then cd '(.+?)' && find/);
        if (inv) {
          const dir = inv[1];
          const lignes = [...fs.keys()]
            .filter((f) => f.startsWith(`${dir}/`))
            .map((f) => `${sha(fs.get(f))}  ./${f.slice(dir.length + 1)}`);
          return { code: 0, stdout: lignes.join('\n'), stderr: '' };
        }
        const cp = cmd.match(/cp -n --preserve=timestamps -- '(.+?)' '(.+?)'$/);
        if (cp) {
          const [, src, dst] = cp;
          copies.push({ src, dst });
          if (!fs.has(src)) return { code: 1, stdout: '', stderr: 'no such file' };
          if (!fs.has(dst)) fs.set(dst, fs.get(src)); // `-n` : jamais d'écrasement
          return { code: 0, stdout: '', stderr: '' };
        }
        return { code: 0, stdout: '', stderr: '' };
      },
    };
  };

  const SRC = '/var/www/ancien.fr/shared/uploads';
  const DST = '/var/www/actuel.fr/shared/uploads';
  const ID = 'identite-commune';

  // 5a. Migration nominale : trois médias absents à destination.
  {
    const vps = faireVps({
      [`${SRC}/favicon.webp`]: 'FAVICON',
      [`${SRC}/logo.webp`]: 'LOGO',
      [`${SRC}/galerie/voiture.webp`]: 'VOITURE',
    });
    const r = await migrateUploads(vps, {
      destination: DST, identityId: ID,
      sources: [{ host: 'ancien.fr', sharedUploadsPath: SRC, projectIdentityId: ID }],
    });
    check('les trois médias sont migrés', r.migrated === 3);
    check('…vérifiés par empreinte après copie', r.verified === true);
    check('…y compris dans un sous-dossier', vps.fs.get(`${DST}/galerie/voiture.webp`) === 'VOITURE');
    check('…avec le contenu exact', vps.fs.get(`${DST}/favicon.webp`) === 'FAVICON');

    // 5b. Rejeu : rien n'est recopié.
    const r2 = await migrateUploads(vps, {
      destination: DST, identityId: ID,
      sources: [{ host: 'ancien.fr', sharedUploadsPath: SRC, projectIdentityId: ID }],
    });
    check('rejeu : aucune nouvelle copie', r2.migrated === 0);
    check('…et les fichiers sont reconnus déjà présents', r2.alreadyPresent === 3);
    check('…idempotent, aucune commande de copie', vps.copies.length === 3);
  }

  // 5c. Un fichier existe déjà à destination : il n'est pas touché.
  {
    const vps = faireVps({
      [`${SRC}/logo.webp`]: 'ANCIEN_LOGO',
      [`${SRC}/nouveau.webp`]: 'NOUVEAU',
      [`${DST}/logo.webp`]: 'ANCIEN_LOGO', // même contenu : rien à faire
    });
    const r = await migrateUploads(vps, {
      destination: DST, identityId: ID,
      sources: [{ host: 'ancien.fr', sharedUploadsPath: SRC, projectIdentityId: ID }],
    });
    check('seul le média absent est copié', r.migrated === 1);
    check('…le fichier déjà présent est laissé intact', vps.fs.get(`${DST}/logo.webp`) === 'ANCIEN_LOGO');
    check('…et il n’a fait l’objet d’aucune copie', !vps.copies.some((c) => c.dst.endsWith('logo.webp')));
  }

  // 5d. MÊME NOM, CONTENU DIFFÉRENT : on s'arrête, on ne tranche pas.
  {
    const vps = faireVps({
      [`${SRC}/logo.webp`]: 'VERSION_A',
      [`${SRC}/sain.webp`]: 'SAIN',
      [`${DST}/logo.webp`]: 'VERSION_B',
    });
    let err = null;
    await migrateUploads(vps, {
      destination: DST, identityId: ID,
      sources: [{ host: 'ancien.fr', sharedUploadsPath: SRC, projectIdentityId: ID }],
    }).catch((e) => { err = e; });

    check('un conflit de contenu ARRÊTE la migration', err?.code === 'UPLOADS_MIGRATION_CONFLICT');
    check('…en nommant le fichier', err?.details?.file === 'logo.webp');
    check('…avec les DEUX empreintes, pour trancher', Boolean(err?.details?.sourceHash && err?.details?.destinationHash)
      && err.details.sourceHash !== err.details.destinationHash);
    check('…et le fichier de destination reste intact', vps.fs.get(`${DST}/logo.webp`) === 'VERSION_B');
    check('…aucune copie n’a été tentée', vps.copies.length === 0);
  }

  // 5e. Une source d'un AUTRE projet est refusée, pas filtrée en silence.
  {
    const vps = faireVps({ [`${SRC}/photo.webp`]: 'PHOTO' });
    let err = null;
    await migrateUploads(vps, {
      destination: DST, identityId: ID,
      sources: [{ host: 'autre.fr', sharedUploadsPath: SRC, projectIdentityId: 'une-autre-identite' }],
    }).catch((e) => { err = e; });
    check('source d’un autre projet : REFUS explicite', err?.code === 'UPLOADS_MIGRATION_IDENTITY_MISMATCH');
    check('…et rien n’a été copié', vps.copies.length === 0);
  }

  // 5f. Sans identité déclarée, aucune migration n'est possible.
  {
    const vps = faireVps({ [`${SRC}/photo.webp`]: 'PHOTO' });
    let err = null;
    await migrateUploads(vps, { destination: DST, identityId: null, sources: [] }).catch((e) => { err = e; });
    check('sans identité : migration REFUSÉE', err?.code === 'UPLOADS_MIGRATION_NO_IDENTITY');
  }

  // 5g. Aucune source : cas normal d'un projet neuf, pas une erreur.
  {
    const vps = faireVps({});
    const r = await migrateUploads(vps, { destination: DST, identityId: ID, sources: [] });
    check('projet neuf sans emplacement antérieur : aucun échec', r.migrated === 0);
  }

  // 5h. Le fichier disparaît entre l'inventaire et la copie.
  {
    const vps = faireVps({ [`${SRC}/volatil.webp`]: 'X' });
    const exec = vps.exec.bind(vps);
    vps.exec = async (cmd) => {
      if (cmd.includes('cp -n')) vps.fs.delete(`${SRC}/volatil.webp`);
      return exec(cmd);
    };
    let err = null;
    await migrateUploads(vps, {
      destination: DST, identityId: ID,
      sources: [{ host: 'ancien.fr', sharedUploadsPath: SRC, projectIdentityId: ID }],
    }).catch((e) => { err = e; });
    check('fichier source disparu : échec explicite', err?.code === 'UPLOADS_MIGRATION_COPY_FAILED');
  }

  // 5i. Un inventaire illisible n'est jamais interprété partiellement.
  {
    const vps = { async exec() { return { code: 0, stdout: 'ceci-nest-pas-un-inventaire\n', stderr: '' }; } };
    let err = null;
    await inventoryUploads(vps, DST).catch((e) => { err = e; });
    check('inventaire illisible : refus de travailler dessus', err?.code === 'UPLOADS_INVENTORY_UNREADABLE');
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
section('6. LE PIPELINE — migrer avant de valider, publier après');
{
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const pipeline = await fs.readFile(path.join(racine, 'src/deployment-engine/pipeline.js'), 'utf8');
  const at = (id) => pipeline.indexOf(`await step('${id}'`);

  check('l’étape de migration existe', at('uploads_migrate') > 0);
  check('elle vient APRÈS l’upload de l’artefact', at('uploads_migrate') > at('upload'));
  check('…et APRÈS la liaison des dossiers partagés', at('uploads_migrate') > at('dirs'));
  check('…et AVANT la validation publique', at('uploads_migrate') < at('validate'));
  check('la validation précède toujours la publication réseau', at('validate') < at('runtime_config'));

  const { PIPELINE_STEPS } = await import('../deployment-engine/pipeline.js');
  check('la liste déclarée suit l’ordre d’exécution',
    PIPELINE_STEPS.indexOf('uploads_migrate') < PIPELINE_STEPS.indexOf('validate')
    && PIPELINE_STEPS.indexOf('validate') < PIPELINE_STEPS.indexOf('runtime_config'));

  const { CANONICAL_ORDER, toCanonical } = await import('../deployment-engine/steps.js');
  check('l’étape a un identifiant canonique', toCanonical('uploads_migrate') === 'uploads.migrate');
  check('…placé avant la vérification publique',
    CANONICAL_ORDER.indexOf('uploads.migrate') < CANONICAL_ORDER.indexOf('public.healthcheck'));
  check('runtime.sync est APRÈS public.healthcheck (affichage et rapport)',
    CANONICAL_ORDER.indexOf('runtime.sync') > CANONICAL_ORDER.indexOf('public.healthcheck'));

  // Le moteur ne cherche jamais une source : il ne connaît que celle qu'on lui donne.
  const uploads = await fs.readFile(path.join(racine, 'src/deployment-engine/uploads.js'), 'utf8');
  const sansCommentaires = uploads.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  check('le moteur ne scanne aucun répertoire de déploiement',
    !/\/var\/www\/\*/.test(sansCommentaires) && !sansCommentaires.includes('ls /var/www'));
  check('…et ne rapproche jamais deux destinations par leur domaine',
    !/registrableDomain|subdomain|dbName/.test(sansCommentaires));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('7. LES SCRIPTS DE RÉPARATION restent ponctuels');
{
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  /** Le code seul : un commentaire qui cite une pratique interdite n'est pas cette pratique. */
  const nu = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  const code = nu(await fs.readFile(path.join(racine, 'scripts/repair-demo-sbauto-identity.js'), 'utf8'));

  check('les deux hôtes sont écrits en dur',
    code.includes("'demo-sbauto.lycarz.com'") && code.includes("'demo-sbauto06.ly-solution.com'"));

  // Le parc de destinations n'est JAMAIS balayé : chaque accès est borné aux
  // deux hôtes. Un `$regex` ou un `find({})` sur cette collection ouvrirait la
  // porte à toucher une cible qui n'a rien demandé.
  check('aucune expression régulière en base', !/\$regex|\$where/.test(code));
  // Le parc n'est atteint QUE par ces deux hôtes : deux lectures nominatives,
  // et un comptage préalable explicitement borné. Aucun autre accès n'existe,
  // donc aucune troisième destination ne peut être touchée par mégarde.
  const acces = [...code.matchAll(/DeploymentTarget\.(\w+)\(([^)]*)\)/g)];
  check('le parc n’est lu que par ses deux hôtes nommés',
    acces.length === 2
    && acces.every((m) => m[1] === 'findOne' && /host: (ANCIEN|ACTUEL)/.test(m[2])));
  check('…et le comptage préalable est borné aux deux mêmes',
    /countDocuments\(\{ host: \{ \$in: \[ANCIEN, ACTUEL\] \} \}\)/.test(code));
  check('…aucun autre hôte n’est écrit en dur',
    (code.match(/'[a-z0-9-]+\.[a-z0-9.-]+\.(com|fr)'/g) ?? []).every(
      (h) => h === "'demo-sbauto.lycarz.com'" || h === "'demo-sbauto06.ly-solution.com'"));
  check('…et le relevé de contenu exclut explicitement le parc',
    /deploymenttargets\|/.test(code));

  // RIEN ne doit s'écrire en simulation. Vérifié par la STRUCTURE, pas par la
  // longueur d'un bloc : toute écriture doit se situer après la sortie anticipée.
  check('le mode simulation est le DÉFAUT', code.includes("includes('--apply')"));
  const garde = code.indexOf('if (!APPLY)');
  const mutations = [...code.matchAll(/\.(save|create|updateOne|insertOne|deleteOne|findOneAndUpdate)\(/g)];
  check('une sortie anticipée existe en simulation', garde > 0);
  check('…et AUCUNE écriture ne la précède',
    mutations.length > 0 && mutations.every((m) => m.index > garde));

  check('deux parents différents : fusion refusée', code.includes('distinctes.length > 1'));
  check('un événement d’audit est enregistré', code.includes("origin: 'REPAIR'") && code.includes('reason: MOTIF'));
  check('le chemin source vient de la topologie, pas d’une chaîne construite',
    code.includes('planTopology(') && code.includes('topoAncien.sharedUploads'));
  check('la base n’est pas supposée : elle est cherchée puis confirmée',
    code.includes('completes.length > 1') && code.includes('completes.length === 0'));
  check('la source n’est retenue que si elle SERT réellement',
    code.includes('sonder(') && code.includes("refuser('La source ne répond pas 200"));
  check('un conflit d’empreinte arrête tout', code.includes('conflits.length'));
  check('le script ne copie AUCUN fichier lui-même',
    !/cp -n|uploadDir|transport/.test(code));

  /* ---- Le script de restauration réseau ---- */
  const net = nu(await fs.readFile(path.join(racine, 'scripts/restore-demo-network-configuration.js'), 'utf8'));

  check('restauration : mode simulation par défaut', net.includes("includes('--apply')"));
  const gardeNet = net.indexOf('if (!APPLY)');
  const mutNet = [...net.matchAll(/\.(updateOne|insertOne|save|create)\(/g)];
  check('restauration : aucune écriture avant la sortie anticipée',
    gardeNet > 0 && mutNet.length > 0 && mutNet.every((m) => m.index > gardeNet));
  check('restauration : la valeur est DÉRIVÉE par le moteur',
    net.includes('deriveNetworkUrls(') && net.includes('planTopology('));
  check('…et confrontée à la dernière valeur connue',
    net.includes('corroboration') && net.includes('ecarts.length'));
  check('restauration : refus si la destination en échec sert ses médias',
    net.includes('sondeMedia.code === 200'));
  check('restauration : aucune bascule manuelle vers la nouvelle destination',
    !new RegExp("derivee\\s*=\\s*deriveNetworkUrls\\(\\{\\s*siteHost:\\s*ECHOUEE").test(net));
  check('restauration : l’état écrasé est journalisé AVANT remplacement',
    net.indexOf('runtimeconfigurationaudits') < net.indexOf("col.updateOne("));
  check('restauration : relecture après écriture',
    net.includes('relu depuis la base') && net.includes('apres.network[k] === derivee[k]'));
}

console.log(`\n${pass} réussis, ${fail} échoués`);
await mongoose.connection.close();
await mongod.stop();
process.exit(fail === 0 ? 0 : 1);
