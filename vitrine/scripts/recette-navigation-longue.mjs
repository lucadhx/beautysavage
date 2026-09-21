/**
 * ══ RECETTE : UNE LONGUE VISITE NE DOIT JAMAIS VIDER LA ZONE CENTRALE ═══════
 *
 * ── L'INCIDENT QU'ELLE VERROUILLE ─────────────────────────────────────────
 *
 * Après une longue navigation, une page finissait par s'afficher avec son
 * en-tête et son pied intacts, et TOUT LE CENTRE noir. Un rechargement manuel
 * réparait aussitôt — le signe que ce qui était cassé vivait dans la mémoire
 * de la page, pas dans le serveur.
 *
 * Deux chemins y menaient, tous deux par les morceaux de code des routes
 * chargées à la demande (`React.lazy`) :
 *
 *   · le morceau N'ARRIVE PAS ENCORE → le repli de `Suspense` était une boîte
 *     VIDE d'une hauteur d'écran, c'est-à-dire un centre noir ;
 *   · le morceau N'ARRIVERA JAMAIS (fichier remplacé par un déploiement
 *     pendant que l'onglet restait ouvert ; le navigateur MÉMORISE l'échec
 *     d'un module) → faute de frontière d'erreur, React démontait la racine
 *     ENTIÈRE, en-tête et pied compris.
 *
 * ── CE QU'ELLE PROUVE ─────────────────────────────────────────────────────
 *
 *   1. une longue navigation SPA — sans le moindre rechargement — laisse
 *      toujours un `<main>` qui porte du contenu VISIBLE ;
 *   2. rien n'accumule : nœuds DOM, éléments fixes, écouteurs, durée de
 *      navigation restent stables du début à la fin ;
 *   3. un morceau de route en échec ne vide plus la page : il rend un message
 *      lisible, et l'en-tête comme le pied restent utilisables ;
 *   4. un morceau de route en retard ne rend plus une boîte vide.
 *
 * ── LANCEMENT ─────────────────────────────────────────────────────────────
 *
 *   npm run test:navigation            # sur le dist local (build préalable)
 *   npm run test:navigation -- <url>   # sur une vitrine DÉPLOYÉE
 *
 * Playwright n'est pas une dépendance de ce projet — c'est un navigateur, pas
 * une brique du site. À défaut, la recette le DIT et sort sans rien prétendre.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium = null;
try { ({ chromium } = await import('playwright')); } catch {
  /**
   * À DÉFAUT, celui du parc — le plan de contrôle en installe un pour ses
   * propres recettes. On remonte depuis CE fichier, jamais depuis le dossier
   * courant : une recette ne doit pas dépendre d'où on la lance.
   */
  const { pathToFileURL } = await import('node:url');
  // `fileURLToPath` — et surtout pas `new URL().pathname` : sous Windows ce
  // dernier rend « /c:/Dev%20Web/… », un chemin qui n'existe pour personne.
  const ici = dirname(fileURLToPath(import.meta.url));
  const partage = resolve(ici, '../../../Panel/backend/node_modules/playwright/index.mjs');
  if (existsSync(partage)) {
    try { ({ chromium } = await import(pathToFileURL(partage).href)); } catch { /* absent */ }
  }
}
if (!chromium) {
  console.error('Playwright est requis pour cette recette (elle pilote un vrai navigateur) :');
  console.error('  npm i --no-save playwright && npx playwright install chromium');
  process.exit(2);
}

const ICI = dirname(fileURLToPath(import.meta.url));
const argUrl = process.argv.slice(2).find((a) => /^https?:\/\//.test(a));
const NAVIGATIONS_MIN = Number(process.env.NAVIGATIONS || 150);
const DIST = resolve(ICI, '../dist');

let ok = 0;
let ko = 0;
const check = (nom, cond, detail) => {
  if (cond) { ok += 1; console.log(`  ✓ ${nom}`); }
  else { ko += 1; console.error(`  ✗ ${nom}${detail ? `\n      ${detail}` : ''}`); }
};
const section = (t) => console.log(`\n${t}`);

/* ── Le site à visiter : un dist servi localement, ou une vitrine déployée ── */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.txt': 'text/plain',
};

