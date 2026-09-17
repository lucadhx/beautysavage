import 'dotenv/config';
import mongoose from 'mongoose';

async function migrate() {
  const mongoURI = process.env.MONGODB_URI;
  if (!mongoURI) {
    console.error('MONGODB_URI manquant dans .env');
    process.exit(1);
  }
  mongoose.set('strictQuery', true);
  await mongoose.connect(mongoURI, { dbName: 'beautysavage-database' });
  console.log('Connexion MongoDB pour la migration des pages.');

  const legacyCollection = mongoose.connection.collection('vitrinePages');
  const targetCollection = mongoose.connection.collection('pages');
  const docs = await legacyCollection.find().toArray();
  console.log(`Migration de ${docs.length} page(s) vers la collection "pages".`);

  for (const doc of docs) {
    const payload = {
      slug: String(doc.slug || '').trim().toLowerCase(),
      moduleFile: String(doc.moduleFile || '').trim(),
      type: 'vitrine',
      order: Number(doc.order) || 0,
      access: {
        public: Boolean(doc.access?.public),
        requiresAuth: Boolean(doc.access?.requiresAuth),
        requiresPurchase: Boolean(doc.access?.requiresPurchase),
        purchaseType: doc.access?.purchaseType || null
      },
      disabled: {
        enabled: Boolean(doc.disabled?.enabled),
        from: doc.disabled?.from || null,
        to: doc.disabled?.to || null
      }
    };
    await targetCollection.updateOne(
      { slug: payload.slug },
      { $set: payload },
      { upsert: true }
    );
  }

  console.log('Migration terminée.');
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('Migration des pages échouée', err);
  process.exit(1);
});
