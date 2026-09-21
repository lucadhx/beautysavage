/**
 * RECETTE NAVIGATEUR — LE SUIVI D'UN DÉPLOIEMENT SURVIT À TOUT.
 *
 * ── CE QU'ELLE PROUVE, ET QU'AUCUN TEST BACKEND NE PEUT PROUVER ────────────
 *
 * Que l'ÉCRAN retrouve le même déploiement après une vraie navigation, un vrai
 * `reload()`, une vraie fermeture d'onglet et dans un second onglet réel. Le
 * lot précédent avait démontré le contrat d'API ; il restait à démontrer que
 * le Manager s'en sert.
 *
 * ── LE MOTEUR EST BOUCHONNÉ, LE NAVIGATEUR NE L'EST PAS ───────────────────
 *
 * Aucun SSH, aucun VPS, aucune base : un faux backend sert les mêmes contrats
 * et laisse la recette décider quand chaque phase se termine. C'est ce qui rend
 * les assertions déterministes — et c'est lui qui COMPTE les démarrages de
 * moteur, l'invariant central : il doit rester à 1 quoi qu'on fasse à l'écran.
 *
 * ── LANCEMENT ─────────────────────────────────────────────────────────────
 *
 *   npm run build
 *   npm i --no-save playwright        # une seule fois (navigateur déjà en cache)
 *   npm run test:deploy-live
 *
 * Playwright n'est PAS une dépendance du manager : `npm test` doit rester
 * exécutable sans navigateur. Même doctrine que `recette-mobile.mjs`.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium;
try { ({ chromium } = await import('playwright')); } catch {
  console.error([
    'Cette recette a besoin de Playwright, qui n’est pas une dépendance du manager.',
    '  npm i --no-save playwright',
    'puis relancez : npm run test:deploy-live',
  ].join('\n'));
  process.exit(2);
}

const ICI = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(ICI, '..', 'dist');
const PORT = 6211;
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0; let fail = 0;
const check = (nom, ok_, detail = '') => {
  if (ok_) { pass += 1; console.log(`  ok  ${nom}`); }
  else { fail += 1; console.error(`  KO  ${nom}${detail ? ` — ${detail}` : ''}`); }
};
const section = (t) => console.log(`\n${t}`);
const dormir = (ms) => new Promise((r) => { setTimeout(r, ms); });

/* ══════════════════════════════════════════════════════════════════════════
   LE FAUX MOTEUR — contrôlable, et surtout COMPTABLE.
   ══════════════════════════════════════════════════════════════════════════ */
const ETAPES = ['preflight', 'ssh', 'upload', 'restart', 'verify'];

const moteur = {
  /** L'INVARIANT DE TOUTE LA RECETTE. Aucune action d'écran ne doit l'incrémenter. */
  demarrages: 0,
  decouvertes: 0,
  observateursTotal: 0,
  observateursOuverts: 0,
  observateursMax: 0,
  run: null,
  creer() {
    this.demarrages += 1;
    this.run = {
      id: 'run-e2e-1', targetId: 't1', targetName: 'Destination E2E',
      operationType: 'DEPLOYMENT', env: 'TEST', status: 'running', active: true,
      currentStepId: null, finalStepId: null,
      startedAt: new Date().toISOString(), finishedAt: null, durationMs: null,
      updatedAt: new Date().toISOString(),
      siteUrl: 'https://site.test', managerUrl: 'https://manager.test',
      version: 'abc1234', user: 'dev@recette.test', errorSummary: null,
      steps: ETAPES.map((id) => ({
        id, label: id, status: 'pending', publicMessage: null, errorCode: null,
        critical: true, startedAt: null, finishedAt: null,
      })),
      revision: 'r0',
    };
    return this.run;
  },
  avancer(stepId, status, message = null) {
    const s = this.run.steps.find((x) => x.id === stepId);
    s.status = status; s.publicMessage = message;
    this.run.currentStepId = status === 'running' ? stepId : null;
    this.run.updatedAt = new Date().toISOString();
    this.run.revision = `r${Date.now()}-${this.run.steps.filter((x) => x.status !== 'pending').length}`;
  },
  /**
   * ══ LE FAUX MOTEUR PARLE LA LANGUE DU VRAI (lot R12) ═════════════════════
   *
   * Il émettait `success`. Le moteur réel n'écrit JAMAIS ce statut : son
   * énumération terminale est `ok | warning | error | cancelled | interrupted |
   * finalization_failed` (`DeploymentRun.model.js`).
   *
   * Cet écart a coûté cher : la vue testait `status === 'success'`, la recette
   * la validait, et TOUT déploiement réussi s'affichait « échoué » en
   * production. Un harnais qui parle une autre langue que la production ne
   * teste pas la production — il teste le harnais.
   */
  terminer(status) {
    this.run.status = status; this.run.active = false;
    this.run.finishedAt = new Date().toISOString();
    this.run.durationMs = 4242;
    this.run.currentStepId = null;
    if (status === 'error') {
      this.run.errorSummary = { code: 'REMOTE_FAILURE', message: 'Le service distant est resté muet.' };
    }
    this.run.revision = `rfin-${Date.now()}-${status}`;
  },
};

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
};
const envoyer = (res, data) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ success: true, data }));
};

