/**
 * LOT DU 9 NOVEMBRE 2026 — repris du rapport melinails, plus trois demandes.
 *
 *   1. FUITE DU CONTENU PAYANT (P0) : la fiche publique ne donne plus que le
 *      programme ; une vidéo de module ne se lit que par une acheteuse
 *      (achat direct ou pack) ; un identifiant fait de caractères spéciaux
 *      est refusé (il donnait une recherche vide qui ouvrait tout).
 *   2. PROFIL CLIENT en liste blanche (aucune empreinte, aucune échéance).
 *   3. CARTE CADEAU : deux paiements simultanés ne réservent jamais plus que
 *      le solde.
 *   4. QUANTITÉ toujours 1 ; ENREGISTRER LES HORAIRES ne vide plus les rappels.
 *   5. PLANNING : la carte d'un rendez-vous détaille les options prises.
 *   6. PHOTOS D'AVIS : 3 au plus, ré-encodées, une cliente ne joint que les siennes.
 *   7. PACKS DE FORMATIONS : garde-fous, fiche, panier, accès par l'instantané,
 *      espace formation, commission.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';
import sharp from 'sharp';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'lot_20261109_test';
process.env.DB_PROD = 'lot_20261109_prod';
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
const { config } = await import('../config/env.js');
const { CommerceProduct } = await import('../models/CommerceProduct.model.js');
const { CommerceSale } = await import('../models/CommerceSale.model.js');
const { Customer } = await import('../models/Customer.model.js');
const { CalendarEvent } = await import('../models/CalendarEvent.model.js');
const { BookingSchedule } = await import('../models/BookingSchedule.model.js');
const { GiftCard, hashGiftSecret, encryptGiftCode } = await import('../models/GiftCard.model.js');
const { Review } = await import('../models/Review.model.js');
const commerce = await import('../services/commerce.service.js');
const calendar = await import('../services/calendar.service.js');
const { assertVideoAccess } = await import('../services/trainingAccess.js');
const { storeReviewPhoto, normalizeReviewPhotos } = await import('../services/reviewPhotos.js');
const { computeSaleCommission } = await import('../services/commissionRules.js');

let saleSeq = 0;
async function paidSale(customerId, lines) {
  saleSeq += 1;
  return CommerceSale.create({
    saleNumber: `T-${Date.now()}-${saleSeq}`,
    customerId,
    paymentStatus: 'PAID',
    totalCents: lines.reduce((s, l) => s + (l.totalCents || 0), 0),
    idempotencyKey: `lot-${saleSeq}-${Date.now()}`,
    lines: lines.map((l) => ({ quantity: 1, unitPriceCents: l.totalCents || 0, totalCents: l.totalCents || 0, ...l })),
  });
}

const alice = await Customer.create({ email: 'alice@example.test', password: 'Motdepasse-123', firstName: 'Alice', lastName: 'Martin', phone: '0600000001' });
const bea = await Customer.create({ email: 'bea@example.test', password: 'Motdepasse-123', firstName: 'Béa', lastName: 'Durand', phone: '0600000002' });

const trainingA = await commerce.upsertProduct({
  title: 'Formation A', slug: 'formation-a', kind: 'DISTANCE_TRAINING', status: 'PUBLISHED',
  price: { amountCents: 20000, currency: 'EUR' },
  modules: [{ id: 'm1', title: 'Module 1', description: 'Bases', videos: [{ title: 'V1', streamableShortcode: 'abc123xyz' }], files: [{ title: 'Fiche', url: '/uploads/x.pdf' }] }],
  trailer: { streamableShortcode: 'trailer01' },
});
const trainingB = await commerce.upsertProduct({
  title: 'Formation B', slug: 'formation-b', kind: 'DISTANCE_TRAINING', status: 'PUBLISHED',
  price: { amountCents: 15000, currency: 'EUR' },
  modules: [{ id: 'm1', title: 'Module B1', videos: [{ title: 'VB', streamableShortcode: 'bbb456uvw' }] }],
});
const draft = await commerce.upsertProduct({ title: 'Brouillon', slug: 'brouillon', kind: 'DISTANCE_TRAINING', status: 'DRAFT', price: { amountCents: 1000, currency: 'EUR' } });
const onsite = await commerce.upsertProduct({ title: 'Présentiel', slug: 'presentiel', kind: 'IN_PERSON_TRAINING', status: 'DRAFT', price: { amountCents: 30000, currency: 'EUR' } });

/* ── 1. Fuite du contenu payant ─────────────────────────────────────────── */
section('1. Contenu payant');
const fiche = await commerce.getProductBySlug('formation-a');
const ficheJson = JSON.stringify(fiche);
check('la fiche publique donne le programme (titre, nombres)', fiche.modules[0].title === 'Module 1' && fiche.modules[0].videoCount === 1 && fiche.modules[0].fileCount === 1);
check('aucun identifiant de vidéo de module ni fichier dans la fiche', !ficheJson.includes('abc123xyz') && !ficheJson.includes('/uploads/x.pdf'));
const catalogJson = JSON.stringify(await commerce.listCatalog());
check('ni dans le catalogue', !catalogJson.includes('abc123xyz') && !catalogJson.includes('bbb456uvw'));
check('une bande-annonce se lit sans compte', (await refusal(assertVideoAccess({ provider: 'STREAMABLE', videoId: 'trailer01' }))) === null);
const anon = await refusal(assertVideoAccess({ provider: 'STREAMABLE', videoId: 'abc123xyz' }));
check('une vidéo de module sans compte → 401', anon?.statusCode === 401, String(anon?.statusCode));
const notOwned = await refusal(assertVideoAccess({ provider: 'STREAMABLE', videoId: 'abc123xyz', customerId: bea._id }));
check('une cliente qui ne l’a pas achetée → 403', codeOf(notOwned) === 'TRAINING_NOT_OWNED', codeOf(notOwned));
for (const bad of ['!!!!', '.*', 'a.*b']) {
  const err = await refusal(assertVideoAccess({ provider: 'STREAMABLE', videoId: bad, customerId: bea._id }));
  check(`identifiant « ${bad} » refusé`, codeOf(err) === 'VIDEO_ID_INVALID', codeOf(err));
}
await paidSale(alice._id, [{ productId: trainingA._id, productSnapshot: { kind: 'DISTANCE_TRAINING', title: 'Formation A' }, totalCents: 20000 }]);
check('l’acheteuse lit la vidéo', (await refusal(assertVideoAccess({ provider: 'STREAMABLE', videoId: 'abc123xyz', customerId: alice._id }))) === null);
const espaceA = await commerce.listCustomerFormations(alice._id);
check('l’espace formation de l’acheteuse garde le contenu complet', JSON.stringify(espaceA).includes('abc123xyz'));