let serveur = null;
let base = argUrl;
/** Retard injecté sur les morceaux de route, pour la partie 4. */
let retardChunks = 0;
/** Coupure des morceaux de route, pour la partie 3. */
let couperChunks = false;

if (!base) {
  if (!existsSync(DIST)) {
    console.error(`Aucun build à visiter : ${DIST} est absent. Lancez \`npm run build\` d'abord.`);
    process.exit(2);
  }
  /**
   * L'API D'UNE VITRINE RÉELLE — sans données, il n'y a pas de pages à visiter.
   * On relaie vers une instance déployée, choisie par l'appelant.
   */
  const AMONT = process.env.API_AMONT;
  if (!AMONT) {
    console.error('API_AMONT est requis en mode local : la vitrine n’a pas de contenu sans son API.');
    console.error('  API_AMONT=https://<domaine-de-la-vitrine> npm run test:navigation');
    process.exit(2);
  }
  serveur = createServer(async (req, res) => {
    const brut = req.url || '/';
    if (brut.startsWith('/api/') || brut.startsWith('/uploads/')) {
      const amont = await fetch(`${AMONT}${brut}`).catch(() => null);
      if (!amont) return res.writeHead(502).end();
      const corps = Buffer.from(await amont.arrayBuffer());
      res.writeHead(amont.status, { 'content-type': amont.headers.get('content-type') || 'application/octet-stream' });
      return res.end(corps);
    }
    const chemin = decodeURIComponent(brut.split('?')[0]);
    let fichier = join(DIST, chemin);
    if (!existsSync(fichier) || chemin === '/') fichier = join(DIST, 'index.html');
    const octets = await readFile(fichier).catch(() => null);
    if (!octets) return res.writeHead(404).end();
    if (/Page-.*\.js$/.test(fichier)) {
      if (couperChunks) return res.writeHead(404).end('gone');
      if (retardChunks) await new Promise((r) => setTimeout(r, retardChunks));
    }
    res.writeHead(200, { 'content-type': MIME[extname(fichier)] || 'application/octet-stream' });
    res.end(octets);
  });
  await new Promise((r) => serveur.listen(0, r));
  base = `http://127.0.0.1:${serveur.address().port}`;
}

const navigateur = await chromium.launch();
const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 900 } });
const page = await contexte.newPage();

const exceptions = [];
page.on('pageerror', (e) => exceptions.push(e.message.slice(0, 200)));

/**
 * L'ÉTAT RÉEL DE LA ZONE CENTRALE — lu dans le DOM.
 *
 * « Du contenu visible » ne se déduit pas d'un composant monté : on mesure la
 * hauteur rendue, la présence d'un élément peint, l'opacité effective, et l'on
 * cherche ce qui pourrait recouvrir le centre de l'écran.
 */
const inspecter = () => page.evaluate(() => {
  const main = document.querySelector('main');
  if (!main) return { erreur: 'aucun <main>' };
  const rect = main.getBoundingClientRect();
  const anime = main.firstElementChild;
  const style = anime ? getComputedStyle(anime) : null;

  /**
   * CE QU'EST UN VOILE, ET CE QUI N'EN EST PAS UN.
   *
   * Un élément plein écran positionné n'est pas suspect en soi : l'image de
   * héros d'une page est exactement cela, et elle EST le contenu. Ce qu'on
   * traque, c'est une surface qui RECOUVRE le contenu — donc posée hors de
   * `<main>`, opaque, et vide de texte. Confondre les deux ferait crier la
   * recette sur toutes les pages qui ont une bannière, et on la désactiverait.
   */
  const main2 = document.querySelector('main');
  const recouvrements = [];
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el);
    if (s.position !== 'fixed' && s.position !== 'absolute') continue;
    if (parseFloat(s.opacity) < 0.9 || s.visibility === 'hidden' || s.display === 'none') continue;
    if (main2 && main2.contains(el)) continue;            // c'est du contenu
    if ((el.innerText || '').trim().length > 0) continue; // un voile ne parle pas
    const b = el.getBoundingClientRect();
    if (b.width >= window.innerWidth * 0.9 && b.height >= window.innerHeight * 0.9) {
      recouvrements.push(`${el.tagName}.${String(el.className).slice(0, 40)}`);
    }
  }

  return {
    chemin: location.pathname,
    hauteurMain: Math.round(rect.height),
    /** Contenu peint : du texte, ou au moins un élément rendu et dimensionné. */
    texte: (main.innerText || '').trim().length,
    elementsRendus: main.querySelectorAll('*').length,
    opacite: style ? parseFloat(style.opacity) : null,
    visibilite: style ? style.visibility : null,
    display: style ? style.display : null,
    navbar: Boolean(document.querySelector('header, nav')),
    footer: Boolean(document.querySelector('footer')),
    recouvrements,
    noeuds: document.querySelectorAll('*').length,
    fixes: [...document.querySelectorAll('body *')].filter((e) => getComputedStyle(e).position === 'fixed').length,
    memoire: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
  };
});

