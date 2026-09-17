// Seed idempotent d'un compte DÉVELOPPEUR + d'une formation « achetée ».
//   - user role 'dev' (luca.duhoux@lycarz.com), mot de passe hashé (argon2id + PWD_PEPPER) ;
//   - Purchase (itemType formation) de « Volume Russe — Extensions de Cils (en ligne) »
//     → la formation apparaît dans « Mes formations » et débloque les modules distanciels.
//
// Idempotent : relançable. Requiert PWD_PEPPER + MONGODB_URI dans .env.
//   node scripts/seedDevAccount.js
import 'dotenv/config';
import mongoose from 'mongoose';

import User from '../models/user.js';
import Formation from '../models/Formation.js';
import Purchase from '../models/Purchase.js';
import { hashPassword } from '../utils/password.js';

const EMAIL = 'dev@beautysavage.ly-solution.com';
const PASSWORD = '123pass!';
const FORMATION_NAME = 'Volume Russe — Extensions de Cils (en ligne)';

async function seed() {
  const mongoURI = process.env.MONGODB_URI;
  if (!mongoURI) {
    console.error('MONGODB_URI manquant dans .env');
    process.exit(1);
  }
  if (!process.env.PWD_PEPPER) {
    console.error('PWD_PEPPER manquant dans .env (requis pour hasher le mot de passe).');
    process.exit(1);
  }
  mongoose.set('strictQuery', true);
  await mongoose.connect(mongoURI, {
    dbName: process.env.MONGODB_DB_NAME || 'beautysavage-database'
  });
  console.log('Connexion MongoDB — seed compte dev + achat.');

  // 1) Compte développeur (idempotent par email). On (re)pose le mot de passe à chaque exécution.
  const { hash, salt } = await hashPassword(PASSWORD);
  const email = EMAIL.toLowerCase().trim();
  let user = await User.findOne({ email });
  if (!user) {
    user = await User.create({
      email,
      passwordHash: hash,
      passwordSalt: salt,
      role: 'dev',
      currentMode: 'gestion',
      emailVerified: true,
      isActive: true
    });
    console.log(`  Compte dev créé : ${user.email} (${user._id}).`);
  } else {
    user.passwordHash = hash;
    user.passwordSalt = salt;
    user.role = 'dev';
    user.currentMode = 'gestion';
    user.emailVerified = true;
    user.isActive = true;
    await user.save();
    console.log(`  Compte dev existant mis à jour (mot de passe réinitialisé) : ${user.email} (${user._id}).`);
  }

  // 2) Formation cible (doit exister — lancer seedDistancielFormations.js avant si besoin).
  const formation = await Formation.findOne({ name: FORMATION_NAME });
  if (!formation) {
    console.error(`  Formation introuvable : « ${FORMATION_NAME} ». Lance d'abord: node scripts/seedDistancielFormations.js`);
    await mongoose.disconnect();
    process.exit(1);
  }

  // 3) Achat (ownership) — upsert respectant l'index unique (user, formation active distancielle).
  await Purchase.updateOne(
    { userId: user._id, itemType: 'formation', itemId: formation._id, sessionId: null, participationStatus: 'active' },
    {
      $setOnInsert: {
        userId: user._id,
        formationId: formation._id,
        sessionId: null,
        paymentProvider: 'mock',
        paymentStatus: 'paid',
        paymentRef: 'SEED-DEV',
        itemType: 'formation',
        itemId: formation._id,
        participationStatus: 'active',
        createdAt: new Date()
      }
    },
    { upsert: true }
  );
  console.log(`  Achat OK : « ${formation.name} » associée à ${user.email}.`);

  await mongoose.disconnect();
  console.log('Seed terminé.');
}

seed().catch((err) => {
  console.error('Seed compte dev échoué', err);
  process.exit(1);
});
