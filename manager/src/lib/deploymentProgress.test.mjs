/* VERDICT ET PROGRESSION D'UN DÉPLOIEMENT — et le contrôle qui manquait.
 *
 * ── LE DÉFAUT QUE CE FICHIER FERME ──────────────────────────────────────────
 *
 * La vue de suivi testait `status === 'success'`. Le moteur n'écrit jamais ce
 * statut : son énumération terminale est `ok | warning | error | cancelled |
 * interrupted | finalization_failed`. **Tout déploiement réussi s'affichait
 * « échoué ».**
 *
 * Rien ne l'a vu. Le typage ne pouvait pas : `status` est un `string`. La
 * recette navigateur ne pouvait pas davantage — son faux moteur émettait
 * `success`, donc le harnais confirmait la vue au lieu de la contredire. Deux
 * mensonges qui se valident l'un l'autre ne laissent aucune trace.
 *
 * Le contrôle décisif est donc celui-ci : **lire l'énumération dans le modèle
 * Mongo et vérifier que le frontend la reconnaît**. Écrire les statuts en dur
 * ici ne prouverait rien — ce serait recopier la même erreur des deux côtés.
 *
 * Runner autonome. Lancement : npm run test */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import {
  verdictDeRun, progressionDeRun, etapeCourante, etatAnneau, estTermine,
} from '@/lib/deploymentProgress';

const RACINE = fileURLToPath(new URL('../../..', import.meta.url));

let pass = 0;
let fail = 0;
function check(nom, cond, detail) {
  if (cond) { pass += 1; console.log(`  ✓ ${nom}`); }
  else { fail += 1; console.error(`  ✗ ${nom}${detail ? `\n      ${detail}` : ''}`); }
}
const section = (n) => console.log(`\n${n}`);

const run = (status, steps = [], active = undefined) => ({
  id: 'run-1',
  status,
  active: active ?? status === 'running',
  steps: steps.map((s, i) => ({ id: s.id ?? `s${i}`, label: s.label ?? `Étape ${i}`, status: s.status })),
});

/* ══ 1 · LE VOCABULAIRE VIENT DU MODÈLE, PAS D'UNE SUPPOSITION ═══════════ */
section('1 · Vocabulaire réel du moteur');

const modele = readFileSync(join(RACINE, 'backend/src/models/DeploymentRun.model.js'), 'utf8');
/*
 * ON CHERCHE L'ÉNUMÉRATION PAR SON CONTENU, PAS PAR SA POSITION.
 *
 * Une première version prenait « le premier enum après `status: {` » et
 * attrapait celui d'`operationType` : le modèle contient plusieurs `status`
 * (celui d'une ÉTAPE n'a pas d'enum) et plusieurs énumérations. Un test qui se
 * repère à la position casse au premier champ ajouté — et casse en disant
 * n'importe quoi, ce qui est pire que de ne pas exister.
 *
 * L'énumération du RUN est la seule qui contienne `running`.
 */
const STATUTS = [...modele.matchAll(/enum:\s*\[([^\]]+)\]/g)]
  .map((m) => m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean))
  .find((liste) => liste.includes('running')) ?? [];

check('l’énumération du modèle a bien été lue', STATUTS.length >= 5, STATUTS.join(' | '));
check('« success » n’existe PAS dans le moteur — c’était tout le défaut',
  !STATUTS.includes('success'),
  'si ce contrôle échoue, le moteur a changé de langue et la vue doit suivre');
check('« ok » est bien le succès du moteur', STATUTS.includes('ok'));

/**
 * AUCUN STATUT DU MODÈLE NE DOIT TOMBER DANS UN TROU.
 *
 * C'est le contrôle qui aurait attrapé le défaut : il ne demande pas « la vue
 * connaît-elle `success` ? » mais « la vue sait-elle classer TOUT ce que le
 * moteur peut écrire ? ».
 */
for (const s of STATUTS) {
  const v = verdictDeRun(run(s, [], s === 'running'));
  check(`« ${s} » est classé (${v})`, ['en-cours', 'succes', 'reserve', 'interrompu', 'echec'].includes(v));
}
check('un « ok » est un SUCCÈS', verdictDeRun(run('ok')) === 'succes');
check('un « interrupted » est distinct d’un échec', verdictDeRun(run('interrupted')) === 'interrompu');
check('un « finalization_failed » n’est PAS un succès',
  verdictDeRun(run('finalization_failed')) === 'echec');
check('un statut inconnu est traité en non-succès (sens prudent)',
  verdictDeRun(run('quelque_chose_de_neuf')) === 'echec');
check('`active` prime : un run actif n’est jamais terminal',
  verdictDeRun({ status: 'ok', active: true }) === 'en-cours' && !estTermine({ status: 'ok', active: true }));

/* ══ 2 · LA PROGRESSION VIENT DU SNAPSHOT ════════════════════════════════ */
section('2 · Progression');

const CONTRAT = ['a', 'b', 'c', 'd', 'e'];
const etapes = (statuts) => statuts.map((st, i) => ({ id: CONTRAT[i], status: st }));

check('aucune étape achevée → 0 %',
  progressionDeRun(run('running', etapes(['running'])), CONTRAT).pourcentage === 0);
check('2 étapes sur 5 → 40 %',
  progressionDeRun(run('running', etapes(['ok', 'ok', 'running'])), CONTRAT).pourcentage === 40);
check('une étape sautée compte comme franchie',
  progressionDeRun(run('running', etapes(['ok', 'skipped', 'running'])), CONTRAT).pourcentage === 40);