/* ── 2. Profil client ───────────────────────────────────────────────────── */
section('2. Profil client en liste blanche');
const login = await commerce.loginCustomer('alice@example.test', 'Motdepasse-123');
const keys = Object.keys(login.customer);
check('la connexion ne renvoie que les champs publics', keys.every((k) => ['_id', 'email', 'firstName', 'lastName', 'phone', 'billingAddress', 'marketingConsent', 'createdByInstitute', 'emailVerified', 'createdAt', 'updatedAt'].includes(k)), keys.join(','));
check('ni mot de passe, ni échéances de codes', !('password' in login.customer) && !('emailVerification' in login.customer) && !('passwordReset' in login.customer));
const reg = await commerce.registerCustomer({ email: 'nouvelle@example.test', password: 'Motdepasse-123', firstName: 'Nina', lastName: 'Neuve', phone: '0600000003' });
check('l’inscription non plus', !('emailVerification' in reg.customer) && reg.customer.email === 'nouvelle@example.test');
const profile = await commerce.updateCustomerProfile(alice._id, { firstName: 'Alice', lastName: 'Martin', phone: '0600000009' });
check('le profil mis à jour non plus', profile.phone === '0600000009' && !('emailVerification' in profile));

/* ── 3. Carte cadeau atomique ───────────────────────────────────────────── */
section('3. Carte cadeau');
await GiftCard.create({ codeHash: hashGiftSecret('CADEAU-TEST-0001'), codeMasked: 'CADE****0001', codeEncrypted: encryptGiftCode('CADEAU-TEST-0001'), initialAmountCents: 5000, balanceCents: 5000, status: 'ACTIVE' });
const [r1, r2] = await Promise.allSettled([
  commerce.reserveGiftCardAllocations(['CADEAU-TEST-0001'], 4000),
  commerce.reserveGiftCardAllocations(['CADEAU-TEST-0001'], 4000),
]);
const card = await GiftCard.findOne({ codeMasked: 'CADE****0001' }).lean();
check('deux paiements simultanés : un seul réserve', [r1, r2].filter((r) => r.status === 'fulfilled').length === 1, `${r1.status}/${r2.status}`);
check('jamais plus que le solde réservé', card.reservedCents <= card.balanceCents, `${card.reservedCents}/${card.balanceCents}`);

