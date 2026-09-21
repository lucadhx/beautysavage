#!/usr/bin/env node
/**
 * REPRISE DES MÉDIAS MÉTIER ANTÉRIEURS — exécuté LÀ OÙ SONT LES FICHIERS.
 *
 * ══ POURQUOI CE SCRIPT EXISTE ══════════════════════════════════════════════
 *
 * Le relevé réel du 07/08 est sans ambiguïté :
 *
 *     poste local        backend/uploads/        → .gitkeep, et rien d'autre
 *     destination        shared/uploads/         → les 14 fichiers du parc
 *
 * Une reprise conduite depuis le poste de déploiement inventorierait donc du
 * vide et conclurait qu'il n'y a rien à reprendre. Ce script tourne sur la
 * DESTINATION, contre son `.env`, sa base et son dossier de médias. Il ne
 * rapatrie aucun fichier et ne dépend d'aucun disque local.
 *
 * ══ APPELÉ PAR LE DÉPLOIEMENT, ET APPELABLE À LA MAIN ══════════════════════
 *
 *   node src/scripts/adopt-project-media.js            → SIMULATION
 *   node src/scripts/adopt-project-media.js --apply    → écriture
 *   node src/scripts/adopt-project-media.js --json     → rapport machine
 *
 * ══ CODES DE SORTIE ════════════════════════════════════════════════════════
 *
 *   0  rien à faire, ou reprise effectuée
 *   2  CONFLIT — une fiche porte déjà un autre descripteur. Aucune écriture
 *      n'a eu lieu, et le déploiement doit s'arrêter : arbitrer à la place de
 *      l'opérateur remplacerait une donnée qu'on n'a pas écrite.
 *   1  échec technique
 */
import mongoose from 'mongoose';

import { config } from '../config/env.js';

const APPLY = process.argv.includes('--apply');
const JSON_MODE = process.argv.includes('--json');

/**
 * LES MARQUEURS VIENNENT DU SERVICE, pas d'une copie locale.
 *
 * L'émetteur et le lecteur du rapport doivent lire la même constante : deux
 * chaînes recopiées finissent toujours par diverger, et le jour où elles
 * divergent l'étape devient muette — exactement ce qu'on refuse.
 */
const { RAPPORT_DEBUT: DEBUT, RAPPORT_FIN: FIN } =
  await import('../services/media/projectMediaAdoption.service.js');

const titre = (t) => { if (!JSON_MODE) console.log(`\n──── ${t} ────`); };
const dire = (t) => { if (!JSON_MODE) console.log(t); };

async function main() {
  dire(APPLY
    ? '\n╔══ MODE : ÉCRITURE ══╗'
    : '\n╔══ MODE : SIMULATION — rien ne sera modifié. Ajoutez --apply pour écrire. ══╗');

  await mongoose.connect(config.mongoUri, { dbName: config.dbName });

  const { adoptLegacyProjectMedia } = await import('../services/media/projectMediaAdoption.service.js');
  const rapport = await adoptLegacyProjectMedia({ apply: APPLY });

  titre('1. OÙ CETTE INSTANCE REGARDE');
  dire(`  environnement      : ${rapport.environment}`);
  dire(`  dossier des médias : ${rapport.uploadsDir}`);
  dire(`  fichiers présents  : ${rapport.remoteFiles.length}`);
  dire(`  projectId          : ${rapport.projectId ?? '— (non appairé)'}`);

  titre('2. RÉFÉRENCES HISTORIQUES DANS LES FICHES');
  dire(`  références trouvées   : ${rapport.legacyRefs.length}`);
  dire(`  déjà décrites/attachées : ${rapport.already.length}`);
  dire(`  descripteurs ${APPLY ? 'créés   ' : 'à créer '}  : ${APPLY ? rapport.created : rapport.toCreate.length}`);
  dire(`  fiches ${APPLY ? 'raccrochées' : 'à raccrocher'} : ${APPLY ? rapport.attached : rapport.toAttach.length}`);

  titre('3. CE QUI RESTE OUVERT');
  dire(`  fichiers manquants : ${rapport.missing.length}`);
  for (const m of rapport.missing.slice(0, 20)) dire(`    · ${m.collection}.${m.field} → ${m.objectKey}`);
  dire(`  doublons de contenu : ${rapport.duplicates.length}`);
  for (const d of rapport.duplicates.slice(0, 20)) dire(`    · ${d.objectKey} ≡ ${d.sameContentAs}`);
  dire(`  conflits            : ${rapport.conflicts.length}`);
  for (const c of rapport.conflicts.slice(0, 20)) {
    dire(`    · ${c.collection}.${c.field} cite ${c.objectKey} mais porte ${c.attachedObjectKey}`);
  }
  if (rapport.errors.length) {
    dire(`  erreurs             : ${rapport.errors.length}`);
    for (const e of rapport.errors.slice(0, 20)) dire(`    · ${e.objectKey ?? e.collection} — ${e.reason}`);
  }

  if (JSON_MODE) console.log(`${DEBUT}${JSON.stringify(rapport)}${FIN}`);

  dire(APPLY
    ? '\n  Terminé. Aucun fichier n’a été déplacé, renommé ni supprimé.'
    : '\n  Simulation terminée. AUCUNE modification.');

  await mongoose.disconnect();
  // Un conflit n'est pas une panne : c'est une décision qui n'appartient pas à
  // ce script. On sort avec un code distinct pour que l'appelant l'arrête net.
  process.exitCode = rapport.conflicts.length ? 2 : 0;
}

main().catch(async (err) => {
  if (JSON_MODE) console.log(`${DEBUT}${JSON.stringify({ failed: true, message: err.message })}${FIN}`);
  console.error(`\n╔══ ÉCHEC ══╗\n  ${err.message}`);
  console.error(err.stack);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
