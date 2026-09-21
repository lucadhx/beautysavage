/**
 * Promotion des données TEST -> PROD.
 *
 *   node src/scripts/promote-test-to-prod.js --audit      (lecture seule)
 *   node src/scripts/promote-test-to-prod.js --dry-run    (simulation, 0 écriture)
 *   node src/scripts/promote-test-to-prod.js --apply      (migration réelle)
 *
 * Options :
 *   --allow-non-empty-prod   autorise l'écriture dans une PROD non vide (futur)
 *
 * Sécurité (mode --apply) :
 *   - refus si DB_TEST === DB_PROD
 *   - refus si PROD non vide (sauf --allow-non-empty-prod)
 *   - confirmation interactive "PROMOTE TEST TO PROD"
 *     ou variable CONFIRM_PROD_PROMOTION=PROMOTE_TEST_TO_PROD (CI)
 *   - la base TEST n'est jamais écrite (client source en lecture seule)
 *   - vérification automatique après migration (parité + TEST inchangée)
 */
import readline from 'node:readline';
import {
  loadDualEnv,
  assertSafety,
  connectClients,
  closeClients,
  listUserCollections,
  countByCollection,
  fingerprintDatabase,
  globalFingerprint,
  scanSource,
  auditUploads,
  checkIntegrity,
  copyCollection,
  dropProdCollections,
  backupProd,
  nowStamp,
  SINGLETON_COLLECTIONS,
  REPORTS_DIR,
  BACKEND_ROOT,
} from './lib/promotion-core.js';
import { writeReports } from './lib/promotion-report.js';
import fsp from 'node:fs/promises';
import path from 'node:path';

const CONFIRM_PHRASE = 'PROMOTE TEST TO PROD';
const CONFIRM_ENV = 'PROMOTE_TEST_TO_PROD';

function parseArgs(argv) {
  const flags = new Set(argv);
  let mode = null;
  if (flags.has('--audit')) mode = 'audit';
  else if (flags.has('--dry-run')) mode = 'dry-run';
  else if (flags.has('--apply')) mode = 'apply';
  return {
    mode,
    allowNonEmptyProd: flags.has('--allow-non-empty-prod'),
    resetProd: flags.has('--reset-prod'),
  };
}

function printBanner({ source, destination, mode }) {
  const line = '─'.repeat(52);
  console.log(line);
  console.log(`SOURCE      : ${source}`);
  console.log(`DESTINATION : ${destination}`);
  console.log(`MODE        : ${mode === 'apply' ? 'APPLY' : mode === 'dry-run' ? 'DRY-RUN' : 'AUDIT'}`);
  console.log(line);
}

async function askConfirmation() {
  if (process.env.CONFIRM_PROD_PROMOTION === CONFIRM_ENV) {
    console.log('Confirmation non interactive via CONFIRM_PROD_PROMOTION. OK.');
    return true;
  }
  if (!process.stdin.isTTY) {
    console.error(
      'Entrée non interactive : pour exécuter sans TTY, définir ' +
        `CONFIRM_PROD_PROMOTION=${CONFIRM_ENV}. Abandon.`
    );
    return false;
  }
  console.log('');
  console.log('Vous allez copier DB_TEST vers DB_PROD.');
  console.log('TEST ne sera pas modifiée.');
  console.log('PROD doit être vide.');
  console.log('');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) =>
    rl.question(`Tapez exactement :  ${CONFIRM_PHRASE}\n> `, (a) => {
      rl.close();
      resolve(a);
    })
  );
  if (answer !== CONFIRM_PHRASE) {
    console.error(`Réponse incorrecte ("${answer}"). Abandon — aucune écriture effectuée.`);
    return false;
  }
  return true;
}

/** Récupère la config réseau du singleton SystemConfiguration source. */
async function readNetwork(srcDb) {
  try {
    const cfg = await srcDb.collection('systemconfigurations').findOne({});
    return cfg?.network || null;
  } catch {
    return null;
  }
}