/* ── 4. Quantité et horaires ────────────────────────────────────────────── */
section('4. Quantité, horaires');
const cart = await commerce.addCartItem(bea._id, { productId: trainingB._id, quantity: 7 });
check('quantité envoyée 7 → 1', cart.lines.every((l) => l.quantity === 1), cart.lines.map((l) => l.quantity).join(','));
await BookingSchedule.findOneAndUpdate({ singleton: 'global' }, { $set: { reminders: [{ hoursBefore: 24 }], noShowPolicy: { threshold: 2 } } }, { upsert: true });
await calendar.saveSchedule({ timezone: 'Europe/Paris', slotStepMinutes: 15, weeklyHours: [] });
const sched = await BookingSchedule.findOne({ singleton: 'global' }).lean();
check('enregistrer les horaires garde les rappels et la règle d’absences', (sched.reminders || []).length === 1 && sched.noShowPolicy?.threshold === 2, JSON.stringify({ r: sched.reminders, n: sched.noShowPolicy }));

/* ── 5. Options au planning ─────────────────────────────────────────────── */
section('5. Options dans la carte du planning');
const soin = await commerce.upsertProduct({
  title: 'Soin', slug: 'soin', kind: 'SERVICE', status: 'PUBLISHED', price: { amountCents: 5000, currency: 'EUR' }, durationMinutes: 60,
  options: [{ key: 'french', label: 'French', priceCents: 1000, extraMinutes: 15, description: 'Finition french', active: true }, { key: 'chrome', label: 'Chrome', priceCents: 0, active: true }],
});
const soinSale = await paidSale(bea._id, [{ productId: soin._id, productSnapshot: { kind: 'SERVICE', title: 'Soin' }, totalCents: 6000, optionsTotalCents: 1000, optionsSnapshot: [{ key: 'french', label: 'French', priceCents: 1000 }, { key: 'chrome', label: 'Chrome', priceCents: 0 }] }]);
const startsAt = new Date(Date.now() + 3 * 86400_000);
await CalendarEvent.create({ type: 'SERVICE_BOOKING', title: 'Soin', productId: soin._id, saleId: soinSale._id, lineId: String(soinSale.lines[0]._id), startsAt, endsAt: new Date(startsAt.getTime() + 75 * 60_000), status: 'SCHEDULED', customerSnapshot: { customerId: bea._id, name: 'Béa Durand' } });
const events = await calendar.listEvents({ from: new Date().toISOString(), to: new Date(Date.now() + 7 * 86400_000).toISOString() });
const ev = events.find((e) => e.title === 'Soin');
check('le rendez-vous porte ses options', ev?.options?.length === 2, JSON.stringify(ev?.options));
check('libellé, prix payé, minutes et description', ev?.options?.[0]?.label === 'French' && ev.options[0].priceCents === 1000 && ev.options[0].extraMinutes === 15 && ev.options[0].description === 'Finition french');
check('total des options', ev?.optionsTotalCents === 1000);

