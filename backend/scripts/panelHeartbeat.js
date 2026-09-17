import 'dotenv/config';
import mongoose from 'mongoose';

import { sendHeartbeat } from '../services/panelBridgeService.js';

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error('MONGODB_URI manquant.');
await mongoose.connect(uri, { dbName: process.env.MONGODB_DB_NAME || 'beautysavage-database' });
try {
  await sendHeartbeat();
  console.log('Heartbeat BeautySavage transmis au panel.');
} finally {
  await mongoose.disconnect();
}
