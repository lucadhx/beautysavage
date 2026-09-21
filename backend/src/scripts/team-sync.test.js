/**
 * ÉQUIPE DU PROJET → PANEL.
 *
 * Ce que ces contrôles verrouillent : que chaque chemin RÉELLEMENT emprunté
 * émette (création, modification, changement de rôle, suppression par
 * `findByIdAndDelete` — le seul en service), qu'une suppression manquée soit
 * réparée par la photographie complète, et qu'AUCUNE donnée sensible ne sorte.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'team_test';
process.env.DB_PROD = 'team_prod';
process.env.JWT_SECRET = 'test-secret-jwt-long-enough-32chars!!';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
process.env.PANEL_SCHEDULER_ENABLED = 'false';

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();
const { bootstrap } = await import('../config/bootstrap.js');
await bootstrap();
// Le service est PRÊT : cette suite a fait elle-même tout ce que le démarrage fait.
await (await import("./helpers/serviceReady.helper.js")).markTestServiceReady();

const { User } = await import('../models/User.model.js');
const { PanelOutboxEntry } = await import('../models/PanelOutboxEntry.model.js');
const { PanelRosterState } = await import('../models/PanelRosterState.model.js');
const team = await import('../services/projectBridge/teamSync.service.js');

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const membres = () => PanelOutboxEntry.find({ entityType: 'TEAM_MEMBER' }).sort({ createdAt: 1 }).lean();
const dernier = async (entityId) => {
  const liste = await PanelOutboxEntry.find({ entityType: 'TEAM_MEMBER', entityId })
    .sort({ createdAt: -1 }).limit(1).lean();
  return liste[0] ?? null;
};

/* ────────────────────────────────────────────────────────────────────────── */
section('1. La chaîne équipe est branchée');
{
  check('la projection d’équipe sait mettre en file', team.isTeamSyncWired());
}

section('2. Création d’un compte : la projection part seule');
{
  await PanelOutboxEntry.deleteMany({});
  const u = await User.create({
    email: 'chef@garage.test', password: 'motdepasse-solide', name: 'Chef d’atelier', role: 'ADMIN',
  });
  await settle();

  const entree = await dernier(team.memberEntityId(u._id));
  check('une projection de membre est en file', !!entree);
  check('…avec son e-mail', entree.payload.email === 'chef@garage.test');
  check('…son nom', entree.payload.name === 'Chef d’atelier');
  check('…son rôle', entree.payload.role === 'ADMIN');
  check('…et l’identifiant source', entree.payload.sourceUserId === String(u._id));
  check('…émise par le PROJET', entree.emitter === 'PROJECT');
}

section('3. AUCUNE donnée sensible ne sort');
{
  const entrees = await membres();
  const brut = JSON.stringify(entrees.map((e) => e.payload));
  check('aucun mot de passe', !/password/i.test(brut));
  check('aucun hachage bcrypt', !/\$2[aby]\$/.test(brut));
  check('aucun jeton ni secret', !/token|secret/i.test(brut));
  check('aucune réinitialisation de mot de passe', !/passwordReset/i.test(brut));

  const cles = new Set(entrees.flatMap((e) => Object.keys(e.payload ?? {})));
  const autorisees = new Set(['sourceUserId', 'email', 'name', 'role', 'createdAt']);
  check(`payload limité à la liste blanche (${[...cles].join(', ')})`,
    [...cles].every((k) => autorisees.has(k)));
  check('ni « dernière connexion » ni « statut » inventés',
    !cles.has('lastLoginAt') && !cles.has('active') && !cles.has('status'));
}

section('4. Modification et changement de rôle');
{
  await PanelOutboxEntry.deleteMany({});
  const u = await User.findOne({ email: 'chef@garage.test' });
  u.name = 'Chef d’atelier principal';
  await u.save();
  await settle();
  check('une modification de nom réémet',
    (await dernier(team.memberEntityId(u._id)))?.payload?.name === 'Chef d’atelier principal');

  await PanelOutboxEntry.deleteMany({});
  u.role = 'DEV';
  await u.save();
  await settle();
  check('un changement de RÔLE réémet',
    (await dernier(team.memberEntityId(u._id)))?.payload?.role === 'DEV');
}