/** Attend que la page se stabilise — bien au-delà de la transition (280 ms). */
async function stabiliser() {
  const limite = Date.now() + 2500;
  let e = await inspecter();
  while (Date.now() < limite) {
    if ((e.opacite ?? 1) >= 0.99 && e.elementsRendus > 3) break;
    await page.waitForTimeout(80);
    e = await inspecter();
  }
  return e;
}

await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('main', { timeout: 20000 });
await page.waitForTimeout(2500); // bootstrap, thème, préchargement d'inactivité

const routes = await page.evaluate(() => {
  const vus = new Set();
  for (const a of document.querySelectorAll('a[href^="/"]')) {
    const h = a.getAttribute('href');
    if (h && !h.startsWith('//')) vus.add(h);
  }
  return [...vus];
});

/* ═══════════════════════════════════════════════════════════════════════════ */
section(`1 · ${NAVIGATIONS_MIN} navigations SPA, sans un seul rechargement`);
console.log(`  routes : ${routes.join(' · ')}`);

const echecs = [];
let navigations = 0;
let premiereDuree = null;
let derniereDuree = null;
const debut = await inspecter();

while (navigations < NAVIGATIONS_MIN) {
  for (const route of routes) {
    if (navigations >= NAVIGATIONS_MIN) break;
    const t = Date.now();

    /**
     * UNE NAVIGATION SUR TROIS EST UNE RAFALE : la destination suivante est
     * cliquée AVANT la fin du fondu. C'est la contrainte que la mécanique de
     * transition doit encaisser, et qu'une navigation posée ne produit jamais.
     */
    const enRafale = navigations % 3 === 0;
    const autres = routes.filter((r) => r !== route).slice(0, 2);
    const parti = await page.evaluate(async ({ r, autres, enRafale }) => {
      const viser = (h) => document.querySelector(`a[href="${h}"]`);
      const a = viser(r);
      if (!a) return false;
      a.click();
      if (enRafale) {
        await new Promise((res) => setTimeout(res, 40));
        viser(autres[0])?.click();
        await new Promise((res) => setTimeout(res, 40));
        viser(autres[1])?.click();
      }
      return true;
    }, { r: route, autres, enRafale });
    if (!parti) continue;
    navigations += 1;

    // Un aller-retour d'historique de loin en loin : `popstate` est un autre
    // chemin d'entrée dans le routeur que le clic.
    if (navigations % 11 === 0) {
      await page.goBack({ waitUntil: 'commit' }).catch(() => {});
      await page.waitForTimeout(60);
      await page.goForward({ waitUntil: 'commit' }).catch(() => {});
    }

    const etat = await stabiliser();
    const duree = Date.now() - t;
    if (premiereDuree === null) premiereDuree = duree;
    derniereDuree = duree;

    const vide = etat.elementsRendus <= 3 || etat.hauteurMain < 100;
    const invisible = (etat.opacite ?? 1) < 0.9 || etat.visibilite === 'hidden' || etat.display === 'none';
    const couvert = etat.recouvrements.length > 0;
    const shellPerdu = !etat.navbar || !etat.footer;

    if (vide || invisible || couvert || shellPerdu) {
      echecs.push({ navigations, route, ...etat });
      if (echecs.length >= 3) { navigations = NAVIGATIONS_MIN; break; }
    }
  }
}

