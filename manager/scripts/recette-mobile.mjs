/**
 * RECETTE MOBILE DU MANAGER — inspection RUNTIME de l'architecture de défilement.
 *
 * ── CE QU'ELLE VÉRIFIE, ET POURQUOI ELLE EXISTE ─────────────────────────────
 *
 * Les tests de `scrollArchitecture.test.mjs` figent la STRUCTURE (qui porte le
 * défilement, qui est collé, qui contient son débordement). Ils ne peuvent pas
 * dire si un DOIGT fait descendre la page. C'est ce que fait cette recette :
 * elle sert le build, bouchonne l'API, et rejoue à chaque viewport le parcours
 * réel — un geste tactile, la barre du haut, le tiroir, une modale, un
 * changement de page — en mesurant `window.scrollY` après chaque geste.
 *
 * La règle qu'elle protège : 1 GESTE = 1 RÉPONSE. Aucun geste absorbé.
 *
 * ── LANCEMENT ───────────────────────────────────────────────────────────────
 *
 *   npm run build
 *   npx playwright install chromium     # une seule fois
 *   npm run test:mobile
 *
 * Playwright n'est PAS une dépendance du manager : cette recette a besoin d'un
 * navigateur, `npm test` non. Elle reste donc hors de `npm test`, à lancer
 * quand on touche au layout.
 *
 * `--avant` rejoue l'ANCIENNE architecture (layout figé à la hauteur de
 * l'écran, défilement déporté dans <main>, barre du haut `static`) par-dessus
 * le même build : utile pour vérifier que la recette détecte bien le défaut
 * qu'elle est censée interdire.
 *
 * ── LIMITE CONNUE ───────────────────────────────────────────────────────────
 *
 * Chromium sans interface n'a pas de barre d'adresse rétractable : `100vh` y
 * vaut toujours la hauteur visible. L'écart `100vh` / viewport réel — la cause
 * première du double défilement sur un vrai téléphone — n'est donc PAS
 * reproductible ici. Ce que la recette prouve, c'est qu'il n'existe plus qu'un
 * seul propriétaire de défilement et que rien n'absorbe les gestes ; l'absence
 * de `vh` dans les sources est verrouillée, elle, par le test structurel.
 */
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, dirname, resolve } from 'node:path';

/*
  Playwright n'est PAS une dépendance du manager : `npm test` doit rester
  installable et exécutable sans navigateur. On le charge donc à la demande, et
  on dit quoi faire s'il manque plutôt que de laisser un ERR_MODULE_NOT_FOUND.
*/
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error(
    [
      'Cette recette a besoin de Playwright, qui n’est pas une dépendance du manager.',
      '  npm i -D playwright && npx playwright install chromium',
      'puis relancez : npm run test:mobile',
    ].join('\n')
  );
  process.exit(2);
}

const ICI = dirname(fileURLToPath(import.meta.url));
const DIST = process.argv.find((a) => !a.startsWith('--') && a.endsWith('dist'))
  || resolve(ICI, '..', 'dist');
const AVANT = process.argv.includes('--avant');
const PORT = 6199;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
};

const serveur = createServer(async (req, res) => {
  const chemin = decodeURIComponent(req.url.split('?')[0]);
  let fichier = join(DIST, chemin);
  if (!existsSync(fichier) || chemin === '/') fichier = join(DIST, 'index.html');
  try {
    const buf = await readFile(fichier);
    res.writeHead(200, { 'Content-Type': MIME[extname(fichier)] || 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404).end('nope');
  }
});
if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`Build introuvable dans ${DIST} — lancez d'abord : npm run build`);
  process.exit(2);
}
await new Promise((r) => serveur.listen(PORT, r));

// ── Bouchon d'API ───────────────────────────────────────────────────────────
const UTILISATEUR = {
  _id: 'u1', email: 'dev@recette.test', name: 'Recette Mobile', role: 'DEV',
  createdAt: '2026-01-01T00:00:00.000Z',
};
const ENTREPRISE = {
  _id: 'c1', name: 'Entreprise de recette', tagline: 'Recette mobile', homeIntro: '',
  keyFigures: [], media: [], logos: { header: '', favicon: '' }, heroImage: '',
  businessHours: [], address: {},
};