section('5. Suppression par le SEUL chemin réellement utilisé');
{
  // `DELETE /api/accounts/:id` passe par `findByIdAndDelete` : un middleware
  // de REQUÊTE. Un hook de document n'aurait jamais été rejoué.
  await PanelOutboxEntry.deleteMany({});
  const u = await User.create({
    email: 'partant@garage.test', password: 'motdepasse-solide', role: 'ADMIN',
  });
  await settle();
  const entityId = team.memberEntityId(u._id);

  await PanelOutboxEntry.deleteMany({});
  await User.findByIdAndDelete(u._id);
  await settle();

  const tombstone = await dernier(entityId);
  check('findByIdAndDelete émet un TOMBSTONE', tombstone?.deleted === true);
  check('…sans payload', tombstone.payload === null);

  const etat = await PanelRosterState.findOne({ kind: 'TEAM_MEMBER' }).lean();
  check('…et le membre sort de la photographie', !etat.entityIds.includes(entityId));
}

section('6. Suppression en LOT : les partants ne sont pas nommables');
{
  const a = await User.create({ email: 'a@garage.test', password: 'motdepasse-solide', role: 'ADMIN' });
  const b = await User.create({ email: 'b@garage.test', password: 'motdepasse-solide', role: 'ADMIN' });
  await settle();
  const ids = [team.memberEntityId(a._id), team.memberEntityId(b._id)];

  await PanelOutboxEntry.deleteMany({});
  await User.deleteMany({ email: { $in: ['a@garage.test', 'b@garage.test'] } });
  await settle(900); // la réconciliation complète est asynchrone

  const tombstones = await PanelOutboxEntry.find({ entityType: 'TEAM_MEMBER', deleted: true }).lean();
  const effaces = tombstones.map((t) => t.entityId);
  check('les deux partants sont effacés côté Panel',
    ids.every((id) => effaces.includes(id)));
}

section('7. Photographie complète : elle RÉPARE ce qui a été manqué');
{
  // On simule une suppression faite hors de tout hook — écriture directe en
  // base, incident, projet arrêté. La photographie doit la rattraper.
  const orphelin = await User.create({
    email: 'orphelin@garage.test', password: 'motdepasse-solide', role: 'ADMIN',
  });
  await settle();
  const entityId = team.memberEntityId(orphelin._id);
  check('le membre est bien dans la photographie',
    (await PanelRosterState.findOne({ kind: 'TEAM_MEMBER' }).lean()).entityIds.includes(entityId));

  await User.collection.deleteOne({ _id: orphelin._id }); // AUCUN hook Mongoose
  await PanelOutboxEntry.deleteMany({});

  const res = await team.reconcileTeam();
  check('la réconciliation détecte le disparu', res.tombstones === 1);
  const tombstone = await dernier(entityId);
  check('…et émet son tombstone', tombstone?.deleted === true);
  check('…tout en republiant les membres présents', res.upserts >= 1);
  check('…et la photographie est à jour',
    !(await PanelRosterState.findOne({ kind: 'TEAM_MEMBER' }).lean()).entityIds.includes(entityId));

  const rejeu = await team.reconcileTeam();
  check('une seconde photographie n’invente aucun départ', rejeu.tombstones === 0);
}

section('8. Panel éteint : rien ne se perd');
{
  // La file est durable : les écritures s'accumulent et partiront au retour.
  await PanelOutboxEntry.deleteMany({});
  const u = await User.create({
    email: 'hors-ligne@garage.test', password: 'motdepasse-solide', role: 'ADMIN',
  });
  await settle();
  await User.findByIdAndDelete(u._id);
  await settle();

  const entrees = await PanelOutboxEntry.find({ entityType: 'TEAM_MEMBER' }).lean();
  check('création et suppression sont toutes deux en file', entrees.length === 2);
  check('…et toutes en attente de livraison',
    entrees.every((e) => e.status === 'PENDING'));
}

await disconnectDatabase();
await mongod.stop();
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
