// FULL_DEPLOYMENT_CROSS_AUTHORITY_MEDIA — le garde-fou principal.
//
// ══ CE QU'IL REMPLACE ═══════════════════════════════════════════════════════
//
// Un redéploiement manuel utilisé comme outil de découverte. Chaque tentative
// coûtait un cycle complet — DNS, SSH, build, transfert, TLS, PM2 — pour
// apprendre une chose qu'un test aurait dite en trois secondes. La dernière a
// échoué sur `MEDIA_UNREACHABLE`, parce que le contrôle public recomposait
// l'adresse du logo du DÉVELOPPEUR contre le domaine du CLIENT.
//
// ══ L'ÉTAT DE DÉPART, CELUI DU 07/08 ════════════════════════════════════════
//
//   Panel      panel.ly-solution.com:5100      → un média PANEL publié
//   ancienne   ancien-sbauto06.ly-solution.com:5001 → le parc legacy, sur disque
//   nouvelle   demo-sbauto06.ly-solution.com:5002   → vierge
//   poste      backend/uploads/                → .gitkeep, et rien d'autre
//   base       fiches avec chemins, descripteurs null, ProjectMedia 0
//              + un ProjectMedia NEUF, jamais publié
//
// ══ CE QUE LE PIPELINE DOIT PRODUIRE ════════════════════════════════════════
//
//   status=ok · target.state=DEPLOYED · currentVersion=HEAD · 0 média 404
//   PanelMedia → Panel · ProjectMedia → SB Auto · legacy adopté SANS réupload
import { strict as assert } from 'node:assert';

process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'TEST';

const { MongoMemoryServer } = await import('mongodb-memory-server');
const mongoose = (await import('mongoose')).default;
const os = await import('node:os');
const path = await import('node:path');
const fs = await import('node:fs/promises');
const crypto = await import('node:crypto');

const serveur = await MongoMemoryServer.create();
process.env.MONGODB_URI = serveur.getUri();
await mongoose.connect(serveur.getUri(), { dbName: 'full-deployment-media' });

/** Le poste qui déploie : un `.gitkeep`, comme en vrai. */
const LOCAL = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-deploy-local-'));
await fs.writeFile(path.join(LOCAL, '.gitkeep'), '');
/** Le `shared/uploads` de la DESTINATION : là où sont les octets. */
const DISTANT = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-deploy-distant-'));

const { config } = await import('../config/env.js');
config.paths = { ...(config.paths ?? {}), uploads: LOCAL };
config.env = 'TEST';

const { ProjectMedia } = await import('../models/ProjectMedia.model.js');
const { DeploymentTarget } = await import('../models/DeploymentTarget.model.js');
const { Company } = await import('../models/Company.model.js');
const { Chapter } = await import('../models/Chapter.model.js');
const { PanelCompanyConfiguration } = await import('../models/PanelConfiguration.model.js');

const { runPipeline, PIPELINE_STEPS } = await import('../deployment-engine/pipeline.js');
const { parseTargetUrl } = await import('../deployment-engine/url.js');
const { FakeTransport } = await import('../deployment-engine/transport/FakeTransport.js');
const { CANONICAL_ORDER, toCanonical } = await import('../deployment-engine/steps.js');
const adoption = await import('../services/media/projectMediaAdoption.service.js');
const mediaSvc = await import('../services/media/projectMedia.service.js');
const projection = await import('../services/media/mediaProjection.service.js');
const targets = await import('../services/deploymentTarget.service.js');

const sharp = (await import('sharp')).default;
const image = async (r, g, b) => sharp({
  create: { width: 48, height: 32, channels: 3, background: { r, g, b } },
}).webp().toBuffer();
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const sha256Str = (s) => crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');

let ok = 0;
let ko = 0;
const check = (libelle, condition) => {
  if (condition) { ok += 1; console.log(`  ✓ ${libelle}`); }
  else { ko += 1; console.log(`  ✗ ${libelle}`); }
};
const section = (t) => console.log(`\n${t}`);

await DeploymentTarget.init();

/* ══ LA TOPOLOGIE RÉELLE ════════════════════════════════════════════════════ */

const PANEL_HOTE = 'panel.ly-solution.com';
const ANCIEN_HOTE = 'ancien-sbauto06.ly-solution.com';
const NOUVEAU_HOTE = 'demo-sbauto06.ly-solution.com';