/*
  ══ LES BOUCHONS SUIVENT L'API, ET L'API A CHANGÉ ═══════════════════════════

  Ils décrivaient `/services`, `/faqs`, `/reviews`, `/before-after`,
  `/promotions` — cinq référentiels du moteur d'origine, retirés depuis. La
  recette servait donc des réponses à des routes que plus personne n'appelle,
  et rendait `{}` à toutes celles qui existent : l'écran arrivait vide, et la
  recette « page assez longue » échouait pour une raison sans rapport avec le
  défilement.

  Les deux référentiels d'aujourd'hui sont les CHAPITRES et les PAGES.
*/
const CHAPITRES = Array.from({ length: 14 }, (_, i) => ({
  _id: `c${i}`,
  slug: `chapitre-${i + 1}`,
  title: `Chapitre de recette numéro ${i + 1}`,
  navLabel: `Chapitre ${i + 1}`,
  kicker: `0${(i % 9) + 1} / RECETTE`,
  lead: 'Un chapô assez long pour occuper deux lignes sur un écran étroit.',
  layout: 'PILLARS',
  items: [{ _id: `v${i}`, title: 'Volet', text: 'Texte', icon: 'Minus', order: 10 }],
  published: true,
  showInNav: true,
  navOrder: i * 10,
  order: i,
  heroImage: '',
  seo: { metaTitle: '', metaDescription: '' },
}));

const PAGES = Array.from({ length: 12 }, (_, i) => ({
  _id: `p${i}`,
  slug: `page-${i + 1}`,
  title: `Page éditoriale numéro ${i + 1}`,
  navLabel: `Page ${i + 1}`,
  intro: 'Une introduction de longueur ordinaire.',
  blocks: [],
  published: true,
  showInNav: true,
  order: i,
  heroImage: '',
  seo: { metaTitle: '', metaDescription: '' },
}));

function corpsPour(chemin) {
  if (chemin.endsWith('/auth/me')) return UTILISATEUR;
  if (chemin.endsWith('/company')) return ENTREPRISE;
  if (chemin.endsWith('/chapters')) return CHAPITRES;
  if (chemin.endsWith('/pages')) return PAGES;
  if (chemin.endsWith('/home-content')) return {};
  if (chemin.endsWith('/site-status')) return { status: 'ACTIVE' };
  if (chemin.endsWith('/theme/manager')) return {};
  if (chemin.endsWith('/theme/vitrine')) return {};
  if (chemin.endsWith('/role-appearance')) return {};
  if (chemin.endsWith('/meta')) return { mediaCatalog: [], environment: 'TEST' };
  if (chemin.includes('/system-configuration/network')) return { config: {}, effective: {} };
  if (chemin.includes('/public/network-configuration')) return {};
  if (chemin.includes('/public/bootstrap')) return { company: ENTREPRISE, devCompany: null };
  if (chemin.endsWith('/my-contract')) return null;
  if (chemin.includes('/contact-submissions')) return { items: [], total: 0, unread: 0 };
  return {};
}

// ── Sonde runtime ───────────────────────────────────────────────────────────
const SONDE = `(() => {
  const doc = document.documentElement;
  const defilants = [];
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    const oy = cs.overflowY;
    const peut = oy === 'auto' || oy === 'scroll';
    if (peut && el.scrollHeight > el.clientHeight + 1) {
      defilants.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className && el.className.baseVal !== undefined ? el.className.baseVal : String(el.className || '')).slice(0, 70),
        overflowY: oy,
        overscroll: cs.overscrollBehaviorY,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      });
    }
  }
  const header = document.querySelector('header');
  return {
    docScrollHeight: doc.scrollHeight,
    docClientHeight: doc.clientHeight,
    docScrollWidth: doc.scrollWidth,
    docClientWidth: doc.clientWidth,
    bodyScrollHeight: document.body.scrollHeight,
    bodyClientHeight: document.body.clientHeight,
    scrollY: window.scrollY,
    documentDefile: doc.scrollHeight > doc.clientHeight + 1,
    defilantsImbriques: defilants,
    bodyStyleInline: document.body.getAttribute('style') || '',
    header: header ? {
      top: Math.round(header.getBoundingClientRect().top),
      hauteur: Math.round(header.getBoundingClientRect().height),
      position: getComputedStyle(header).position,
    } : null,
  };
})()`;

