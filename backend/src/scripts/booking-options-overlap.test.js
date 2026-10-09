/**
 * UNE CLIENTE NE SE CHEVAUCHE PLUS ELLE-MÊME — garde de réservation.
 *
 * ══ L'INCIDENT ═════════════════════════════════════════════════════════════
 *
 * Le 9 octobre 2026, une cliente a tenté cinq fois de payer une pédicure
 * (40 min, 14:00) et deux « Options pédicure » (fiche prestation de 15 min,
 * vendue à part faute de pouvoir donner une durée à une option). Elle avait
 * posé les options à 14:00, puis 14:15 et 14:30 : pendant sa propre pédicure.
 * Le panier avait tout accepté ; le paiement refusait tout, avec « il vient
 * d'être réservé ». L'institut a fini par réserver à la main, l'option à 14:45
 * — la grille de 15 min interdisait 14:40, fin réelle de la pédicure.
 *
 * ══ CE QUE CETTE SUITE VÉRIFIE ═════════════════════════════════════════════
 *
 *   1. une option peut porter des minutes : la durée réservée = prestation +
 *      options cochées, et les disponibilités cherchent cette durée totale ;
 *   2. le panier refuse, AU CHOIX DE L'HEURE, une ligne qui chevauche une autre
 *      ligne de la cliente, avec un message qui donne l'heure possible ;
 *   3. le calendrier d'une ligne du panier grise les heures des autres lignes ;
 *   4. la fin d'un rendez-vous devient une heure de départ (14:40, pas 14:45) ;
 *   5. un paiement en cours d'une autre personne est dit comme tel ;
 *   6. le paiement refuse un panier d'avant ce contrôle qui se chevauche ;
 *   7. deux écritures au planning ne se recouvrent jamais (verrou) ;
 *   8. le HTML servi aux robots déclare le vrai favicon, avec son empreinte ;
 *   9. plusieurs prestations à la suite : une heure, des segments collés,
 *      tout ou rien, déplacées d’un bloc, une seule confirmation.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'booking_options_test';
process.env.DB_PROD = 'booking_options_prod';
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

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();

const { CommerceProduct } = await import('../models/CommerceProduct.model.js');
const { Customer } = await import('../models/Customer.model.js');
const { Cart } = await import('../models/Cart.model.js');
const { CalendarEvent } = await import('../models/CalendarEvent.model.js');
const calendar = await import('../services/calendar.service.js');
const commerce = await import('../services/commerce.service.js');
const { bookingDurationMinutes } = await import('../services/bookingDuration.js');
const { withCalendarLock } = await import('../services/calendarLock.js');
const { pngToIco, iconVersion } = await import('../services/seo/siteIcon.service.js');
const { injectIntoTemplate } = await import('../services/seo/seo.service.js');

// Un mercredi à au moins une semaine : ouvert de 08:00 à 18:00, grille de 15 min.
const now = new Date();
const probe = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 8));
while (probe.getUTCDay() !== 3) probe.setUTCDate(probe.getUTCDate() + 1);
const [Y, M, D] = [probe.getUTCFullYear(), probe.getUTCMonth() + 1, probe.getUTCDate()];
const at = (hh, mm = 0) => calendar.zonedWallTime(Y, M, D, hh * 60 + mm, 'Europe/Paris');
const hhmm = (d) => new Date(d).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
const dayFrom = at(0).toISOString();
const dayTo = at(23, 59).toISOString();

await calendar.saveSchedule({
  timezone: 'Europe/Paris',
  slotStepMinutes: 15,
  weeklyHours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, enabled: true, ranges: [{ start: '08:00', end: '18:00' }] })),
});

const pedicure = await CommerceProduct.create({
  slug: 'pedicure-express', title: 'Dépose extérieur + pédicure express + semi permanent', kind: 'SERVICE', status: 'PUBLISHED',
  price: { amountCents: 4500 }, durationMinutes: 40,
  options: [
    { key: 'french', label: 'French', priceCents: 500, extraMinutes: 15 },
    { key: 'chrome', label: 'Chrome', priceCents: 500, extraMinutes: 15 },
    { key: 'retired', label: 'Ancienne option', priceCents: 0, extraMinutes: 60, active: false },
  ],
});
const optionFiche = await CommerceProduct.create({
  slug: 'options-pedicure', title: 'Options pédicure', kind: 'SERVICE', status: 'PUBLISHED', price: { amountCents: 500 }, durationMinutes: 15,
});
const customer = await Customer.create({ email: 'cliente@example.test', password: 'motdepasse-1', emailVerified: true });
const other = await Customer.create({ email: 'autre@example.test', password: 'motdepasse-2', emailVerified: true });

section('1. Les options allongent le rendez-vous');
check('40 min sans option', bookingDurationMinutes(pedicure, []) === 40);
check('40 + 15 avec French', bookingDurationMinutes(pedicure, ['french']) === 55);
check('40 + 15 + 15 avec French et Chrome', bookingDurationMinutes(pedicure, ['french', 'chrome']) === 70);
check('une option désactivée ne compte pas', bookingDurationMinutes(pedicure, ['retired']) === 40);
check('les clés arrivent aussi en liste « a,b » (paramètre d’URL)', bookingDurationMinutes(pedicure, 'french,chrome') === 70);
const slots55 = await calendar.listAvailability({ from: dayFrom, to: dayTo, productId: String(pedicure._id), optionKeys: 'french' });
check('les disponibilités cherchent la durée totale (55 min)', slots55.length > 0 && slots55.every((s) => s.durationMinutes === 55));
check('le dernier départ laisse tenir 55 min avant 18:00', hhmm(slots55.at(-1).startsAt) === '17:00', hhmm(slots55.at(-1)?.startsAt));

section('2. Le panier refuse une ligne qui chevauche une autre ligne de la cliente');
let cart = await commerce.addCartItem(customer._id, { productId: String(pedicure._id), optionKeys: ['french'], serviceBooking: { startsAt: at(14).toISOString() } });
const pediLine = cart.lines[0];
check('la pédicure + French est réservée de 14:00 à 14:55', hhmm(pediLine.bookingSnapshot.startsAt) === '14:00' && hhmm(pediLine.bookingSnapshot.endsAt) === '14:55');
const overlapErr = await refusal(commerce.addCartItem(customer._id, { productId: String(optionFiche._id), serviceBooking: { startsAt: at(14, 15).toISOString() } }));
check('l’option posée à 14:15 est refusée tout de suite', overlapErr?.details?.code === 'CART_OVERLAP', overlapErr?.message);
check('le message nomme la prestation voisine et l’heure possible', /pédicure express/.test(overlapErr?.message || '') && /14:55/.test(overlapErr?.message || ''), overlapErr?.message);
check('il ne prétend plus qu’une autre personne a pris l’heure', !/vient d.être réservé/.test(overlapErr?.message || ''));

section('3. Le calendrier d’une ligne du panier grise les autres lignes');
cart = await commerce.addCartItem(customer._id, { productId: String(optionFiche._id) });
const optionLine = cart.lines.find((l) => l.product.id === String(optionFiche._id));
const forOption = await calendar.listAvailability(
  { from: dayFrom, to: dayTo, productId: String(optionFiche._id), cartLineId: optionLine.id },
  { customerId: customer._id },
);
const starts = forOption.map((s) => hhmm(s.startsAt));
check('aucune heure proposée pendant la pédicure (14:00 → 14:55)', !starts.some((t) => t >= '13:46' && t < '14:55'), starts.filter((t) => t >= '13:30' && t < '15:00').join(' '));
check('14:55, fin de la pédicure, est proposée', starts.includes('14:55'));
cart = await commerce.setCartItemBooking(customer._id, optionLine.id, { serviceBooking: { startsAt: at(14, 55).toISOString() } });
check('l’option se pose à 14:55, sans trou', hhmm(cart.lines.find((l) => l.id === optionLine.id).bookingSnapshot.startsAt) === '14:55');

section('4. La fin d’un rendez-vous est une heure de départ');
await CalendarEvent.create({ type: 'SERVICE_BOOKING', title: 'Pédicure', startsAt: at(10), endsAt: at(10, 40), status: 'SCHEDULED' });
const after = (await calendar.listAvailability({ from: dayFrom, to: dayTo, productId: String(optionFiche._id) })).map((s) => hhmm(s.startsAt));
check('10:40 est proposée (hors grille de 15 min)', after.includes('10:40'), after.filter((t) => t >= '10:00' && t < '11:00').join(' '));
check('10:30 reste fermée (chevauche 10:00–10:40)', !after.includes('10:30'));
// « Ajouter juste après » cherche à partir de la fin même du rendez-vous.
const fromEnd = (await calendar.listAvailability({ from: at(10, 40).toISOString(), to: dayTo, productId: String(optionFiche._id) })).map((s) => hhmm(s.startsAt));
check('une recherche qui commence à 10:40 propose 10:40 en premier', fromEnd[0] === '10:40', fromEnd.slice(0, 3).join(' '));

section('5. Un paiement en cours d’une autre personne est dit comme tel');
await CalendarEvent.create({
  type: 'SERVICE_BOOKING', title: 'Retenue', startsAt: at(16), endsAt: at(16, 40), status: 'HELD',
  holdExpiresAt: new Date(Date.now() + 20 * 60_000), customerSnapshot: { customerId: String(other._id) },
});
const pending = await refusal(commerce.addCartItem(customer._id, { productId: String(pedicure._id), serviceBooking: { startsAt: at(16).toISOString() } }));
check('code SLOT_PENDING_PAYMENT', pending?.details?.code === 'SLOT_PENDING_PAYMENT', pending?.details?.code);
check('le message parle d’un paiement en cours et de son échéance', /paiement en cours/.test(pending?.message || '') && /au plus tard à/.test(pending?.message || ''), pending?.message);
await CalendarEvent.create({ type: 'MANUAL_BLOCK', title: 'Blocage', startsAt: at(17), endsAt: at(17, 30), status: 'SCHEDULED' });
const taken = await refusal(commerce.addCartItem(customer._id, { productId: String(optionFiche._id), serviceBooking: { startsAt: at(17).toISOString() } }));
check('un vrai rendez-vous reste « vient d’être réservé » (SLOT_TAKEN)', taken?.details?.code === 'SLOT_TAKEN', taken?.details?.code);

section('6. Le paiement refuse un panier d’avant ce contrôle qui se chevauche');
await Cart.updateOne({ customerId: customer._id }, { $set: { 'lines.$[l].bookingSnapshot': { startsAt: at(14, 15), endsAt: at(14, 30), durationMinutes: 15 } } }, { arrayFilters: [{ 'l._id': optionLine.id }] });
const atCheckout = await refusal(commerce.createCheckout(customer._id, {}));
check('refus CART_OVERLAP avant toute retenue', atCheckout?.details?.code === 'CART_OVERLAP', atCheckout?.details?.code || atCheckout?.message);
check('aucune retenue posée au planning', (await CalendarEvent.countDocuments({ status: 'HELD', 'customerSnapshot.customerId': String(customer._id) })) === 0);
// La fiche « Options pédicure » dépubliée : la ligne restée au panier ne se paie plus.
await CommerceProduct.updateOne({ _id: optionFiche._id }, { $set: { status: 'DISABLED' } });
const withdrawn = await refusal(commerce.createCheckout(customer._id, {}));
check('un article retiré du catalogue ne se paie plus', withdrawn?.details?.code === 'PRODUCT_WITHDRAWN', withdrawn?.details?.code);

section('7. Deux écritures au planning ne se recouvrent jamais');
const spans = [];
await Promise.all([1, 2, 3].map((n) => withCalendarLock(async () => {
  const start = Date.now();
  await new Promise((r) => { setTimeout(r, 60); });
  spans.push([start, Date.now(), n]);
})));
spans.sort((a, b) => a[0] - b[0]);
check('trois écritures simultanées passent l’une après l’autre', spans.length === 3 && spans.every((s, i) => i === 0 || s[0] >= spans[i - 1][1]));

section('8. Le HTML servi aux robots déclare le vrai favicon');
const data = { company: { logos: { favicon: '/uploads/abc-123456789abc.png' } } };
const version = iconVersion(data);
check('une empreinte est tirée du fichier choisi', /^[0-9a-f]{10}$/.test(version));
check('changer de fichier change l’empreinte', iconVersion({ company: { logos: { favicon: '/uploads/autre.png' } } }) !== version);
const shell = '<!doctype html><html><head><title>x</title><link rel="icon" href="data:," /></head><body><div id="root"></div></body></html>';
const route = { pathname: '/', title: 'T', description: 'D', robots: 'index', canonical: 'https://x.test/', themeColor: '#fff', siteName: 'S', ogType: 'website', image: '', imageAlt: '', preload: [], jsonLd: [], body: '', iconVersion: version };
const html = injectIntoTemplate(shell, route);
check('l’icône vide `data:,` a disparu', !html.includes('data:,'));
check('/favicon.ico est déclaré avec son empreinte', html.includes(`href="/favicon.ico?v=${version}"`));
check('icône Apple et manifeste déclarés', html.includes('apple-touch-icon.png') && html.includes('site.webmanifest'));
check('sans favicon ni logo, la coquille reste telle quelle', injectIntoTemplate(shell, { ...route, iconVersion: '' }).includes('data:,'));
const ico = pngToIco(Buffer.from([0x89, 0x50, 0x4e, 0x47]), 48);
check('ICO : en-tête « icône, une image, 48 px », PNG embarqué', ico.readUInt16LE(2) === 1 && ico.readUInt16LE(4) === 1 && ico[6] === 48 && ico.readUInt32LE(18) === 22 && ico[22] === 0x89);

section('9. Plusieurs prestations à la suite (enchaînement)');
const { addCartSequence, setCartGroupBooking } = commerce;
const { emitAppointmentsBooked } = await import('../services/commerceCustomer.service.js');
const { DomainEvent } = await import('../models/DomainEvent.model.js');
const depose = await CommerceProduct.create({ slug: 'depose-shampoing', title: 'Dépose + shampoing', kind: 'SERVICE', status: 'PUBLISHED', price: { amountCents: 1500 }, durationMinutes: 30 });
const pose = await CommerceProduct.create({ slug: 'volume-russe', title: 'Volume russe intense', kind: 'SERVICE', status: 'PUBLISHED', price: { amountCents: 8100 }, durationMinutes: 150 });
const seqParam = `${depose._id},${pedicure._id}:french`;
// Un jour neuf, sans les rendez-vous des sections précédentes.
const at2 = (hh, mm = 0) => new Date(at(hh, mm).getTime() + 86400_000);
const day2From = new Date(at(0).getTime() + 86400_000).toISOString();
const day2To = new Date(at(23, 59).getTime() + 86400_000).toISOString();
const seqSlots = await calendar.listAvailability({ from: day2From, to: day2To, sequence: seqParam });
const first = seqSlots[0];
check('les créneaux cherchent la durée totale (30 + 55 = 85 min)', first?.durationMinutes === 85, String(first?.durationMinutes));
check('chaque créneau porte ses deux segments', first?.segments?.length === 2);
check('le second segment commence à la fin du premier, sans battement', first.segments[0].endsAt === first.segments[1].startsAt);
check('le dernier départ laisse tenir 85 min avant 18:00', hhmm(seqSlots.at(-1).startsAt) === '16:35' || hhmm(seqSlots.at(-1).startsAt) <= '16:35', hhmm(seqSlots.at(-1).startsAt));
const sequencer = await Customer.create({ email: 'sequence@example.test', password: 'motdepasse-3', emailVerified: true });
cart = await addCartSequence(sequencer._id, { items: [{ productId: String(depose._id) }, { productId: String(pedicure._id), optionKeys: ['french'] }], startsAt: at2(9).toISOString() });
const [l1, l2] = cart.lines;
check('deux lignes ajoutées au panier', cart.lines.length === 2);
check('dépose 09:00 → 09:30, pédicure + French 09:30 → 10:25', hhmm(l1.bookingSnapshot.startsAt) === '09:00' && hhmm(l1.bookingSnapshot.endsAt) === '09:30' && hhmm(l2.bookingSnapshot.startsAt) === '09:30' && hhmm(l2.bookingSnapshot.endsAt) === '10:25');
check('les deux lignes portent le même enchaînement (1/2, 2/2)', l1.bookingSnapshot.groupId && l1.bookingSnapshot.groupId === l2.bookingSnapshot.groupId && l1.bookingSnapshot.groupIndex === 0 && l2.bookingSnapshot.groupIndex === 1 && l2.bookingSnapshot.groupSize === 2);
check('la French est bien sur la ligne pédicure', l2.optionKeys.includes('french') && l2.unitPriceCents === 5000);
// Un rendez-vous existant tombe sur le SECOND segment seulement.
await CalendarEvent.create({ type: 'SERVICE_BOOKING', title: 'Autre cliente', startsAt: at2(14), endsAt: at2(14, 30), status: 'SCHEDULED' });
const seqRefused = await refusal(addCartSequence(other._id, { items: [{ productId: String(depose._id) }, { productId: String(pose._id) }], startsAt: at2(13, 30).toISOString() }));
check('un segment en conflit fait refuser tout l’enchaînement', seqRefused?.details?.code === 'SLOT_TAKEN', seqRefused?.details?.code);
check('rien n’a été ajouté au panier de cette cliente', ((await Cart.findOne({ customerId: other._id }).lean())?.lines || []).length === 0);
const tooLong = await refusal(addCartSequence(other._id, { items: [1, 2, 3, 4, 5].map(() => ({ productId: String(depose._id) })), startsAt: at2(9).toISOString() }));
check('au plus 4 prestations à la suite', tooLong?.details?.code === 'SEQUENCE_TOO_LONG');
// Déplacer d'un bloc : les deux suivent, et l'enchaînement ne se bloque pas lui-même.
const groupSlots = (await calendar.listAvailability({ from: day2From, to: day2To, sequence: seqParam, cartGroupId: l1.bookingSnapshot.groupId }, { customerId: sequencer._id })).map((x) => hhmm(x.startsAt));
check('le calendrier de l’enchaînement repropose sa propre heure (09:00)', groupSlots.includes('09:00'));
cart = await setCartGroupBooking(sequencer._id, l1.bookingSnapshot.groupId, { startsAt: at2(10).toISOString() });
const moved = cart.lines.map((l) => `${hhmm(l.bookingSnapshot.startsAt)}-${hhmm(l.bookingSnapshot.endsAt)}`).join(' ');
check('déplacé à 10:00, il reste collé : 10:00-10:30 10:30-11:25', moved === '10:00-10:30 10:30-11:25', moved);
const outside = await refusal(commerce.addCartItem(sequencer._id, { productId: String(optionFiche._id), serviceBooking: { startsAt: at2(10, 15).toISOString() } }).catch(async (err) => {
  // La fiche option a été dépubliée en section 6 : on la republie pour ce contrôle.
  if (err?.message !== 'Article indisponible') throw err;
  await CommerceProduct.updateOne({ _id: optionFiche._id }, { $set: { status: 'PUBLISHED' } });
  return commerce.addCartItem(sequencer._id, { productId: String(optionFiche._id), serviceBooking: { startsAt: at2(10, 15).toISOString() } });
}));
check('une autre prestation posée DANS l’enchaînement est refusée (CART_OVERLAP)', outside?.details?.code === 'CART_OVERLAP', outside?.details?.code);
// Une confirmation pour tout l'enchaînement.
const e1 = { _id: new (await import('mongoose')).default.Types.ObjectId(), type: 'SERVICE_BOOKING', title: 'Dépose + shampoing', startsAt: at2(10), endsAt: at2(10, 30), customerSnapshot: { customerId: String(sequencer._id) }, paymentSnapshot: { paidCents: 1500, balanceDueCents: 0 } };
const e2 = { ...e1, _id: new (await import('mongoose')).default.Types.ObjectId(), title: 'Pédicure', startsAt: at2(10, 30), endsAt: at2(11, 25), paymentSnapshot: { paidCents: 2000, balanceDueCents: 3000 } };
await emitAppointmentsBooked([e2, e1], { saleNumber: 'BS-TEST', origin: 'CHECKOUT' });
const mails = await DomainEvent.find({ type: 'appointment.booked', 'payloadSafe.customerId': String(sequencer._id) }).lean();
check('un seul e-mail « rendez-vous confirmé » pour les deux prestations', mails.length === 1, String(mails.length));
check('il dit « Dépose + shampoing, puis Pédicure », de 10:00 à 11:25', mails[0]?.payloadSafe?.appointmentTitle === 'Dépose + shampoing, puis Pédicure' && hhmm(mails[0].payloadSafe.appointmentStart) === '10:00' && hhmm(mails[0].payloadSafe.appointmentEnd) === '11:25', JSON.stringify(mails[0]?.payloadSafe || {}).slice(0, 200));
check('montants additionnés (35 € payés, 30 € sur place)', mails[0]?.payloadSafe?.paidAmount === 3500 && mails[0]?.payloadSafe?.balanceDueAmount === 3000);

await disconnectDatabase();
await mongod.stop();
console.log(`\n${pass} réussi(s), ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
