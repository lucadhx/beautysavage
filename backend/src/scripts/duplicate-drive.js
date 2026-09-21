#!/usr/bin/env node
// PILOTE LE MOTEUR OFFICIEL DE DUPLICATION, depuis une console.
//
// ── CE QU'IL FAIT, ET CE QU'IL NE FAIT PAS ──────────────────────────────────
//
// L'assistant « Dupliquer » du Manager fait trois gestes : il valide la saisie,
// appelle `engine.duplicate()`, et affiche les phases au fil de l'eau. Ce
// script fait les mêmes trois gestes, avec les mêmes fonctions.
//
// Il ne réimplémente AUCUNE étape : ni la création des bases, ni la copie, ni la
// réécriture d'identité, ni le contrôle de propreté, ni l'installation des
// dépendances. Un script qui « dupliquerait presque comme le moteur » finirait
// par en diverger, et le premier écart se découvrirait sur un projet client.
//
// ── POURQUOI IL EXISTE ──────────────────────────────────────────────────────
//
// Parce que la duplication n'avait PAS d'entrée en console, là où le
// déploiement en a une (`deploy-drive.js`). Le premier projet client réel a donc
// été fabriqué par un script d'exploitation écrit pour l'occasion, hors dépôt et
// hors garde : exactement ce que `deploy-drive.js` existe pour éviter côté
// déploiement. Le geste le plus structurant de la fabrique était le seul à ne
// pas avoir de porte officielle.
//
// ── LE MOT DE PASSE DU PREMIER ADMINISTRATEUR ───────────────────────────────
//
// Il est LU DANS L'ENVIRONNEMENT (`FIRST_ADMIN_PASSWORD`), jamais passé en
// argument : une ligne de commande finit dans l'historique du shell, dans les
// journaux du terminal, et dans la sortie de `ps` de tout utilisateur de la
// machine. Il n'est ni affiché, ni journalisé, ni écrit dans le rapport.
//
// Usage :
//   FIRST_ADMIN_PASSWORD='…' node src/scripts/duplicate-drive.js \
//     --name "Garage Dupont" \
//     --db-test garage_dupont_test --db-prod garage_dupont_prod \
//     --repo https://github.com/compte/garage-dupont.git \
//     --dev-email dev@agence.fr --dev-name "Camille Dupont" \
//     --admin-email contact@garage-dupont.fr \
//     [--folder garage-dupont] [--dest-parent ../]
import process from 'node:process';

import { config } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { DeploymentEngine } from '../deployment-engine/DeploymentEngine.js';
import { describeDuplicationPhases } from '../duplication-engine/config/duplication.phases.js';
import { describeTreePolicy } from '../duplication-engine/config/duplication.tree.js';

