/* SUIVI LIVE DE DÉPLOIEMENT — le run appartient au backend, pas à la page.
 *
 * ── LES DEUX DÉFAUTS QUE CE FICHIER VERROUILLE ──────────────────────────────
 *
 * 1. LE DOUBLE MODÈLE. `DeployRunning` reconstruisait la checklist dans un
 *    `useState` alimenté par le flux. Quitter l'écran jetait cet état ; le
 *    déploiement, lui, continuait. L'utilisateur revenait devant un écran vide
 *    et un bouton « Déployer » réarmé — au-dessus d'un travail bien vivant.
 *
 * 2. LA REQUÊTE JAMAIS ÉMISE. `refuserRunEtranger` filtrait
 *    `/deployment/runs/:id` pour bloquer les identifiants d'un autre projet. Il
 *    voyait `active` comme un identifiant, jetait `DEPLOYMENT_RUN_ID_ETRANGER`
 *    AVANT le `fetch`, et l'exception mourait dans un `.catch()`. Résultat :
 *    dans Chromium, AUCUNE requête `GET /api/deployment/runs/active` ne
 *    partait. La découverte de run actif ne pouvait pas échouer — elle n'avait
 *    jamais lieu. Un garde de sécurité avait discrètement supprimé la
 *    fonctionnalité qu'il protégeait.
 *
 * Le second défaut est invisible à la relecture : le code du hook est correct,
 * il s'exécute, et il ne lève rien de visible. Seul un compteur de requêtes
 * réelles le montre — c'est le rôle de `scripts/recette-deploiement-live.mjs`,
 * qui pilote un vrai Chromium. Ce fichier-ci verrouille la RÈGLE de transport
 * en isolation, pour qu'aucune modification future ne la casse en silence.
 *
 * Runner autonome. Lancement : npm run test */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import {
  estRunIdDeCeProjet,
  estSousRessourceDeRuns,
  SOUS_RESSOURCES_DE_RUNS,
} from '@/lib/deploymentRunId';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const lire = (p) => readFileSync(join(SRC, p), 'utf8');

let pass = 0;
let fail = 0;
function check(nom, cond, detail) {
  if (cond) { pass += 1; console.log(`  ✓ ${nom}`); }
  else { fail += 1; console.error(`  ✗ ${nom}${detail ? `\n      ${detail}` : ''}`); }
}
function section(n) { console.log(`\n${n}`); }

/**
 * Blanchit les commentaires en préservant les lignes.
 *
 * Sans ça, une explication qui CITE le motif interdit (« l'ancienne version
 * appelait `setSteps` ») ferait échouer la règle qu'elle documente : le test
 * interdirait d'expliquer ce qui a été corrigé.
 */
function codeSeul(texte) {
  const blanc = (m) => m.replace(/[^\n]/g, ' ');
  return texte
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, blanc)
    .replace(/\/\*[\s\S]*?\*\//g, blanc)
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
}

/* ══ 1 · LA RÈGLE DE TRANSPORT — `active` n'est pas un identifiant ════════ */
section('1 · Sous-ressources de /deployment/runs');

check('`active` est reconnu comme sous-ressource', estSousRessourceDeRuns('active'));
check("la liste est gelée (pas d'élargissement accidentel)",
  Object.isFrozen(SOUS_RESSOURCES_DE_RUNS));
check("un identifiant de run n'est PAS une sous-ressource",
  // Fixture NEUTRE : elle portait le slug d'un projet du parc, recopié à chaque
  // duplication. Un identifiant d'exemple n'a pas à nommer un client.
  !estSousRessourceDeRuns('run-exemple-1730000000000-ab12'));
check('les valeurs non-chaînes sont refusées',
  !estSousRessourceDeRuns(null) && !estSousRessourceDeRuns(undefined)
  && !estSousRessourceDeRuns(42) && !estSousRessourceDeRuns({}));

/**
 * Le point exact du défaut : `active` ne ressemble PAS à un run-id de ce
 * projet. Sans la règle de sous-ressource, le garde le rejetait donc.
 */
check("`active` ne passe pas le test d'appartenance au projet — d'où le défaut",
  !estRunIdDeCeProjet('active'));

/* ══ 2 · LE GARDE LAISSE PASSER LA DÉCOUVERTE ════════════════════════════ */
section('2 · refuserRunEtranger');

const apiCode = codeSeul(lire('lib/api.ts'));