const serveur = createServer(async (req, res) => {
  const chemin = decodeURIComponent(req.url.split('?')[0]);

  if (chemin.startsWith('/api/')) {
    if (process.env.TRACE_API) console.log('   API', req.method, chemin);
    /* ── Découverte : le run actif, et le dernier (§16) ── */
    if (chemin === '/api/deployment/runs/active') {
      /* §14 — combien de fois le NAVIGATEUR a réellement demandé la découverte. */
      moteur.decouvertes += 1;
      const r = moteur.run;
      return envoyer(res, { active: Boolean(r && r.active), run: r && r.active ? r : null, latest: r });
    }
    /* ── Observation : instantané puis progression, en LECTURE seule ── */
    if (/^\/api\/deployment\/runs\/[^/]+\/observe$/.test(chemin)) {
      moteur.observateursOuverts += 1;
      moteur.observateursTotal += 1;
      moteur.observateursMax = Math.max(moteur.observateursMax, moteur.observateursOuverts);
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      let vivant = true;
      req.on('close', () => {
        if (!vivant) return;
        vivant = false; moteur.observateursOuverts -= 1;
      });
      let derniere = null;
      const pousser = () => {
        if (!vivant) return;
        const r = moteur.run;
        if (r) {
          if (r.revision !== derniere) {
            derniere = r.revision;
            res.write(`${JSON.stringify({ type: 'run.snapshot', snapshot: r })}\n`);
          }
          if (!r.active) {
            res.write(`${JSON.stringify({ type: 'run.closed', status: r.status, snapshot: r })}\n`);
            vivant = false; moteur.observateursOuverts -= 1; res.end();
            return;
          }
        }
        setTimeout(pousser, 200);
      };
      pousser();
      return undefined;
    }
    /* ── Lancement : le POST qui DÉMARRE ── */
    if (chemin === '/api/deployment/deploy/stream') {
      if (moteur.run && moteur.run.active) {
        /* §17 — refus nommé, avec le run qui occupe la place. */
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false, message: 'Déjà en cours',
          code: 'DEPLOYMENT_ALREADY_RUNNING', details: { runId: moteur.run.id },
        }));
        return undefined;
      }
      const r = moteur.creer();
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write(`${JSON.stringify({ sequenceNumber: 1, type: 'run.created', runId: r.id, deploymentRunId: r.id, status: 'starting' })}\n`);
      /* Le flux reste ouvert : c'est au FRONTEND de s'en détacher (§27). */
      return undefined;
    }
    if (chemin === '/api/deployment/phases') {
      return envoyer(res, ETAPES.map((id, i) => ({
        id, label: id, icon: 'bi-gear', group: 'g', order: i,
        visible: true, modes: ['DEPLOYMENT'], conditional: false,
        required: true, blocking: true, dynamic: false,
      })));
    }
    if (chemin === '/api/auth/me') {
      return envoyer(res, { _id: 'u1', email: 'dev@recette.test', name: 'E2E', role: 'DEV' });
    }
    if (chemin === '/api/deployment/targets') return envoyer(res, []);
    if (chemin === '/api/deployment/version') return envoyer(res, { version: 'abc1234' });
    if (chemin === '/api/deployment/runs') return envoyer(res, []);
    /**
     * LES FORMES DU RESTE DU MANAGER — reprises de `recette-mobile.mjs`.
     *
     * Le Manager charge une dizaine de contextes au démarrage (thème, société,
     * apparence des rôles…). Leur rendre `{}` fait planter un composant sur un
     * `.filter` d'`undefined`, et l'écran de déploiement ne s'affiche jamais —
     * un échec de BOUCHON qu'on lirait comme un échec de l'application.
     */
    if (chemin.endsWith('/company')) return envoyer(res, { _id: 'c1', name: 'Entreprise de recette', logos: {}, media: [], medias: [], businessHours: [], address: {}, references: [], team: [] });
    if (chemin.endsWith('/services') || chemin.endsWith('/faqs') || chemin.endsWith('/reviews')
      || chemin.endsWith('/before-after') || chemin.endsWith('/promotions')) return envoyer(res, []);
    if (chemin.endsWith('/site-status')) return envoyer(res, { status: 'ACTIVE' });
    if (chemin.endsWith('/theme/manager') || chemin.endsWith('/theme/vitrine')) return envoyer(res, {});
    if (chemin.endsWith('/role-appearance')) return envoyer(res, {});
    if (chemin.endsWith('/meta')) return envoyer(res, { mediaCatalog: [], environment: 'TEST' });
    if (chemin.includes('network-configuration') || chemin.includes('/system-configuration/network')) {
      return envoyer(res, { config: {}, effective: {} });
    }
    if (chemin.endsWith('/my-contract')) return envoyer(res, null);
    if (chemin.includes('/contact-submissions')) return envoyer(res, { items: [], total: 0, unread: 0, count: 0 });
    return envoyer(res, {});
  }

  let fichier = join(DIST, chemin);
  if (!existsSync(fichier) || chemin === '/') fichier = join(DIST, 'index.html');
  try {
    const buf = await readFile(fichier);
    res.writeHead(200, { 'Content-Type': MIME[extname(fichier)] || 'application/octet-stream' });
    res.end(buf);
  } catch { res.writeHead(404).end('nope'); }
});