/** Points à configurer avant déploiement VPS, dérivés de l'état constaté. */
function buildBeforeVps({ riskyUrls, network, uploads }) {
  const items = [];
  items.push('Basculer le backend en `ENV=PROD` (utilise DB_PROD).');
  if (network) {
    const risky = Object.entries(network).filter(([, v]) => /(localhost|127\.0\.0\.1|ngrok)/i.test(String(v)));
    if (risky.length) {
      items.push(
        `Mettre à jour SystemConfiguration.network dans PROD (${risky
          .map(([k]) => k)
          .join(', ')}) — contient localhost/ngrok.`
      );
    }
  }
  if (riskyUrls?.length) {
    items.push(`Corriger ${riskyUrls.length} URL localhost/ngrok stockées dans les documents (voir rapport).`);
  }
  if (uploads?.manifest?.length) {
    items.push(`Déployer ${uploads.manifest.length} fichier(s) upload sur le VPS via le manifest.`);
  }
  if (uploads?.missing?.length) {
    items.push(`Résoudre ${uploads.missing.length} référence(s) d'upload cassée(s) avant déploiement.`);
  }
  items.push('Régénérer `.env` PROD (JWT_SECRET fort, PUBLIC_URL/CORS_ORIGINS définitifs).');
  return items;
}

