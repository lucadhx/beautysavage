/**
 * DIAGNOSTIC DU STOCKAGE DES CONTRATS — à exécuter LÀ où le problème se pose.
 *
 *   npm run contracts:storage:doctor          # lecture seule, ne touche à rien
 *   npm run contracts:storage:repair          # reprend les fichiers retrouvés
 *
 * ── POURQUOI CE SCRIPT ──────────────────────────────────────────────────────
 * « Ça marche en local, pas en production » ne se règle pas en relisant du
 * code : les deux environnements exécutent le même. Ce qui diffère, c'est ce
 * qu'il y a sur le disque. Ce script imprime, côte à côte, ce que la base
 * référence et ce que le disque contient — le chemin cherché, le chemin
 * réellement résolu derrière les liens, et les endroits où le fichier a pu
 * rester lors d'un déploiement.
 *
 * Il ne modifie RIEN sans `--repair`, et même alors il ne fait que copier vers
 * le stockage canonique un fichier déjà présent sur la machine. Il n'invente
 * aucune disponibilité : un document introuvable reste introuvable, et la
 * projection envoyée au Panel le dira.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { Contract } from '../models/Contract.model.js';
import {
  adoptOrphanContractDocuments,
  candidateStorageRoots,
  inspectContractStorage,
  resolveContractDocumentPath,
} from '../services/contractDocument.service.js';
import projectSync from '../services/projectBridge/projectSync.service.js';
import { logger } from '../utils/logger.js';

const REPARER = process.argv.includes('--repair');

const decrire = async (chemin) => {
  try {
    const stat = await fs.lstat(chemin);
    if (stat.isSymbolicLink()) {
      const cible = await fs.readlink(chemin);
      let reel = null;
      try { reel = await fs.realpath(chemin); } catch { /* lien cassé */ }
      return `lien → ${cible}${reel ? ` (réel : ${reel})` : ' (CIBLE INTROUVABLE)'}`;
    }
    if (stat.isDirectory()) return `dossier (mode ${(stat.mode & 0o777).toString(8)})`;
    return `fichier ${stat.size} o`;
  } catch {
    return 'ABSENT';
  }
};

await connectDatabase();

console.log('\n══ ENVIRONNEMENT ═══════════════════════════════════════════════');
console.log(`ENV                     : ${config.env}`);
console.log(`CONTRACT_STORAGE_DIR    : ${process.env.CONTRACT_STORAGE_DIR || '(non défini)'}`);
console.log(`paths.contractStorage   : ${config.paths.contractStorage}`);
console.log(`  état                  : ${await decrire(config.paths.contractStorage)}`);
const backendStorage = path.resolve(config.paths.root, 'storage');
console.log(`backend/storage         : ${backendStorage}`);
console.log(`  état                  : ${await decrire(backendStorage)}`);
console.log(`utilisateur du processus: uid ${process.getuid?.() ?? 'n/a'} / gid ${process.getgid?.() ?? 'n/a'}`);

console.log('\n══ RACINES CANDIDATES (où un fichier a pu rester) ══════════════');
for (const racine of candidateStorageRoots()) {
  console.log(`  ${racine} — ${await decrire(racine)}`);
}

const contracts = await Contract.find({
  $or: [
    { 'document.originalFilename': { $ne: null } },
    { 'document.signedFilename': { $ne: null } },
  ],
}).sort({ updatedAt: -1 });

console.log(`\n══ CONTRATS PORTANT UN DOCUMENT (${contracts.length}) ═══════════════════`);
let orphelins = 0;

for (const contract of contracts) {
  const stockage = await inspectContractStorage(contract);
  console.log(`\n— ${contract.reference || contract._id} (${contract._id})`);
  console.log(`  statut contrat        : ${contract.status}`);
  console.log(`  signature             : ${contract.yousign?.status || 'NONE'}`);

  for (const [kind, champ, checksum] of [
    ['ORIGINAL', 'originalFilename', 'originalChecksum'],
    ['SIGNED', 'signedFilename', 'signedChecksum'],
  ]) {
    const nom = contract.document?.[champ];
    if (!nom) {
      console.log(`  ${kind.padEnd(8)}            : (non référencé en base)`);
      continue;
    }
    let attendu = '(non résolu)';
    try { attendu = resolveContractDocumentPath(contract, kind); } catch { /* absent */ }
    const etat = kind === 'SIGNED' ? stockage.signed : stockage.original;
    console.log(`  ${kind.padEnd(8)} base       : ${nom}`);
    console.log(`  ${' '.repeat(8)} sha256     : ${contract.document?.[checksum] || '(aucun)'}`);
    console.log(`  ${' '.repeat(8)} chemin     : ${attendu}`);
    console.log(`  ${' '.repeat(8)} réel       : ${await decrire(attendu)}`);
    console.log(`  ${' '.repeat(8)} verdict    : ${etat.exists ? 'PRÉSENT' : 'INTROUVABLE'}`);

    if (!etat.exists) {
      orphelins += 1;
      // Où est-il, alors ? On regarde les racines candidates.
      for (const racine of candidateStorageRoots()) {
        const candidat = path.join(racine, String(contract._id), nom);
        const trouve = await decrire(candidat);
        if (trouve !== 'ABSENT') console.log(`  ${' '.repeat(8)} RETROUVÉ   : ${candidat} (${trouve})`);
      }
    }
  }

  // Ce que le Panel recevrait MAINTENANT, sans rien changer.
  const projection = await projectSync.buildContractProjection().catch(() => null);
  if (projection?.payload?.document && String(projection.entityId) === String(contract._id)) {
    const d = projection.payload.document;
    console.log(`  projection Panel      : status=${d.status} available=${d.available} `
      + `downloadAvailable=${d.downloadAvailable} modifiedAt=${projection.modifiedAt}`);
  }
}

console.log(`\n══ SYNTHÈSE ════════════════════════════════════════════════════`);
console.log(`documents référencés introuvables : ${orphelins}`);

if (REPARER && orphelins > 0) {
  console.log('\n══ REPRISE ═════════════════════════════════════════════════════');
  const rapport = await adoptOrphanContractDocuments(contracts);
  console.log(`examinés ${rapport.examined} · repris ${rapport.repaired} · toujours absents ${rapport.missing}`);
  for (const d of rapport.details) {
    console.log(`  ${d.contractId} ${d.kind} : ${d.repaired ? `repris depuis ${d.from}` : 'introuvable'}`);
  }
  if (rapport.repaired > 0) {
    // La projection repart d'elle-même : `contractModifiedAt` tient compte de
    // la date des fichiers, donc l'écriture est bien plus récente que celle
    // que le Panel connaît, et elle passe.
    const res = await projectSync.projectNow('CONTRACT');
    logger.success(`Projection CONTRACT remise en file : ${JSON.stringify(res)}`);
  }
} else if (orphelins > 0) {
  console.log('Relancez avec --repair pour reprendre les fichiers retrouvés ailleurs sur la machine.');
}

await disconnectDatabase();
process.exit(0);
