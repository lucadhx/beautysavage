/**
 * MEMBRES DES FORMATIONS EN LIGNE ET ACCÈS OFFERT PAR L'INSTITUT (2026-11-12).
 *
 *   1. la liste des membres réunit achat, pack et accès offert, une ligne par cliente ;
 *   2. l'ajout manuel d'une cliente existante ouvre l'accès (vidéos, espace
 *      formation, dossier final) SANS vente ni commission, et émet l'e-mail dédié ;
 *   3. la création d'un compte (prénom, nom, e-mail, téléphone) envoie AUSSI le
 *      lien « choisir mon mot de passe », d'abord ; une adresse connue reprend le compte ;
 *   4. refus : déjà membre, formation en présentiel, identité incomplète ;
 *   5. le retrait d'un accès offert coupe l'accès et annule l'e-mail non parti ;
 *   6. les e-mails se rendent (formation offerte, compte créé pour une formation).
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'training_members_test';
process.env.DB_PROD = 'training_members_prod';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.NGROK_API_URL = 'http://127.0.0.1:1';

let pass = 0;
let fail = 0;
const check = (n, c, detail = '') => {
  if (c) { pass += 1; console.log(`  ✓ ${n}`); } else { fail += 1; console.error(`  ✗ ${n}${detail ? ` — ${detail}` : ''}`); }
};
const section = (n) => console.log(`\n${n}`);
async function refusal(promise) {
  try { await promise; return null; } catch (err) { return err; }
}
const codeOf = (err) => err?.details?.code || err?.code || '';

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();
const mongoose = (await import('mongoose')).default;
const { CommerceSale } = await import('../models/CommerceSale.model.js');
const { Customer } = await import('../models/Customer.model.js');
const { TrainingAccessGrant } = await import('../models/TrainingAccessGrant.model.js');
const commerce = await import('../services/commerce.service.js');
const members = await import('../services/trainingMembers.service.js');
const { assertVideoAccess, customerOwnsTraining } = await import('../services/trainingAccess.js');
const { resolveTrainingAccessGrantedClient, resolveCustomerAccountCreated } = await import('../services/email/commerceVariableResolver.js');
const { renderInstituteEmail } = await import('../services/email/instituteEmail.service.js');
const db = mongoose.connection.db;
const eventsOf = (type) => db.collection('domainevents').find({ type }).sort({ _id: 1 }).toArray();

const training = await commerce.upsertProduct({
  title: 'Formation cils en ligne', slug: 'cils-en-ligne', kind: 'DISTANCE_TRAINING', status: 'PUBLISHED',
  price: { amountCents: 30000, currency: 'EUR' },
  modules: [{ id: 'm1', title: 'Bases', videos: [{ title: 'V', streamableShortcode: 'cils1234' }] }, { id: 'm2', title: 'Pose' }],
});
const other = await commerce.upsertProduct({ title: 'Autre', slug: 'autre', kind: 'DISTANCE_TRAINING', status: 'PUBLISHED', price: { amountCents: 10000, currency: 'EUR' } });
const onsite = await commerce.upsertProduct({ title: 'Présentiel', slug: 'presentiel', kind: 'IN_PERSON_TRAINING', status: 'DRAFT', price: { amountCents: 20000, currency: 'EUR' } });
const pack = await commerce.upsertProduct({ title: 'Pack duo', slug: 'pack-duo', kind: 'TRAINING_PACK', status: 'PUBLISHED', price: { amountCents: 35000, currency: 'EUR' }, pack: { productIds: [String(training._id), String(other._id)] } });

const buyer = await Customer.create({ email: 'achat@example.test', password: 'Motdepasse-123', firstName: 'Ava', lastName: 'Achat', phone: '0600000001', emailVerified: true });
const packBuyer = await Customer.create({ email: 'pack@example.test', password: 'Motdepasse-123', firstName: 'Paula', lastName: 'Pack', phone: '0600000002', emailVerified: true });
const invited = await Customer.create({ email: 'invitee@example.test', password: 'Motdepasse-123', firstName: 'Inès', lastName: 'Invitée', phone: '0600000003', emailVerified: true });
let n = 0;
const paid = (customerId, line) => CommerceSale.create({ saleNumber: `T-${++n}`, customerId, paymentStatus: 'PAID', totalCents: line.totalCents, idempotencyKey: `tm-${n}`, lines: [{ quantity: 1, unitPriceCents: line.totalCents, ...line }] });
await paid(buyer._id, { productId: training._id, productSnapshot: { kind: 'DISTANCE_TRAINING', title: training.title }, totalCents: 30000 });
await paid(packBuyer._id, { productId: pack._id, productSnapshot: { kind: 'TRAINING_PACK', title: 'Pack duo', pack: { productIds: [String(training._id), String(other._id)] } }, totalCents: 35000 });
const salesBefore = await CommerceSale.countDocuments();

/* ── 1. Liste ───────────────────────────────────────────────────────────── */
section('1. Membres : achat et pack');
let view = await members.listTrainingMembers(String(training._id));
check('2 membres (achat + pack)', view.members.length === 2, String(view.members.length));
check('origines lues', view.members.some((m) => m.origins[0].type === 'PURCHASE') && view.members.some((m) => m.origins[0].type === 'PACK' && m.origins[0].packTitle === 'Pack duo'));
const overview = await members.listTrainingsWithMembers();
check('vue d’ensemble : compteur par formation', overview.find((t) => t.id === String(training._id))?.memberCount === 2 && overview.every((t) => t.id !== String(onsite._id)));