/* ── 6. Photos d'avis ───────────────────────────────────────────────────── */
section('6. Photos d’avis');
const jpeg = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#c08080' } }).jpeg().withMetadata({ exif: { IFD0: { Copyright: 'GPS-SECRET' } } }).toBuffer();
const photo = await storeReviewPhoto({ buffer: jpeg, mimetype: 'image/jpeg', originalname: 'p.jpg' }, { customerId: bea._id });
const written = path.join(config.paths.uploads, photo.url.replace('/uploads/', ''));
const meta = await sharp(await fs.readFile(written)).metadata();
check('photo ré-encodée en webp, 1600 px au plus', meta.format === 'webp' && meta.width <= 1600, `${meta.format} ${meta.width}`);
check('sans métadonnées de l’original', !meta.exif);
const notImage = await refusal(storeReviewPhoto({ buffer: Buffer.from('pas une image'), mimetype: 'image/png' }, { customerId: bea._id }));
check('un faux fichier image est refusé', Boolean(notImage));
check('une cliente joint sa photo', normalizeReviewPhotos([photo.url], { customerId: bea._id }).length === 1);
const stolen = await refusal(Promise.resolve().then(() => normalizeReviewPhotos([photo.url], { customerId: alice._id })));
check('pas celle d’une autre', codeOf(stolen) === 'REVIEW_PHOTO_FORBIDDEN', codeOf(stolen));
const four = [1, 2, 3, 4].map((i) => `/uploads/review-photos/m-0000000${i}-0000-4000-8000-000000000000.webp`);
check('4 photos → refusé', codeOf(await refusal(Promise.resolve().then(() => normalizeReviewPhotos(four, { manager: true })))) === 'REVIEW_PHOTO_TOO_MANY');
check('adresse extérieure → refusée', codeOf(await refusal(Promise.resolve().then(() => normalizeReviewPhotos(['https://evil.example/x.webp'], { manager: true })))) === 'REVIEW_PHOTO_INVALID');
const review = await commerce.createReview(bea._id, { saleId: soinSale._id, productId: soin._id, rating: 5, comment: 'Top', photos: [photo.url] });
check('avis de cliente avec photo', review.photos?.length === 1);
const manual = await commerce.createManualReview({ rating: 5, comment: 'Avis manuel', photos: four.slice(0, 3) });
check('avis manuel : 3 photos', manual.photos?.length === 3);
await commerce.moderateReview(String(review._id), { status: 'PUBLISHED' });
const published = await commerce.listPublishedReviews({});
check('les photos sortent avec l’avis publié', published.some((r) => (r.photos || []).length === 1));
const removed = await commerce.removeReviewPhoto(String(review._id), photo.url);
check('l’institut retire une photo', (removed.photos || []).length === 0);
await fs.rm(written, { force: true });