// ── Recette ─────────────────────────────────────────────────────────────────
const VIEWPORTS = [
  { nom: '320x568', width: 320, height: 568 },
  { nom: '375x667', width: 375, height: 667 },
  { nom: '390x844', width: 390, height: 844 },
  { nom: '430x932', width: 430, height: 932 },
  { nom: '768x1024', width: 768, height: 1024 },
  { nom: '1440x900 (desktop)', width: 1440, height: 900, desktop: true },
];

/** La clé de stockage de CE projet — même dérivation que `vite.config.ts`. */
const CLE_SESSION = `${JSON.parse(
  await readFile(resolve(dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'),
).name.replace(/-manager$/, '')}.manager.session.token`;

const navigateur = await chromium.launch();
const resultats = [];

for (const vp of VIEWPORTS) {
  const context = await navigateur.newContext({
    viewport: { width: vp.width, height: vp.height },
    hasTouch: !vp.desktop,
    isMobile: !vp.desktop,
    deviceScaleFactor: vp.desktop ? 1 : 3,
  });

  await context.route('**/api/**', (route) => {
    const chemin = new URL(route.request().url()).pathname;
    // Le client déballe `json.data` : le bouchon doit emballer comme le backend.
    const corps = { data: corpsPour(chemin) };
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corps) });
  });
  /*
    ══ LA CLÉ DE SESSION EST CELLE DU PROJET ═══════════════════════════════

    Elle valait `manager.session.token` — la clé GLOBALE, que `lib/api.ts`
    PURGE désormais au chargement pour empêcher deux managers du parc de se
    prêter leur jeton (`lib/projectIdentity.ts`). La recette posait donc un
    jeton immédiatement effacé, se retrouvait sur l'écran de connexion, et
    ses vingt assertions de défilement portaient sur un formulaire de login.

    On dérive la clé comme le fait `vite.config.ts` : depuis le nom du paquet.
    Recopier « ly-solution » ici la ferait mentir à la première duplication.
  */
  await context.addInitScript((cle) => {
    localStorage.setItem(cle, 'jeton-de-recette');
  }, CLE_SESSION);

  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e)));

  /** Un SEUL geste tactile (ou molette sur desktop) vers le bas / le haut. */
  const geste = async (yDistance) => {
    const avant = await page.evaluate('window.scrollY');
    if (vp.desktop) {
      await page.mouse.move(vp.width / 2, vp.height / 2);
      await page.mouse.wheel(0, -yDistance);
      await page.waitForTimeout(300);
    } else {
      /* UN doigt, UN glissement — évènements tactiles réels.
         `Input.synthesizeScrollGesture` en source `touch` ne produit rien en
         headless ; la séquence touchStart/touchMove/touchEnd, si. C'est aussi
         la plus fidèle au geste qu'on veut mesurer. */
      const x = Math.round(vp.width / 2);
      const depart = yDistance < 0
        ? Math.round(vp.height * 0.75)
        : Math.round(vp.height * 0.30);
      const arrivee = depart + yDistance;
      const toucher = (type, y) => cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
      });
      await toucher('touchStart', depart);
      const pas = yDistance < 0 ? -20 : 20;
      for (let y = depart + pas; pas < 0 ? y >= arrivee : y <= arrivee; y += pas) {
        await toucher('touchMove', y);
      }
      await toucher('touchEnd', arrivee);
      await page.waitForTimeout(300);
    }
    const apres = await page.evaluate('window.scrollY');
    return { avant, apres, deplacement: apres - avant };
  };

  const sonder = () => page.evaluate(SONDE);

  /* « 1 geste = 1 réponse », dans le sens où il RESTE de la place : collé en bas
     de page, un geste vers le bas ne peut rien produire, et ce n'est pas un
     défaut. On choisit donc la direction selon la position courante. */
  const unGesteRepond = async (nom) => {
    const e = await sonder();
    // Une page qui tient dans l'écran n'a rien à défiler : ce n'est pas un échec.
    if (e.docScrollHeight <= e.docClientHeight + 320) {
      noter(`${nom} (page plus courte que l'écran — sans objet)`, true, '');
      return;
    }
    const versLeBas = e.scrollY + e.docClientHeight < e.docScrollHeight - 320;
    const g = await geste(versLeBas ? -300 : 300);
    noter(nom, Math.abs(g.deplacement) > 100, `${versLeBas ? 'bas' : 'haut'} ${JSON.stringify(g)}`);
  };

  const cas = [];
  const noter = (nom, ok, detail) => cas.push({ nom, ok, detail });

  /* 768 px EST le point de bascule `md:` : la sidebar y est déjà permanente et
     le bouton du tiroir masqué. On regarde donc l'écran, pas la largeur. */
  const tiroirDisponible = async () =>
    await page.locator('button[aria-label="Ouvrir le menu"]').isVisible();

  /* Ouvre le tiroir par un clic AUX COORDONNÉES RÉELLES du bouton.
     `page.click()` fait d'abord un `scrollIntoViewIfNeeded`, et Blink mesure mal
     la boîte d'un élément `sticky` : il défilait la page de quelques centaines
     de pixels AVANT le clic, ce qu'aucun doigt ne fait. Le clic brut reproduit
     le geste réel — et vérifie au passage que le bouton est bien épinglé en
     haut de l'écran alors que la page est défilée. */
  const ouvrirTiroir = async () => {
    const b = await page.locator('button[aria-label="Ouvrir le menu"]').boundingBox();
    noter('bouton du menu épinglé en haut malgré le défilement', b.y < 60, JSON.stringify(b));
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(600);
  };

  /*
    `/faq` n'existe plus : la route est tombée avec le référentiel du même nom.
    La recette atterrissait donc sur la page « introuvable » — courte, sans
    en-tête collant — et mourait sur l'attente du `<header>`.

    « Pages » est le bon substitut : c'est une LISTE, donc une page plus
    haute que l'écran à tous les viewports, et elle porte les trois gestes que
    la recette mesure — un interrupteur, une navigation, une modale de
    confirmation.
  */
  await page.goto(`http://localhost:${PORT}/pages`, { waitUntil: 'networkidle' });
  if (AVANT) {
    // Rejoue l'architecture d'AVANT sur le même build : layout verrouillé à la
    // hauteur de l'écran, défilement déporté dans <main>, barre non collante.
    await page.addStyleTag({
      content: `
        html, body, #root { height: 100%; }
        body { min-height: auto; }
        #root > div { height: 100vh !important; overflow: hidden !important;
                      min-height: 0 !important; }
        #root > div > div:last-child { overflow: hidden !important; }
        header { position: static !important; }
        main { flex: 1 1 0%; overflow-y: auto !important; min-height: 0; }
      `,
    });
    await page.waitForTimeout(200);
  }
  /* `state: 'attached'` : à partir de 768 px la barre mobile est masquée et le
     bandeau de suspension absent — le <header> collant existe, mais mesure 0.
     Il reste l'ancre `sticky` du haut de page, et c'est ce qu'on vérifie. */
  await page.waitForSelector('header', { state: 'attached', timeout: 10000 });
  await page.waitForSelector('main', { timeout: 10000 });
  await page.waitForTimeout(400);

  const initial = await sonder();

  /* Un défilement imbriqué n'est LÉGITIME que s'il est local et déclaré : la
     navigation de la sidebar (plus haute que l'écran pour un compte DEV) et le
     corps d'une modale. Tout le reste serait un second propriétaire subi. */
  const ATTENDUS = [/nav/];
  const inattendus = (liste) => liste.filter(
    (d) => !(d.tag === 'nav' && d.overscroll === 'contain')
  );

  // 1. Propriétaire du défilement.
  noter(
    'le document est le propriétaire du défilement',
    initial.documentDefile,
    `docScrollHeight=${initial.docScrollHeight} clientHeight=${initial.docClientHeight}`
  );
  noter(
    'aucun second propriétaire vertical subi',
    inattendus(initial.defilantsImbriques).length === 0,
    JSON.stringify(initial.defilantsImbriques)
  );
  noter(
    'les défilements imbriqués légitimes sont contenus',
    initial.defilantsImbriques.every((d) => d.overscroll === 'contain'),
    JSON.stringify(initial.defilantsImbriques)
  );

  // 2. Page longue.
  noter(
    'page assez longue pour la recette',
    initial.docScrollHeight > initial.docClientHeight * 1.3,
    `${initial.docScrollHeight} vs ${initial.docClientHeight}`
  );

  // 3. Aucun débordement horizontal.
  noter(
    'aucun débordement horizontal',
    initial.docScrollWidth <= initial.docClientWidth,
    `scrollWidth=${initial.docScrollWidth} clientWidth=${initial.docClientWidth}`
  );

  // 4. UN geste = UNE réponse (descente).
  const g1 = await geste(-300);
  noter('1er geste vers le bas → le contenu descend', g1.deplacement > 100, JSON.stringify(g1));

  // 5. Barre du haut toujours collée.
  const apres1 = await sonder();
  noter(
    'barre du haut restée en haut après le 1er geste',
    apres1.header && apres1.header.top === 0 && apres1.header.position === 'sticky',
    JSON.stringify(apres1.header)
  );

  // 6. Descendre jusqu'en bas.
  let gestes = 1;
  let bas = apres1;
  while (bas.scrollY + bas.docClientHeight < bas.docScrollHeight - 2 && gestes < 40) {
    await geste(-600);
    bas = await sonder();
    gestes += 1;
  }
  noter(
    'bas de page atteint sans forcer',
    bas.scrollY + bas.docClientHeight >= bas.docScrollHeight - 2,
    `${gestes} gestes, scrollY=${bas.scrollY}`
  );
  noter(
    'barre du haut visible en bas de page',
    bas.header && bas.header.top === 0,
    JSON.stringify(bas.header)
  );

  // 7. Remontée : un geste = une réponse.
  const g2 = await geste(300);
  noter('1er geste vers le haut → le contenu remonte', g2.deplacement < -100, JSON.stringify(g2));

  // 8bis. Modale : ouverture → verrou, fermeture → restitution.
  /* Déclencheur RÉALISTE : le crayon d'une ligne, choisi PARMI CEUX DÉJÀ
     VISIBLES à la position courante. C'est là que perdre la position de
     défilement se remarque — pas depuis le haut de la page. Et on clique aux
     coordonnées, sans le `scrollIntoView` de `locator.click()`. */
  const cibleModale = await page.evaluate(() => {
    /*
      LE CRAYON NE FAIT PLUS APPARAÎTRE DE MODALE : il NAVIGUE vers la fiche du
      page. Le déclencheur de boîte de dialogue est la corbeille, qui
      demande confirmation avant de supprimer — c'est elle qu'il faut viser
      pour éprouver le gel de la page et la restitution du défilement.
    */
    const btns = [...document.querySelectorAll('button')]
      .filter((b) => b.querySelector('[class*="lucide-trash"]'));
    for (const b of btns) {
      const r = b.getBoundingClientRect();
      if (r.top > 90 && r.bottom < window.innerHeight - 20) {
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
    }
    return null;
  });
  /*
    UNE ÉTAPE SAUTÉE DOIT SE VOIR.

    Ce bloc était entièrement conditionnel : quand le sélecteur du déclencheur
    cessait de correspondre — ce qui est arrivé, la classe de l'icône ayant
    changé de forme —, les cinq assertions de la modale disparaissaient du
    rapport SANS un mot, et la recette annonçait PASS. Un contrôle qui
    s'évapore quand il ne trouve plus sa cible ne protège plus rien.
  */
  noter('un déclencheur de modale a été trouvé sur la page', Boolean(cibleModale), '');
  if (cibleModale) {
    const yAvant = await page.evaluate('window.scrollY');
    await page.mouse.click(cibleModale.x, cibleModale.y);
    await page.waitForTimeout(700);
    const ouverte = await sonder();
    const estModale = await page.$('[role="dialog"]');
    noter('le déclencheur ouvre bien une boîte de dialogue', Boolean(estModale), '');
    if (estModale) {
      noter('modale ouverte → page gelée', /position:\s*fixed/.test(ouverte.bodyStyleInline), ouverte.bodyStyleInline);
      const panneau = await page.evaluate(() => {
        const d = document.querySelector('[role="dialog"]');
        if (!d) return null;
        const r = d.getBoundingClientRect();
        return { haut: Math.round(r.top), bas: Math.round(r.bottom), viewport: window.innerHeight };
      });
      noter(
        'modale entièrement dans l’écran',
        panneau && panneau.haut >= 0 && panneau.bas <= panneau.viewport + 1,
        JSON.stringify(panneau)
      );
      await page.keyboard.press('Escape');
      await page.waitForTimeout(600);
      const refermee = await sonder();
      noter('modale fermée → aucun style résiduel sur body', refermee.bodyStyleInline.trim() === '', `"${refermee.bodyStyleInline}"`);
      noter('modale fermée → position rendue', Math.abs(refermee.scrollY - yAvant) < 5, `${refermee.scrollY} vs ${yAvant}`);
      await unGesteRepond('après la modale, 1 geste = 1 réponse');
    }
  }

  // 8. Menu mobile : ouverture → verrou, fermeture → restitution.
  if (await tiroirDisponible()) {
    const yAvant = await page.evaluate('window.scrollY');
    await ouvrirTiroir();
    const ouvert = await sonder();
    noter(
      'menu ouvert → page gelée',
      /position:\s*fixed/.test(ouvert.bodyStyleInline),
      ouvert.bodyStyleInline
    );
    const gVerrou = await geste(-400);
    noter('menu ouvert → aucun défilement de la page derrière', Math.abs(gVerrou.deplacement) < 5, JSON.stringify(gVerrou));

    // Le voile est SOUS le tiroir (256 px) : on clique près du bord droit,
    // là où il est réellement découvert.
    await page.mouse.click(vp.width - 8, Math.round(vp.height / 2));
    await page.waitForTimeout(800);
    const ferme = await sonder();
    noter('menu fermé → aucun style résiduel sur body', ferme.bodyStyleInline.trim() === '', `"${ferme.bodyStyleInline}"`);
    noter('menu fermé → position de défilement rendue', Math.abs(ferme.scrollY - yAvant) < 5, `${ferme.scrollY} vs ${yAvant}`);
    await unGesteRepond('après le menu, 1 geste = 1 réponse');
  }

  // 9. Changement de page → on refait le test.
  // Parcours réel : sur mobile on passe par le tiroir (ce qui vérifie aussi
  // qu'il se referme ET rend le défilement en naviguant).
  if (await tiroirDisponible()) await ouvrirTiroir();
  await page.locator('a[href="/pages"]:visible').first().click();
  await page.waitForTimeout(1100);
  const nouvelle = await sonder();
  noter('navigation depuis le tiroir → aucun style résiduel sur body', nouvelle.bodyStyleInline.trim() === '', `"${nouvelle.bodyStyleInline}"`);
  noter('changement de page → on repart du haut', nouvelle.scrollY === 0, `scrollY=${nouvelle.scrollY}`);
  noter(
    'changement de page → toujours aucun second propriétaire subi',
    inattendus(nouvelle.defilantsImbriques).length === 0,
    JSON.stringify(nouvelle.defilantsImbriques)
  );
  noter(
    'changement de page → aucun débordement horizontal',
    nouvelle.docScrollWidth <= nouvelle.docClientWidth,
    `${nouvelle.docScrollWidth} vs ${nouvelle.docClientWidth}`
  );
  await unGesteRepond('nouvelle page → 1 geste = 1 réponse');

  noter('aucune erreur JavaScript', erreurs.length === 0, erreurs.join(' | '));

  resultats.push({ viewport: vp.nom, initial, cas });
  await context.close();
}

await navigateur.close();
serveur.close();

// ── Rapport ─────────────────────────────────────────────────────────────────
let global = true;
for (const r of resultats) {
  const echecs = r.cas.filter((c) => !c.ok);
  const verdict = echecs.length === 0 ? 'PASS' : 'FAIL';
  if (echecs.length) global = false;
  console.log(`\n━━ ${r.viewport} — ${verdict}`);
  console.log(`   document ${r.initial.docScrollHeight}px / écran ${r.initial.docClientHeight}px`
    + ` · largeur ${r.initial.docScrollWidth}/${r.initial.docClientWidth}`
    + ` · défilants imbriqués: ${r.initial.defilantsImbriques.length}`);
  for (const c of r.cas) console.log(`   ${c.ok ? '✓' : '✗'} ${c.nom}${c.ok ? '' : `\n       → ${c.detail}`}`);
}
console.log(`\n\nVERDICT GLOBAL : ${global ? 'PASS' : 'FAIL'}`);
process.exit(global ? 0 : 1);
