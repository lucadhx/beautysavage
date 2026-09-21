/**
 * ══ LE MANAGER NE PARLE QU'À SON PROPRE BACKEND ═════════════════════════════
 *
 * ── L'INCIDENT QUI A IMPOSÉ CETTE GARDE ────────────────────────────────────
 *
 * Un `ECONNRESET` sur `/api/deployment/runs/<uuid>/stream?since=0` a été
 * attribué au Manager SB Auto pendant un déploiement. Un premier audit a
 * répondu « cette route appartient au Panel » en s'appuyant sur le NOM de la
 * route et le FORMAT de l'identifiant. C'étaient des indices, pas des preuves :
 * un nom se copie, et un format se partage.
 *
 * La preuve ne peut venir que du CONTRAT RÉEL : quelles adresses le Manager
 * sait-il émettre, et son propre backend les sert-il toutes ?
 *
 * ── CE QUE CETTE RECETTE VÉRIFIE, ET POURQUOI AINSI ────────────────────────
 *
 * Elle ne cherche pas le mot « Panel » — un tel contrôle passerait au travers
 * d'une URL absolue, d'un port codé en dur ou d'un chemin recopié. Elle
 * confronte deux sources indépendantes :
 *
 *   1. toutes les adresses `/deployment/...` que le code du Manager peut
 *      construire ;
 *   2. la PILE EXPRESS RÉELLEMENT MONTÉE par ce backend.
 *
 * Toute adresse que le Manager sait émettre et que ce backend ne sert pas
 * désigne, par construction, un AUTRE serveur. C'est exactement la classe de
 * défaut que l'incident faisait craindre, et elle devient impossible à
 * introduire en silence.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(ICI, '..');
const PROJET = path.resolve(ICI, '../../..');
const MANAGER = path.join(PROJET, 'manager/src');

let pass = 0;
let fail = 0;
const check = (nom, cond) => {
  if (cond) { pass += 1; console.log(`  ✓ ${nom}`); }
  else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (t) => console.log(`\n${t}`);

/* ── L'application RÉELLE, et les routes qu'elle sert VRAIMENT ───────────── */
process.env.ENV = process.env.ENV || 'TEST';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
process.env.DB_TEST = process.env.DB_TEST || 'manager_contract_probe';
process.env.DB_PROD = process.env.DB_PROD || 'manager_contract_probe_prod';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'manager-contract-secret-0123456789abcdef0123456789';
process.env.INTEGRATED_API_ENCRYPTION_KEY = process.env.INTEGRATED_API_ENCRYPTION_KEY || '0'.repeat(64);
process.env.NGROK_API_URL = process.env.NGROK_API_URL || 'http://127.0.0.1:1';

const { createApp } = await import('../app.js');
const app = createApp();

/** Parcourt la pile Express et rend les chemins réellement montés. */
function routesMontees(pile, prefixe = '') {
  const out = [];
  for (const couche of pile ?? []) {
    if (couche.route) {
      for (const methode of Object.keys(couche.route.methods)) {
        out.push({ methode: methode.toUpperCase(), chemin: prefixe + couche.route.path });
      }
    } else if (couche.name === 'router' && couche.handle?.stack) {
      const seg = (couche.regexp?.source ?? '')
        .replace('^\\/', '/')
        .replace('\\/?(?=\\/|$)', '')
        .replace(/\\\//g, '/')
        .replace(/\$$/, '');
      out.push(...routesMontees(couche.handle.stack, prefixe + (seg === '/' ? '' : seg)));
    }
  }
  return out;
}

const montees = routesMontees(app?._router?.stack ?? app?.router?.stack);
const deploiement = montees.filter((r) => r.chemin.startsWith('/api/deployment'));

/* ── Les adresses que le Manager sait construire ─────────────────────────── */
function fichiersDu(dossier) {
  const out = [];
  for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
    const complet = path.join(dossier, e.name);
    if (e.isDirectory()) out.push(...fichiersDu(complet));
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(complet);
  }
  return out;
}

/**
 * ON JUGE LE CODE, PAS LE RÉCIT.
 *
 * Cette garde a rougi sur sa propre documentation : le correctif décrit
 * l'adresse fautive de l'incident dans un commentaire de `api.ts`, et une
 * lecture brute y voyait un appel. Une garde qui punit l'explication du défaut
 * qu'elle protège finit par être désactivée — et le défaut revient avec elle.
 *
 * `https://` n'est jamais amputé : seules les lignes COMMENÇANT par `//` sont
 * retirées.
 */
