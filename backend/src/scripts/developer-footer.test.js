/**
 * « RÉALISÉ PAR … » — du Panel jusqu'au footer du site.
 *
 * L'entreprise qui édite et opère un projet est publiée par le PANEL, qui en
 * est l'autorité. Le projet en conserve la dernière version reçue : le footer
 * reste donc juste quand le Panel est injoignable.
 *
 * Le lien était auparavant déduit de la première « référence » de type lien de
 * l'entreprise locale — une donnée qui ne dit pas cela. Il vient désormais du
 * site réellement renseigné, ou n'existe pas.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'developer_test';
process.env.DB_PROD = 'developer_prod';
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

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();

const { PanelCompanyConfiguration } = await import('../models/PanelConfiguration.model.js');
const fsp = await import('node:fs/promises');
const path = await import('node:path');

/**
 * On appelle la vraie fonction du contrôleur via son module — elle n'est pas
 * exportée, on rejoue donc l'appel complet du bootstrap public.
 */
const { bootstrap } = await import('../controllers/public.controller.js');

const appeler = async () => {
  let charge = null;
  const res = {
    status: () => res,
    json: (corps) => { charge = corps; return res; },
  };
  await bootstrap({}, res, (err) => { if (err) throw err; });
  return charge?.data ?? charge;
};

const poserPanel = async (identity, domains) => {
  await PanelCompanyConfiguration.findOneAndUpdate(
    { key: 'SINGLETON' },
    { $set: { key: 'SINGLETON', identity, domains, environment: 'TEST' } },
    { upsert: true },
  );
};

/* ────────────────────────────────────────────────────────────────────────── */
section('1. Le Panel a publié un nom ET un site');
{

  await poserPanel({ name: 'L.Y Solution' }, { websiteUrl: 'https://lysolution.fr' });
  const data = await appeler();

  check('le bloc développeur est publié', Boolean(data.developer));
  check('…avec le nom du PANEL, pas le nom local', data.developer.name === 'L.Y Solution');
  check('…et le site publié', data.developer.websiteUrl === 'https://lysolution.fr');
}

/* ────────────────────────────────────────────────────────────────────────── */
section('2. Un nom sans site — le footer affichera le nom, sans lien');
{
  await poserPanel({ name: 'L.Y Solution' }, { websiteUrl: null });
  const data = await appeler();
  check('le nom reste publié', data.developer.name === 'L.Y Solution');
  check('…et aucun lien n’est inventé', data.developer.websiteUrl === null);
}

/* ────────────────────────────────────────────────────────────────────────── */
section('3. Une adresse relative n’est jamais publiée');
{
  // Un lien relatif pointerait sur le site du CLIENT : pire que pas de lien.
  for (const valeur of ['/a-propos', 'lysolution.fr', 'ftp://lysolution.fr', '   ']) {
    await poserPanel({ name: 'L.Y Solution' }, { websiteUrl: valeur });
    const data = await appeler();
    check(`« ${valeur.trim() || '(vide)'} » → aucun lien`, data.developer.websiteUrl === null);
  }

  await poserPanel({ name: 'L.Y Solution' }, { websiteUrl: 'http://lysolution.fr' });
  check('…mais http:// est accepté', (await appeler()).developer.websiteUrl === 'http://lysolution.fr');
}