/* ── 2. Ajout d'une cliente existante ───────────────────────────────────── */
section('2. Ajout manuel d’une cliente existante');
check('avant : pas d’accès', !(await customerOwnsTraining(invited._id, String(training._id))));
const added = await members.grantTrainingAccess(String(training._id), { customerId: String(invited._id) });
check('accès ouvert', await customerOwnsTraining(invited._id, String(training._id)));
check('vidéo lisible', (await refusal(assertVideoAccess({ provider: 'STREAMABLE', videoId: 'cils1234', customerId: invited._id }))) === null);
check('aucune vente créée (ni CA, ni commission)', (await CommerceSale.countDocuments()) === salesBefore);
const espace = await commerce.listCustomerFormations(invited._id);
check('espace formation : la formation, marquée « offerte »', espace.length === 1 && espace[0].manualAccess === true && espace[0].modules.length === 2);
const granted = await eventsOf('training.access.granted');
check('e-mail « vous avez accès » émis', granted.length === 1 && granted[0].payloadSafe.trainingTitle === training.title && granted[0].payloadSafe.accountPending === false);
check('pas de lien de compte pour un compte existant', (await eventsOf('customer.account_created')).length === 0 && added.accountCreated === false);
const sub = await refusal(commerce.createTrainingSubmission(invited._id, { productId: String(training._id), saleId: added.grantId, answers: {} }));
check('dossier final : la formation offerte est admissible', !sub || codeOf(sub) !== 'TRAINING_NOT_OWNED' && !/non admissible|introuvable/i.test(sub.message), sub?.message);
view = await members.listTrainingMembers(String(training._id));
check('liste : 3 membres, dont 1 offert', view.members.length === 3 && view.members.find((m) => m.customerId === String(invited._id))?.manualGrantId === added.grantId);

/* ── 3. Création de compte ──────────────────────────────────────────────── */
section('3. Ajout avec création de compte');
const created = await members.grantTrainingAccess(String(training._id), { newCustomer: { firstName: ' Nora ', lastName: 'Neuve', email: 'Nora.Neuve@Example.test', phone: '06 11 22 33 44' } });
const nora = await Customer.findOne({ email: 'nora.neuve@example.test' }).lean();
check('compte créé, e-mail en minuscules, identité complète', created.accountCreated && nora && nora.firstName === 'Nora' && nora.phone === '06 11 22 33 44' && nora.createdByInstitute === true && nora.emailVerified === false);
const accountEvents = await eventsOf('customer.account_created');
check('lien « choisir mon mot de passe » envoyé (origine formation)', accountEvents.length === 1 && accountEvents[0].payloadSafe.origin === 'MANUAL_TRAINING');
const granted2 = await eventsOf('training.access.granted');
check('puis l’e-mail de la formation, compte à activer', granted2.length === 2 && granted2[1].payloadSafe.accountPending === true);
check('ordre : le compte d’abord', accountEvents[0]._id < granted2[1]._id);
const again = await members.grantTrainingAccess(String(other._id), { newCustomer: { firstName: 'X', lastName: 'Y', email: 'nora.neuve@example.test', phone: '0612345678' } });
const noraAfter = await Customer.findById(nora._id).lean();
check('adresse connue : le compte existant est repris, sans être modifié', again.accountCreated === false && again.existingByEmail === true && noraAfter.firstName === 'Nora');

