/**
 * ══ LA TRACE QUI S'ARME TOUTE SEULE — ÉPROUVÉE ══════════════════════════════
 *
 * Le backend redémarrait au clic « Suivant » de l'étape « Connexion au
 * serveur », et l'écran annonçait un échec de connexion. La mesure a établi que
 * seul un changement de fichier IMPORTÉ produit « Restarting 'src/server.js' »
 * (une exception ou un signal donnent « Failed running »). Restait à nommer le
 * fichier — au moment même où cela se produit.
 *
 * Cette recette éprouve le diagnostic automatique : il s'arme au bon endroit,
 * voit ce qui bouge, survit au redémarrage qu'il observe, ne dit rien de faux
 * quand rien ne bouge, et ne laisse échapper aucun secret.
 *
 * Runner autonome : aucun réseau, aucune base, aucun VPS.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

process.env.ENV = process.env.ENV || 'TEST';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
process.env.DB_TEST = process.env.DB_TEST || 'forensics_probe';
process.env.DB_PROD = process.env.DB_PROD || 'forensics_probe_prod';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'forensics-secret-0123456789abcdef0123456789';
process.env.INTEGRATED_API_ENCRYPTION_KEY = process.env.INTEGRATED_API_ENCRYPTION_KEY || '0'.repeat(64);
process.env.NGROK_API_URL = process.env.NGROK_API_URL || 'http://127.0.0.1:1';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(ICI, '..');

let pass = 0;
let fail = 0;
const check = (nom, ok) => {
  if (ok) { pass += 1; console.log(`  ✓ ${nom}`); }
  else { fail += 1; console.error(`  ✗ ${nom}`); }
};
const section = (t) => console.log(`\n${t}`);
const dormir = (ms) => new Promise((r) => { setTimeout(r, ms); });

const forensics = await import('../services/deployment/forensics/restartForensics.js');

/**
 * ON PART D'UN JOURNAL VIERGE.
 *
 * Le journal de reprise est CUMULATIF — c'est sa raison d'être en exploitation.
 * Dans une recette, ce cumul couple les exécutions entre elles : une session
 * d'hier peut satisfaire une attente d'aujourd'hui, et le contrôle devient
 * vert pour une mauvaise raison.
 */
try { fs.rmSync(forensics.cheminTrace, { force: true }); } catch { /* rien à retirer */ }

/**
 * Attend qu'un fait soit RÉELLEMENT inscrit — à partir d'un point donné du
 * journal, jamais depuis son début : la notification récursive de Windows est
 * asynchrone, et un délai fixe rendrait la recette flottante.
 */
async function attendreDansLeJournal(motif, depuis) {
  for (let i = 0; i < 50; i += 1) {
    const brut = fs.existsSync(forensics.cheminTrace)
      ? fs.readFileSync(forensics.cheminTrace, 'utf8') : '';
    if (brut.slice(depuis).includes(motif)) return true;
    await dormir(100);
  }
  return false;
}
const tailleJournal = () => (fs.existsSync(forensics.cheminTrace)
  ? fs.statSync(forensics.cheminTrace).size : 0);

/**
 * ══ UN TÉMOIN DOIT ÊTRE CHARGÉ, PAS SEULEMENT ÉCRIT (V2) ═══════════════════
 *
 * Cette recette créait auparavant un fichier sous `src/` et attendait qu'il soit
 * nommé. La V1 le voyait, parce qu'elle surveillait le DOSSIER. La V2 ne le voit
 * plus, et c'est un PROGRÈS : la mesure établit qu'un fichier jamais importé ne
 * provoque AUCUN redémarrage. Le nommer serait désigner un innocent.
 *
 * Le témoin est donc réellement CHARGÉ (`require`), ce qui le fait entrer dans
 * le graphe — exactement comme un module du produit. La falsification porte
 * alors sur ce qu'elle prétend éprouver.
 */
const require_ = createRequire(import.meta.url);
function poserTemoinCharge(nom, contenu = '// témoin\n') {
  const chemin = path.join(SRC, 'services/deployment/forensics', nom);
  fs.writeFileSync(chemin, contenu);
  require_(chemin); // → entre dans le graphe (cache CommonJS)
  return chemin;
}
function retirerTemoin(chemin) {
  try { delete require_.cache[require_.resolve(chemin)]; } catch { /* jamais chargé */ }
  try { fs.unlinkSync(chemin); } catch { /* déjà retiré */ }
}