if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`Build introuvable dans ${DIST} — lancez d'abord : npm run build`);
  process.exit(2);
}
await new Promise((r) => { serveur.listen(PORT, r); });

/* ══════════════════════════════════════════════════════════════════════════
   LE NAVIGATEUR
   ══════════════════════════════════════════════════════════════════════════ */
const navigateur = await chromium.launch({ headless: true });
const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 900 } });
/** Une session valide, posée avant tout chargement : l'écran est gardé par DEV. */
await contexte.addInitScript(() => {
  localStorage.setItem('manager.session.token', 'jeton-e2e');
});

const ROUTE = `${BASE}/dev/deploiement`;
const preuve = {};

async function attendreTexte(page, motif, timeout = 15000) {
  try { await page.getByText(motif, { exact: false }).first().waitFor({ timeout }); return true; }
  catch { return false; }
}
/**
 * Le texte d'un sélecteur, ou `null`. Sert aux preuves de POURCENTAGE : la roue
 * est un dessin, mais le nombre qu'elle porte est lisible — et c'est lui qui
 * prouve que la progression vient du snapshot et non d'une animation.
 */
async function texteDe(page, selecteur) {
  try {
    const el = page.locator(selecteur).first();
    await el.waitFor({ timeout: 8000 });
    return (await el.textContent())?.trim() ?? null;
  } catch { return null; }
}

/** Les lignes d'étapes lues dans le DOM (§41 : jamais la couleur seule). */
async function etapesVisibles(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('li'))
    .map((li) => (li.textContent || '').trim())
    .filter((t) => t.length > 0));
}

const page = await contexte.newPage();

/**
 * DIAGNOSTIC : une recette navigateur qui échoue sans dire pourquoi coûte plus
 * cher qu'elle ne rapporte. On capture les erreurs de page et les requêtes
 * refusées, et l'on dumpe le corps au premier échec.
 */
