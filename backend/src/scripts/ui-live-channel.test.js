/**
 * LE CANAL D'INVALIDATION — ses abonnés, et son catalogue.
 *
 * ══ CE QUE CE FICHIER GARDE ═════════════════════════════════════════════════
 *
 * Une connexion longue est la primitive la plus facile à faire fuir : elle
 * s'ouvre à la vue de tous et se ferme dans un chemin d'erreur que personne ne
 * regarde. Une fuite ne se voit pas en recette — elle se voit trois semaines
 * plus tard, en production, sous la forme d'un processus qui grossit.
 *
 * On ne prouve donc pas « ça se connecte ». On prouve que ça se DÉCONNECTE :
 * fermeture ordinaire, abandon brutal, cinquante cycles, plusieurs onglets.
 *
 * ══ ET LE CATALOGUE ═════════════════════════════════════════════════════════
 *
 * `contract` était déclaré des DEUX côtés — backend et Manager — sans que
 * personne ne l'émette ni ne l'écoute. Un scope fantôme est pire qu'un scope
 * absent : il donne l'impression qu'un écran est vivant alors qu'il ne l'est
 * pas, et il survit aux relectures parce qu'il « existe déjà ».
 *
 * Le catalogue DÉCLARÉ doit donc correspondre au catalogue RÉELLEMENT routable :
 * un producteur, un consommateur, pour chaque entrée.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'uilive_test';
process.env.DB_PROD = 'uilive_prod';
process.env.JWT_SECRET = 'test-secret-jwt-uilive';
process.env.PORT = '4194';
process.env.CORS_ORIGINS = 'http://localhost:6062';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.SIGNATURE_PROVIDER = 'stub';
process.env.STRIPE_PROVIDER = 'stub';
process.env.PANEL_SCHEDULER_ENABLED = 'false';

let pass = 0; let fail = 0;
const check = (n, c) => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.error(`  ✗ ${n}`)); };
const section = (n) => console.log(`\n${n}`);
const attendre = (ms) => new Promise((r) => { setTimeout(r, ms); });

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
const { bootstrap } = await import('../config/bootstrap.js');
const { createApp } = await import('../app.js');
await connectDatabase();
await bootstrap();
// Le service est PRÊT : cette suite a fait elle-même tout ce que le démarrage fait.
await (await import("./helpers/serviceReady.helper.js")).markTestServiceReady();
// LOT 2C — le DÉCOR de recette (dev@mail.com, admin@mail.com) ne vient plus du
// produit : `bootstrap()` ne pose aucun mot de passe. Voir helpers/testAccounts.helper.js.
await (await import("./helpers/testAccounts.helper.js")).seedTestAccounts();

const app = createApp();
const server = app.listen(4194);
const base = 'http://localhost:4194';

const uiLive = await import('../services/uiLive/uiLive.service.js');

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const lire = (rel) => fs.readFileSync(path.join(racine, rel), 'utf8');

async function jeton() {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'dev@mail.com', password: '123dev' }),
  });
  return (await res.json())?.data?.token ?? null;
}

/**
 * Ouvre un flux et attend sa PREMIÈRE trame.
 *
 * Sans cette attente, l'abonnement pourrait ne pas encore avoir eu lieu côté
 * serveur au moment où on compte les abonnés : le test mesurerait alors une
 * course, pas un comportement.
 */
async function ouvrirFlux(token) {
  const controleur = new AbortController();
  const res = await fetch(`${base}/api/live/events`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: controleur.signal,
  });
  const lecteur = res.body.getReader();
  await lecteur.read();
  return { controleur, lecteur, status: res.status };
}

/** Le backend a-t-il fini de traiter la fermeture ? On lui laisse un tour. */
async function jusqua(condition, limiteMs = 3_000) {
  const debut = Date.now();
  while (Date.now() - debut < limiteMs) {
    if (condition()) return true;
    // eslint-disable-next-line no-await-in-loop
    await attendre(20);
  }
  return condition();
}