check('le garde consulte estSousRessourceDeRuns',
  /estSousRessourceDeRuns\s*\(/.test(apiCode),
  'sans cet appel, /deployment/runs/active est rejeté avant le fetch');
check("…AVANT de tester l'appartenance au projet",
  apiCode.indexOf('estSousRessourceDeRuns(') < apiCode.indexOf('estRunIdDeCeProjet('),
  "l'ordre importe : estRunIdDeCeProjet(«active») est faux");
check('la découverte passe par api.deployment.activeRun',
  /activeRun\s*[:(]/.test(apiCode));
check('la route de découverte est bien /deployment/runs/active',
  /deployment\/runs\/active/.test(apiCode));

/* ══ 3 · UN SEUL MODÈLE DE VUE ═══════════════════════════════════════════ */
section('3 · DeployRunning ne reconstruit plus la checklist');

const running = lire('pages/dev/deployment/DeployRunning.tsx');
const runningCode = codeSeul(running);

check('aucun setSteps dans le code (hors commentaires)',
  !/setSteps/.test(runningCode),
  'le double modèle est de retour');
check("aucun useState d'étapes accumulées",
  !/useState[^\n]*steps/i.test(runningCode));
check('DeployRunning délègue à DeploymentFollowUp',
  /<DeploymentFollowUp\b/.test(runningCode));
check('le lanceur est resté mince',
  running.split('\n').length < 200,
  `${running.split('\n').length} lignes`);

/* ══ 4 · DeploymentFollowUp EST LA VUE MÉTIER UNIQUE ═════════════════════ */
section('4 · Vue métier unique');

const followUpCode = codeSeul(lire('pages/dev/deployment/DeploymentFollowUp.tsx'));

check('elle observe le backend (useDeploymentObserver)',
  /useDeploymentObserver\s*\(/.test(followUpCode));
/*
 * R12 — CETTE ASSERTION EXIGEAIT LE DÉFAUT.
 *
 * Elle demandait `status === 'success'`. Le moteur n'écrit jamais ce statut :
 * son vocabulaire est `ok | warning | error | cancelled | interrupted |
 * finalization_failed`. Le contrôle verrouillait donc la comparaison qui
 * affichait « échoué » sur tout déploiement réussi.
 *
 * L'invariant tenu ici reste le même — le verdict ne se calcule pas dans la
 * vue — mais il se vérifie désormais par la DÉLÉGATION à l'autorité partagée,
 * dont `deploymentProgress.test.mjs` éprouve le vocabulaire contre le modèle.
 */
check("le verdict est délégué à l'autorité partagée",
  /verdictDeRun\s*\(/.test(followUpCode) && !/status\s*===\s*'success'/.test(followUpCode),
  'le moteur ne connaît pas le statut « success »');
check('la progression vient du snapshot, pas d’une horloge',
  /progressionDeRun\s*\(/.test(followUpCode));
check('la roue historique est bien rendue',
  /<RadialProgress/.test(followUpCode));
check("elle n'accumule aucun état d'étapes",
  !/setSteps/.test(followUpCode));
check('aucune autorité localStorage sur le run',
  !/localStorage/.test(followUpCode));

/* ══ 5 · LE RÉSULTAT NE S'ESCAMOTE PAS ═══════════════════════════════════ */
section('5 · Un run terminé reste lisible');

const pageCode = codeSeul(lire('pages/dev/DeploymentPage.tsx'));

check('la page lit aussi `dernier` (le run terminé)',
  /dernier\s*:\s*dernierRun/.test(pageCode),
  "sans lui, un run achevé pendant l'absence n'a rien à afficher");
check('la reprise retombe sur le résultat récent',
  /runActif\s*\?\?\s*resultatRecent/.test(pageCode));
check('un run terminé n’est montré que s’il est FRAIS',
  /FRAICHEUR_RESULTAT_MS/.test(pageCode),
  "sinon l'écran devient un mémorial des échecs passés");
check("la fin du run n'acquitte plus toute seule",
  !/onTermine[\s\S]{0,220}acquitterReprise\s*\(/.test(pageCode),
  "le résultat disparaîtrait à l'instant où il arrive");
/**
 * L'ACQUITTEMENT PORTE UN IDENTIFIANT DE RUN, PAS UN BOOLÉEN.
 *
 * Il valait `onFermer={acquitterReprise}` — un drapeau « l'écran a été
 * refermé », remis à zéro à chaque montage et incapable de dire QUEL run avait
 * été lu. Après un déploiement réussi, « Déployer » réaffichait donc aussitôt
 * l'écran de réussite du run PRÉCÉDENT, pendant que le nouveau partait en
 * arrière-plan. En acquittant un identifiant, un run DIFFÉRENT reprend la main
 * de lui-même.
 */
check("l'utilisateur dispose d'un acquittement explicite",
  /onFermer\s*=\s*\{\s*\(\)\s*=>\s*acquitterRun\(reprise\.id\)\s*\}/.test(pageCode));
check("…et il porte l'identifiant du run acquitté, jamais un simple drapeau",
  /candidatReprise\.id\s*!==\s*runAcquitte/.test(pageCode)
  && !/repriseAcquittee/.test(pageCode));
check('aucune autorité localStorage sur le run actif',
  !/localStorage[^\n]*(run|deploy)/i.test(pageCode));

/* ══ 6 · LA DÉCOUVERTE INTERROGE LE BACKEND, À CHAQUE MONTAGE ════════════ */
section('6 · useActiveDeployment');

const resumeCode = codeSeul(lire('pages/dev/deployment/useDeploymentResume.ts'));

check('le montage appelle api.deployment.activeRun',
  /api\.deployment\.activeRun\s*\(/.test(resumeCode));
check('aucun cache localStorage ne se substitue au backend',
  !/localStorage/.test(resumeCode));
check("aucun sondage périodique (setInterval) n'a été introduit",
  !/setInterval/.test(resumeCode),
  'la reprise est évènementielle, pas un polling');
check("l'observation est annulable sans annuler le déploiement",
  /AbortController/.test(resumeCode) && /abort\(\)/.test(resumeCode));
check('la reconnexion est bornée',
  /tentatives\s*>\s*\d+/.test(resumeCode));

/* == 7 . UN REDEMARRAGE DE BACKEND N'EST PAS UN ECHEC == */
section('7 · Coupure attendue pendant un déploiement');

/**
 * Cette garantie a été PERDUE une fois, en scindant `DeployRunning` : elle
 * vivait dans le composant, et la recette navigateur ne l'a pas vue partir —
 * son faux moteur ne coupe jamais l'API. Elle est verrouillée ici pour que la
 * prochaine réorganisation la casse bruyamment, pas en silence.
 */
check('une indisponibilité transitoire est reconnue comme telle',
  /estIndisponibiliteTransitoire\s*\(\s*err\s*\)/.test(resumeCode));
check('on reprend depuis le run PERSISTÉ',
  /reprendreDepuisLeRun\s*\(/.test(resumeCode));
check('…sans jamais relancer une seconde opération',
  !/streamDeploy|deployStream/.test(resumeCode),
  'ce serait déployer deux fois');
check('la patience est bornée par RECULS_MS', /RECULS_MS/.test(resumeCode));
check('un backend qui ne revient pas est NOMMÉ', /BACKEND_NOT_BACK/.test(resumeCode));
check("l'écran distingue redémarrage et perte de suivi",
  /redemarrage/.test(followUpCode) && /liveperdu\s*&&\s*!redemarrage/.test(followUpCode),
  'deux causes, deux messages');

/* == 8 . LE LANCEMENT NE PEUT PLUS RESTER SUSPENDU == */
section('8 · Lancement : aucun loader infini');

const lancement = codeSeul(lire('pages/dev/deployment/useDeploymentLaunch.ts'));

/**
 * LE DÉFAUT : « Ouverture du déploiement… » en boucle.
 *
 * Le contrôleur d'annulation était créé DANS l'effet de lancement, et le
 * nettoyage de cet effet l'annulait. Or un effet se nettoie à CHAQUE changement
 * de dépendance, pas seulement au démontage : un `corps` recalculé une fois
 * suffisait à avorter le POST avant l'arrivée de `run.created`. Le garde
 * `lance.current` étant déjà armé, personne ne relançait — l'écran attendait un
 * identifiant que plus personne n'enverrait, alors que le run existait.
 *
 * Un F5 le retrouvait, puisque la découverte, elle, interroge le backend. C'est
 * la signature du défaut : réparable par rechargement, donc invisible aux tests
 * qui rechargent.
 */
check("la fermeture n'appartient plus à l'effet de lancement",
  /useEffect\(\(\) => \(\) => \{/.test(lancement) && /\}, \[\]\);/.test(lancement),
  'sans effet de démontage dédié, un changement de dépendance avorte le lancement');
check('le contrôleur survit dans une référence',
  /controleurRef/.test(lancement));
check("un flux coupé interroge le backend avant de conclure",
  /rattraperDepuisLeBackend/.test(lancement)
  && /activeRun\(\)/.test(lancement),
  'un POST mort ne prouve pas qu’aucun run n’existe');
check('…et ce filet couvre AUSSI le cas « aucun identifiant émis »',
  (lancement.match(/rattraperDepuisLeBackend\(\)/g) || []).length >= 2);
check('un seul lancement par montage reste garanti',
  /lance\.current/.test(lancement));

/* == 9 . LE RAPPORT EST DE NOUVEAU ATTEIGNABLE == */
section('9 · Rapport de déploiement');

check('la vue de suivi propose de copier le rapport',
  /Copier le rapport/.test(followUpCode));
check('…en allant le chercher sur le run persisté',
  /getRun\(/.test(followUpCode),
  'le rapport n’est pas dans l’instantané de suivi, volontairement minimal');
check('…et propose d’ouvrir le rapport complet',
  /onRapport/.test(followUpCode));
check('la page relie ce bouton à la modale existante',
  /onRapport=\{setReportRunId\}/.test(codeSeul(lire('pages/dev/DeploymentPage.tsx'))));

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
