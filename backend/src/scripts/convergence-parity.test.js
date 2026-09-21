/*
 * LOT 7 — Test de PARITÉ de convergence.
 *
 * Prouve que Brevo/e-mail ET le moteur de déploiement coexistent dans la version
 * canonique sans qu'un côté n'écrase l'autre :
 *   - le routeur API monte SIMULTANÉMENT les routes e-mail/brevo/contact ET les
 *     routes déploiement/plan-de-contrôle ET la route publique /version ;
 *   - le catalogue de testeurs de connexion expose les 4 fournisseurs
 *     (STRIPE, YOUSIGN, HOSTINGER, BREVO) — aucun n'a disparu à la fusion ;
 *   - la navigation Manager contient les DEUX univers (groupes e-mail + Déploiement).
 *
 * Aucune connexion réseau/DB : on inspecte les modules et la table de routage.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { apiRouter } from '../routes/index.js';

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.error('  ✗ ' + n)); };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Collecte les préfixes montés sur un Router Express (couche `router` = use()). */
function mountedPrefixes(router) {
  const out = [];
  for (const layer of router.stack || []) {
    // Express encode le préfixe dans layer.regexp ; on relit plutôt le nom source.
    if (layer.name === 'router' && layer.regexp) {
      out.push(layer.regexp.toString());
    }
  }
  return out.join('\n');
}