check('un avertissement compte aussi',
  progressionDeRun(run('running', etapes(['ok', 'warning', 'running'])), CONTRAT).pourcentage === 40);

/**
 * LE DÉNOMINATEUR VIENT DU CONTRAT, PAS DU RUN.
 *
 * Le run ne porte que les étapes ATTEINTES. Diviser par ce nombre donnerait
 * 100 % dès la première — une progression qui commence pleine puis redescend.
 */
check('le total vient du contrat, pas des étapes atteintes',
  progressionDeRun(run('running', etapes(['ok'])), CONTRAT).total === 5);

/**
 * LE CONTRÔLE LE PLUS IMPORTANT DE CE FICHIER.
 *
 * 100 % est une affirmation : « le site est en ligne ». L'afficher sur un
 * `finalization_failed` — fichiers partis, destination jamais finalisée — est
 * le mensonge le plus cher du parcours, celui qui fait fermer l'écran.
 */
const toutesOk = etapes(['ok', 'ok', 'ok', 'ok', 'ok']);
check('100 % UNIQUEMENT sur un succès réel',
  progressionDeRun(run('ok', toutesOk), CONTRAT).pourcentage === 100);
for (const mauvais of ['error', 'cancelled', 'interrupted', 'finalization_failed']) {
  const p = progressionDeRun(run(mauvais, toutesOk), CONTRAT);
  check(`…jamais sur « ${mauvais} » (${p.pourcentage} %)`, p.pourcentage < 100);
}
check('un run en cours ne peut pas non plus atteindre 100 %',
  progressionDeRun(run('running', toutesOk), CONTRAT).pourcentage === 99);

/* ══ 3 · LA PROGRESSION NE RECULE PAS, ET N'INVENTE RIEN ═════════════════ */
section('3 · Persistance de la progression');

/*
 * Le scénario réel du lot : on quitte à 40 %, deux étapes s'achèvent pendant
 * l'absence, on revient. La valeur doit être celle du SNAPSHOT, pas 0 — et pas
 * une reprise d'accumulation locale, qui n'existe plus.
 */
const avant = progressionDeRun(run('running', etapes(['ok', 'ok', 'running'])), CONTRAT);
const apres = progressionDeRun(run('running', etapes(['ok', 'ok', 'ok', 'ok', 'running'])), CONTRAT);
check('avant absence : 40 %', avant.pourcentage === 40);
check('après absence : 80 %, lu du snapshot', apres.pourcentage === 80);
check('…la progression n’est jamais repartie de zéro', apres.pourcentage > avant.pourcentage);

/*
 * PENDANT UNE INDISPONIBILITÉ, RIEN NE BOUGE (§19).
 *
 * La fonction est PURE : sans nouvel instantané, elle rend la même valeur. Une
 * barre qui avancerait toute seule rassurerait pendant une panne — exactement
 * ce qu'il ne faut pas.
 */
const fige = run('running', etapes(['ok', 'ok', 'running']));
check('sans nouvel instantané, la valeur ne bouge pas',
  progressionDeRun(fige, CONTRAT).pourcentage === progressionDeRun(fige, CONTRAT).pourcentage
  && progressionDeRun(fige, CONTRAT).pourcentage === 40);

/* ══ 4 · L'ÉTAPE NOMMÉE ET L'ÉTAT DE LA ROUE ════════════════════════════ */
section('4 · Étape courante et anneau');

check('l’étape en cours est nommée',
  etapeCourante(run('running', [
    { id: 'a', label: 'Transfert', status: 'ok' },
    { id: 'b', label: 'Installation', status: 'running' },
  ]))?.label === 'Installation');
check('sinon, la dernière étape atteinte',
  etapeCourante(run('interrupted', [
    { id: 'a', label: 'Transfert', status: 'ok' },
    { id: 'b', label: 'Installation', status: 'interrupted' },
  ]))?.label === 'Installation');
check('aucune étape → rien plutôt qu’une invention', etapeCourante(run('running', [])) === null);

check('anneau en cours', etatAnneau(verdictDeRun(run('running'))) === 'running');
check('anneau succès', etatAnneau(verdictDeRun(run('ok'))) === 'ok');
check('anneau erreur sur interruption', etatAnneau(verdictDeRun(run('interrupted'))) === 'error');
check('anneau erreur sur finalisation manquée',
  etatAnneau(verdictDeRun(run('finalization_failed'))) === 'error');

/* ══ 5 · LA VUE UTILISE BIEN CETTE AUTORITÉ ═════════════════════════════ */
section('5 · Vue de suivi');

const vue = readFileSync(
  join(RACINE, 'manager/src/pages/dev/deployment/DeploymentFollowUp.tsx'), 'utf8',
);
const codeSeul = vue.replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');

check('la vue ne teste plus « success » en dur',
  !/status\s*===\s*'success'/.test(codeSeul),
  'le vocabulaire du moteur ne contient pas ce statut');
check('elle délègue le verdict au module', /verdictDeRun\s*\(/.test(codeSeul));
check('elle dérive la progression du snapshot', /progressionDeRun\s*\(/.test(codeSeul));
check('la roue est rendue', /<RadialProgress/.test(codeSeul));
check('…et le pourcentage est lisible dans le DOM',
  /deploiement-pourcentage/.test(codeSeul),
  'sans repère stable, aucune recette ne peut prouver la progression');
check('aucune accumulation locale d’étapes n’est réintroduite',
  !/setSteps|steps\s*=>\s*\[/.test(codeSeul));

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
