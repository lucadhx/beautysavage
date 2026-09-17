// tests/setup/testDb.js
// In-memory MongoDB lifecycle for tests, using mongodb-memory-server.
// app.js connects mongoose itself (top-level `mongoose.connect`) using
// process.env.MONGODB_URI — so we only need to (a) start the in-memory server and
// (b) set MONGODB_URI to its local URI BEFORE app.js is imported.
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

let mongod = null;

/**
 * Start (once per test file/worker) an in-memory MongoDB and point
 * process.env.MONGODB_URI at it. Returns the URI.
 */
export async function startMemoryDb() {
  if (!mongod) {
    mongod = await MongoMemoryServer.create();
  }
  const uri = mongod.getUri();
  process.env.MONGODB_URI = uri;
  return uri;
}

/** Stop the in-memory server and disconnect mongoose. */
export async function stopMemoryDb() {
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  if (mongod) {
    await mongod.stop();
    mongod = null;
  }
}

/** Wipe all collections between tests (keeps indexes/structure). */
export async function clearDatabase() {
  if (mongoose.connection.readyState !== 1) return;
  const collections = await mongoose.connection.db.collections();
  for (const collection of collections) {
    await collection.deleteMany({});
  }
}
