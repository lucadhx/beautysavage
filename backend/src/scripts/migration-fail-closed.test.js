// LA MIGRATION EST FAIL-CLOSED — elle refuse le démarrage plutôt que de mentir.
//
// ══ LE DÉFAUT MESURÉ, PUIS FERMÉ ════════════════════════════════════════════
//
// Sur les données réelles de `sbauto06_test` — deux destinations ACTIVE, sans
// environnement — la migration produisait ceci, constaté et non supposé :
//
//   rapport : {"environmentBackfilled":2}
//   les deux reportées en PROD, toutes deux ACTIVE
//   index « environnement_actif_unique » construit : FALSE
//   une TROISIÈME destination ACTIVE PROD acceptée → la garantie était ABSENTE
//
// L'échec de construction d'index était avalé par un `.catch(() => {})`. Le
// démarrage s'annonçait sain, et la règle « une seule destination active par
// environnement » n'existait pas. C'est le pire état possible : un système qui
// paraît conforme et ne l'est pas — précisément la panne que l'index devait
// rendre impossible.
//
// ══ CE QUI EST PROUVÉ ICI ═══════════════════════════════════════════════════
//
//   · deux ACTIVE TEST                  → démarrage REFUSÉ ;
//   · deux ACTIVE PROD                  → démarrage REFUSÉ ;
//   · une ACTIVE TEST + une ACTIVE PROD → démarrage accepté ;
//   · index impossible à construire     → démarrage REFUSÉ ;
//   · index réellement présent          → démarrage accepté, et VÉRIFIÉ ;
//   · aucun `.catch()` silencieux ne subsiste sur cette étape.
import { strict as assert } from 'node:assert';

process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'TEST';

const { MongoMemoryServer } = await import('mongodb-memory-server');
const mongoose = (await import('mongoose')).default;

/**
 * AUCUNE CONSTRUCTION AUTOMATIQUE D'INDEX.
 *
 * Mongoose construit les index déclarés dès qu'un modèle est compilé, en tâche
 * de fond. Ici, cela masquerait ce qu'on veut prouver : que c'est la MIGRATION
 * — et elle seule — qui pose la garantie, et qu'elle refuse de la poser sur un
 * état ambigu. Un index apparu tout seul entre deux scénarios rendrait le test
 * dépendant d'un ordonnancement invisible.
 */
mongoose.set('autoIndex', false);

const serveur = await MongoMemoryServer.create();
process.env.MONGODB_URI = serveur.getUri();
await mongoose.connect(serveur.getUri(), { dbName: 'fail-closed' });

const { DeploymentTarget } = await import('../models/DeploymentTarget.model.js');
const cycle = await import('../services/deployment/destinationLifecycle.service.js');

let ok = 0;
let ko = 0;
const check = (libelle, condition) => {
  if (condition) { ok += 1; console.log(`  ✓ ${libelle}`); }
  else { ko += 1; console.log(`  ✗ ${libelle}`); }
};
const section = (titre) => console.log(`\n${titre}`);

const at = new Date();
let compteur = 0;
/** Insère SANS passer par le modèle : on simule des fiches déjà en base. */
const poser = async (over) => {
  compteur += 1;
  await DeploymentTarget.collection.insertOne({
    name: `d${compteur}`, url: `https://d${compteur}.exemple.com`, host: `d${compteur}.exemple.com`,
    type: 'domain', backendPort: 5100 + compteur, sshHost: '203.0.113.10',
    state: 'DEPLOYED', history: [], createdAt: at, updatedAt: at, ...over,
  });
};

const remettreAZero = async () => {
  await DeploymentTarget.collection.deleteMany({});
  try { await DeploymentTarget.collection.dropIndexes(); } catch { /* aucune */ }
};

/** Rejoue la migration et rend l'issue : succès, ou code d'arrêt. */
const migrer = async () => {
  try {
    return { ok: true, rapport: await cycle.migrateDeploymentTargets() };
  } catch (err) {
    return { ok: false, code: err.code, message: err.message, details: err.details };
  }
};

