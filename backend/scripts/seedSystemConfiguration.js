import 'dotenv/config';
import mongoose from 'mongoose';

import {
  seedSystemConfigurationFromEnv,
  getSystemConfiguration
} from '../services/system/systemConfigurationService.js';

// S1 — Migration / seed idempotent de SystemConfiguration depuis le .env.
// Remplit UNIQUEMENT les champs encore vides (domaines, institut, fiscalité, plateforme),
// puis affiche l'état résolu. À lancer une fois après déploiement, avant de nettoyer le .env.
//
//   node scripts/seedSystemConfiguration.js

async function run() {
  const mongoURI = process.env.MONGODB_URI;
  if (!mongoURI) {
    console.error('MONGODB_URI manquant dans .env');
    process.exit(1);
  }
  mongoose.set('strictQuery', true);
  await mongoose.connect(mongoURI, { dbName: 'beautysavage-database' });
  console.log('[seedSystemConfiguration] Connexion MongoDB OK.');

  await seedSystemConfigurationFromEnv();
  const cfg = await getSystemConfiguration({ force: true });

  console.log('[seedSystemConfiguration] Configuration résolue :');
  console.log(
    JSON.stringify(
      {
        domains: cfg.domains,
        institute: cfg.institute,
        localization: cfg.localization,
        tax: cfg.tax,
        system: cfg.system,
        maintenance: cfg.maintenance
      },
      null,
      2
    )
  );
  console.log('[seedSystemConfiguration] Terminé (idempotent).');

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(async (error) => {
  console.error('[seedSystemConfiguration] Échec :', error);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