/** On capture la console : c'est la SORTIE que l'exploitant copiera. */
function capturerConsole() {
  const lignes = [];
  const original = console.log;
  console.log = (...args) => { lignes.push(args.join(' ')); };
  return { lignes, rendre: () => { console.log = original; } };
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('1 · La trace ne s’active jamais en production, et sans drapeau ailleurs');
{
  check('activable dans le monde de développement (ENV=TEST)', forensics.estActivable() === true);
  const source = fs.readFileSync(
    path.join(SRC, 'services/deployment/forensics/restartForensics.js'), 'utf8',
  );
  check('…et refusée en PROD, par une condition explicite',
    /config\.env !== 'PROD'/.test(source));
  check('aucun drapeau manuel n’est requis',
    !/process\.env\.(FORENSICS|DEBUG_FS|TRACE)_/.test(source));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('2 · Elle est armée par le VRAI point d’entrée du clic « Suivant »');
{
  /**
   * Le parcours a été tracé : `DeployAssistant.next()` (étape 1) → `connect()`
   * → `api.deployment.openVpsSession` → `POST /api/deployment/vps-session`.
   * C'est donc DANS ce contrôleur que l'armement doit vivre — pas dans un
   * endpoint voisin qu'on aurait supposé.
   */
  const ctrl = fs.readFileSync(path.join(SRC, 'controllers/deployment.controller.js'), 'utf8');
  const iOuverture = ctrl.indexOf('export const openVpsSession');
  const iArmement = ctrl.indexOf('forensics.armerTraceConnexion');
  check('l’armement est bien dans `openVpsSession`', iArmement > iOuverture && iOuverture > 0);
  check('…avec l’étape nommée', /etape: 'CONNECTION_SERVER'/.test(ctrl));
  /**
   * V2 — LE DÉSARMEMENT EST DIFFÉRÉ, ET C'EST UN CORRECTIF.
   *
   * Le run réel s'est interrompu JUSTE après la sonde SSH : refermer la trace
   * dans la même milliseconde pouvait la clore quelques instants avant le
   * redémarrage qu'elle cherchait. `planifierDesarmement` conserve le
   * désarmement — la surveillance permanente serait du bruit — en lui ajoutant
   * un court répit.
   */
  check('elle se désarme quand la connexion aboutit', /planifierDesarmement\('CONNECTED'\)/.test(ctrl));
  check('…comme lorsqu’elle est refusée', /planifierDesarmement\('SSH_REFUSED'\)/.test(ctrl));

  const assistant = fs.readFileSync(
    path.resolve(SRC, '../../manager/src/pages/dev/deployment/DeployAssistant.tsx'), 'utf8',
  );
  check('et le clic « Suivant » de l’étape 1 appelle bien cette connexion',
    /step === 1[\s\S]{0,300}await connect\(\{/.test(assistant));
}

/* ══════════════════════════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════════════════════
   3-5. LA DETECTION DE FICHIER A QUITTE L ENFANT — VOIR LE LOT NON-INTRUSIF.
   ══════════════════════════════════════════════════════════════════════════ */
section("3 · L armement est desormais O(1) — il n observe plus les fichiers");
{
  /**
   * Ces trois sections eprouvaient la capacite de l ENFANT a nommer un fichier
   * ecrit pendant la fenetre. Elle a ete retiree, et le journal dit pourquoi :
   *
   *     22:37:57.653  ARMED
   *     22:37:57.663  CHANGE  startupReconciliation.service.js   (+10 ms)
   *     22:37:57.797  CHANGE  integratedApiStartup.service.js    (+144 ms)
   *     22:37:59.258  Restarting
   *
   * ARMED est la derniere ligne ecrite par l enfant : il est mort dans son
   * propre balayage de 1200 fichiers. Un observateur qui perturbe ce qu il
   * mesure ne mesure plus rien.
   *
   * La detection vit maintenant cote LANCEUR, qui observe depuis npm run dev et
   * survit au redemarrage — eprouvee dans deployment-restart-forensics-v3.
   */
  const capture = capturerConsole();
  forensics.armerTraceConnexion({ etape: "CONNECTION_SERVER" });
  forensics.noterHttp("POST", "/api/deployment/vps-session");
  forensics.noterHttp("GET", "/api/deployment/dns-status?hostname=demo-sbauto06.ly-solution.com");
  forensics.noterSsh("probe start", { host: "vps.exemple.com", username: "root" });
  const issue = forensics.desarmerTrace("TEST");
  capture.rendre();
  const texte = capture.lignes.join("\n");

  check("l armement se declare O(1)", /ARMED_O1/.test(texte));
  check("...et ne rend aucun declencheur",
    issue.candidat === null && issue.touches.length === 0);
  check("les appels de l etape figurent toujours dans la trace",
    /HTTP POST \/api\/deployment\/vps-session START/.test(texte)
    && /HTTP GET \/api\/deployment\/dns-status/.test(texte));
  check("...et les etapes SSH aussi", /SSH probe start/.test(texte));
  check("chaque ligne porte un numero d ordre et un horodatage",
    /\[DEPLOY-FORENSICS #001 \d{2}:\d{2}:\d{2}\.\d{3}\]/.test(texte));
  check("l etape est nommee des l armement", /ARMED .*tape=CONNECTION_SERVER/.test(texte));
  check("la valeur de la chaine de requete n est PAS recopiee",
    !/hostname=demo-sbauto06/.test(texte));
  check("le resume renvoie au lanceur pour l attribution",
    /CÔTÉ LANCEUR/.test(texte));

  forensics.armerTraceConnexion({ etape: "CONNECTION_SERVER" });
  forensics.noterHttp("POST", "/api/deployment/vps-session");
  const capture2 = capturerConsole();
  const reprise = forensics.rejouerTraceInterrompue();
  capture2.rendre();
  const texte2 = capture2.lignes.join("\n");
  check("une session interrompue est toujours reimprimee au demarrage suivant",
    /\[RECOVERY\].*INTERROMPUE/.test(texte2) && /\[RECOVERY\].*ARMED/.test(texte2));
  check("...en renvoyant au verdict du lanceur",
    /attribution=CÔTÉ LANCEUR/.test(texte2) && reprise?.candidat === null);
}
/* ══════════════════════════════════════════════════════════════════════════ */
section('6 · AUCUN SECRET ne peut entrer dans la trace');
{
  const secrets = [
    ['mot de passe SSH nommé', 'password=SuperSecret123', /password=«caviardé»/],
    /**
     * L'en-tête subit DEUX règles : celle du porteur (`Bearer …`) puis celle
     * des paires `clé: valeur`. La seconde absorbe la première — le résultat
     * est `Authorization: «caviardé»`, soit plus prudent encore que
     * `Bearer «caviardé»`. On atteste donc le masquage, pas sa forme exacte.
     */
    ['en-tête d’autorisation', 'Authorization: Bearer abc.def.ghi', /«caviardé»/],
    ['jeton JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature', /«jwt-caviardé»/],
    ['URI Mongo', 'mongodb://user:pass@host:27017/db', /mongodb:\/\/«caviardé»/],
    ['clé fournisseur', 'sk_live_ABCDEFGH1234', /«clé-caviardée»/],
    ['secret en JSON', '{"secret":"tres-confidentiel"}', /«caviardé»/],
  ];
  for (const [nom, brut, attendu] of secrets) {
    const masque = forensics.caviarder(brut);
    check(`${nom} — masqué`, attendu.test(masque));
    check(`${nom} — la valeur d’origine a disparu`,
      !masque.includes('SuperSecret123') && !masque.includes('tres-confidentiel')
      && !masque.includes('abc.def.ghi') && !masque.includes('ABCDEFGH1234')
      && !/user:pass@/.test(masque));
  }

  /** Le fichier de reprise voyage lui aussi : il subit la même règle. */
  const trace = fs.existsSync(forensics.cheminTrace)
    ? fs.readFileSync(forensics.cheminTrace, 'utf8') : '';
  check('le journal de reprise ne contient aucun mot de passe',
    !/password=[^«\s]/i.test(trace) && !/Bearer\s+[A-Za-z0-9]/.test(trace));
  check('…et vit HORS du code source (donc ne relance jamais le service)',
    !path.resolve(forensics.cheminTrace).startsWith(path.resolve(SRC) + path.sep));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('7 · Désarmement automatique — aucun surveillant ne fuit');
{
  /**
   * La section 5 a VOLONTAIREMENT laissé une session ouverte : elle simulait un
   * process qui meurt avant de conclure. Dans la réalité, cette mémoire
   * disparaît avec le process ; ici elle survit, puisque la recette, elle, ne
   * meurt pas. On la referme donc explicitement avant d'éprouver l'hygiène.
   */
  check('la session laissée ouverte par la simulation de crash est encore là',
    forensics.estArmee() === true);
  forensics.desarmerTrace('CLEANUP');
  check('…et se referme proprement', forensics.estArmee() === false);

  forensics.armerTraceConnexion({ etape: 'CONNECTION_SERVER' });
  check('une session s’arme', forensics.estArmee() === true);
  const seconde = forensics.armerTraceConnexion({ etape: 'CONNECTION_SERVER' });
  check('…et un second clic n’en ouvre pas une deuxième (aucune fuite de handle)',
    seconde === null);
  forensics.desarmerTrace('TEST');
  check('le désarmement libère la session', forensics.estArmee() === false);
  check('désarmer deux fois est sans effet', forensics.desarmerTrace('TEST') === null);

  const source = fs.readFileSync(
    path.join(SRC, 'services/deployment/forensics/restartForensics.js'), 'utf8',
  );
  check('une fenêtre bornée referme la session même sans issue',
    /setTimeout\(\(\) => desarmerTrace\('TIMEOUT'\)/.test(source));
  /**
   * IL N'Y A PLUS DE SURVEILLANT À FERMER — c'est la meilleure des hygiènes.
   *
   * L'enfant n'ouvre plus aucun `fs.watch` : il ne peut donc plus en fuir un.
   * Les veilleurs vivent chez le lanceur, qui les ferme à sa sortie.
   */
  check('l’enfant n’ouvre aucun surveillant, donc n’en fuit aucun',
    !/fs\.watch\(/.test(source));
  check('…et le lanceur, lui, ferme les siens',
    /arreterHelpers/.test(fs.readFileSync(
      path.resolve(SRC, '../scripts/forensics/watchAuthority.js'), 'utf8',
    )));
  check('aucun gestionnaire de signal n’est posé — la terminaison reste celle de Node',
    !/process\.on\('SIGTERM'|process\.on\('SIGINT'/.test(source));
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