const SITE_ROOT = `/var/www/${NOUVEAU_HOTE}`;
const PARTAGE = `${SITE_ROOT}/shared/uploads`;
const BACKEND_DIR = `${SITE_ROOT}/backend`;
const ANCIEN_PARTAGE = `/var/www/${ANCIEN_HOTE}/shared/uploads`;

const HEAD = 'cafe0123456789abcdef';

/** Le média du Panel — celui du 07/08, à l'identique. */
const MEDIA_PANEL_URL =
  `https://${PANEL_HOTE}/uploads/7dda6e2d-1745-49df-9a1d-e1894aecb34b-bd65e2ad257b.webp`;

/** Le parc LEGACY : présent uniquement sur l'ancienne destination. */
const LEGACY = ['img-1784735408962-149225253.webp', 'img-1783981616391-171701318.webp'];
/** Un média NEUF, importé en local avant tout déploiement. */
const NEUF_CLE = 'ffffffff-0000-1111-2222-333333333333-0123456789ab.webp';

const octets = new Map();
for (const [i, nom] of [...LEGACY, NEUF_CLE].entries()) {
  octets.set(nom, await image(20 + i * 40, 60, 180 - i * 30));
}
// Le NEUF, et lui seul, existe sur le poste qui déploie.
await fs.writeFile(path.join(LOCAL, NEUF_CLE), octets.get(NEUF_CLE));
// Le legacy vit sur le disque distant, et nulle part ailleurs.
for (const nom of LEGACY) await fs.writeFile(path.join(DISTANT, nom), octets.get(nom));

/* ── La base ──────────────────────────────────────────────────────────────── */

const destination = await DeploymentTarget.create({
  name: 'SB Auto TEST', url: `https://${NOUVEAU_HOTE}`, host: NOUVEAU_HOTE,
  type: 'domain', environment: 'TEST', backendPort: 5002,
  lifecycleStatus: 'ACTIVE', state: 'DEPLOYING',
});

const company = await Company.create({
  name: 'SB Auto 06',
  logos: { header: `/uploads/${LEGACY[0]}` },
  heroImage: '',
});
const chapitre = await Chapter.create({
  slug: 'conception', title: 'Conception', heroImage: `/uploads/${LEGACY[1]}`,
});

const at = new Date().toISOString();
await ProjectMedia.create({
  mediaId: 'ffffffff-0000-1111-2222-333333333333',
  mediaType: 'hero', environment: 'TEST', publicationState: 'LOCAL_ONLY',
  objectKey: NEUF_CLE, path: `/uploads/${NEUF_CLE}`,
  mime: 'image/webp', size: octets.get(NEUF_CLE).length,
  width: 48, height: 32, sha256: sha256(octets.get(NEUF_CLE)), version: 1,
  createdAt: at, updatedAt: at,
});
await Company.updateOne({ _id: company._id }, {
  $set: {
    heroImage: `/uploads/${NEUF_CLE}`,
    heroImageMedia: {
      authority: 'PROJECT',
      mediaId: 'ffffffff-0000-1111-2222-333333333333',
      objectKey: NEUF_CLE, environment: 'TEST', mediaType: 'hero',
      sha256: sha256(octets.get(NEUF_CLE)), mime: 'image/webp',
      size: octets.get(NEUF_CLE).length, width: 48, height: 32, version: 1,
    },
  },
});

await PanelCompanyConfiguration.create({
  key: 'SINGLETON', companyId: '11111111-1111-1111-1111-111111111111', slug: 'agence',
  environment: 'TEST', version: 1,
  identity: { name: 'L.Y Solution' },
  branding: {
    logo: {
      authority: 'PANEL',
      mediaId: '7dda6e2d-1745-49df-9a1d-e1894aecb34b',
      url: MEDIA_PANEL_URL, environment: 'TEST', publicationState: 'PUBLISHED',
      mime: 'image/webp', sha256: 'b'.repeat(64), version: 3,
    },
  },
});

/* ══ LE SERVEUR — un vrai disque distant, et de vraies réponses HTTP ════════ */

const INDEX_HTML = '<!doctype html><html><head><script type="module" src="/assets/app-TEST1234.js"></script></head><body></body></html>';
const APP_JS = 'console.log("app")';
const WEB_FP = { indexHash: sha256Str(INDEX_HTML), mainJs: { name: 'app-TEST1234.js', hash: sha256Str(APP_JS) } };
const MANIFEST = { commitHash: HEAD, shortCommit: HEAD.slice(0, 7) };
const ARTIFACT = {
  dists: { vitrine: '/local/vitrine/dist', manager: '/local/manager/dist' },
  backendDir: '/local/backend',
  uploadsDir: LOCAL,
  web: { vitrine: WEB_FP, manager: WEB_FP }, manifest: MANIFEST,
};