/* ── 4. Refus ───────────────────────────────────────────────────────────── */
section('4. Refus');
check('déjà membre (achat) → refusé', codeOf(await refusal(members.grantTrainingAccess(String(training._id), { customerId: String(buyer._id) }))) === 'TRAINING_ALREADY_MEMBER');
check('déjà membre (offert) → refusé', codeOf(await refusal(members.grantTrainingAccess(String(training._id), { customerId: String(invited._id) }))) === 'TRAINING_ALREADY_MEMBER');
check('formation en présentiel → refusée', codeOf(await refusal(members.grantTrainingAccess(String(onsite._id), { customerId: String(invited._id) }))) === 'TRAINING_NOT_DISTANCE');
check('identité incomplète (sans téléphone) → refusée', codeOf(await refusal(members.grantTrainingAccess(String(training._id), { newCustomer: { firstName: 'A', lastName: 'B', email: 'a@b.test' } }))) === 'CUSTOMER_IDENTITY_INVALID');
check('e-mail invalide → refusé', codeOf(await refusal(members.grantTrainingAccess(String(training._id), { newCustomer: { firstName: 'A', lastName: 'B', email: 'pas-un-mail', phone: '0612345678' } }))) === 'CUSTOMER_EMAIL_INVALID');
check('cliente inconnue → 404', (await refusal(members.grantTrainingAccess(String(training._id), { customerId: String(new mongoose.Types.ObjectId()) })))?.statusCode === 404);

/* ── 5. Retrait ─────────────────────────────────────────────────────────── */
section('5. Retrait d’un accès offert');
const guardBefore = await members.trainingAccessGrantStillActive({ payloadSafe: { grantId: added.grantId } });
await members.revokeTrainingAccess(String(training._id), added.grantId);
check('accès coupé', !(await customerOwnsTraining(invited._id, String(training._id))));
check('vidéo refusée', codeOf(await refusal(assertVideoAccess({ provider: 'STREAMABLE', videoId: 'cils1234', customerId: invited._id }))) === 'TRAINING_NOT_OWNED');
const guardAfter = await members.trainingAccessGrantStillActive({ payloadSafe: { grantId: added.grantId } });
check('e-mail pas encore parti : annulé', guardBefore.relevant === true && guardAfter.relevant === false);
check('trace gardée', (await TrainingAccessGrant.findById(added.grantId).lean())?.revokedAt instanceof Date);
check('second retrait → 404', (await refusal(members.revokeTrainingAccess(String(training._id), added.grantId)))?.statusCode === 404);
check('ré-ajout possible après retrait', (await refusal(members.grantTrainingAccess(String(training._id), { customerId: String(invited._id) }))) === null);

/* ── 6. E-mails ─────────────────────────────────────────────────────────── */
section('6. E-mails');
const vars = await resolveTrainingAccessGrantedClient({ event: granted2[1] });
const mail = await renderInstituteEmail('TRAINING_ACCESS_GRANTED_CLIENT', vars);
const text = `${mail.subject}\n${mail.html}\n${mail.text}`;
check('objet : « Félicitations, vous avez accès à … »', /Félicitations, vous avez accès à Formation cils en ligne/.test(mail.subject), mail.subject);
check('prénom, modules, lien formation', /Nora/.test(text) && /2 modules/.test(text) && /\/espace-client\/formations/.test(text));
check('compte à activer : consigne « choisissez d’abord votre mot de passe »', /choisissez d’abord votre mot de passe/.test(text));
const accVars = await resolveCustomerAccountCreated({ event: accountEvents[0] });
const accMail = await renderInstituteEmail('CUSTOMER_ACCOUNT_CREATED', accVars);
check('compte créé pour une formation : texte adapté', /pour vous donner accès à votre formation en ligne/.test(accMail.html) && !/lors de votre réservation/.test(accMail.html));
const bookingVars = await resolveCustomerAccountCreated({ event: { payloadSafe: { ...accountEvents[0].payloadSafe, origin: 'MANUAL_BOOKING' } } });
check('compte créé lors d’une réservation : texte d’origine inchangé', /lors de votre réservation/.test((await renderInstituteEmail('CUSTOMER_ACCOUNT_CREATED', bookingVars)).html));

console.log(`\n${pass} réussis, ${fail} échoués`);
await disconnectDatabase();
await mongod.stop();
process.exit(fail ? 1 : 0);
