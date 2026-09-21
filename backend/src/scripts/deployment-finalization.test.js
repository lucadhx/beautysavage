// FINALISATION D'UN DÉPLOIEMENT — le succès ne s'affiche que s'il est vrai.
//
// ══ L'INCIDENT REPRODUIT ════════════════════════════════════════════════════
//
// Le 06/08, le déploiement de `demo-sbauto06.ly-solution.com` a affiché son
// écran de SUCCÈS pendant que la destination gardait le badge bleu
// « Publication… ». Relevé en base juste après :
//
//   run  6a74f1ba… : status=ok, finishedAt=20:46:10.664
//   destination    : state=DEPLOYING, currentVersion=null, history=[], __v=0
//
// `__v=0` et `history` vide prouvaient que `doc.save()` n'avait jamais abouti.
// La cause : le pipeline avait produit deux étapes `warning`
// (`server.preflight`, `dns.site`), or `historyStepSchema.status` n'admettait
// que `ok | error | running`. `recordDeployment` levait donc une
// ValidationError — avalée par un `.catch(() => {})`.
//
// Le modèle refusait la réalité au lieu de la décrire, et l'appelant cachait
// le refus. L'écran, lui, déduisait le succès d'un pipeline vert sans jamais
// relire l'état persisté.
import { strict as assert } from 'node:assert';

process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'TEST';

const { MongoMemoryServer } = await import('mongodb-memory-server');
const mongoose = (await import('mongoose')).default;

const serveur = await MongoMemoryServer.create();
process.env.MONGODB_URI = serveur.getUri();
await mongoose.connect(serveur.getUri(), { dbName: 'finalisation' });

const { DeploymentTarget } = await import('../models/DeploymentTarget.model.js');
const targets = await import('../services/deploymentTarget.service.js');

let ok = 0;
let ko = 0;
const check = (libelle, condition) => {
  if (condition) { ok += 1; console.log(`  ✓ ${libelle}`); }
  else { ko += 1; console.log(`  ✗ ${libelle}`); }
};
const section = (titre) => console.log(`\n${titre}`);

await DeploymentTarget.init();

let n = 0;
const destination = async () => {
  n += 1;
  await DeploymentTarget.deleteMany({});
  const at = new Date();
  return DeploymentTarget.create({
    name: `Demo ${n}`, url: `https://d${n}.exemple.com`, host: `d${n}.exemple.com`,
    type: 'domain', environment: 'TEST', backendPort: 5000 + n,
    lifecycleStatus: 'ACTIVE', state: 'DEPLOYING',
    createdAt: at, updatedAt: at,
  });
};