/** Chaque adresse HTTP réellement sondée, dans l'ordre. */
const sondes = [];
/** Fichiers présents sur le disque distant, par chemin absolu. */
const disqueDistant = new Map();
for (const nom of LEGACY) disqueDistant.set(`${ANCIEN_PARTAGE}/${nom}`, octets.get(nom));

/** Le catalogue public servi par la nouvelle destination — la vraie projection. */
async function bootstrapServi() {
  const c = await projection.projectCompanyMedia(await Company.findById(company._id).lean(), 'TEST');
  const ch = await projection.projectChapterMedia(await Chapter.findById(chapitre._id).lean(), 'TEST');
  const { getPublishedDeveloperIdentity } =
    await import('../services/panelConfiguration/developerIdentity.service.js');
  const dev = await getPublishedDeveloperIdentity();
  return JSON.stringify({
    company: { logos: c.logos, heroImage: c.heroImage },
    chapters: [{ slug: ch.slug, heroImage: ch.heroImage }],
    developer: { logo: dev.logo },
  });
}

/** Les adresses que les serveurs SERVENT réellement (200 + image/webp). */
function estServi(url) {
  if (url === MEDIA_PANEL_URL) return true; // le Panel sert le sien
  const m = /^https:\/\/([^/]+)\/uploads\/(.+)$/.exec(url);
  if (!m) return false;
  const [, hote, cle] = m;
  // Les fronts de la NOUVELLE destination servent ce que porte son partagé.
  const nôtres = hote === NOUVEAU_HOTE || hote === `manager.${NOUVEAU_HOTE}`;
  return nôtres && disqueDistant.has(`${PARTAGE}/${cle}`);
}