const arg = (nom) => {
  const i = process.argv.indexOf(`--${nom}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const has = (nom) => process.argv.includes(`--${nom}`);

async function main() {
  /**
   * `--phases` et `--policy` : deux introspections, aucune écriture.
   *
   * Elles répondent aux deux questions que pose un opérateur avant de lancer
   * quoi que ce soit — « que va-t-il se passer ? » et « qu'est-ce qui sera
   * copié ? » — et elles les lisent dans le REGISTRE, pas dans une
   * documentation qui pourrait avoir vieilli.
   */
  if (has('phases')) {
    for (const p of describeDuplicationPhases()) {
      console.log(`${String(p.order).padStart(3)}  ${p.id.padEnd(14)} ${p.required ? 'requise' : 'facultative'}  ${p.label}`);
    }
    return;
  }
  if (has('policy')) {
    for (const e of describeTreePolicy()) {
      console.log(`${e.policy.padEnd(11)} ${e.match === 'path' ? 'chemin' : 'nom   '} ${e.target.padEnd(24)} ${e.why}`);
    }
    return;
  }

  const entree = {
    projectName: arg('name'),
    folderName: arg('folder') || undefined,
    dbTest: arg('db-test'),
    dbProd: arg('db-prod'),
    githubRepositoryUrl: arg('repo'),
    devEmail: arg('dev-email'),
    devName: arg('dev-name') || '',
    adminEmail: arg('admin-email'),
    adminPassword: process.env.FIRST_ADMIN_PASSWORD,
    adminPasswordConfirmation: process.env.FIRST_ADMIN_PASSWORD,
  };

  /**
   * LES ABSENCES SONT NOMMÉES TOUTES ENSEMBLE, ET AVANT TOUTE ÉCRITURE.
   *
   * Le moteur valide déjà, et mieux — il connaît les règles. Mais il s'arrête à
   * la PREMIÈRE faute : un opérateur qui a oublié trois arguments les découvre
   * alors en trois exécutions. Ici, on les lui rend d'un coup.
   */
  const manquants = [
    ['--name', entree.projectName], ['--db-test', entree.dbTest], ['--db-prod', entree.dbProd],
    ['--repo', entree.githubRepositoryUrl], ['--dev-email', entree.devEmail],
    ['--admin-email', entree.adminEmail], ['FIRST_ADMIN_PASSWORD', entree.adminPassword],
  ].filter(([, v]) => !v).map(([k]) => k);
  if (manquants.length) {
    console.error(`✗ Duplication refusée — information(s) manquante(s) : ${manquants.join(', ')}.`);
    console.error('  Voir docs/factory/PROJECT_DUPLICATION_GUIDE.md §1.');
    process.exitCode = 2;
    return;
  }

  await connectDatabase();
  const engine = new DeploymentEngine({ mongoUri: config.mongoUri });

  console.log(`\n▸ DUPLICATION — « ${entree.projectName} »`);
  console.log(`  bases   : ${entree.dbTest} (TEST) · ${entree.dbProd} (PROD)`);
  console.log(`  dépôt   : ${entree.githubRepositoryUrl}`);
  console.log(`  premier développeur : ${entree.devEmail}\n`);

  let resultat = null;
  try {
    resultat = await engine.duplicate(entree, {
      stamp: 'duplicate-drive',
      destParent: arg('dest-parent') || undefined,
      onLog: (m) => console.log(`   ${m}`),
      onPhase: (p) => {
        const nom = p.phase + (p.target ? `:${p.target}` : '');
        const glyphe = { running: '·', ok: '✓', error: '✗', skipped: '–' }[p.status] ?? ' ';
        if (p.status !== 'running') console.log(`  ${glyphe} ${nom}`);
      },
    });
  } catch (err) {
    console.error(`\n✗ DUPLICATION interrompue : ${err?.details?.blocker ?? err?.code ?? ''} ${err?.message ?? err}`);
    await disconnectDatabase().catch(() => {});
    process.exitCode = 1;
    return;
  }

  console.log('\n✓ DUPLICATION — projet créé');
  console.log(`  dossier : ${resultat.path}`);
  console.log(`  identité technique : ${resultat.identity?.slug ?? '?'} / ${resultat.identity?.projectId ?? '?'}`);
  console.log(`  bases   : ${resultat.dbTest?.name} (${resultat.dbTest?.created ? 'créée' : 'déjà là'}) · `
    + `${resultat.dbProd?.name} (${resultat.dbProd?.created ? 'créée' : 'déjà là'})`);
  console.log(`  copie   : ${resultat.copy?.files} fichier(s), ${resultat.copy?.dirs} dossier(s)`);
  if (resultat.cleanliness) {
    console.log(`  propreté : ${resultat.cleanliness.emptyDirectories?.length ?? 0} dossier(s) vierge(s) vérifié(s), `
      + `${resultat.cleanliness.residualIdentity?.inCode ?? 0} occurrence(s) de l’identité source hors commentaires`);
  }
  if (resultat.identityRewrite?.toReview?.length) {
    console.log('\n  À PERSONNALISER (le moteur ne l’invente pas) :');
    for (const t of resultat.identityRewrite.toReview) console.log(`   · ${t}`);
  }
  console.log('\n  Suite : docs/factory/PROJECT_DUPLICATION_GUIDE.md §4.\n');

  await disconnectDatabase().catch(() => {});
}

main().catch(async (err) => {
  console.error(`✗ ${err?.message ?? err}`);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});