const fin = await inspecter();
check(`${navigations} navigations effectuées`, navigations >= NAVIGATIONS_MIN);
check('la zone centrale porte TOUJOURS du contenu visible',
  echecs.length === 0, echecs.length ? JSON.stringify(echecs[0], null, 1) : '');
check('aucune exception critique pendant la visite',
  exceptions.length === 0, exceptions.slice(0, 3).join(' | '));

/* ═══════════════════════════════════════════════════════════════════════════ */
section('2 · Rien ne s’accumule');
const croissanceNoeuds = fin.noeuds - debut.noeuds;
check(`nœuds DOM stables (${debut.noeuds} → ${fin.noeuds})`,
  croissanceNoeuds < Math.max(200, debut.noeuds * 0.5),
  'un composant crée quelque chose qu’il ne retire pas au démontage');
check(`éléments fixes stables (${debut.fixes} → ${fin.fixes})`,
  fin.fixes <= debut.fixes + 2,
  'un fond, un voile ou une fenêtre modale survit à sa page');
check(`la navigation ne ralentit pas (${premiereDuree} ms → ${derniereDuree} ms)`,
  derniereDuree < Math.max(1500, premiereDuree * 3));
if (fin.memoire !== null && debut.memoire !== null) {
  check(`mémoire raisonnable (${debut.memoire} → ${fin.memoire} Mo)`, fin.memoire < debut.memoire + 120);
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/**
 * Les parties 3 et 4 exigent de manipuler le SERVEUR : elles ne valent que sur
 * le dist local. Contre une vitrine déployée, on ne coupe évidemment rien.
 */
if (serveur) {
  section('3 · Un morceau de route en échec ne vide plus la page');
  {
    const p2 = await contexte.newPage();
    const exc2 = [];
    p2.on('pageerror', (e) => exc2.push(e.message.slice(0, 120)));
    couperChunks = true;
    await p2.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await p2.waitForSelector('main', { timeout: 20000 });
    await p2.waitForTimeout(2000);
    await p2.evaluate(() => document.querySelector('a[href^="/services/"]')?.click());
    await p2.waitForTimeout(2500);

    const e = await p2.evaluate(() => {
      const main = document.querySelector('main');
      return {
        main: Boolean(main),
        texte: (main?.innerText || '').trim().length,
        navbar: Boolean(document.querySelector('header, nav')),
        footer: Boolean(document.querySelector('footer')),
        racineVide: (document.getElementById('root')?.children.length ?? 0) === 0,
      };
    });
    check('la racine React n’est PAS démontée', !e.racineVide);
    check('l’en-tête reste en place', e.navbar);
    check('le pied de page reste en place', e.footer);
    check('la zone centrale explique la panne au lieu de rester noire',
      e.main && e.texte > 40, JSON.stringify(e));
    couperChunks = false;
    await p2.close();
  }

  section('4 · Un morceau de route en retard ne rend plus une boîte vide');
  {
    const p3 = await contexte.newPage();
    retardChunks = 1500;
    await p3.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await p3.waitForSelector('main', { timeout: 20000 });
    await p3.waitForTimeout(300); // avant que le préchargement n'ait fini
    await p3.evaluate(() => document.querySelector('a[href^="/services/"]')?.click());
    await p3.waitForTimeout(500);

    const e = await p3.evaluate(() => {
      const main = document.querySelector('main');
      return {
        attenteAnnoncee: Boolean(main?.querySelector('[role="status"]')),
        elements: main ? main.querySelectorAll('*').length : 0,
        navbar: Boolean(document.querySelector('header, nav')),
      };
    });
    check('l’attente est ANNONCÉE (et non un rectangle vide)',
      e.attenteAnnoncee, JSON.stringify(e));
    check('le reste du site demeure', e.navbar);
    retardChunks = 0;
    await p3.close();
  }
}

console.log(`\n${ok} réussis, ${ko} échoués`);
await navigateur.close();
serveur?.close();
process.exit(ko === 0 ? 0 : 1);