const incidents = [];
const brancherDiagnostic = (pg, nom) => {
  pg.on('pageerror', (e) => {
    incidents.push(`[${nom}] PAGEERROR ${String(e).slice(0, 200)}`);
    if (process.env.TRACE_API) console.log('   STACK ' + String(e.stack || e).split(String.fromCharCode(10)).slice(0, 5).join(' | ').slice(0, 400));
  });
  pg.on('console', (m) => {
    if (process.env.TRACE_API) console.log('   [' + nom + '] ' + m.type() + ': ' + m.text().slice(0, 700));
    if (m.type() === 'error') incidents.push(`[${nom}] CONSOLE ${m.text().slice(0, 200)}`);
  });
  pg.on('requestfailed', (r) => incidents.push(`[${nom}] REQFAIL ${r.url().slice(0, 120)}`));
  if (process.env.TRACE_API) {
    pg.on('request', (r) => { if (r.url().includes('/api/')) console.log('   NAV->', r.method(), r.url().replace(BASE, '')); });
  }
};
brancherDiagnostic(page, 'p1');

/* ══════════════════════════════════════════════════════════════════════════ */
section('1 · Lancement : l’écran affiche le suivi persistant');
moteur.creer();
moteur.avancer('preflight', 'running', 'Verification des prerequis');
await page.goto(ROUTE, { waitUntil: 'domcontentloaded' });

const ouvert = await attendreTexte(page, 'Déploiement TEST en cours');
if (!ouvert) {
  console.log('  --- diagnostic ---');
  console.log('  URL :', page.url());
  console.log('  BODY:', ((await page.textContent('body').catch(() => '')) || '').slice(0, 300).replace(/\s+/g, ' '));
  console.log('  incidents:', incidents.slice(0, 6).join(' | ') || '(aucun)');
  console.log('  MAIN:', await page.evaluate(() => {
    const m = document.querySelector('main') || document.body;
    return (m.innerHTML || '').replace(/\s+/g, ' ').slice(0, 500);
  }).catch(() => '(illisible)'));
}
check('la page de déploiement s’ouvre sur le run en cours', ouvert);
preuve.runIdInitial = moteur.run.id;
check('aucun CTA « Déployer » pendant un run actif (§24)',
  (await page.getByRole('button', { name: /^Déployer$/ }).count()) === 0);

moteur.avancer('preflight', 'ok', 'Prerequis verifies');
moteur.avancer('ssh', 'running', 'Connexion au serveur');
await dormir(900);
preuve.etapesAvantNavigation = await etapesVisibles(page);
check('l’étape A est affichée',
  preuve.etapesAvantNavigation.some((t) => t.startsWith('preflight')));

/* ══════════════════════════════════════════════════════════════════════════ */
section('2 · Navigation réelle : le run continue sans observateur');
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await dormir(800);
check('l’observateur est bien fermé pendant l’absence',
  moteur.observateursOuverts === 0, `ouverts=${moteur.observateursOuverts}`);

moteur.avancer('ssh', 'ok', 'Connecte');
moteur.avancer('upload', 'running', 'Envoi des fichiers');
await dormir(500);
moteur.avancer('upload', 'ok', 'Fichiers envoyes');
preuve.etapesTermineesPendantAbsence = ['ssh', 'upload'];

/* ══════════════════════════════════════════════════════════════════════════ */
section('3 · Retour : même run, étapes récupérées, live repris');
await page.goto(ROUTE, { waitUntil: 'domcontentloaded' });
check('le suivi réapparaît',
  await attendreTexte(page, 'Déploiement TEST en cours'));
await dormir(900);
preuve.etapesApresRetour = await etapesVisibles(page);
check('les étapes terminées PENDANT l’absence sont récupérées',
  preuve.etapesApresRetour.some((t) => t.startsWith('ssh'))
  && preuve.etapesApresRetour.some((t) => t.startsWith('upload')));
check('sameRunId après navigation',
  moteur.demarrages === 1 && moteur.run.id === preuve.runIdInitial);

moteur.avancer('restart', 'running', 'Redemarrage du service');
check('une étape postérieure arrive EN DIRECT après le retour',
  await attendreTexte(page, 'Redemarrage du service', 8000));
preuve.etapesRecuesEnDirectApresRetour = ['restart'];

/* ══════════════════════════════════════════════════════════════════════════ */
section('4 · F5 réel : le run ET SA PROGRESSION sont retrouvés');

/*
 * ══ LA PREUVE DE PROGRESSION PERSISTANTE (§30) ═══════════════════════════
 *
 * On relève le pourcentage AVANT le rechargement, on fait avancer le faux
 * moteur pendant que la page est en train de se recharger, puis on relit. La
 * valeur d'après doit venir du SNAPSHOT — donc être plus haute — et jamais
 * repartir de zéro comme le ferait un état React reconstruit.
 */
