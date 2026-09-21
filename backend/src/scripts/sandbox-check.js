/* Vérification d'un fournisseur pour un MODE EXPLICITE, avec les
 * credentials réels stockés. LECTURE SEULE : aucun paiement, aucune signature,
 * aucune ressource créée. N'affiche jamais de secret. Le MODE n'est plus déduit
 * de l'ENV applicatif. Usage :
 *   npm run integrated-api:test:stripe -- --mode=TEST
 *   npm run integrated-api:test:stripe -- --mode=PROD   (demande --confirm-prod)
 *   npm run integrated-api:test:stripe                  (teste le mode ACTIF)
 */
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { testProviderConnection } from '../services/providerConnectionTest.service.js';
import { getActiveMode } from '../services/integratedApi.service.js';
import { isValidMode } from '../utils/integratedApiCatalog.js';
import { logger } from '../utils/logger.js';

const provider = (process.argv[2] || '').toUpperCase();
/**
 * LA SIGNATURE A QUITTÉ CETTE LISTE.
 *
 * `YOUSIGN` y figurait. Le test qu'il déclenchait lisait une clé LOCALE et
 * appelait le fournisseur depuis ce projet — exactement ce que la
 * centralisation a supprimé : il n'y a plus de clé de signature ici, et le
 * testeur correspondant a disparu avec elle.
 *
 * « La signature répond-elle ? » se demande désormais à la plateforme, par
 * `signatureControlPlaneDiagnostic`, qui sait quel fournisseur l'exécute.
 */
if (!['STRIPE'].includes(provider)) {
  logger.error('Usage : node src/scripts/sandbox-check.js STRIPE [--mode=TEST|PROD]');
  process.exit(2);
}
const modeArg = (process.argv.find((a) => a.startsWith('--mode=')) || '').split('=')[1];
const explicitMode = modeArg ? modeArg.toUpperCase() : null;
if (explicitMode && !isValidMode(explicitMode)) {
  logger.error(`Mode invalide : ${explicitMode} (TEST|PROD).`);
  process.exit(2);
}

await connectDatabase();
try {
  // Sans --mode : on teste le MODE ACTIF du fournisseur (jamais l'ENV applicatif).
  const mode = explicitMode || (await getActiveMode(provider)) || 'TEST';

  if (mode === 'PROD' && !process.argv.includes('--confirm-prod')) {
    logger.error(
      `Refus : test du mode PROD de ${provider}. C'est un appel LECTURE SEULE (aucun ` +
        `paiement) mais il utilise les clés de PRODUCTION. Relancer avec --confirm-prod.`
    );
    process.exitCode = 2;
  } else {
    logger.info(`Test ${provider} — mode ${mode}${explicitMode ? '' : ' (mode actif)'}…`);
    const result = await testProviderConnection(provider, mode);
    const line = `${provider} (${mode}) : ${result.status} — ${result.message}`;
    if (result.status === 'SUCCESS') logger.success(line);
    else logger.error(line);
    process.exitCode = result.status === 'SUCCESS' ? 0 : 1;
  }
} finally {
  await disconnectDatabase();
}