/* ────────────────────────────────────────────────────────────────────────── */
section('4. Aucune configuration du Panel — AUCUN bloc, aucun repli local');
{
  // Le projet porte toujours une entreprise développeur locale (« Studio
  // local ») : elle ne doit plus jamais servir de repli. Un footer qui annonce
  // un éditeur que l'autorité ne connaît pas est un footer qui ment.
  await PanelCompanyConfiguration.deleteMany({});
  const data = await appeler();
  check('aucun bloc développeur', data.developer === null);
  /**
   * LA PREUVE A CHANGÉ DE NATURE — et elle est plus forte.
   *
   * Ce contrôle posait autrefois un nom dans la fiche locale `DevCompany` et
   * vérifiait que le footer ne le reprenait pas. Un repli restait donc
   * possible : il était seulement inutilisé.
   *
   * La fiche locale n'existe plus du tout. On ne vérifie donc plus qu'elle
   * n'est pas lue, on vérifie qu'elle est INTROUVABLE — un repli ne peut pas
   * réapparaître par inadvertance dans du code qui ne compile pas.
   */
  /**
   * LA RACINE SE CALCULE DEPUIS CE FICHIER, PAS DEPUIS LE RÉPERTOIRE COURANT.
   *
   * `path.resolve(process.cwd(), 'src')` supposait que la suite soit lancée
   * depuis `backend/`. Lancée depuis la racine du dépôt — ce que fait tout
   * lanceur global — elle pointait sur un `src/` inexistant.
   *
   * Le plus grave n'était pas le plantage, mais l'assertion d'AVANT : « le
   * modèle local a été retiré du projet » passait parce que le chemin sondé
   * n'existait pas. Elle aurait passé de la même façon avec le modèle bien
   * présent dans `backend/src/models`. Un contrôle d'absence qui vise à côté
   * ne prouve rien, et se tait.
   *
   * `import.meta.url` ne dépend ni du répertoire de lancement ni du nom du
   * dossier qui contient le dépôt.
   */
  const { fileURLToPath } = await import('node:url');
  const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  check('DEVELOPER_FOOTER_PATH_IS_REPOSITORY_RELATIVE : la racine sondée existe bien',
    await fsp.access(path.join(racine, 'controllers')).then(() => true).catch(() => false));
  const modeleAbsent = await fsp.access(path.join(racine, 'models/DevCompany.model.js'))
    .then(() => false).catch(() => true);
  check('le modèle local a été retiré du projet', modeleAbsent);

  const controleur = await fsp.readFile(path.join(racine, 'controllers/public.controller.js'), 'utf8');
  const sansCommentaires = controleur
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  check('…et le contrôleur public ne le connaît plus',
    !/DevCompany/.test(sansCommentaires));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('5. Panel appairé mais entreprise sans nom — le bloc disparaît aussi');
{
  // Une URL sans nom ne fait pas une signature : « Réalisé par » suivi d'un
  // lien anonyme n'apprend rien.
  await poserPanel({ name: '   ' }, { websiteUrl: 'https://lysolution.fr' });
  const data = await appeler();
  check('aucun bloc sans nom', data.developer === null);

  await poserPanel({ name: 'L.Y Solution' }, { websiteUrl: 'https://lysolution.fr' });
  check('…et il revient dès que le nom existe', (await appeler())?.developer?.name === 'L.Y Solution');
}

/* ────────────────────────────────────────────────────────────────────────── */
section('5 bis. La dernière configuration reçue survit à une panne du Panel');
{
  // Le projet ne rappelle pas le Panel pour afficher son footer : il lit ce
  // qu'il a persisté. Une panne ne change donc rien à ce qu'on sait déjà.
  const data = await appeler();
  check('le nom reste affiché sans le Panel', data.developer?.name === 'L.Y Solution');
  check('…et son site aussi', data.developer?.websiteUrl === 'https://lysolution.fr');
}

/* ────────────────────────────────────────────────────────────────────────── */
section('6. Le footer consomme cette donnée, et elle seule');
{
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const footer = await fs.readFile(path.join(racine, 'vitrine/src/components/layout/Footer.tsx'), 'utf8');
  const sansCommentaires = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const rendu = sansCommentaires(footer);

  check('le footer lit l’identité publiée', /const developer = data\?\.developer;/.test(rendu));
  check('« Réalisé par » est affiché', /Réalisé par/.test(rendu));
  check('le lien n’apparaît qu’avec une adresse',
    /\{developer\.websiteUrl \? \(/.test(rendu));
  check('…sinon le nom seul', /<span className="font-medium">\{developer\.name\}<\/span>/.test(rendu));
  check('lien externe sécurisé', /rel="noopener noreferrer"/.test(rendu) && /target="_blank"/.test(rendu));
  check('plus de lien deviné depuis les « références »',
    !/references\.some\(\(r\) => r\.type === 'LINK'\)/.test(rendu));
  check('une petite icône accompagne le lien', /<Globe className="h-3 w-3 shrink-0"/.test(rendu));
  /**
   * LE SURVOL EST SOIGNÉ — vérifié sur le SOULIGNEMENT, plus sur l'opacité.
   *
   * Le pied de page ne se dégrade plus par `opacity` : ses gris viennent de
   * `color-mix` contre le fond, ce qui reste juste sur une palette claire là
   * où une opacité globale ne l'était pas. Chercher `hover:opacity-100` ici
   * revenait donc à exiger une technique abandonnée plutôt que le RÉSULTAT
   * — un lien qui se distingue quand on le vise.
   */
  check('…et le survol est soigné', /hover:underline/.test(rendu));
  check('le footer ne lit PLUS l’entreprise locale', !/devCompany/.test(rendu));
  check('aucun nom ni URL en dur',
    !/lysolution|L\.Y Solution/i.test(rendu));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('7. Le Manager ne modifie plus cette identité');
{
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const lire = (rel) => fs.readFile(path.join(racine, rel), 'utf8');

  const page = await lire('manager/src/pages/dev/DevCompanyPage.tsx');
  const client = await lire('manager/src/lib/api.ts');
  const routesIndex = await lire('backend/src/routes/index.js');

  /**
   * LA SURFACE LOCALE A DISPARU — pas seulement son formulaire.
   *
   * Une première étape avait fermé l'ÉCRITURE (409) en laissant la lecture
   * ouverte. C'était un état de transition : tant qu'une route sert une fiche
   * développeur locale, quelqu'un finit par la lire.
   *
   * Il n'y a plus de route du tout, plus de contrôleur, plus de modèle.
   */
  check('la route locale n’est plus montée', !/dev-company', devCompanyRoutes/.test(routesIndex));
  check('…ni même importée', !/devCompany\.routes/.test(routesIndex));
  check('le client du Manager ne l’appelle plus',
    !/updateDevCompany/.test(client) && !/getDevCompany/.test(client));

  check('la page lit la configuration reçue du Panel',
    /api\.getPanelConnection\(\)/.test(page));
  check('…et n’édite plus rien', !/<Input/.test(page) && !/onChange=/.test(page));
  check('…plus aucun enregistrement', !/FloatingSaveWidget/.test(page) && !/useFloatingSave/.test(page));
  check('un bandeau explique qui décide',
    /Configuration administrée depuis le Panel/.test(page));
  check('…et un bouton mène au Panel', /Ouvrir le Panel/.test(page));
  check('…ouvert sans exposer la page appelante', /'noopener,noreferrer'/.test(page));
  check('sans Panel appairé, le bouton n’apparaît pas',
    /panelUrl \? \(/.test(page));
  check('la provenance et la date sont affichées',
    /Appliquée le/.test(page) && /company\.source === 'BOOTSTRAP'/.test(page));
  check('l’absence de signataire est dite avec sa conséquence',
    /Aucun signataire publié[\s\S]{0,160}sera refusée/.test(page));
}

/* ────────────────────────────────────────────────────────────────────────── */
section('8. Chaîne complète — publication Panel → réception → Manager, sans rechargement');
{
  const { applyCompanyProfile, getCompanyConfiguration } = await import(
    '../services/panelConfiguration/panelConfiguration.service.js'
  );

  // Charge utile telle que le Panel la publie (companyPublicProfile).
  const profil = (over = {}) => ({
    companyId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    slug: 'ly-solution',
    environment: 'TEST',
    version: 1,
    identity: { name: 'Identité initiale', tagline: 'Avant', legalName: null, description: null },
    branding: { logoUrl: 'https://panel.test/uploads/logo-1.webp' },
    domains: { websiteUrl: 'https://avant.test' },
    signer: { firstName: 'Jean', lastName: 'Dupont', jobTitle: 'Gérant', email: 'jean@exemple.fr' },
    references: [{ type: 'LINK', icon: 'bi-star', name: 'Site', value: 'https://ref.test', order: 0 }],
    ...over,
  });

  await PanelCompanyConfiguration.deleteMany({});
  const premier = await applyCompanyProfile(profil(), 'BOOTSTRAP');
  check('la première publication est appliquée', premier.applied === true);

  // Ce que le Manager LIT — la même source que la vitrine, sans cache.
  const vu1 = await getCompanyConfiguration();
  check('le Manager voit l’identité publiée', vu1.identity.name === 'Identité initiale');
  check('…le signataire', vu1.signer?.email === 'jean@exemple.fr');
  check('…les références', vu1.references?.length === 1);
  check('…le logo, en URL absolue', vu1.branding?.logoUrl === 'https://panel.test/uploads/logo-1.webp');
  const vitrine1 = await appeler();
  check('…et la vitrine la même chose', vitrine1.developer?.websiteUrl === 'https://avant.test');

  // MODIFICATION dans le Panel, puis nouvelle publication.
  const second = await applyCompanyProfile(profil({
    version: 2,
    identity: { name: 'Identité modifiée', tagline: 'Après', legalName: null, description: null },
    branding: { logoUrl: 'https://panel.test/uploads/logo-2.webp' },
    domains: { websiteUrl: 'https://apres.test' },
    signer: { firstName: 'Marie', lastName: 'Martin', jobTitle: 'Directrice', email: 'marie@exemple.fr' },
    references: [],
  }), 'SYNC');
  check('la seconde publication est appliquée', second.applied === true);

  // Le Manager relit la MÊME source : aucune valeur d'avant ne subsiste.
  const vu2 = await getCompanyConfiguration();
  check('le nom a changé', vu2.identity.name === 'Identité modifiée');
  check('…le slogan aussi', vu2.identity.tagline === 'Après');
  check('…le logo aussi', vu2.branding?.logoUrl === 'https://panel.test/uploads/logo-2.webp');
  check('…le signataire aussi', vu2.signer?.email === 'marie@exemple.fr');
  check('…les références supprimées ont bien disparu', (vu2.references || []).length === 0);
  check('…la version est celle publiée', vu2.version === 2);
  check('…et la source est tracée', vu2.source === 'SYNC');
  check('AUCUN reliquat de l’identité précédente',
    !JSON.stringify(vu2).includes('Identité initiale')
    && !JSON.stringify(vu2).includes('jean@exemple.fr')
    && !JSON.stringify(vu2).includes('logo-1.webp'));

  const vitrine2 = await appeler();
  check('la vitrine suit aussi', vitrine2.developer?.name === 'Identité modifiée');
  check('…et son lien', vitrine2.developer?.websiteUrl === 'https://apres.test');

  // Une publication PLUS ANCIENNE ne doit pas réécrire l'identité courante.
  const vieille = await applyCompanyProfile(profil({ version: 1 }), 'SYNC');
  check('une version antérieure est refusée', vieille.applied === false && vieille.reason === 'OLDER_VERSION');
  check('…et l’identité courante est intacte',
    (await getCompanyConfiguration()).identity.name === 'Identité modifiée');
}

/* ────────────────────────────────────────────────────────────────────────── */
section('9. L’écran Manager se rafraîchit seul, sans cache local');
{
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const lire = (rel) => fs.readFile(path.join(racine, rel), 'utf8');

  const page = await lire('manager/src/pages/dev/DevCompanyPage.tsx');
  const hook = await lire('manager/src/hooks/useResource.ts');

  check('la page sonde le serveur', /usePollWhile\(true, \(\) => refresh\(\), 10_000\)/.test(page));
  check('…silencieusement (pas de clignotement)', /refresh = React\.useCallback\(\(\) => run\(true\)/.test(hook));
  check('…et revenir sur l’onglet rafraîchit tout de suite',
    /visibilitychange/.test(await lire('manager/src/hooks/useContractJourney.ts')));
  check('une resynchronisation immédiate est offerte',
    /api\.syncPanelNow\(\)/.test(page) && /Resynchroniser/.test(page));

  // Le point capital : aucune persistance locale de cette identité.
  check('AUCUN cache local (localStorage/sessionStorage)',
    !/localStorage|sessionStorage/.test(page));
  check('…et la donnée vient d’un appel serveur, pas d’un état figé',
    /api\.getPanelConnection\(\)/.test(page));
  check('…aucune valeur par défaut codée en dur',
    !/L\.Y Solution|Studio/.test(page));
}

await disconnectDatabase();
console.log(`\n${pass} réussis, ${fail} échoués`);
await mongod.stop();
process.exit(fail === 0 ? 0 : 1);
