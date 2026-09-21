#!/usr/bin/env node
/**
 * INVENTAIRE DES MÉDIAS MÉTIER EXISTANTS — reprise de l'historique.
 *
 * ══ CE QU'IL FAIT ══════════════════════════════════════════════════════════
 *
 * Les fichiers déjà présents sous `/uploads` n'ont pas de descripteur : ils
 * ont été écrits avant que le projet en tienne un. Personne ne peut donc dire
 * à quel projet ils appartiennent, quel est leur contenu réel, ni s'ils sont
 * encore utilisés.
 *
 * Ce script les LIT, calcule leur empreinte, leur type réel et leurs
 * dimensions, cherche qui les référence, et — seulement avec `--apply` —
 * écrit le descripteur correspondant.
 *
 * ══ DRY-RUN PAR DÉFAUT ═════════════════════════════════════════════════════
 *
 * Une reprise qui écrit avant d'avoir été relue est une reprise qu'on n'a pas
 * relue. Sans `--apply`, RIEN n'est modifié : ni fichier, ni document.
 *
 * ══ CE QU'IL NE FAIT JAMAIS ════════════════════════════════════════════════
 *
 *   · supprimer un fichier — un orphelin est SIGNALÉ, pas nettoyé ;
 *   · rapprocher deux médias par leur nom de fichier ;
 *   · copier quoi que ce soit entre deux projets.
 *
 * ══ USAGE ══════════════════════════════════════════════════════════════════
 *
 *   node src/scripts/inventory-project-media.js            → SIMULATION
 *   node src/scripts/inventory-project-media.js --apply    → écriture
 */
import mongoose from 'mongoose';

import { config } from '../config/env.js';

const APPLY = process.argv.includes('--apply');

const titre = (t) => console.log(`\n──── ${t} ────`);

async function main() {
  console.log(APPLY
    ? '\n╔══ MODE : ÉCRITURE ══╗'
    : '\n╔══ MODE : SIMULATION — rien ne sera modifié. Ajoutez --apply pour écrire. ══╗');

  await mongoose.connect(config.mongoUri, { dbName: config.dbName });

  const { inventoryProjectMedia, currentProjectScope } =
    await import('../services/media/projectMedia.service.js');

  titre('1. PORTÉE DU PROJET');
  const scope = await currentProjectScope();
  console.log(`  projectId          : ${scope.projectId ?? '— (non appairé)'}`);
  console.log(`  projectIdentityId  : ${scope.projectIdentityId ?? '— (aucune identité déclarée)'}`);
  console.log(`  dossier des médias : ${config.paths.uploads}`);

  titre('2. INVENTAIRE');
  const rapport = await inventoryProjectMedia({ apply: APPLY });
  console.log(`  fichiers examinés     : ${rapport.scanned}`);
  console.log(`  déjà décrits          : ${rapport.alreadyDescribed}`);
  console.log(`  descripteurs ${APPLY ? 'écrits  ' : 'à écrire'} : ${APPLY ? rapport.described : rapport.scanned - rapport.alreadyDescribed}`);

  titre('3. ORPHELINS — aucun usage connu');
  if (rapport.orphans.length === 0) console.log('  aucun');
  for (const o of rapport.orphans.slice(0, 50)) {
    console.log(`  · ${o.objectKey}  (${(o.size / 1024).toFixed(0)} Ko, sha ${o.sha256.slice(0, 12)})`);
  }
  if (rapport.orphans.length > 50) console.log(`  … et ${rapport.orphans.length - 50} autre(s)`);
  console.log('\n  Ils ne sont PAS supprimés : un fichier qu’on ne comprend pas se garde.');

  titre('4. CONFLITS — même contenu, deux objets');
  if (rapport.conflicts.length === 0) console.log('  aucun');
  for (const c of rapport.conflicts) console.log(`  · ${c.objectKey} ≡ ${c.sameContentAs}`);

  if (rapport.errors.length) {
    titre('5. ILLISIBLES');
    for (const e of rapport.errors) console.log(`  · ${e.objectKey} — ${e.reason}`);
  }

  console.log(APPLY
    ? '\n  Terminé. Les descripteurs ont été écrits ; aucun fichier n’a été touché.'
    : '\n  Simulation terminée. AUCUNE modification. Relancez avec --apply pour écrire.');

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(`\n╔══ ÉCHEC ══╗\n  ${err.message}`);
  console.error(err.stack);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
