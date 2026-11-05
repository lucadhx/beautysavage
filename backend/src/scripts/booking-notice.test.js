// DÉLAI MINIMUM DE RÉSERVATION — la règle (sans base), et sa présence sur chaque parcours client.
import fs from 'node:fs';
process.env.ENV = process.env.ENV || 'TEST';
const src = (rel) => new URL(`../${rel}`, import.meta.url);
const { minBookingHours, bookableFrom, sequenceBookableFrom, assertBookingNotice, DEFAULT_MIN_BOOKING_HOURS } = await import(src('services/bookingNotice.js').href);

let ok = 0; let ko = 0;
const check = (n, c) => { c ? ok++ : ko++; console.log(`${c ? '✓' : '✗'} ${n}`); };
const code = (fn) => { try { fn(); return null; } catch (e) { return e.details?.code || e.message; } };

const now = new Date('2026-11-05T12:30:00Z');
const h = (n) => new Date(now.getTime() + n * 3_600_000);
const three = { title: 'Korean lash lift', bookingRules: { minBookingHours: 3 } };

check('réglage lu sur la fiche', minBookingHours(three) === 3);
check('0 = jusqu’à la dernière minute', minBookingHours({ bookingRules: { minBookingHours: 0 } }) === 0);
check('fiche sans valeur : le défaut affiché par le Manager', minBookingHours({}) === DEFAULT_MIN_BOOKING_HOURS);
check('valeur absurde : le défaut, jamais « sans limite »', minBookingHours({ bookingRules: { minBookingHours: 'abc' } }) === DEFAULT_MIN_BOOKING_HOURS && minBookingHours({ bookingRules: { minBookingHours: -2 } }) === DEFAULT_MIN_BOOKING_HOURS);
check('premier instant réservable = maintenant + délai', bookableFrom(three, now).getTime() === h(3).getTime());

// L'incident : réservé à 13:30 (Paris) pour 15:00, soit 1 h 30 avant, avec un délai de 3 h.
check('incident : 1 h 30 avant, délai 3 h → refusé', code(() => assertBookingNotice(three, h(1.5), now)) === 'BOOKING_TOO_LATE');
check('juste sous le délai → refusé', code(() => assertBookingNotice(three, new Date(h(3).getTime() - 60_000), now)) === 'BOOKING_TOO_LATE');
check('pile au délai → accepté', code(() => assertBookingNotice(three, h(3), now)) === null);
check('délai 0, dans 5 min → accepté', code(() => assertBookingNotice({ bookingRules: { minBookingHours: 0 } }, h(0.1), now)) === null);
check('délai 0, horaire passé → refusé', code(() => assertBookingNotice({ bookingRules: { minBookingHours: 0 } }, h(-1), now)) === 'BOOKING_TOO_LATE');
let message = '';
try { assertBookingNotice(three, h(1), now, { lineId: 'L1' }); } catch (e) { message = `${e.message}|${e.details?.lineId}|${e.statusCode}`; }
check('le message nomme la prestation et le délai ; la ligne est transmise au panier', message.includes('Korean lash lift') && message.includes('3 heures') && message.includes('|L1|409'));

// Enchaînement : chaque prestation respecte son délai à sa propre heure.
const seq = [{ product: { bookingRules: { minBookingHours: 1 } }, durationMinutes: 60 }, { product: { bookingRules: { minBookingHours: 5 } }, durationMinutes: 30 }];
check('enchaînement : la 2e (délai 5 h, 1 h plus tard) impose un départ à +4 h', sequenceBookableFrom(seq, now).getTime() === h(4).getTime());
check('enchaînement : jamais avant maintenant', sequenceBookableFrom([{ product: { bookingRules: { minBookingHours: 0 } }, durationMinutes: 60 }], now).getTime() === now.getTime());

// La règle reste branchée sur chaque parcours — c'est son absence qui a causé l'incident.
const commerce = fs.readFileSync(src('services/commerce.service.js'), 'utf8');
const calendar = fs.readFileSync(src('services/calendar.service.js'), 'utf8');
const routes = fs.readFileSync(src('routes/commerce.routes.js'), 'utf8');
const snapshot = commerce.slice(commerce.indexOf('async function serviceBookingSnapshot'), commerce.indexOf('CHOISIR (OU CHANGER) LE CRÉNEAU'));
check('panier, achat rapide, changement d’heure et enchaînement : contrôlés', snapshot.includes('assertBookingNotice(product, startsAt)'));
const checkout = commerce.slice(commerce.indexOf('async function checkoutHydratedLines'), commerce.indexOf('const accepted = new Set'));
check('paiement : le délai est revérifié', checkout.includes('assertBookingNotice(line.product'));
check('horaires proposés : filtrés', calendar.includes('earliest && startsAt < earliest'));
check('route publique : la règle est activée', /publicCommerceRoutes\.get\('\/availability'[^\n]*enforceNotice: true/.test(routes));

console.log(`${ok} réussis, ${ko} échoués`);
process.exit(ko ? 1 : 0);