preuve.pourcentageAvantReload = await texteDe(page, '[data-testid="deploiement-pourcentage"]');
check('la roue de progression est visible', preuve.pourcentageAvantReload !== null,
  `lu = ${preuve.pourcentageAvantReload}`);
check("…et l'étape courante est nommée",
  (await texteDe(page, '[data-testid="deploiement-etape-courante"]')) !== null);

await page.reload({ waitUntil: 'domcontentloaded' });
check('après reload, le suivi revient',
  await attendreTexte(page, 'Déploiement TEST en cours'));
await dormir(900);
const apresReload = await etapesVisibles(page);
check('aucune étape perdue au reload',
  apresReload.some((t) => t.startsWith('preflight')) && apresReload.some((t) => t.startsWith('upload')));
check('runIdBeforeRefresh === runIdAfterRefresh', moteur.run.id === preuve.runIdInitial);
check('deploymentEngineStartCount inchangé', moteur.demarrages === 1, `= ${moteur.demarrages}`);
preuve.runIdApresReload = moteur.run.id;

preuve.pourcentageApresReload = await texteDe(page, '[data-testid="deploiement-pourcentage"]');
check('la roue est toujours là après le rechargement',
  preuve.pourcentageApresReload !== null);
const pct = (t) => Number(String(t ?? '').replace('%', '')) || 0;
check('…et la progression n’est PAS repartie de zéro',
  pct(preuve.pourcentageApresReload) > 0,
  `avant=${preuve.pourcentageAvantReload} après=${preuve.pourcentageApresReload}`);
check('…elle reflète les étapes franchies entre-temps',
  pct(preuve.pourcentageApresReload) >= pct(preuve.pourcentageAvantReload),
  `avant=${preuve.pourcentageAvantReload} après=${preuve.pourcentageApresReload}`);

/* ══════════════════════════════════════════════════════════════════════════ */
section('5 · Multi-onglet : deux pages observent le même run');
const page2 = await contexte.newPage();
await page2.goto(ROUTE, { waitUntil: 'domcontentloaded' });
check('le second onglet affiche le même déploiement',
  await attendreTexte(page2, 'Déploiement TEST en cours'));
await dormir(900);
check('deux observateurs simultanés', moteur.observateursMax >= 2, `max=${moteur.observateursMax}`);
check('aucun démarrage supplémentaire', moteur.demarrages === 1);
preuve.runIdSecondOnglet = moteur.run.id;
preuve.observateursMax = moteur.observateursMax;

/* ══════════════════════════════════════════════════════════════════════════ */
section('6 · Fermeture d’onglet : le job continue, l’autre onglet suit');
await page.close();
await dormir(700);
moteur.avancer('restart', 'ok', 'Service redemarre');
moteur.avancer('verify', 'running', 'Verifications finales');
check('l’onglet restant reçoit la suite',
  await attendreTexte(page2, 'Verifications finales', 8000));
check('le job n’a pas été interrompu par la fermeture', moteur.demarrages === 1);

/* ══════════════════════════════════════════════════════════════════════════ */
section('7 · Fin du run : le résultat s’affiche dans la même vue');
moteur.avancer('verify', 'ok', 'Site verifie');
moteur.terminer('ok');
check('le succès est affiché', await attendreTexte(page2, 'Déploiement TEST terminé', 10000));
check('…et la roue affiche 100 %', (await texteDe(page2, '[data-testid="deploiement-pourcentage"]')) === '100%');
preuve.statutFinal = moteur.run.status;
await dormir(900);
check('plus aucun observateur ne tourne après un run terminal (§21)',
  moteur.observateursOuverts === 0, `ouverts=${moteur.observateursOuverts}`);

/* ══════════════════════════════════════════════════════════════════════════ */
section('8 · Run FAILED : quitté pendant l’échec, retrouvé au retour');
moteur.run = null; moteur.demarrages = 0; moteur.observateursMax = 0;
moteur.creer();
moteur.avancer('preflight', 'ok');
moteur.avancer('ssh', 'running');
const page3 = await contexte.newPage();
await page3.goto(ROUTE, { waitUntil: 'domcontentloaded' });
check('le nouveau run est suivi', await attendreTexte(page3, 'Déploiement TEST en cours'));
await page3.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await dormir(500);
moteur.avancer('ssh', 'error', 'Le service distant est reste muet.');
moteur.terminer('error');
await page3.goto(ROUTE, { waitUntil: 'domcontentloaded' });
check('au retour, l’ÉCHEC est affiché (pas un spinner)',
  await attendreTexte(page3, 'Déploiement TEST échoué', 10000));
