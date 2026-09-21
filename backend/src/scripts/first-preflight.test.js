// FIRST_PREFLIGHT_AFTER_BOOT — le premier clic doit suffire.
//
// ══ CE QUE CE FICHIER FIXE ══════════════════════════════════════════════════
//
// La vérification des prérequis restait indéfiniment sur « Connexion sécurisée
// au serveur ». La cause n'était ni SSH, ni le réseau, ni le proxy de
// développement : `streamOperation` levait une `ReferenceError` juste avant
// d'émettre son rapport.
//
//   let finalise = false;              // ── déclarées DANS `if (!preflightOnly)`
//   let erreurFinalisation = null;     // ──
//   ...
//   finalizationError: erreurFinalisation ?? ...   // ── lues HORS du bloc
//
// `let` est à portée de bloc. La lecture levait donc `erreurFinalisation is not
// defined` — dans TOUS les cas, préflight comme déploiement, puisque cette
// ligne est évaluée sans condition. Conséquences en chaîne :
//
//   · `deployment.report_ready` jamais émis → aucun évènement terminal ;
//   · `res.end()` jamais atteint → le flux NDJSON ne se ferme pas ;
//   · Express n'attendant pas les gestionnaires `async`, le rejet devient un
//     `unhandledRejection` — d'où « [forensique] rejet non géré ».
//
// Les deux garanties vérifiées ici :
//   1. le rapport terminal est TOUJOURS émis et le flux TOUJOURS fermé ;
//   2. aucune variable du rapport n'est hors de la portée où il la lit.
import { strict as assert } from 'node:assert';

process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'TEST';

let ok = 0;
let ko = 0;
const check = (libelle, condition) => {
  if (condition) { ok += 1; console.log(`  ✓ ${libelle}`); } else { ko += 1; console.log(`  ✗ ${libelle}`); }
};
const section = (titre) => console.log(`\n${titre}`);

