import 'dotenv/config';
import mongoose from 'mongoose';

import { seedIntegratedApisFromEnv } from '../seeders/seedIntegratedApisFromEnv.js';

// S1B — Migration des credentials .env (Stripe institut/dev, Brevo) vers le coffre
// IntegratedApi. Lit l'ancien .env LOCAL, chiffre et stocke. Idempotent.
//
//   node scripts/migrateEnvCredentialsToIntegratedApi.js            # DRY-RUN (par défaut)
//   node scripts/migrateEnvCredentialsToIntegratedApi.js --apply    # écrit dans le coffre
//
// - Ne loggue JAMAIS une valeur de secret.
// - Ne s'exécute JAMAIS au boot (script CLI uniquement).
// - Après migration réussie, indique quelles variables retirer du .env.

const ENV_VARS_TO_REMOVE = [
  'STRIPE_SECRET_KEY',
  'STRIPE_PUBLISHABLE_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_DEV_SECRET_KEY',
  'STRIPE_DEV_PUBLISHABLE_KEY',
  'STRIPE_DEV_WEBHOOK_SECRET',
  'BREVO_API_KEY'
];

async function run() {
  const apply = process.argv.includes('--apply');
  const dryRun = !apply;

  const mongoURI = process.env.MONGODB_URI;
  if (!mongoURI) {
    console.error('MONGODB_URI manquant dans .env');
    process.exit(1);
  }
  if (!process.env.CREDENTIAL_VAULT_KEY) {
    console.error('CREDENTIAL_VAULT_KEY manquant — impossible de chiffrer les credentials.');
    process.exit(1);
  }

  mongoose.set('strictQuery', true);
  await mongoose.connect(mongoURI, { dbName: 'beautysavage-database' });
  console.log(`[migrateEnvCredentials] Connexion MongoDB OK — mode ${dryRun ? 'DRY-RUN' : 'APPLY'}.`);

  const result = await seedIntegratedApisFromEnv({ dryRun });

  console.log('\n=== Résultat (aucun secret affiché) ===');
  for (const d of result.details || []) {
    if (d.reason) {
      console.log(`- ${d.reason}`);
      continue;
    }
    console.log(
      `- ${d.slug} : ${d.created ? 'créé' : 'existant'}, credentials ${dryRun ? 'à ajouter' : 'ajoutés'}=${d.credentialsAdded}` +
        `, mode=${d.mode}, purpose=${d.accountPurpose}${d.purposeBackfilled ? ' (purpose backfillé)' : ''}`
    );
  }
  console.log(`seeded=[${(result.seeded || []).join(', ')}] skipped=[${(result.skipped || []).join(', ')}]`);

  if (dryRun) {
    console.log('\nDRY-RUN : rien n\'a été écrit. Relancez avec --apply pour migrer.');
  } else {
    console.log('\n✓ Migration appliquée. Vous pouvez maintenant RETIRER du .env :');
    for (const v of ENV_VARS_TO_REMOVE) console.log(`   - ${v}`);
    console.log('   (gardez ALLOW_ENV_CREDENTIAL_FALLBACK=false en production.)');
  }

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (error) => {
  console.error('[migrateEnvCredentials] Échec :', error?.message || error);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
