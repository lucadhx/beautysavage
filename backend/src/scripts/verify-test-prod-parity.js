/**
 * Vérification de parité TEST / PROD (lecture seule des deux bases).
 *
 *   node src/scripts/verify-test-prod-parity.js
 *
 * Compare : liste des collections, nombre de documents, ensemble des _id,
 * empreinte de contenu (EJSON canonique), singletons, comptes, références.
 * N'écrit RIEN (ni TEST ni PROD). Écrit uniquement un rapport dans
 * migration-reports/.
 */
import {
  loadDualEnv,
  assertSafety,
  connectClients,
  closeClients,
  listUserCollections,
  fingerprintDatabase,
  globalFingerprint,
  checkIntegrity,
  nowStamp,
} from './lib/promotion-core.js';
import { writeReports } from './lib/promotion-report.js';

async function collectIds(db, name) {
  const ids = await db.collection(name).find({}, { projection: { _id: 1 }, sort: { _id: 1 } }).toArray();
  return ids.map((d) => String(d._id));
}

async function main() {
  const env = loadDualEnv();
  try {
    assertSafety(env);
  } catch (err) {
    console.error(`\n❌ ${err.message}\n`);
    process.exit(1);
  }

  const line = '─'.repeat(52);
  console.log(line);
  console.log(`SOURCE      : ${env.dbTest}`);
  console.log(`DESTINATION : ${env.dbProd}`);
  console.log(`MODE        : VERIFY (lecture seule)`);
  console.log(line);

  const clients = await connectClients(env);
  const { srcDb, dstDb } = clients;
  const stamp = nowStamp();

  const report = {
    date: new Date().toISOString(),
    mode: 'verify',
    source: env.dbTest,
    destination: env.dbProd,
    success: false,
    warnings: [],
    collections: [],
  };

  try {
    const testColls = await listUserCollections(srcDb);
    const prodColls = await listUserCollections(dstDb);

    // 1. Même ensemble de collections ?
    const onlyInTest = testColls.filter((c) => !prodColls.includes(c));
    const onlyInProd = prodColls.filter((c) => !testColls.includes(c));
    if (onlyInTest.length) report.warnings.push(`Collections présentes en TEST mais absentes en PROD : ${onlyInTest.join(', ')}`);
    if (onlyInProd.length) report.warnings.push(`Collections présentes en PROD mais absentes en TEST : ${onlyInProd.join(', ')}`);

    // 2. Empreintes + _id + counts.
    const testFp = await fingerprintDatabase(srcDb, testColls);
    const prodFp = await fingerprintDatabase(dstDb, testColls);
    const perCollection = {};
    let allMatch = testColls.length > 0 && onlyInTest.length === 0 && onlyInProd.length === 0;

    for (const name of testColls) {
      const contentMatch = testFp[name]?.hash === prodFp[name]?.hash;
      const countMatch = testFp[name]?.count === prodFp[name]?.count;
      let idsMatch = countMatch;
      if (countMatch && !contentMatch) {
        const [a, b] = await Promise.all([collectIds(srcDb, name), collectIds(dstDb, name)]);
        idsMatch = a.length === b.length && a.every((v, i) => v === b[i]);
      } else if (countMatch) {
        // contenu identique -> _id forcément identiques (triés par _id).
        idsMatch = true;
      }
      const match = contentMatch && countMatch && idsMatch;
      if (!match) allMatch = false;
      perCollection[name] = { match, test: testFp[name], prod: prodFp[name], idsMatch, contentMatch };
      report.collections.push({
        name,
        sourceCount: testFp[name]?.count ?? 0,
        destBefore: null,
        destAfter: prodFp[name]?.count ?? 0,
      });
      console.log(`  Collection ${name} : ${match ? 'MATCH' : 'MISMATCH'}`);
    }

    report.parity = {
      perCollection,
      testGlobal: globalFingerprint(testFp),
      prodGlobal: globalFingerprint(prodFp),
      allMatch,
    };

    // 3. Intégrité PROD (singletons, comptes, refs).
    report.integrity = await checkIntegrity(dstDb, prodColls);

    report.success = allMatch && report.integrity.errors.length === 0;
    console.log(`\nParité globale : ${allMatch ? 'MATCH ✅' : 'MISMATCH ❌'}`);
    console.log(`Intégrité PROD : ${report.integrity.errors.length === 0 ? 'OK ✅' : 'ERREURS ❌'}`);

    const { jsonFile, mdFile } = await writeReports(report, `verify-${stamp}`);
    console.log(`\nRapports :\n  - ${jsonFile}\n  - ${mdFile}`);

    await closeClients(clients);
    process.exit(report.success ? 0 : 1);
  } catch (err) {
    console.error('\n❌ Erreur pendant la vérification :', err.message);
    await closeClients(clients);
    process.exit(1);
  }
}

main();