/* ── 7. Packs ───────────────────────────────────────────────────────────── */
section('7. Packs de formations');
const packBase = { title: 'Pack', slug: 'pack-duo', kind: 'TRAINING_PACK', price: { amountCents: 30000, currency: 'EUR' } };
check('pack publié à une seule formation → refusé', codeOf(await refusal(commerce.upsertProduct({ ...packBase, status: 'PUBLISHED', pack: { productIds: [String(trainingA._id)] } }))) === 'PACK_TOO_SMALL');
check('pack publié avec un brouillon → refusé', codeOf(await refusal(commerce.upsertProduct({ ...packBase, status: 'PUBLISHED', pack: { productIds: [String(trainingA._id), String(draft._id)] } }))) === 'PACK_ITEM_UNPUBLISHED');
check('pack avec un présentiel → refusé', codeOf(await refusal(commerce.upsertProduct({ ...packBase, status: 'DRAFT', pack: { productIds: [String(trainingA._id), String(onsite._id)] } }))) === 'PACK_KIND_INVALID');
check('un pack en brouillon peut être incomplet', (await refusal(commerce.upsertProduct({ ...packBase, slug: 'pack-brouillon', status: 'DRAFT', pack: { productIds: [String(trainingA._id)] } }))) === null);
const pack = await commerce.upsertProduct({ ...packBase, status: 'PUBLISHED', pack: { productIds: [String(trainingA._id), String(trainingB._id), String(trainingA._id)] } });
check('pack enregistré, doublons retirés', pack.pack.productIds.length === 2);
const packView = await commerce.getProductBySlug('pack-duo');
check('fiche : les 2 formations et leur valeur (350 €)', packView.pack.items.length === 2 && packView.pack.valueCents === 35000, JSON.stringify(packView.pack));
check('consentement d’accès immédiat exigé', (packView.consentRequirements || []).some((c) => c.key === 'DIGITAL_WITHDRAWAL_WAIVER'));
const packCart = await commerce.addCartItem(bea._id, { productId: pack._id, quantity: 3 });
const packLine = packCart.lines.find((l) => l.product.kind === 'TRAINING_PACK');
check('panier : quantité 1, contenu du pack dans la ligne', packLine?.quantity === 1 && packLine.product.pack.items.length === 2);
check('avant paiement : aucun accès', codeOf(await refusal(assertVideoAccess({ provider: 'STREAMABLE', videoId: 'bbb456uvw', customerId: bea._id }))) === 'TRAINING_NOT_OWNED');
const packSale = await paidSale(bea._id, [{ productId: pack._id, productSnapshot: packLine.product, totalCents: 30000 }]);
check('payé : la vidéo de B se lit par le pack', (await refusal(assertVideoAccess({ provider: 'STREAMABLE', videoId: 'bbb456uvw', customerId: bea._id }))) === null);
check('Alice (sans pack) ne lit pas B', codeOf(await refusal(assertVideoAccess({ provider: 'STREAMABLE', videoId: 'bbb456uvw', customerId: alice._id }))) === 'TRAINING_NOT_OWNED');
await commerce.upsertProduct({ ...packBase, id: String(pack._id), status: 'DRAFT', pack: { productIds: [String(trainingA._id)] } });
check('pack modifié après coup : l’accès acheté reste', (await refusal(assertVideoAccess({ provider: 'STREAMABLE', videoId: 'bbb456uvw', customerId: bea._id }))) === null);
const espaceB = await commerce.listCustomerFormations(bea._id);
const ids = espaceB.map((x) => x.productId).sort();
check('espace formation : A et B, une fois chacune', ids.length === 2 && ids.includes(String(trainingA._id)) && ids.includes(String(trainingB._id)), ids.join(','));
check('signalées « via le pack », avec le titre de la formation', espaceB.every((x) => x.viaPack?.title === 'Pack') && espaceB.some((x) => x.productSnapshot.title === 'Formation B'));
await paidSale(bea._id, [{ productId: trainingA._id, productSnapshot: { kind: 'DISTANCE_TRAINING', title: 'Formation A' }, totalCents: 20000 }]);
const espaceB2 = await commerce.listCustomerFormations(bea._id);
check('A achetée aussi en direct : l’achat direct prime', espaceB2.length === 2 && espaceB2.find((x) => x.productId === String(trainingA._id))?.viaPack === null);
const rule = { enabled: true, productKinds: ['DISTANCE_TRAINING'], basis: 'TTC', salesVatRate: 20 };
const commission = computeSaleCommission(packSale.toObject(), rule);
check('commission : un pack compte comme une formation en ligne', commission.lines?.[0]?.subject === true, JSON.stringify(commission.lines));
await CommerceProduct.updateOne({ _id: trainingB._id }, { $set: { status: 'DRAFT' } });
await CommerceProduct.updateOne({ _id: pack._id }, { $set: { status: 'PUBLISHED', 'pack.productIds': [trainingA._id, trainingB._id] } });
check('une formation du pack retirée : le pack ne se vend plus', codeOf(await refusal(commerce.addCartItem(alice._id, { productId: pack._id }))) === 'PACK_UNAVAILABLE');

console.log(`\n${pass} réussis, ${fail} échoués`);
await disconnectDatabase();
await mongod.stop();
await mongoose.disconnect().catch(() => {});
process.exit(fail ? 1 : 0);
