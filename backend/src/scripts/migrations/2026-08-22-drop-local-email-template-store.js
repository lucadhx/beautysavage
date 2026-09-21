#!/usr/bin/env node
// MIGRATION UNIQUE — la base LOCALE de modèles d'e-mail quitte ce projet (L12.1).
//
// ══ CE QU'ELLE RETIRE ═══════════════════════════════════════════════════════
//
//   emailtemplates          la copie locale : sujet, HTML, interrupteur, version
//   emailtemplateversions   son historique d'édition
//
// ══ POURQUOI CE CONTENU NE SE MIGRE PAS VERS LE PANEL ═══════════════════════
//
// La question s'est posée, et elle méritait de se poser : un déménagement vaut
// toujours mieux qu'une perte. L'audit y a répondu en regardant les données.
//
// Les quatorze documents locaux étaient TOUS en version 1, tous d'origine
// `BOOTSTRAP`, et l'historique ne contenait pas une seule entrée `EDIT`.
// Autrement dit : PERSONNE n'a jamais édité un modèle depuis le Manager. Ce que
// contenait cette base n'était pas du contenu rédigé — c'étaient les défauts
// d'un registre de code, figés au premier démarrage.
//
// Sept d'entre eux avaient pourtant DIVERGÉ du contenu réellement expédié : les
// deux registres, celui du projet et celui du Panel, avaient dérivé l'un de
// l'autre. Pousser ces sept-là vers le Panel n'aurait donc pas « sauvé » du
// contenu : cela aurait ÉCRASÉ le contenu autoritatif — celui qui part
// aujourd'hui — par une version plus ancienne du même défaut.
//
// Le déménagement aurait été une régression. Il n'a pas lieu.
//
// ══ QUAND LA JOUER — ET SURTOUT, QUAND PAS ══════════════════════════════════
//
// APRÈS le déploiement du lot, jamais avant. Tant qu'une instance exécute le
// code précédent, elle lit ces collections : les retirer sous ses pieds
// casserait ses envois. Migration puis nettoyage, dans cet ordre.
//
// La garde ci-dessous refuse de tourner si le nouveau runtime n'est pas en
// place — la présence des modules supprimés est la preuve la plus directe qu'on
// est encore sur l'ancien code.
//
// ══ CE QU'ELLE NE TOUCHE PAS ════════════════════════════════════════════════
//
//   emaildeliveries         le SUIVI des envois — il appartient au projet,
//                           ce sont ses messages vers ses destinataires ;
//   emaildeliveryevents     idem ;
//   emailtemplatecontracts  le cache de VOCABULAIRE, écrit par le nouveau code.
//
// Usage :
//   node src/scripts/migrations/2026-08-22-drop-local-email-template-store.js
//   node src/scripts/migrations/2026-08-22-drop-local-email-template-store.js --dry-run

import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import mongoose from 'mongoose';

import { config } from '../../config/env.js';
import { connectDatabase, disconnectDatabase } from '../../config/db.js';
import { logger } from '../../utils/logger.js';

const DRY_RUN = process.argv.includes('--dry-run');
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Les modules dont la disparition atteste que le nouveau runtime est en place. */
const MODULES_SUPPRIMES = [
  'models/EmailTemplate.model.js',
  'services/email/emailTemplate.service.js',
  'services/email/emailTemplateRenderer.js',
  'utils/emailTemplateRegistry.js',
];

const COLLECTIONS = ['emailtemplates', 'emailtemplateversions'];

async function main() {
  const survivants = MODULES_SUPPRIMES.filter((m) => fs.existsSync(path.join(SRC, m)));
  if (survivants.length) {
    logger.error(
      'REFUS : ce code exécute encore l’ancienne autorité locale de modèles '
      + `(${survivants.join(', ')} présent(s)). Déployez le lot avant de nettoyer — `
      + 'retirer ces collections sous les pieds du code qui les lit casserait ses envois.',
    );
    process.exitCode = 1;
    return;
  }

  await connectDatabase();
  const db = mongoose.connection.db;
  logger.info(`[migration] base « ${config.dbName} » (ENV=${config.env})${DRY_RUN ? ' — SIMULATION' : ''}`);

  const noms = (await db.listCollections().toArray()).map((c) => c.name);
  const rapport = [];

  for (const nom of COLLECTIONS) {
    if (!noms.includes(nom)) {
      rapport.push({ collection: nom, etat: 'ABSENTE', documents: 0 });
      continue;
    }
    const documents = await db.collection(nom).countDocuments();

    /**
     * ON REGARDE AVANT DE SUPPRIMER.
     *
     * Une entrée `EDIT` signifierait qu'un humain a réellement écrit ici, et
     * que le raisonnement de l'en-tête ne tient pas pour CETTE base. On
     * s'arrête alors : perdre du contenu rédigé pour tenir un calendrier de
     * nettoyage serait le pire échange possible.
     */
    if (nom === 'emailtemplateversions') {
      const edits = await db.collection(nom).countDocuments({ origin: { $in: ['EDIT', 'RESTORE'] } });
      if (edits > 0) {
        logger.error(
          `REFUS : ${edits} version(s) d’origine EDIT/RESTORE dans « ${nom} ». `
          + 'Du contenu a été écrit à la main sur cette base : il doit être relu et reporté '
          + 'dans le Panel avant tout retrait. Aucune suppression n’est faite.',
        );
        process.exitCode = 1;
        await disconnectDatabase();
        return;
      }
    }

    if (DRY_RUN) {
      rapport.push({ collection: nom, etat: 'À RETIRER', documents });
      continue;
    }
    await db.collection(nom).drop();
    rapport.push({ collection: nom, etat: 'RETIRÉE', documents });
  }

  for (const ligne of rapport) {
    logger.info(`[migration] ${ligne.collection} — ${ligne.etat} (${ligne.documents} document(s))`);
  }
  logger.info(
    DRY_RUN
      ? '[migration] simulation terminée — rien n’a été modifié.'
      : '[migration] terminée : ce projet ne détient plus aucune copie de modèle d’e-mail.',
  );

  await disconnectDatabase();
}

main().catch(async (err) => {
  logger.error(`[migration] échec : ${err?.message ?? err}`);
  await disconnectDatabase().catch(() => null);
  process.exitCode = 1;
});