/* ══════════════════════════════════════════════════════════════════════════ */
section('LES STATUTS QUE LE MOTEUR PRODUIT SONT ACCEPTÉS');
{
  const d = await destination();

  // Exactement les statuts du run réel : deux `warning` parmi des `ok`.
  const steps = [
    { step: 'upload', label: 'Upload', status: 'ok', durationMs: 10 },
    { step: 'server.preflight', label: 'Prérequis serveur', status: 'warning', durationMs: 20 },
    { step: 'dns.site', label: 'DNS du site', status: 'warning', durationMs: 30 },
    { step: 'media_publish', label: 'Médias', status: 'skipped', durationMs: 1 },
  ];

  let leve = null;
  try {
    await targets.recordDeployment(String(d._id), {
      pipeline: { steps, failedStep: null }, version: '1c2080f', ok: true,
      user: 'dev@exemple.com', durationMs: 216183, error: null,
    });
  } catch (e) { leve = e; }

  check('un déploiement comportant des étapes « warning » s’enregistre', leve === null);
  check('…« skipped » aussi', leve === null);

  const apres = await DeploymentTarget.findById(d._id).lean();
  check('la destination atteint DEPLOYED', apres.state === 'DEPLOYED');
  check('…sa version est inscrite', apres.currentVersion === '1c2080f');
  check('…sa date de mise en ligne aussi', apres.lastDeployedAt !== null);
  check('…son historique porte l’opération', apres.history?.[0]?.operationType === 'DEPLOYMENT');
  check('…avec les quatre étapes, statuts compris', apres.history?.[0]?.steps?.length === 4);
  check('…dont les « warning », conservés tels quels',
    apres.history[0].steps.filter((s) => s.status === 'warning').length === 2);

  /* L'INVARIANT DU SUCCÈS, vérifié sur l'état PERSISTÉ. */
  check('INVARIANT : aucun verrou de déploiement ne subsiste', apres.activeDeploymentRunId === null);
  check('INVARIANT : le cycle de vie est ACTIVE', apres.lifecycleStatus === 'ACTIVE');
  check('INVARIANT : aucun état transitoire ne subsiste après un succès',
    apres.state !== 'DEPLOYING' && apres.lifecycleStatus !== 'DEPROVISIONING');

  const vue = targets.serializeTarget(await DeploymentTarget.findById(d._id));
  check('l’écran ne peut donc plus afficher « Publication… »', vue.state === 'DEPLOYED');
  check('…et propose de redéployer, pas d’attendre', vue.canDeploy === true);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('UN ÉCHEC DE FINALISATION N’EST PLUS AVALÉ');
{
  const d = await destination();

  // Un statut d'étape RÉELLEMENT inconnu doit encore être refusé : le modèle
  // s'ouvre à ce que le moteur produit, pas à n'importe quoi.
  let leve = null;
  try {
    await targets.recordDeployment(String(d._id), {
      pipeline: { steps: [{ step: 'x', label: 'X', status: 'inconnu', durationMs: 1 }], failedStep: null },
      version: 'abc', ok: true, user: 'x@y.z', durationMs: 1, error: null,
    });
  } catch (e) { leve = e; }

  check('un statut hors contrat est toujours REFUSÉ', leve !== null);
  check('…et l’erreur REMONTE, au lieu d’être avalée', leve?.name === 'ValidationError');

  const apres = await DeploymentTarget.findById(d._id).lean();
  check('…la destination reste alors dans son état transitoire — c’est la vérité',
    apres.state === 'DEPLOYING');
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LE CONTRÔLEUR TRANSMET L’ÉCHEC ET RETIRE LE SUCCÈS');
{
  const fs = await import('node:fs/promises');
  const sansCommentaires = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const ctrl = sansCommentaires(await fs.readFile(
    new URL('../controllers/deployment.controller.js', import.meta.url), 'utf8',
  ));

  check('`recordDeployment` n’est plus suivi d’un catch muet',
    !/recordDeployment\([\s\S]{0,600}?\}\)\s*\.catch\(\(\) => \{\}\)/.test(ctrl));
  check('son échec est transmis dans le flux',
    /deployment\.finalization_failed/.test(ctrl));
  /*
    L'INVARIANT VIT DANS UN SERVICE DÉDIÉ, pas en ligne dans le contrôleur.
    Il est appelé par le déploiement ET par le retrait, et il RELIT la base :
    le laisser dans un contrôleur l'aurait dupliqué au premier appelant
    suivant — et deux copies d'une règle finissent par diverger.
  */
  check('l’état final est RELU avant d’annoncer un succès',
    /verifyFinalization\(runId, targetId\)/.test(ctrl));

  const service = sansCommentaires(await fs.readFile(
    new URL('../services/deployment/forensics/finalization.service.js', import.meta.url), 'utf8',
  ));
  check('…et confronté aux conditions de l’invariant',
    /state === 'DEPLOYED'/.test(service)
    && /lifecycleStatus === 'ACTIVE'/.test(service)
    && /activeDeploymentRunId/.test(service)
    && /portActive/.test(service));
  check('…qui relit la destination ET la réservation de port',
    /DeploymentTarget\.findById/.test(service) && /reservationFor/.test(service));
  check('…et marque le run « finalization_failed » plutôt que réussi',
    /finalization_failed/.test(service));
  check('le rapport final porte l’état de finalisation', /finalized:/.test(ctrl));

  /**
   * ══ L'ÉCRAN NE DÉDUIT PLUS LE SUCCÈS — IL LE LIT ═════════════════════════
   *
   * Ces contrôles visaient `DeployRunning`, qui calculait `ok` à partir des
   * évènements reçus (`e.ok && e.finalized !== false`). Ce calcul a disparu
   * avec le double modèle : le suivi lit désormais le `status` PERSISTÉ du run,
   * celui-là même que `finalizeRun` écrit — `finalization_failed` compris.
   *
   * L'invariant est donc plus fort qu'avant : l'écran ne peut plus se tromper
   * sur la finalisation, puisqu'il ne la calcule plus. On vérifie ici la seule
   * chose qui puisse encore mal tourner — que le test de succès soit une
   * APPARTENANCE (`=== 'success'`) et non une exclusion, sans quoi un statut
   * d'échec futur serait affiché comme un succès.
   */
  const ui = sansCommentaires(await fs.readFile(
    new URL('../../../manager/src/pages/dev/deployment/DeploymentFollowUp.tsx', import.meta.url), 'utf8',
  ));
  /**
   * ══ CETTE ASSERTION FIGEAIT LE DÉFAUT (corrigé en R12) ═══════════════════
   *
   * Elle EXIGEAIT `vue.status === 'success'`. Or le moteur n'écrit jamais ce
   * statut : son énumération est `ok | warning | error | cancelled |
   * interrupted | finalization_failed`. Le contrôle verrouillait donc la
   * comparaison qui faisait afficher « échoué » sur TOUT déploiement réussi —
   * un test peut cimenter un défaut aussi solidement qu'il en prévient un.
   *
   * L'invariant défendu, lui, n'a pas changé : le succès se teste par
   * APPARTENANCE, jamais par exclusion, sans quoi un statut d'échec futur
   * s'afficherait comme un succès. Il est simplement vérifié là où il vit
   * désormais — dans l'autorité partagée, contre le vocabulaire réel.
   */
  const autorite = sansCommentaires(await fs.readFile(
    new URL('../../../manager/src/lib/deploymentProgress.ts', import.meta.url), 'utf8',
  ));
  check('l’écran délègue le verdict à l’autorité partagée',
    /verdictDeRun\s*\(/.test(ui) && !/status\s*===\s*'success'/.test(ui));
  check('le succès se teste par APPARTENANCE, pas par exclusion',
    /STATUTS_SUCCES\.includes/.test(autorite));
  check('…et `finalization_failed` n’en fait PAS partie',
    /STATUTS_SUCCES\s*=\s*Object\.freeze\(\['ok'\]\)/.test(autorite),
    'un déploiement dont la destination n’a pas été finalisée n’est pas un succès');
  check('…un statut inconnu retombe en non-succès',
    /return 'echec'/.test(autorite));
}

/* ══════════════════════════════════════════════════════════════════════════ */
console.log(`\n${ok} réussis, ${ko} échoués`);
await mongoose.disconnect();
await serveur.stop();
assert.equal(ko, 0, `${ko} vérification(s) en échec.`);