/* ══════════════════════════════════════════════════════════════════════════ */
section('DEUX ACTIVE DANS LE MÊME ENVIRONNEMENT — démarrage REFUSÉ');
for (const env of ['TEST', 'PROD']) {
  await remettreAZero();
  await poser({ environment: env, lifecycleStatus: 'ACTIVE' });
  await poser({ environment: env, lifecycleStatus: 'ACTIVE' });

  const issue = await migrer();
  check(`deux ACTIVE ${env} : le démarrage est refusé`, issue.ok === false);
  check('…avec le code dédié',
    issue.code === cycle.MIGRATION_ERRORS.ACTIVE_CONFLICT);
  check('…le message NOMME l’environnement en cause', String(issue.message).includes(env));
  check('…et NOMME les deux fiches concernées',
    (issue.details?.conflicts?.[0]?.fiches ?? []).length === 2);
  check('…en donnant leur hôte et leur port',
    /d\d\.exemple\.com \(port 51\d\d, _id /.test(String(issue.message)));
  check('…aucune fiche n’est arbitrée automatiquement',
    (await DeploymentTarget.collection.countDocuments({ lifecycleStatus: 'ACTIVE' })) === 2);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('LE CAS DES DONNÉES RÉELLES — deux ACTIVE sans environnement');
{
  await remettreAZero();
  // L'état exact rencontré : deux fiches ACTIVE, aucune n'ayant d'environnement.
  await poser({ lifecycleStatus: 'ACTIVE' });
  await poser({ lifecycleStatus: 'ACTIVE' });

  const issue = await migrer();
  check('le report en PROD produit un conflit, et le démarrage est refusé',
    issue.ok === false && issue.code === cycle.MIGRATION_ERRORS.ACTIVE_CONFLICT);
  check('…le conflit porte bien sur PROD, le défaut historique',
    issue.details?.conflicts?.[0]?.environment === 'PROD');
  check('…et le report d’environnement, lui, a bien eu lieu',
    (await DeploymentTarget.collection.countDocuments({ environment: 'PROD' })) === 2);
  check('l’index de garantie n’est PAS créé sur un état ambigu',
    !(await DeploymentTarget.collection.indexes())
      .some((i) => i.name === cycle.ACTIVE_INDEX_NAME));
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('UNE ACTIVE PAR ENVIRONNEMENT — démarrage ACCEPTÉ, garantie VÉRIFIÉE');
{
  await remettreAZero();
  await poser({ environment: 'TEST', lifecycleStatus: 'ACTIVE' });
  await poser({ environment: 'PROD', lifecycleStatus: 'ACTIVE' });
  // Une RETIRED ne réserve pas l'environnement : elle ne doit pas gêner.
  await poser({ environment: 'TEST', lifecycleStatus: 'RETIRED' });
  await poser({ environment: 'TEST', lifecycleStatus: 'EMPTY' });

  const issue = await migrer();
  check('une ACTIVE TEST + une ACTIVE PROD : le démarrage passe', issue.ok === true);
  check('…et la garantie est déclarée VÉRIFIÉE', issue.rapport?.activeIndexVerified === true);

  const index = await DeploymentTarget.collection.indexes();
  const garantie = index.find((i) => i.name === cycle.ACTIVE_INDEX_NAME);
  check('l’index existe RÉELLEMENT en base', Boolean(garantie));
  check('…il est unique', garantie?.unique === true);
  check('…et partiel sur les seules ACTIVE',
    JSON.stringify(garantie?.partialFilterExpression) === JSON.stringify({ lifecycleStatus: { $in: ['ACTIVE'] } }));

  // La garantie n'est pas déclarative : elle refuse une écriture directe.
  let refuse = false;
  try {
    await DeploymentTarget.collection.insertOne({
      name: 'x', url: 'https://x.exemple.com', host: 'x.exemple.com', type: 'domain',
      environment: 'TEST', backendPort: 5999, lifecycleStatus: 'ACTIVE',
      createdAt: at, updatedAt: at,
    });
  } catch (e) { refuse = e.code === 11000; }
  check('une seconde ACTIVE TEST écrite DIRECTEMENT en base est refusée', refuse);

  // Ni RETIRED ni EMPTY ne réservent l'environnement.
  await DeploymentTarget.collection.insertOne({
    name: 'y', url: 'https://y.exemple.com', host: 'y.exemple.com', type: 'domain',
    environment: 'TEST', backendPort: 5998, lifecycleStatus: 'RETIRED',
    createdAt: at, updatedAt: at,
  });
  check('…mais une RETIRED de plus est acceptée : elle ne sert pas',
    (await DeploymentTarget.collection.countDocuments({ lifecycleStatus: 'RETIRED' })) === 2);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('INDEX ABSENT APRÈS CONSTRUCTION — démarrage REFUSÉ');
{
  await remettreAZero();
  await poser({ environment: 'TEST', lifecycleStatus: 'ACTIVE' });

  /**
   * On simule le cas exact qui a échoué en silence : la construction rend sans
   * lever, mais l'index n'est pas là. C'est l'hypothèse — « la construction a
   * rendu, donc l'index existe » — qui s'était révélée fausse avec un filtre
   * partiel en `$ne`, et de nouveau avec `autoIndex` désactivé. La relecture en
   * base est la seule preuve.
   */
  const vrai = DeploymentTarget.createIndexes.bind(DeploymentTarget);
  DeploymentTarget.createIndexes = async () => ({});

  const issue = await migrer();
  check('un index annoncé construit mais ABSENT refuse le démarrage',
    issue.ok === false && issue.code === cycle.MIGRATION_ERRORS.ACTIVE_INDEX_MISSING);
  check('…et le dit explicitement', /absent après construction/.test(String(issue.message)));
  check('…en listant les index réellement présents',
    Array.isArray(issue.details?.indexes));

  DeploymentTarget.createIndexes = vrai;
  const apres = await migrer();
  check('l’index rétabli, le démarrage repasse', apres.ok === true);
  check('…et la garantie est de nouveau vérifiée', apres.rapport?.activeIndexVerified === true);
}

/* ══════════════════════════════════════════════════════════════════════════ */
section('AUCUN `.catch()` SILENCIEUX SUR CETTE ÉTAPE');
{
  const fs = await import('node:fs/promises');
  const sansCommentaires = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  const service = sansCommentaires(await fs.readFile(
    new URL('../services/deployment/destinationLifecycle.service.js', import.meta.url), 'utf8',
  ));
  const migration = service.slice(service.indexOf('export async function migrateDeploymentTargets'));

  check('la construction d’index n’est plus avalée',
    !/(init|createIndexes)\(\)\s*\.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)/.test(migration));
  check('…et elle ne dépend pas du réglage global `autoIndex`',
    /createIndexes\(\)/.test(migration) && !/await DeploymentTarget\.init\(\)/.test(migration));
  check('elle lève sur conflit', /throw new MigrationBlockedError/.test(migration));
  check('…et relit les index de Mongo pour vérifier',
    /collection\.indexes\(\)/.test(migration) && /ACTIVE_INDEX_NAME/.test(migration));

  /**
   * ══ LA REPRISE A CHANGÉ DE PHASE — L'INVARIANT, LUI, EST INTACT ═══════════
   *
   * Ces deux constats lisaient `server.js`, où les reprises vivaient. Elles ont
   * rejoint `structuralRecovery.service.js`, appelé par la PHASE DE PRÉPARATION
   * de l'amorçage : elles s'exécutent désormais AVANT tout service de fond, au
   * lieu de s'exécuter après.
   *
   * Ce qu'ils vérifient ne bouge pas d'un pouce : la reprise qui porte une
   * garantie ne doit jamais être absorbée, et celle qui n'en porte aucune doit
   * rester tolérante. Seul le fichier qui héberge cette décision a changé.
   */
  const reprises = sansCommentaires(await fs.readFile(
    new URL('../services/lifecycle/structuralRecovery.service.js', import.meta.url), 'utf8',
  ));
  check('la reprise porteuse de garantie n’est plus absorbée — elle relance',
    /await migrateDeploymentTargets\(\)/.test(reprises)
    && !/migrateDeploymentTargets\(\)\s*\.catch/.test(reprises)
    && /throw err;/.test(reprises));
  check('…tandis que les reprises non porteuses de garantie restent tolérantes',
    /migratePortRegistry\(\)\.catch/.test(reprises)
    && /migrateProjectMedia\(\)\.catch/.test(reprises));

  /**
   * ET LE POINT D'ENTRÉE NE LES EXÉCUTE PLUS LUI-MÊME : c'est ce déplacement
   * qui garantit qu'aucun worker ne tourne pendant qu'elles réparent.
   */
  const amorcage = sansCommentaires(await fs.readFile(
    new URL('../config/bootstrap.js', import.meta.url), 'utf8',
  ));
  const iReprises = amorcage.indexOf('await runStructuralRecovery()');
  const iServices = amorcage.indexOf('await demarrerServices(');
  check('la reprise est appelée par la phase de PRÉPARATION, avant les services',
    iReprises > 0 && iServices > 0 && iReprises < iServices);
}

/* ══════════════════════════════════════════════════════════════════════════ */
console.log(`\n${ok} réussis, ${ko} échoués`);
await mongoose.disconnect();
await serveur.stop();
assert.equal(ko, 0, `${ko} vérification(s) en échec.`);
