import 'dotenv/config';
import mongoose from 'mongoose';

import { pairWithPanel } from '../services/panelBridgeService.js';

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI manquant.');
await mongoose.connect(uri, { dbName: process.env.MONGODB_DB_NAME || 'beautysavage-database' });
try {
  const state = await pairWithPanel({});
  console.log(`BeautySavage appairé au panel (projet ${state.projectId}).`);
} finally {
  await mongoose.disconnect();
}
