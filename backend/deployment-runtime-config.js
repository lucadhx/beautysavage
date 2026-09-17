import { MongoClient } from 'mongodb';

// Adaptateur BeautySavage injecté au moteur : son singleton métier porte les
// domaines dans `domains`, et non dans le schéma `network` des projets vitrines
// historiques. Le moteur ne connaît pas ce détail.
export async function syncBeautyRuntimeConfiguration({ mongoUri, dbName, urls } = {}) {
  if (!mongoUri || !dbName || !urls?.vitrineUrl || !urls?.managerUrl) {
    throw new Error('Configuration réseau BeautySavage incomplète.');
  }
  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10_000 });
  try {
    await client.connect();
    const collection = client.db(dbName).collection('systemconfiguration');
    const now = new Date();
    await collection.updateOne(
      { key: 'global' },
      {
        $set: {
          'domains.vitrineUrl': urls.vitrineUrl,
          // L'espace manager est l'interface d'administration de l'institut.
          'domains.panelUrl': urls.managerUrl,
          updatedAt: now,
        },
        $setOnInsert: { key: 'global', createdAt: now },
      },
      { upsert: true },
    );
    const readback = await collection.findOne({ key: 'global' }, { projection: { domains: 1 } });
    if (readback?.domains?.vitrineUrl !== urls.vitrineUrl || readback?.domains?.panelUrl !== urls.managerUrl) {
      throw new Error('Relecture des domaines BeautySavage incohérente.');
    }
    return { ok: true, urls, created: false };
  } finally {
    await client.close();
  }
}
