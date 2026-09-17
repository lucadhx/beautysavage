import 'dotenv/config';
import mongoose from 'mongoose';

import { mailTemplateDefaults, saveTemplate } from '../services/mailService.js';

async function main() {
  const mongoURI = process.env.MONGODB_URI;
  if (!mongoURI) {
    throw new Error('MONGODB_URI manquant dans .env');
  }

  await mongoose.connect(mongoURI, { dbName: 'beautysavage-database' });

  const templateEntries = Object.entries(mailTemplateDefaults);

  for (const [functionName, template] of templateEntries) {
    await saveTemplate(
      functionName,
      template.subject || '',
      template.bodyHtml || '',
      template.fullHtml || '',
      template.mode || 'html'
    );
    console.log(`[syncPremiumMailTemplates] Template synchronise: ${functionName}`);
  }
}

main()
  .then(async () => {
    await mongoose.disconnect();
  })
  .catch(async error => {
    console.error('[syncPremiumMailTemplates] Echec de synchronisation', error);
    try {
      await mongoose.disconnect();
    } catch (_disconnectError) {
      // noop
    }
    process.exitCode = 1;
  });