async function main() {
  const { mode, allowNonEmptyProd, resetProd } = parseArgs(process.argv.slice(2));
  if (!mode) {
    console.error('Usage: promote-test-to-prod.js --audit | --dry-run | --apply [--reset-prod] [--allow-non-empty-prod]');
    process.exit(2);
  }

  const env = loadDualEnv();
  try {
    assertSafety(env); // refuse si DB_TEST === DB_PROD ou variables manquantes
  } catch (err) {
    console.error(`\n❌ ${err.message}\n`);
    process.exit(1);
  }

  printBanner({ source: env.dbTest, destination: env.dbProd, mode });

  const clients = await connectClients(env);
  const { srcDb, dstDb } = clients;
  const stamp = nowStamp();
  const date = new Date().toISOString();

  const report = {
    date,
    mode,
    source: env.dbTest,
    destination: env.dbProd,
    success: false,
    warnings: [],
    collections: [],
  };

  try {
    const sourceCollections = await listUserCollections(srcDb);
    console.log(`\nCollections détectées dans TEST (${sourceCollections.length}) : ${sourceCollections.join(', ')}`);

    const [srcCounts, dstCountsBefore] = await Promise.all([
      countByCollection(srcDb, sourceCollections),
      listUserCollections(dstDb).then((n) => countByCollection(dstDb, n)),
    ]);
    const prodTotalBefore = Object.values(dstCountsBefore).reduce((a, b) => a + b, 0);
    console.log(`PROD avant migration : ${prodTotalBefore} document(s) au total.`);

    // Scans transverses (URLs, secrets, uploads) sur la source.
    const scan = await scanSource(srcDb, sourceCollections);
    const uploads = await auditUploads(scan.uploadRefs);
    // Écrit toujours le manifest d'uploads (pour le futur déploiement).
    await fsp.mkdir(REPORTS_DIR, { recursive: true });
    const manifestFile = path.join(REPORTS_DIR, 'uploads-manifest.json');
    await fsp.writeFile(
      manifestFile,
      JSON.stringify({ generatedAt: date, ...uploads }, null, 2),
      'utf8'
    );
    uploads.manifestFile = path.relative(BACKEND_ROOT, manifestFile).replace(/\\/g, '/');

    const network = await readNetwork(srcDb);
    report.network = network;
    report.riskyUrls = scan.riskyUrls;
    report.secretFields = scan.secretFields;
    report.uploads = uploads;
    report.beforeVps = buildBeforeVps({ riskyUrls: scan.riskyUrls, network, uploads });

    // -------------------- AUDIT --------------------
    if (mode === 'audit') {
      report.collections = sourceCollections.map((name) => ({
        name,
        sourceCount: srcCounts[name],
        destBefore: dstCountsBefore[name] || 0,
        destAfter: dstCountsBefore[name] || 0,
      }));
      report.integrity = await checkIntegrity(srcDb, sourceCollections);
      report.integrity.warnings.push('Audit : contrôle d\'intégrité effectué sur la base SOURCE (TEST).');
      if (prodTotalBefore > 0) {
        report.warnings.push(`PROD n'est pas vide (${prodTotalBefore} documents) — une migration réelle serait refusée sans --allow-non-empty-prod.`);
      }
      report.success = true;
      console.log('\nAudit terminé (aucune écriture).');
    }

    // -------------------- DRY-RUN --------------------
    if (mode === 'dry-run') {
      for (const name of sourceCollections) {
        const plan = await copyCollection({ srcDb, dstDb, name, dryRun: true });
        report.collections.push(plan);
        console.log(`  ~ ${name} : copierait ${plan.wouldCopy} doc(s), ${plan.wouldCreateIndexes} index`);
      }
      report.integrity = await checkIntegrity(srcDb, sourceCollections);
      report.resetProd = resetProd;
      if (prodTotalBefore > 0) {
        if (resetProd) {
          report.warnings.push(`PROD contient ${prodTotalBefore} documents — ils seraient SUPPRIMÉS par --reset-prod (après sauvegarde) avant la copie.`);
        } else if (!allowNonEmptyProd) {
          report.warnings.push(`PROD n'est pas vide (${prodTotalBefore} documents) — la migration réelle serait REFUSÉE sans --reset-prod ni --allow-non-empty-prod.`);
        }
      }
      report.success = true;
      console.log('\nDry-run terminé (aucune écriture dans TEST ni PROD).');
    }

    // -------------------- APPLY --------------------
    if (mode === 'apply') {
      report.resetProd = resetProd;
      // 1. Protection PROD non vide. Trois cas :
      //    - PROD vide -> OK
      //    - --reset-prod -> on videra PROD (après sauvegarde + confirmation)
      //    - --allow-non-empty-prod -> insertion par-dessus (usage avancé)
      //    - sinon -> refus.
      if (prodTotalBefore > 0 && !resetProd && !allowNonEmptyProd) {
        console.error(
          `\n❌ PROD n'est pas vide (${prodTotalBefore} documents). ` +
            'Refus d\'écrasement.\n' +
            '   Utilisez --reset-prod pour réinitialiser PROD (sauvegarde + confirmation),\n' +
            '   ou --allow-non-empty-prod pour insérer par-dessus (risque de conflits).\n'
        );
        report.warnings.push('Migration refusée : PROD non vide.');
        await writeAndClose(report, stamp, clients);
        process.exit(1);
      }

      // 2. Confirmation explicite.
      if (resetProd) {
        console.log(`\n⚠️  --reset-prod : les ${prodTotalBefore} document(s) de PROD seront SUPPRIMÉS (après sauvegarde).`);
      }
      const confirmed = await askConfirmation();
      if (!confirmed) {
        await writeAndClose(report, stamp, clients);
        process.exit(1);
      }

      // 3. Empreinte TEST AVANT + sauvegarde PROD.
      console.log('\nCalcul de l\'empreinte TEST (avant)…');
      const testFpBefore = await fingerprintDatabase(srcDb, sourceCollections);
      const testGlobalBefore = globalFingerprint(testFpBefore);

      console.log('Sauvegarde logique de PROD…');
      report.backup = await backupProd(dstDb, stamp);
      console.log(`  Sauvegarde : ${report.backup.file}`);

      // 3b. Réinitialisation contrôlée de PROD (jamais TEST).
      if (resetProd && prodTotalBefore > 0) {
        console.log('Réinitialisation de PROD (suppression des collections)…');
        const dropped = await dropProdCollections({ dstDb, dbTest: env.dbTest, dbProd: env.dbProd });
        report.resetDropped = dropped;
        console.log(`  Collections supprimées : ${dropped.join(', ')}`);
      }

      // 4. Copie.
      console.log('\nCopie des collections…');
      for (const name of sourceCollections) {
        const res = await copyCollection({ srcDb, dstDb, name, dryRun: false });
        report.collections.push(res);
        const okc = res.destAfter === res.sourceCount;
        console.log(`  ${okc ? '✓' : '✗'} ${name} : ${res.copied}/${res.sourceCount} copiés, ${res.indexesCreated} index`);
        if (res.indexErrors?.length) report.warnings.push(`Index en erreur sur ${name}: ${res.indexErrors.map((e) => e.error).join('; ')}`);
      }

      // 5. Empreinte TEST APRÈS -> TEST inchangée ?
      console.log('\nVérification que TEST est inchangée…');
      const testFpAfter = await fingerprintDatabase(srcDb, sourceCollections);
      const testGlobalAfter = globalFingerprint(testFpAfter);
      const testUnchanged = testGlobalBefore === testGlobalAfter;
      report.testUntouched = { unchanged: testUnchanged, before: testGlobalBefore, after: testGlobalAfter };
      console.log(`  Base TEST inchangée : ${testUnchanged ? 'OUI' : 'NON'}`);
      if (!testUnchanged) report.warnings.push('INCIDENT CRITIQUE : empreinte TEST modifiée après migration.');

      // 6. Parité PROD vs TEST.
      console.log('Contrôle de parité PROD vs TEST…');
      const prodFp = await fingerprintDatabase(dstDb, sourceCollections);
      const perCollection = {};
      let allMatch = true;
      for (const name of sourceCollections) {
        const match = testFpAfter[name]?.hash === prodFp[name]?.hash && testFpAfter[name]?.count === prodFp[name]?.count;
        perCollection[name] = { match, test: testFpAfter[name], prod: prodFp[name] };
        if (!match) allMatch = false;
        console.log(`  Collection ${name} : ${match ? 'MATCH' : 'MISMATCH'}`);
      }
      report.parity = {
        perCollection,
        testGlobal: testGlobalAfter,
        prodGlobal: globalFingerprint(prodFp),
        allMatch,
      };

      // 7. Intégrité PROD.
      console.log('Contrôle d\'intégrité PROD…');
      report.integrity = await checkIntegrity(dstDb, sourceCollections);

      // 8. Verdict.
      const integrityOk = report.integrity.errors.length === 0;
      report.success = testUnchanged && allMatch && integrityOk;
      console.log(`\n${report.success ? '✅ Migration réussie.' : '❌ Migration en échec (voir rapport).'}`);
    }

    const { jsonFile, mdFile } = await writeReports(report, stamp);
    console.log(`\nRapports :\n  - ${jsonFile}\n  - ${mdFile}`);
    if (mode !== 'audit') console.log(`  - ${report.uploads.manifestFile}`);

    await closeClients(clients);
    process.exit(report.success ? 0 : 1);
  } catch (err) {
    console.error('\n❌ Erreur pendant la migration :', err.message);
    report.warnings.push(`Erreur: ${err.message}`);
    try {
      const { jsonFile } = await writeReports(report, stamp);
      console.error(`Rapport partiel : ${jsonFile}`);
    } catch {
      /* ignore */
    }
    await closeClients(clients);
    process.exit(1);
  }
}

async function writeAndClose(report, stamp, clients) {
  try {
    await writeReports(report, stamp);
  } catch {
    /* ignore */
  }
  await closeClients(clients);
}

main();

// Empêche un unhandledRejection silencieux de laisser des connexions ouvertes.
process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection:', err);
  process.exit(1);
});

void SINGLETON_COLLECTIONS;