function serveurDistant() {
  const t = new FakeTransport()
    .on('nginx -t', { stdout: 'syntax is ok\ntest is successful' })
    .on('fullchain.pem', { stdout: 'OK' })
    .on(/127\.0\.0\.1.*health/, { stdout: '200' })
    .on(/https:\/\/[^']*\/health/, { stdout: '{"success":true,"data":{"env":"TEST"}}\n200' })
    .on(/-m 10 'https:\/\/[^']+\/'/, { stdout: INDEX_HTML })
    .on(/\/assets\/app-TEST1234\.js'/, { stdout: APP_JS })
    .on(/\/version\.json'/, { stdout: JSON.stringify({ commitHash: HEAD }) });

  t.files.set(`${BACKEND_DIR}/build-manifest.json`, JSON.stringify({ commitHash: HEAD }));

  const original = t.exec.bind(t);
  t.exec = async (commande) => {
    /* ---- inventaire d'un dossier (migration des médias) ---- */
    /**
     * LE DOUBLE RECONNAÎT UNE INTENTION, PAS UNE CHAÎNE EXACTE.
     *
     * Il exigeait la forme littérale de la commande, `&&` compris. Le jour où
     * l'inventaire est passé sous shell strict (`set -euo pipefail`, séparateurs
     * `;`), le double a cessé de la reconnaître — et a répondu à sa place une
     * empreinte isolée, que le module a lue comme un inventaire corrompu.
     *
     * Un double trop littéral ne teste plus le comportement : il teste
     * l'orthographe. On reconnaît donc « un inventaire du dossier X », quelle
     * que soit la ponctuation du shell.
     */
    const inv = /if \[ -d '([^']+)' \]; then cd '[^']+'[;&\s]+find \. -type f -exec sha256sum/.exec(commande);
    if (inv) {
      t.commands.push({ command: commande });
      const prefixe = `${inv[1]}/`;
      const lignes = [...disqueDistant.entries()]
        .filter(([p]) => p.startsWith(prefixe))
        .map(([p, c]) => `${sha256(c)}  ./${p.slice(prefixe.length)}`);
      return { code: 0, stdout: lignes.join('\n'), stderr: '' };
    }

    /* ---- copie sans écrasement (migration) ---- */
    const cp = /cp -n --preserve=timestamps -- '([^']+)' '([^']+)'/.exec(commande);
    if (cp) {
      t.commands.push({ command: commande });
      if (!disqueDistant.has(cp[2]) && disqueDistant.has(cp[1])) {
        disqueDistant.set(cp[2], disqueDistant.get(cp[1]));
      }
      return { code: 0, stdout: '', stderr: '' };
    }

    /* ---- LA REPRISE, exécutée SUR la destination ---- */
    if (commande.includes('adopt-project-media.js')) {
      t.commands.push({ command: commande });
      /**
       * Le script tourne sur le backend distant : son `uploadsDir()` est le
       * partagé de la destination. On l'incarne en pointant la configuration
       * sur un dossier qui reflète EXACTEMENT le disque distant, le temps de
       * l'appel — et jamais sur le dossier du poste qui déploie.
       */
      await fs.rm(DISTANT, { recursive: true, force: true });
      await fs.mkdir(DISTANT, { recursive: true });
      for (const [p, contenu] of disqueDistant) {
        if (p.startsWith(`${PARTAGE}/`)) await fs.writeFile(path.join(DISTANT, p.slice(PARTAGE.length + 1)), contenu);
      }
      const avant = config.paths.uploads;
      config.paths = { ...config.paths, uploads: DISTANT };
      let rapport;
      try {
        rapport = await adoption.adoptLegacyProjectMedia({ apply: true });
      } finally {
        config.paths = { ...config.paths, uploads: avant };
      }
      return {
        code: rapport.conflicts.length ? 2 : 0,
        stdout: `npm notice bruit\n${adoption.RAPPORT_DEBUT}${JSON.stringify(rapport)}${adoption.RAPPORT_FIN}\nfin`,
        stderr: '',
      };
    }

    /* ---- empreinte / taille d'un fichier distant (publication) ---- */
    const shaCmd = /sha256sum (\S+)/.exec(commande);
    if (shaCmd) {
      t.commands.push({ command: commande });
      const contenu = disqueDistant.get(shaCmd[1]);
      return { code: 0, stdout: contenu ? sha256(contenu) : 'ABSENT', stderr: '' };
    }
    const statCmd = /stat -c %s (\S+)/.exec(commande);
    if (statCmd) {
      t.commands.push({ command: commande });
      const contenu = disqueDistant.get(statCmd[1]);
      return { code: 0, stdout: contenu ? String(contenu.length) : 'ABSENT', stderr: '' };
    }

    /* ---- la sonde publique : la VRAIE projection ---- */
    if (commande.includes('/api/public/bootstrap')) {
      t.commands.push({ command: commande });
      return { code: 0, stdout: await bootstrapServi(), stderr: '' };
    }

    /* ---- téléchargement d'un média ---- */
    const head = /-o \/dev\/null -w '%\{http_code\} %\{content_type\}' '([^']+)'/.exec(commande);
    if (head) {
      t.commands.push({ command: commande });
      sondes.push(head[1]);
      return { code: 0, stdout: estServi(head[1]) ? '200 image/webp' : '404 text/html', stderr: '' };
    }

    return original(commande);
  };

  // Un transfert de fichier dépose RÉELLEMENT ses octets sur le disque distant.
  t.uploadFile = async (local, distant) => {
    disqueDistant.set(distant, await fs.readFile(local));
    t.uploads.push({ localPath: local, remotePath: distant });
    return { files: 1 };
  };
  return t;
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('L’ÉTAT DE DÉPART');
{
  check('le poste ne porte que le média NEUF (et .gitkeep)',
    (await fs.readdir(LOCAL)).sort().join() === ['.gitkeep', NEUF_CLE].sort().join());
  check('le parc legacy n’existe QUE sur l’ancienne destination',
    LEGACY.every((n) => disqueDistant.has(`${ANCIEN_PARTAGE}/${n}`)));
  check('la nouvelle destination est vierge',
    ![...disqueDistant.keys()].some((p) => p.startsWith(`${PARTAGE}/`)));
  check('un seul ProjectMedia en base : le neuf, non publié',
    (await ProjectMedia.countDocuments({})) === 1
    && (await ProjectMedia.findOne({}).lean()).publicationState === 'LOCAL_ONLY');
  check('les fiches legacy n’ont aucun descripteur',
    (await Company.findById(company._id).lean()).logosMedia?.header == null);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('L’ORDRE DU PIPELINE EST CELUI QU’ON EXIGE');
{
  const i = (s) => PIPELINE_STEPS.indexOf(s);
  check('uploads_migrate → project_media_adopt',
    i('uploads_migrate') < i('project_media_adopt'));
  check('project_media_adopt → media_publish',
    i('project_media_adopt') < i('media_publish'));
  check('media_publish → validate (healthcheck public)',
    i('media_publish') < i('validate'));
  check('validate → runtime_config (constater avant publier)',
    i('validate') < i('runtime_config'));

  const c = (s) => CANONICAL_ORDER.indexOf(toCanonical(s));
  check('le catalogue canonique porte la même contrainte',
    c('uploads_migrate') < c('project_media_adopt')
    && c('project_media_adopt') < c('media_publish')
    && c('media_publish') < c('validate'));
  check('chaque étape du pipeline a une étape canonique',
    PIPELINE_STEPS.every((s) => CANONICAL_ORDER.includes(toCanonical(s))));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LE PIPELINE COMPLET');

const transport = serveurDistant();
const cible = parseTargetUrl(`https://${NOUVEAU_HOTE}`, { wildcardBases: ['ly-solution.com'] });
const etapes = [];

const resultat = await runPipeline({
  transport,
  target: cible,
  artifact: ARTIFACT,
  version: HEAD,
  onStep: (e) => etapes.push(e),
  options: {
    backendPort: 5002,
    env: 'TEST',
    remoteEnv: {
      ENV: 'TEST', MONGODB_URI: 'mongodb://x/y', DB_TEST: 'sbauto_test',
      JWT_SECRET: 'x'.repeat(40), INTEGRATED_API_ENCRYPTION_KEY: 'a'.repeat(64),
    },
    health: { localRetries: 1, localDelayMs: 0, publicRetries: 1, publicDelayMs: 0 },

    // L'ancienne destination porte les octets ; l'identité déclarée est la même.
    resolveUploadsSources: async () => ({
      identityId: 'identite-sbauto06',
      sources: [{
        host: ANCIEN_HOTE, sharedUploadsPath: ANCIEN_PARTAGE, projectIdentityId: 'identite-sbauto06',
      }],
    }),

    // LA capacité injectée — le moteur n'importe aucun modèle de média.
    adoptApplicationMedia: async ({ transport: t, backendDir }) => {
      const issue = await adoption.runRemoteProjectMediaAdoption({ transport: t, backendDir });
      if (!issue.ok) throw new Error(`${issue.code} — ${issue.message}`);
      return issue.report;
    },

    publishApplicationMedia: async ({ transport: t, sharedUploads, host }) =>
      mediaSvc.publishProjectMediaOnDestination({
        transport: t, sharedUploads, host, environment: 'TEST',
      }),
  },
});

{
  check('pipeline : ok', resultat.ok === true && resultat.failedStep === null);
  if (!resultat.ok) console.log(`    → ${resultat.error?.code} : ${resultat.error?.message}`);
  check('pipeline : toutes les étapes du catalogue exécutées',
    resultat.steps.length === PIPELINE_STEPS.length);
  check('pipeline : aucune étape en erreur',
    resultat.steps.every((s) => s.status === 'ok'));
  check('pipeline : l’ordre d’exécution est celui du catalogue',
    resultat.steps.map((s) => s.step).join() === PIPELINE_STEPS.join());
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LA MIGRATION A AMENÉ LES OCTETS, ET RIEN D’AUTRE');
{
  const migration = resultat.steps.find((s) => s.step === 'uploads_migrate');
  check('les 2 médias legacy ont été migrés', migration.detail.migrated === 2);
  check('…et vérifiés par empreinte APRÈS copie', migration.detail.verified === true);
  check('ils sont désormais sur le partagé de la nouvelle destination',
    LEGACY.every((n) => disqueDistant.has(`${PARTAGE}/${n}`)));
  check('l’ancienne destination n’a rien perdu',
    LEGACY.every((n) => disqueDistant.has(`${ANCIEN_PARTAGE}/${n}`)));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('L’ADOPTION S’EST FAITE SUR LA DESTINATION');
{
  const etape = resultat.steps.find((s) => s.step === 'project_media_adopt');
  check('l’étape a produit un rapport lisible', Boolean(etape.detail?.mode));
  check('elle s’est exécutée en mode APPLY', etape.detail.mode === 'APPLY');
  check('elle a regardé le dossier DISTANT, jamais celui du poste',
    etape.detail.uploadsDir === DISTANT);
  /**
   * TROIS RÉFÉRENCES, DEUX DESCRIPTEURS, DEUX RACCROCHAGES.
   *
   * Les trois champs cités sont `companies.logos.header` (LEGACY[0]),
   * `companies.heroImage` et `chapters.heroImage` (LEGACY[1]). Le deuxième
   * porte DÉJÀ un descripteur — il a été posé plus haut, pour éprouver
   * justement ce cas — et l'adoption le laisse donc intact : il compte dans
   * les références EXAMINÉES, pas dans les fiches raccrochées.
   *
   * C'est la distinction qui compte ici : une adoption qui raccrocherait les
   * trois écraserait un descripteur valide par un descripteur reconstruit.
   */
  check('3 références historiques examinées', etape.detail.legacyRefs.length === 3);
  check('2 médias legacy décrits (un fichier = un descripteur)', etape.detail.created === 2);
  check('2 fiches raccrochées — la troisième avait déjà son descripteur',
    etape.detail.attached === 2);
  check('le média NEUF, déjà décrit, n’est pas redécrit',
    etape.detail.already.some((a) => a.objectKey === NEUF_CLE));
  check('aucun conflit', etape.detail.conflicts.length === 0);
  check('aucune référence sans fichier', etape.detail.missing.length === 0);

  check('la reprise a bien été LANCÉE à distance',
    transport.commands.some((c) => c.command.includes('adopt-project-media.js --apply --json')));
  check('…depuis le répertoire du backend déployé',
    transport.commands.some((c) => c.command.startsWith(`cd ${BACKEND_DIR} &&`)));

  const c = await Company.findById(company._id).lean();
  check('le logo legacy porte maintenant un descripteur',
    c.logosMedia.header.objectKey === LEGACY[0]);
  check('…qui déclare l’autorité PROJECT', c.logosMedia.header.authority === 'PROJECT');
  check('…avec l’empreinte des octets DISTANTS',
    c.logosMedia.header.sha256 === sha256(octets.get(LEGACY[0])));
  check('les noms historiques sont conservés',
    (await ProjectMedia.find({ objectKey: { $in: LEGACY } }).lean()).length === 2);
  check('le poste qui déploie n’a reçu aucun fichier',
    (await fs.readdir(LOCAL)).sort().join() === ['.gitkeep', NEUF_CLE].sort().join());
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LA PUBLICATION : le legacy sans transfert, le neuf transféré');
{
  const etape = resultat.steps.find((s) => s.step === 'media_publish');
  check('les 3 médias (2 legacy + 1 neuf) sont examinés', etape.detail.scanned === 3);
  check('les 3 sont publiés', etape.detail.published === 3);
  check('SEUL le média neuf a été transféré',
    etape.detail.transferred.length === 1 && etape.detail.transferred[0] === NEUF_CLE);
  check('les médias legacy n’ont PAS été réuploadés',
    !etape.detail.transferred.some((k) => LEGACY.includes(k)));
  check('aucun média manquant', etape.detail.missing.length === 0);
  check('aucune divergence d’empreinte', etape.detail.mismatched.length === 0);

  const publies = await ProjectMedia.find({ publicationState: 'PUBLISHED' }).lean();
  check('3 médias PUBLISHED en base', publies.length === 3);
  check('…tous sur la nouvelle destination',
    publies.every((m) => m.publishedHost === NOUVEAU_HOTE));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LE HEALTHCHECK PUBLIC : 0 MÉDIA 404');
{
  const validate = resultat.steps.find((s) => s.step === 'validate');
  check('la validation a réussi', validate.status === 'ok');
  check('le contrôle des médias déclare OK', validate.detail.mediaOk === true);

  const mediasSondes = sondes.filter((u) => u.includes('/uploads/'));
  check('des médias ont réellement été sondés', mediasSondes.length > 0);
  check('AUCUN média n’a répondu 404',
    mediasSondes.every((u) => estServi(u)));

  // Le cœur de l'incident du 07/08.
  check('le média du Panel a été testé sur l’hôte du Panel',
    sondes.includes(MEDIA_PANEL_URL));
  check('…et JAMAIS recomposé contre le domaine du client',
    !sondes.some((u) => u.includes('7dda6e2d') && !u.includes(PANEL_HOTE)));

  check('les médias du projet ont été testés sur le domaine du projet',
    mediasSondes.some((u) => u.startsWith(`https://${NOUVEAU_HOTE}/uploads/`)));
  check('…et jamais portés sur l’hôte du Panel',
    !sondes.some((u) => u.startsWith(`https://${PANEL_HOTE}/uploads/`) && !u.includes('7dda6e2d')));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('PENDANT LE DÉPLOIEMENT, LA DESTINATION N’EST PAS ENCORE UNE ADRESSE');
{
  /**
   * La destination est `DEPLOYING` tant que le run n'a pas abouti. Les médias
   * du PROJET se résolvent donc en chemins relatifs — servis par le backend qui
   * répond, et c'est exact. Ceux du PANEL, eux, sont déjà absolus : ils ne
   * dépendent d'aucune destination de ce projet, à aucun moment.
   */
  const pendant = JSON.parse(await bootstrapServi());
  check('média du projet pendant le run → chemin relatif',
    pendant.company.logos.header === `/uploads/${LEGACY[0]}`);
  check('média du Panel pendant le run → déjà absolu, sur le Panel',
    pendant.developer.logo.url === MEDIA_PANEL_URL);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LA FINALISATION EST PERSISTÉE, PAS DÉDUITE');
{
  await targets.recordDeployment(String(destination._id), {
    pipeline: resultat, version: HEAD, ok: resultat.ok, user: 'test', durationMs: resultat.durationMs,
  });
  const relu = await DeploymentTarget.findById(destination._id).lean();
  check('target.state = DEPLOYED', relu.state === 'DEPLOYED');
  check('currentVersion = HEAD', relu.currentVersion === HEAD);
  check('l’historique porte le run', (relu.history ?? []).length === 1);
  check('…avec toutes les étapes du pipeline',
    relu.history[0].steps.length === PIPELINE_STEPS.length);
  check('…et l’étape de reprise y figure',
    relu.history[0].steps.some((s) => s.step === 'project_media_adopt' && s.status === 'ok'));
  check('finalisation : succès enregistré', relu.history[0].success === true);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LA PROJECTION SERVIE — chaque média chez son autorité');
{
  // La destination est DEPLOYED : les médias du PROJET portent désormais son
  // domaine, sans qu'aucune fiche n'ait été réécrite.
  const servi = JSON.parse(await bootstrapServi());
  check('le logo du garage → domaine SB Auto',
    servi.company.logos.header === `https://${NOUVEAU_HOTE}/uploads/${LEGACY[0]}`);
  check('l’image d’accueil neuve → domaine SB Auto',
    servi.company.heroImage === `https://${NOUVEAU_HOTE}/uploads/${NEUF_CLE}`);
  check('l’avant/après legacy → domaine SB Auto',
    servi.chapters[0].heroImage === `https://${NOUVEAU_HOTE}/uploads/${LEGACY[1]}`);
  check('le logo du développeur → domaine du PANEL',
    servi.developer.logo.url === MEDIA_PANEL_URL);
  check('…et il déclare son autorité', servi.developer.logo.authority === 'PANEL');
  check('aucune adresse du projet ne porte l’hôte du Panel',
    ![servi.company.logos.header, servi.company.heroImage, servi.chapters[0].heroImage]
      .some((u) => u.includes(PANEL_HOTE)));

  /**
   * L'INVARIANT DU §6, VÉRIFIÉ SUR LA PROJECTION FINALE :
   * ce que l'application affiche est exactement ce que le healthcheck teste.
   */
  const t = serveurDistant();
  const avant = sondes.length;
  const { checkPublicMedia } = await import('../deployment-engine/health.js');
  const rapport = await checkPublicMedia(t, NOUVEAU_HOTE, {
    origins: [{ label: 'vitrine', host: NOUVEAU_HOTE }, { label: 'manager', host: `manager.${NOUVEAU_HOTE}` }],
  });
  const nouvelles = sondes.slice(avant);
  check('healthcheck sur la projection finale : aucun média cassé',
    rapport.ok === true && rapport.brokenCount === 0);
  check('URL affichée === URL testée (média du Panel)',
    nouvelles.includes(servi.developer.logo.url));
  check('URL affichée === URL testée (médias du projet)',
    [servi.company.logos.header, servi.company.heroImage, servi.chapters[0].heroImage]
      .every((u) => nouvelles.includes(u)));
  check('aucune adresse inventée par le contrôle',
    nouvelles.every((u) => [
      servi.developer.logo.url, servi.company.logos.header,
      servi.company.heroImage, servi.chapters[0].heroImage,
    ].includes(u)));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('REJOUER LE DÉPLOIEMENT NE MUTE RIEN');
{
  const avantMedias = await ProjectMedia.find({}).sort({ objectKey: 1 }).lean();
  const t2 = serveurDistant();
  const r2 = await runPipeline({
    transport: t2, target: cible, artifact: ARTIFACT, version: HEAD,
    options: {
      backendPort: 5002, env: 'TEST',
      remoteEnv: {
        ENV: 'TEST', MONGODB_URI: 'mongodb://x/y', DB_TEST: 'sbauto_test',
        JWT_SECRET: 'x'.repeat(40), INTEGRATED_API_ENCRYPTION_KEY: 'a'.repeat(64),
      },
      health: { localRetries: 1, localDelayMs: 0, publicRetries: 1, publicDelayMs: 0 },
      resolveUploadsSources: async () => ({
        identityId: 'identite-sbauto06',
        sources: [{ host: ANCIEN_HOTE, sharedUploadsPath: ANCIEN_PARTAGE, projectIdentityId: 'identite-sbauto06' }],
      }),
      adoptApplicationMedia: async ({ transport: t, backendDir }) => {
        const issue = await adoption.runRemoteProjectMediaAdoption({ transport: t, backendDir });
        if (!issue.ok) throw new Error(`${issue.code} — ${issue.message}`);
        return issue.report;
      },
      publishApplicationMedia: async ({ transport: t, sharedUploads, host }) =>
        mediaSvc.publishProjectMediaOnDestination({ transport: t, sharedUploads, host, environment: 'TEST' }),
    },
  });

  check('second déploiement : ok', r2.ok === true);
  const adopt2 = r2.steps.find((s) => s.step === 'project_media_adopt');
  check('reprise : 0 création', adopt2.detail.created === 0);
  check('reprise : 0 raccrochage', adopt2.detail.attached === 0);
  const publish2 = r2.steps.find((s) => s.step === 'media_publish');
  check('publication : 0 transfert', publish2.detail.transferred.length === 0);
  check('publication : les 3 sont déjà publiés', publish2.detail.alreadyPublished === 3);
  const migration2 = r2.steps.find((s) => s.step === 'uploads_migrate');
  check('migration : idempotente', migration2.detail.migrated === 0);

  const apres = await ProjectMedia.find({}).sort({ objectKey: 1 }).lean();
  check('aucun ProjectMedia ajouté', apres.length === avantMedias.length);
  check('aucun mediaId réattribué',
    apres.map((m) => m.mediaId).join() === avantMedias.map((m) => m.mediaId).join());
  check('aucun fichier supprimé sur la destination',
    LEGACY.every((n) => disqueDistant.has(`${PARTAGE}/${n}`))
    && disqueDistant.has(`${PARTAGE}/${NEUF_CLE}`));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('UN CONFLIT DE REPRISE ARRÊTE LE DÉPLOIEMENT');
{
  const t3 = new FakeTransport();
  t3.exec = async () => ({
    code: 2,
    stdout: `${adoption.RAPPORT_DEBUT}${JSON.stringify({
      mode: 'APPLY', created: 0, attached: 0, missing: [],
      conflicts: [{ collection: 'companies', field: 'logos.header', objectKey: 'a.webp', attachedObjectKey: 'b.webp' }],
    })}${adoption.RAPPORT_FIN}`,
    stderr: '',
  });
  const issue = await adoption.runRemoteProjectMediaAdoption({ transport: t3, backendDir: BACKEND_DIR });
  check('un conflit distant est rapporté comme tel',
    issue.ok === false && issue.code === 'PROJECT_MEDIA_ADOPT_CONFLICT');

  const t4 = new FakeTransport();
  t4.exec = async () => ({ code: 0, stdout: 'npm notice quelque chose', stderr: '' });
  const muet = await adoption.runRemoteProjectMediaAdoption({ transport: t4, backendDir: BACKEND_DIR });
  check('une étape MUETTE est un échec, jamais un succès',
    muet.ok === false && muet.code === 'PROJECT_MEDIA_ADOPT_UNREADABLE');
  check('…et la sortie brute est conservée pour le rapport', muet.tail.includes('npm notice'));
}

assert.equal(typeof runPipeline, 'function');

console.log(`\n${ok} réussis, ${ko} échoués`);
await mongoose.disconnect();
await serveur.stop();
await fs.rm(LOCAL, { recursive: true, force: true });
await fs.rm(DISTANT, { recursive: true, force: true });
process.exit(ko === 0 ? 0 : 1);