const codeSeul = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const adresses = new Set();
for (const fichier of fichiersDu(MANAGER)) {
  const source = codeSeul(fs.readFileSync(fichier, 'utf8'));
  /**
   * `'/deployment/...'` et `` `${API_BASE}/deployment/...` `` — les deux formes
   * employées par le Manager.
   *
   * ── LES INTERPOLATIONS DEVIENNENT DES PARAMÈTRES, ELLES N'ARRÊTENT PAS LA
   *    LECTURE ────────────────────────────────────────────────────────────────
   * S'arrêter au premier `${` tronquait `/deployment/runs/${runId}/stream` en
   * `/deployment/runs` — une adresse parfaitement servie, donc un contrôle qui
   * passait. La falsification l'a montré : c'est précisément la forme de
   * l'incident qui échappait. On remplace donc chaque interpolation par un
   * segment quelconque, et l'adresse complète est confrontée au routeur.
   */
  for (const m of source.matchAll(/['"`](?:\$\{API_BASE\})?(\/deployment\/[^'"`\s)]*)/g)) {
    const brut = m[1]
      // Une interpolation SIMPLE est un segment quelconque : `${id}` → `:param`.
      .replace(/\$\{[A-Za-z0-9_.?]*\}/g, ':param')
      // La chaîne de requête n'appartient pas au chemin routé.
      .replace(/[?$].*$/, '')
      .replace(/\/+$/, '');
    if (brut.length > '/deployment'.length) adresses.add(brut);
  }
}

/** Une adresse concrète correspond-elle à un chemin monté (paramètres compris) ? */
const servie = (adresse) => deploiement.some((r) => {
  const motif = new RegExp(`^${r.chemin.replace(/:[A-Za-z0-9_]+/g, '[^/]+').replace(/\//g, '\\/')}$`);
  return motif.test(`/api${adresse}`);
});

/* ══════════════════════════════════════════════════════════════════════════ */
section('1 · Le backend de CE projet sert bien un plan de déploiement');
{
  check(`des routes /api/deployment sont montées (${deploiement.length})`, deploiement.length > 0);
  check('la recette a bien extrait des adresses du Manager', adresses.size > 0);
}

section('2 · TOUTE adresse de déploiement du Manager est servie par CE backend');
{
  const orphelines = [...adresses].filter((a) => !servie(a));
  check(
    `aucune adresse ne désigne un autre serveur${orphelines.length ? ` — ${orphelines.join(', ')}` : ''}`,
    orphelines.length === 0,
  );
  if (orphelines.length) {
    console.error('    → Ces adresses ne sont servies par AUCUNE route de ce backend.');
    console.error('       Elles visent donc un AUTRE serveur (Panel ou autre) : c’est un défaut d’appartenance.');
  }
}

section('3 · Le Manager n’emprunte JAMAIS le flux de run du Panel');
{
  /**
   * `GET /api/deployment/runs/:runId/stream?since=` est la surface du PANEL —
   * il s'y déploie lui-même et rediffuse son journal durable. Ce projet suit
   * son déploiement par le flux NDJSON de `POST /deployment/deploy/stream`.
   *
   * Les confondre ferait piloter un déploiement depuis le mauvais serveur.
   */
  const sertFluxDeRun = deploiement.some((r) => /\/runs\/[^/]*\/stream$/.test(r.chemin));
  check('ce backend ne monte AUCUN flux `runs/:id/stream`', sertFluxDeRun === false);

  const emprunte = [...adresses].some((a) => /\/runs\//.test(a) && /stream/.test(a));
  check('…et le Manager n’en demande aucun', emprunte === false);

  const managerSources = fichiersDu(MANAGER).map((f) => codeSeul(fs.readFileSync(f, 'utf8'))).join('\n');
  check('…il n’utilise pas non plus le curseur `?since=` d’un tel flux',
    !/\/deployment\/[^'"`]*since=/.test(managerSources));
}

section('4 · Aucune adresse ABSOLUE ne contourne le proxy de même origine');
{
  /**
   * Le Manager parle à son backend en RELATIF (`/api/...`), servi en même
   * origine par le proxy de développement puis par Nginx. Une URL absolue —
   * `http://localhost:4100`, un domaine de Panel — sortirait de cette origine
   * et viserait un serveur choisi à la main.
   */
  const sources = fichiersDu(MANAGER).map((f) => ({ f, s: codeSeul(fs.readFileSync(f, 'utf8')) }));
  const absolues = [];
  for (const { f, s } of sources) {
    for (const m of s.matchAll(/https?:\/\/[^'"`\s]*\/(?:api\/)?deployment[^'"`\s]*/g)) {
      absolues.push(`${path.relative(PROJET, f)} → ${m[0]}`);
    }
  }
  check(`aucune URL absolue de déploiement dans le Manager${absolues.length ? ` — ${absolues.join(' | ')}` : ''}`,
    absolues.length === 0);
}

section('5 · Un seul point d’entrée peut réellement PUBLIER');
{
  const publiants = deploiement.filter((r) => r.methode === 'POST' && /\/deploy(\/stream)?$/.test(r.chemin));
  check(`exactement un point d’entrée de publication (${publiants.length})`, publiants.length === 1);
  check('…et c’est le flux instrumenté',
    publiants[0]?.chemin === '/api/deployment/deploy/stream');
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