async function main() {
  const routes = mountedPrefixes(apiRouter);
  const has = (frag) => routes.includes(frag);

  // --- Axe Brevo / e-mail / contact ---
  check('route /version (publique) montée', has('version'));
  check('route /email-configuration montée', has('email'));
  check('route /dev/email-templates montée', has('email') && routes.includes('templates'));
  /*
   * R11 — AUCUNE ROUTE BREVO NE DOIT PLUS ETRE MONTEE.
   *
   * L'assertion exigeait l'inverse : que `/dev/brevo-webhook-config` existe.
   * Cette route administrait un webhook local chez Brevo avec la cle du projet.
   * Brevo n'appelle plus ce projet — les evenements suivent le COMPTE, celui du
   * Panel — et la cle a disparu avec son dernier appelant.
   *
   * On verrouille donc l'absence : une route d'administration qui reviendrait
   * rouvrirait le chemin par lequel un secret revient en base.
   */
  check('aucune route d’administration Brevo n’est montée', !routes.includes('brevo'));
  check('route /dev/domain-events montée', routes.includes('domain'));
  check('route /admin/contact-submissions montée', routes.includes('contact'));

  // --- Axe déploiement / plan de contrôle ---
  check('route /deployment montée', routes.includes('deployment'));
  check('route /admin/deployments (plan de contrôle) montée', routes.includes('deployments'));
  /*
   * R11 — LA SURFACE D'ADMINISTRATION DES INTEGRATED API A DISPARU.
   *
   * Les quatre fournisseurs sont administres par le Panel L.Y Solution : il n'y
   * avait plus rien a lire ni a ecrire ici. Verrouiller l'ABSENCE est ce qui
   * empeche la route de revenir « pour depanner » — et avec elle le chemin par
   * lequel un secret revient en base.
   */
  check('aucune route /integrated-apis n’est montée', !routes.includes('integrated'));

  /*
   * --- Testeurs de connexion : ceux qui ont ENCORE une clé locale à éprouver ---
   *
   * `YOUSIGN` a quitté cette liste avec son testeur. Un testeur local suppose
   * une credential locale, et ce projet n'en détient plus pour signer : celui
   * qui restait n'avait aucun appelant, et savait seulement répondre « clé
   * absente » — c'est-à-dire inviter quelqu'un à en coller une.
   *
   * On éprouve donc AUSSI son absence. Sans cela, le rétablir passerait
   * inaperçu, et avec lui le chemin par lequel une clé revient en base.
   */
  const svc = await import('../services/providerConnectionTest.service.js');
  const src = await fs.readFile(path.join(__dirname, '../services/providerConnectionTest.service.js'), 'utf8');
  for (const p of ['STRIPE', 'HOSTINGER', 'BREVO']) {
    check(`testeur ${p} présent`, src.includes(p + ':'));
  }
  check('AUCUN testeur de signature — il n’y a plus de clé locale à éprouver',
    !/(YOUSIGN|OPENSIGN|SIGNATURE)\s*:\s*test/i.test(src));
  check('export testProviderConnection présent', typeof svc.testProviderConnection === 'function' || src.includes('testProviderConnection'));

  // --- Navigation Manager : les deux univers cohabitent ---
  const navPath = path.resolve(__dirname, '../../../manager/src/config/nav.ts');
  const nav = await fs.readFile(navPath, 'utf8');
  check('nav : groupe Déploiement présent', nav.includes('Déploiement'));
  check('nav : /dev/deploiement présent', nav.includes('/dev/deploiement'));
  check('nav : /dev/deploiements (destinations) présent', nav.includes('/dev/deploiements'));
  check('nav : pages e-mail présentes', nav.includes('email') || nav.includes('livraisons') || nav.includes('templates-email'));
  check('nav : GROUP_ORDER dev contient Déploiement', /GROUP_ORDER[\s\S]*Déploiement/.test(nav));

  // --- API Manager : getVersion + controlPlane exposés ---
  const apiTs = await fs.readFile(path.resolve(__dirname, '../../../manager/src/lib/api.ts'), 'utf8');
  check('manager api.getVersion présent', apiTs.includes('getVersion'));
  check('manager api.controlPlane présent', apiTs.includes('controlPlane'));
  check('manager api email/brevo présent', /email|brevo/i.test(apiTs));

  // --- Cohérence RUNTIME local (bug page de connexion 6101) ---
  const root = path.resolve(__dirname, '../../..');
  const mgrVite = await fs.readFile(path.join(root, 'manager/vite.config.ts'), 'utf8');
  const vitVite = await fs.readFile(path.join(root, 'vitrine/vite.config.ts'), 'utf8');
  // Le proxy DOIT viser le backend canonique 6100, jamais l'ancien 6060.
  check('manager proxy -> 6100', /['"]\/api['"]\s*:\s*['"]http:\/\/localhost:6100['"]/.test(mgrVite));
  check('manager proxy /uploads -> 6100', /['"]\/uploads['"]\s*:\s*['"]http:\/\/localhost:6100['"]/.test(mgrVite));
  check('manager port dev = 6101', /port:\s*6101/.test(mgrVite));
  check('manager proxy ne vise plus 6060', !mgrVite.includes('localhost:6060'));
  check('vitrine proxy -> 6100', /http:\/\/localhost:6100/.test(vitVite) && !vitVite.includes('localhost:6060'));

  // Pas de VITE_API_URL ACTIF en local (sinon cross-origin -> CORS -> login vide).
  let envLocal = '';
  try { envLocal = await fs.readFile(path.join(root, 'manager/.env.local'), 'utf8'); } catch { /* absent = OK */ }
  const hasActiveViteApiUrl = envLocal.split('\n').some((l) => /^\s*VITE_API_URL\s*=/.test(l));
  check('.env.local ne définit pas VITE_API_URL actif', !hasActiveViteApiUrl);

  // API en même origine : API_ROOT retombe sur chemin relatif si pas d'URL.
  check('api.ts : API_ROOT défensif (import.meta.env?)', apiTs.includes('import.meta.env?'));

  // LoginPage : bon champ de logo + résolution média (pas de logo en dur).
  const login = await fs.readFile(path.join(root, 'manager/src/pages/LoginPage.tsx'), 'utf8');
  check('LoginPage utilise company.logos?.header', login.includes('logos?.header') || login.includes('logos.header'));
  // Le résolveur d'APERÇU porte désormais un nom qui dit sa responsabilité :
  // trois fonctions s'appelaient `resolveMediaUrl` pour trois rôles distincts.
  check('LoginPage utilise le résolveur d’aperçu', login.includes('resolvePreviewMediaUrl'));
  check('LoginPage charge le bootstrap public', login.includes('getPublicBootstrap'));
  check('LoginPage affiche le logo DEV', login.includes('devCompany') && login.includes('devLogo'));

  // Script de démarrage canonique : garde-fous.
  const dev = await fs.readFile(path.join(root, 'scripts/dev-canonical.mjs'), 'utf8');
  check('dev-canonical vérifie /health', dev.includes('/health'));
  check('dev-canonical vérifie /api/version', dev.includes('/api/version'));
  check('dev-canonical refuse le double-bind', /occup/i.test(dev) && dev.includes('portInUse'));
  check('dev-canonical signale 6060/6061', dev.includes('6060') && dev.includes('6061'));

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