const fs = await import('node:fs/promises');
const source = await fs.readFile(new URL('../controllers/deployment.controller.js', import.meta.url), 'utf8');
/** Le fichier privé de ses commentaires : une assertion ne doit pas se valider sur son explication. */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ══════════════════════════════════════════════════════════════════════════ */
section('LA RÉFÉRENCE FAUTIVE — reproduction de la portée exacte');
{
  /**
   * On rejoue le modèle de portée original, sans dépendre du texte du fichier :
   * c'est le COMPORTEMENT de JavaScript qui est en cause, et c'est lui qu'on
   * montre. Avant correction, la fonction ci-dessous est ce qu'exécutait le
   * contrôleur.
   */
  const versionFautive = (preflightOnly) => {
    if (!preflightOnly) {
      // eslint-disable-next-line no-unused-vars
      let finalise = false;
      // eslint-disable-next-line no-unused-vars, prefer-const
      let erreurFinalisation = null;
    }
    // Hors du bloc : les deux identifiants n'existent plus.
    // eslint-disable-next-line no-undef
    return { finalizationError: erreurFinalisation ?? null };
  };

  let leve = null;
  try { versionFautive(true); } catch (e) { leve = e; }
  check('la portée d’origine lève bien une ReferenceError', leve instanceof ReferenceError);
  check('…et c’est exactement le message observé en production',
    /erreurFinalisation is not defined/.test(leve?.message ?? ''));
  check('…y compris pour un PRÉFLIGHT, qui n’entre jamais dans le bloc',
    leve !== null);

  let leveDeploiement = null;
  try { versionFautive(false); } catch (e) { leveDeploiement = e; }
  check('…et pour un DÉPLOIEMENT aussi : la ligne est évaluée sans condition',
    leveDeploiement instanceof ReferenceError);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LE CONTRÔLEUR N’A PLUS CETTE PORTÉE');
{
  /**
   * On isole le corps de `streamOperation` et on vérifie que les variables du
   * rapport ne sont plus déclarées à l'intérieur du bloc réservé au
   * déploiement. Une déclaration ajoutée ailleurs « pour faire taire l'erreur »
   * ne passerait pas : on exige qu'elles précèdent le bloc.
   */
  const iDeclFinalise = code.indexOf('let finalise =');
  const iDeclErreur = code.indexOf('let erreurFinalisation =');
  const iBloc = code.indexOf('if (!preflightOnly) {', iDeclFinalise);
  const iLecture = code.indexOf('finalizationError: erreurFinalisation');

  check('`finalise` est déclarée', iDeclFinalise > 0);
  check('`erreurFinalisation` est déclarée', iDeclErreur > 0);
  check('…AVANT le bloc réservé au déploiement', iDeclErreur < iBloc && iDeclFinalise < iBloc);
  check('…et donc avant la ligne qui les lit', iDeclErreur < iLecture);
  check('un préflight n’annonce pas un échec de finalisation qui ne lui est pas dû',
    /let finalise = preflightOnly;/.test(code));
  check('aucune seconde déclaration ne masque le problème',
    (code.match(/let erreurFinalisation/g) ?? []).length === 1);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('AUCUNE EXCEPTION NE PEUT LAISSER LE FLUX OUVERT');
{
  // On compte les APPELS, pas la déclaration — qui porte la même signature.
  check('les deux routes de flux passent par la ceinture',
    (code.match(/return fluxProtege\(req, res, \{/g) ?? []).length === 2);
  check('…qui n’appelle plus `streamOperation` en direct',
    !/return streamOperation\(req, res/.test(code));
  check('avant en-têtes, un vrai 500 est rendu', /res\.status\(500\)/.test(code));
  check('après en-têtes, un dernier évènement TERMINAL est écrit',
    /type: 'deployment\.report_ready'[\s\S]{0,400}ok: false/.test(code));
  check('…avec un code d’erreur exploitable', /DEPLOYMENT_STREAM_FAILED/.test(code));
  check('…et le flux est fermé', /res\.end\(\);/.test(code));
  check('l’erreur est journalisée, jamais avalée', /eventCode: EVENTS\.HTTP_REQUEST_FAILED/.test(code));
  check('aucun `catch` vide n’a été introduit dans la ceinture',
    !/catch \{ \}/.test(code.slice(code.indexOf('async function fluxProtege'))));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LE RAPPORT TERMINAL EST ÉMIS SUR TOUS LES CHEMINS');
{
  const corps = code.slice(code.indexOf('async function streamOperation'), code.indexOf('async function fluxProtege'));
  const iRapport = corps.indexOf("type: 'deployment.report_ready'");
  const iFin = corps.indexOf('res.end()', iRapport);

  check('le rapport précède la fermeture du flux', iRapport > 0 && iFin > iRapport);
  check('le succès n’est annoncé que si l’état persisté le confirme',
    /finalized: preflightOnly \? true : \(finalise && verdict\.finalized\)/.test(corps));
  check('le run est persisté AVANT le rapport',
    corps.indexOf('runs.finalizeRun(runId, result)') < iRapport);
  check('le run actif est libéré à la fin', /clearActiveRun\(runId\)/.test(corps));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('ÉCOUTEURS D’ÉVÈNEMENTS — aucun `async` qui rejette dans le vide');
{
  /**
   * Un `EventEmitter` de Node n'attend pas ses écouteurs : le rejet d'un
   * écouteur `async` devient un `unhandledRejection`. On interdit donc la
   * forme `emitter.on('x', async () => …)` dans ce périmètre.
   */
  const fichiers = [
    '../controllers/deployment.controller.js',
    '../services/deployment/forensics/httpTrace.js',
    '../services/deployment/forensics/processGuard.js',
  ];
  for (const f of fichiers) {
    const brut = (await fs.readFile(new URL(f, import.meta.url), 'utf8'))
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const coupables = brut.match(/\.on\('[a-z]+',\s*async/g) ?? [];
    check(`${f.split('/').pop()} : aucun écouteur async non attendu`, coupables.length === 0);
  }
}

/* ══════════════════════════════════════════════════════════════════════════ */
console.log(`\n${ok} réussis, ${ko} échoués`);
assert.equal(ko, 0, `${ko} vérification(s) en échec.`);