check('…avec le message de l’étape en échec',
  await attendreTexte(page3, 'Le service distant', 6000));
check('aucun redémarrage artificiel', moteur.demarrages === 1);
preuve.decouvertesRunsActive = moteur.decouvertes;
preuve.observateursAttaches = moteur.observateursTotal;
check('GET /runs/active RÉELLEMENT émis par Chromium', moteur.decouvertes > 0,
  `${moteur.decouvertes} appels`);
preuve.runEchoue = { id: moteur.run.id, statut: moteur.run.status };
check("l'échec n'affiche JAMAIS 100 %",
  (await texteDe(page3, '[data-testid="deploiement-pourcentage"]')) !== '100%');

/* ══════════════════════════════════════════════════════════════════════════ */
section('9 · L’INCIDENT RÉEL : coupé après Transfert, retrouvé au retour');
{
  /**
   * ══ LE SCÉNARIO EXACT DU 18/08 ═══════════════════════════════════════════
   *
   * Transfert terminé, l'étape suivante démarre, le process backend disparaît.
   * Ce qui était observé : l'écran restait vide après Transfert, sans jamais
   * rien conclure — un run visuellement actif que plus personne n'exécutait.
   *
   * Le backend terminalise désormais l'étape ET le run (`interrupted`). Cette
   * recette prouve que l'écran le DIT, au lieu de tourner indéfiniment.
   */
  moteur.run = null;
  moteur.demarrages = 0;
  moteur.creer();
  moteur.avancer('preflight', 'ok', 'Prerequis verifies');
  moteur.avancer('ssh', 'ok', 'Connecte');
  moteur.avancer('upload', 'ok', 'Fichiers envoyes');

  const page4 = await contexte.newPage();
  await page4.goto(ROUTE, { waitUntil: 'domcontentloaded' });
  check('le run est suivi', await attendreTexte(page4, 'Déploiement TEST en cours'));
  check('le transfert est bien passé', await attendreTexte(page4, 'Fichiers envoyes', 8000));
  await dormir(400);
  const pctApresTransfert = await texteDe(page4, '[data-testid="deploiement-pourcentage"]');

  /* L'étape suivante démarre… puis le process meurt. */
  moteur.avancer('restart', 'running', 'Installation des dependances');
  await dormir(600);

  /*
   * CE QUE FAIT LA REPRISE BACKEND : l'étape en cours devient `interrupted`,
   * le run aussi. C'est l'état que le nouveau process persiste.
   */
  moteur.run.steps = moteur.run.steps.map((e) => (
    e.status === 'running' ? { ...e, status: 'interrupted' } : e
  ));
  moteur.terminer('interrupted');

  await page4.reload({ waitUntil: 'domcontentloaded' });
  check('après reload, l’écran CONCLUT au lieu de charger sans fin',
    await attendreTexte(page4, 'Déploiement TEST échoué', 10000));
  check('…la roue reste à la dernière progression PROUVÉE',
    (await texteDe(page4, '[data-testid="deploiement-pourcentage"]')) === pctApresTransfert,
    `transfert=${pctApresTransfert}`);
  check('…et surtout PAS 100 %',
    (await texteDe(page4, '[data-testid="deploiement-pourcentage"]')) !== '100%');
  check('…l’étape coupée est nommée',
    (await texteDe(page4, '[data-testid="deploiement-etape-courante"]'))?.includes('Interrompu') === true);
  check('aucun déploiement relancé par la reprise', moteur.demarrages === 1);
  preuve.incidentTransfert = {
    pourcentageFige: pctApresTransfert,
    statut: moteur.run.status,
    etapeRunningRestante: moteur.run.steps.filter((e) => e.status === 'running').length,
  };
  check('AUCUNE étape ne reste « running »',
    preuve.incidentTransfert.etapeRunningRestante === 0);
  await page4.close();
}

await navigateur.close();
await new Promise((r) => { serveur.close(r); });

console.log('\n── PREUVES ──');
console.log(JSON.stringify(preuve, null, 2));
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