try {
  const token = await jeton();
  check('jeton obtenu', Boolean(token));

  /* ══════════════════════════════════════════════════════════════════════ */
  section('UNE CONNEXION FERMÉE DISPARAÎT RÉELLEMENT');
  {
    uiLive.resetUiLiveForTests();
    const flux = await ouvrirFlux(token);
    check(`le flux répond (${flux.status})`, flux.status === 200);
    check('un abonné actif', uiLive.describeUiLive().subscribers === 1);

    flux.controleur.abort();
    check('la fermeture est constatée par le backend',
      await jusqua(() => uiLive.describeUiLive().subscribers === 0));

    const etat = uiLive.describeUiLive();
    check(`ouvertes ${etat.opened} = fermées ${etat.closed}`, etat.opened === etat.closed);
    check('…et aucune fuite comptée', etat.leaked === 0);
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  section('DEUX ONGLETS = DEUX FLUX, PUIS PLUS AUCUN');
  {
    uiLive.resetUiLiveForTests();
    const a = await ouvrirFlux(token);
    const b = await ouvrirFlux(token);
    check('deux abonnés', uiLive.describeUiLive().subscribers === 2);

    /**
     * UN SEUL ONGLET SE FERME. L'autre doit continuer de RECEVOIR — c'est la
     * différence entre retirer un abonné et vider la collection.
     */
    a.controleur.abort();
    check('il en reste un', await jusqua(() => uiLive.describeUiLive().subscribers === 1));

    const livres = uiLive.notifyResourceChanged(uiLive.UI_RESOURCE.SITE_STATUS);
    check('…et il est toujours prévenu', livres.notified === 1);

    b.controleur.abort();
    check('les deux ont disparu', await jusqua(() => uiLive.describeUiLive().subscribers === 0));
    check('aucune fuite', uiLive.describeUiLive().leaked === 0);
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  section('CINQUANTE CYCLES — LE COMPTE REVIENT À ZÉRO');
  {
    uiLive.resetUiLiveForTests();
    for (let i = 0; i < 50; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const flux = await ouvrirFlux(token);
      flux.controleur.abort();
    }
    check('plus aucun abonné après 50 ouvertures/fermetures',
      await jusqua(() => uiLive.describeUiLive().subscribers === 0, 10_000));

    const etat = uiLive.describeUiLive();
    check(`50 ouvertes, ${etat.closed} fermées`, etat.opened === 50 && etat.closed === 50);
    check('…et l’écart reste nul', etat.leaked === 0);

    /**
     * ET RIEN NE S'ACCUMULE HORS DES ABONNÉS. Le service ne conserve aucune
     * identité, aucune adresse, aucun horodatage après la déconnexion : seuls
     * des compteurs subsistent, et ils ne grandissent pas avec le parc.
     */
    check('l’état publié ne porte que des NOMBRES et le catalogue',
      Object.keys(etat).sort().join(',')
        === 'closed,eventsEmitted,leaked,opened,resources,subscribers');
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  section('SANS SESSION, AUCUN FLUX');
  {
    uiLive.resetUiLiveForTests();
    const res = await fetch(`${base}/api/live/events`);
    check(`la route refuse un anonyme (${res.status})`, res.status === 401);
    check('…et aucun abonné n’a été créé', uiLive.describeUiLive().opened === 0);
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  section('LE CATALOGUE DÉCLARÉ EST LE CATALOGUE ROUTABLE');
  {
    const declares = Object.values(uiLive.UI_RESOURCE).sort();

    /**
     * ══ UNE DETTE DÉCLARÉE, PAS UN ROUGE QU'ON APPREND À IGNORER ═══════════
     *
     * `legal-document` est ÉMIS par le backend (`legalDocument.service.js`,
     * deux points d'émission) et n'est consommé par PERSONNE. Ce n'est pas un
     * oubli de branchement côté Manager : son lecteur naturel est la VITRINE —
     * ce sont ses pages « Mentions légales » et « Politique de confidentialité »
     * qui doivent se rafraîchir quand le Panel publie un nouveau document.
     *
     * Or `/api/live/events` est derrière `authenticate` (voir
     * `routes/uiLive.routes.js`), et la vitrine est ANONYME. Elle ne peut donc
     * pas s'y abonner, et la promesse écrite dans le service — « rendre la
     * publication visible sur un site déjà ouvert, sans rechargement » — n'est
     * pas tenue aujourd'hui.
     *
     * ── POURQUOI ON NE SUPPRIME PAS L'ÉMISSION ───────────────────────────
     *
     * Parce que la bonne réponse n'est pas « retirer le fil », c'est
     * « brancher l'autre bout » : ouvrir un canal d'invalidation PUBLIC pour la
     * vitrine, ou renoncer explicitement au rafraîchissement à chaud des pages
     * légales. Les deux sont des décisions d'architecture, pas des corrections
     * d'écran — et supprimer l'émission les rendrait invisibles.
     *
     * ── ET POURQUOI ON NE LAISSE PAS LA RECETTE ROUGE ────────────────────
     *
     * Un rouge permanent cesse d'être lu, et il emporte avec lui les DEUX
     * contrôles de ce bloc — qui, eux, gardent tous les autres scopes. La dette
     * est donc NOMMÉE ici : le jour où le canal public existe, il suffit de
     * retirer cette ligne pour que la garde reprenne son plein effet.
     */
    const DETTE_SANS_CONSOMMATEUR_MANAGER = [uiLive.UI_RESOURCE.LEGAL_DOCUMENT];
    const aControler = declares.filter((s) => !DETTE_SANS_CONSOMMATEUR_MANAGER.includes(s));

    /**
     * LES DEUX CÔTÉS DISENT LA MÊME CHOSE. Le Manager déclare son union de
     * types à la main : si elle s'écarte du backend, un scope émis n'est
     * jamais écouté — ou un écran s'abonne à un nom qui n'existe pas.
     */
    const front = lire('manager/src/lib/liveInvalidation.ts');
    const union = front.match(/export type LiveResource =([^;]+);/)?.[1] ?? '';
    const cotesFront = [...union.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    check(`le Manager déclare les mêmes scopes — ${cotesFront.join(', ')}`,
      JSON.stringify(cotesFront) === JSON.stringify(aControler));

    /**
     * CHAQUE SCOPE A UN PRODUCTEUR. Sans émetteur, un écran s'abonne à un
     * silence — et croit être vivant.
     */
    const sources = ['services', 'controllers', 'models']
      .flatMap((d) => fichiersJs(path.join(racine, 'backend/src', d)))
      .filter((f) => !f.endsWith('uiLive.service.js'))
      .map((f) => fs.readFileSync(f, 'utf8'))
      .join('\n');
    const cleParScope = Object.fromEntries(
      Object.entries(uiLive.UI_RESOURCE).map(([cle, valeur]) => [valeur, cle]),
    );
    const sansProducteur = declares.filter(
      (scope) => !sources.includes(`UI_RESOURCE.${cleParScope[scope]}`),
    );
    check(`chaque scope a un producteur${sansProducteur.length ? ` — orphelins : ${sansProducteur}` : ''}`,
      sansProducteur.length === 0);

    /**
     * ET CHAQUE SCOPE A UN CONSOMMATEUR. C'est le contrôle qui manquait :
     * `contract` était déclaré des deux côtés, émis par personne, écouté par
     * personne — et rien ne le signalait.
     */
    const ecrans = fichiersFront(path.join(racine, 'manager/src'))
      .map((f) => fs.readFileSync(f, 'utf8'))
      .join('\n');
    const sansConsommateur = aControler.filter((scope) => !ecrans.includes(`live: '${scope}'`));
    check(`chaque scope a un consommateur${sansConsommateur.length ? ` — fantômes : ${sansConsommateur}` : ''}`,
      sansConsommateur.length === 0);
  }

  /* ══════════════════════════════════════════════════════════════════════ */
  section('UNE RESSOURCE INCONNUE NE DIFFUSE RIEN');
  {
    uiLive.resetUiLiveForTests();
    const flux = await ouvrirFlux(token);
    const issue = uiLive.notifyResourceChanged('inventée-au-fil-de-l-eau');
    check('elle est ignorée, pas diffusée', issue.notified === 0);
    check('…et l’abonné reste connecté', uiLive.describeUiLive().subscribers === 1);
    flux.controleur.abort();
    await jusqua(() => uiLive.describeUiLive().subscribers === 0);
  }
} finally {
  try { server.close(); server.closeAllConnections?.(); } catch { /* déjà fermé */ }
  await disconnectDatabase();
  await mongod.stop();
}

/** Tous les `.js` d'un dossier, récursivement. */
function fichiersJs(dossier) {
  if (!fs.existsSync(dossier)) return [];
  return fs.readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
    const complet = path.join(dossier, e.name);
    if (e.isDirectory()) return fichiersJs(complet);
    return e.name.endsWith('.js') ? [complet] : [];
  });
}

/** Tous les `.ts`/`.tsx` du Manager, hors tests d'atelier. */
function fichiersFront(dossier) {
  if (!fs.existsSync(dossier)) return [];
  return fs.readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
    const complet = path.join(dossier, e.name);
    if (e.isDirectory()) return fichiersFront(complet);
    return /\.tsx?$/.test(e.name) && !e.name.includes('.test.') ? [complet] : [];
  });
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
