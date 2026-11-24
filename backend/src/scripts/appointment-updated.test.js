/**
 * RENDEZ-VOUS MODIFIÉ AU MANAGER — la cliente est prévenue, les rappels suivent.
 *
 * Base en mémoire. Vérifie : quand l'e-mail part (date, heure, prestation) et
 * quand il ne part pas (note, montant, case décochée, passé, blocage, annulé) ;
 * le contenu (seul ce qui change est affiché) ; la garde d'envoi (modifié une
 * seconde fois = seul le dernier e-mail part) ; le recalage des rappels.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'rdv_modifie_test';
process.env.DB_PROD = 'rdv_modifie_prod';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.INTEGRATED_API_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.NGROK_API_URL = 'http://127.0.0.1:1';

let pass = 0;
let fail = 0;
const check = (n, c, detail = '') => {
  if (c) { pass += 1; console.log(`  ✓ ${n}`); } else { fail += 1; console.error(`  ✗ ${n}${detail ? ` — ${detail}` : ''}`); }
};

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();
const { CalendarEvent } = await import('../models/CalendarEvent.model.js');
const { CommerceProduct } = await import('../models/CommerceProduct.model.js');
const { Customer } = await import('../models/Customer.model.js');
const { DomainEvent } = await import('../models/DomainEvent.model.js');
const calendar = await import('../services/calendar.service.js');
const reminders = await import('../services/appointmentReminder.service.js');
const { resolveAppointmentUpdatedClient } = await import('../services/email/commerceVariableResolver.js');
const { INSTITUTE_TEMPLATES } = await import('../services/email/instituteTemplates.js').catch(() => ({}));
const actions = await import('../utils/domainEventActionRegistry.js');

const cliente = await Customer.create({ email: 'rdv-modifie@example.test', password: 'motdepasse-1', emailVerified: true, firstName: 'Léa', lastName: 'Martin', phone: '0612345678' });
const pose = await CommerceProduct.create({ slug: 'pose-gel', title: 'Pose gel', kind: 'SERVICE', status: 'PUBLISHED', price: { amountCents: 4500 }, durationMinutes: 60 });
const soin = await CommerceProduct.create({ slug: 'soin-mains', title: 'Soin des mains', kind: 'SERVICE', status: 'PUBLISHED', price: { amountCents: 3000 }, durationMinutes: 60 });
const DAY = 86_400_000;
const at = (days, hour = 9) => { const d = new Date(Date.now() + days * DAY); d.setUTCHours(hour, 0, 0, 0); return d; };
const rdv = (extra = {}) => CalendarEvent.create({
  type: 'SERVICE_BOOKING', status: 'SCHEDULED', title: 'Pose gel', productId: pose._id,
  startsAt: at(5), endsAt: new Date(at(5).getTime() + 3_600_000),
  customerSnapshot: { customerId: String(cliente._id), email: cliente.email, name: 'Léa Martin' },
  ...extra,
});
const emis = async (id) => (await DomainEvent.find({ type: 'appointment.updated', entityId: String(id) }).sort({ createdAt: 1 }).lean());

console.log('\n1. Quand la cliente est prévenue');
{
  const e = await rdv();
  const r = await calendar.updateEvent(String(e._id), { startsAt: at(6).toISOString(), endsAt: new Date(at(6).getTime() + 3_600_000).toISOString() });
  const evts = await emis(e._id);
  check('déplacé : e-mail émis et signalé au Manager', r.customerNotified === true && evts.length === 1, JSON.stringify({ n: r.customerNotified, evts: evts.length }));
  const p = evts[0]?.payloadSafe || {};
  check('… avec l’ancienne et la nouvelle date', p.dateChanged === true && p.previousStart === at(5).toISOString() && p.appointmentStart === at(6).toISOString(), JSON.stringify(p));
  check('… et la date du déplacement retenue pour les rappels', Boolean((await CalendarEvent.findById(e._id)).rescheduledAt));

  const r2 = await calendar.updateEvent(String(e._id), { productId: String(soin._id), title: 'Soin des mains' });
  const p2 = (await emis(e._id))[1]?.payloadSafe || {};
  check('prestation changée : e-mail émis', r2.customerNotified === true && p2.serviceChanged === true && p2.dateChanged === false && p2.previousTitle === 'Pose gel', JSON.stringify(p2));

  const r3 = await calendar.updateEvent(String(e._id), { endsAt: new Date(at(6).getTime() + 5_400_000).toISOString() });
  check('heure de fin changée : e-mail émis', r3.customerNotified === true && (await emis(e._id)).length === 3);
}

console.log('\n2. Quand elle ne l’est pas');
{
  const e = await rdv();
  const r = await calendar.updateEvent(String(e._id), { notes: 'Préfère le vernis nude', paymentSnapshot: { totalCents: 4500, paidCents: 1000 } });
  check('note ou montant seulement : pas d’e-mail', r.customerNotified === false && (await emis(e._id)).length === 0);
  const r2 = await calendar.updateEvent(String(e._id), { startsAt: at(7).toISOString(), endsAt: new Date(at(7).getTime() + 3_600_000).toISOString(), notifyCustomer: false });
  check('case « Prévenir la cliente » décochée : pas d’e-mail', r2.customerNotified === false && (await emis(e._id)).length === 0);
  check('… mais les rappels se recalent quand même', Boolean((await CalendarEvent.findById(e._id)).rescheduledAt));

  const passe = await rdv({ startsAt: at(-3), endsAt: new Date(at(-3).getTime() + 3_600_000) });
  const r3 = await calendar.updateEvent(String(passe._id), { startsAt: at(-2).toISOString(), endsAt: new Date(at(-2).getTime() + 3_600_000).toISOString() });
  check('rendez-vous passé corrigé : pas d’e-mail', r3.customerNotified === false);

  const bloc = await CalendarEvent.create({ type: 'MANUAL_BLOCK', status: 'SCHEDULED', title: 'Pause', startsAt: at(9), endsAt: new Date(at(9).getTime() + 3_600_000) });
  const r4 = await calendar.updateEvent(String(bloc._id), { startsAt: at(10).toISOString(), endsAt: new Date(at(10).getTime() + 3_600_000).toISOString() });
  check('blocage de l’institut déplacé : pas d’e-mail', r4.customerNotified === false);

  const sansCompte = await rdv({ customerSnapshot: { name: 'Passage', email: '' } });
  const r5 = await calendar.updateEvent(String(sansCompte._id), { startsAt: at(11).toISOString(), endsAt: new Date(at(11).getTime() + 3_600_000).toISOString() });
  check('rendez-vous sans cliente reliée : pas d’e-mail', r5.customerNotified === false);
}

console.log('\n3. Contenu de l’e-mail');
{
  const base = { calendarEventId: 'x', customerId: String(cliente._id), appointmentTitle: 'Pose gel', previousTitle: 'Pose gel', appointmentStart: at(6).toISOString(), appointmentEnd: at(6).toISOString(), previousStart: at(5).toISOString(), updatedAt: new Date().toISOString() };
  const v1 = await resolveAppointmentUpdatedClient({ event: { payloadSafe: { ...base, dateChanged: true, serviceChanged: false } } });
  check('déplacé : objet « a été déplacé », ancienne date affichée, pas d’ancienne prestation', /a été déplacé/.test(v1.subjectLine) && v1.previousStart === base.previousStart && v1.previousServiceName === '' && v1.clientFirstName === 'Léa', JSON.stringify(v1));
  const v2 = await resolveAppointmentUpdatedClient({ event: { payloadSafe: { ...base, appointmentTitle: 'Soin des mains', dateChanged: false, serviceChanged: true } } });
  check('prestation changée : objet « a été modifié », ancienne prestation, pas d’ancienne date', /a été modifié/.test(v2.subjectLine) && v2.previousServiceName === 'Pose gel' && v2.previousStart === '', JSON.stringify(v2));
  const action = (actions.DOMAIN_EVENT_ACTIONS || actions.default || {})['appointment.updated'] || Object.values(actions).find((x) => x && typeof x === 'object' && x['appointment.updated'])?.['appointment.updated'];
  check('action d’envoi déclarée vers le modèle APPOINTMENT_UPDATED_CLIENT', JSON.stringify(action || '').includes('APPOINTMENT_UPDATED_CLIENT'));
  void INSTITUTE_TEMPLATES;
}

console.log('\n4. Garde d’envoi : seul le dernier état part');
{
  const e = await rdv({ startsAt: at(12), endsAt: new Date(at(12).getTime() + 3_600_000) });
  await calendar.updateEvent(String(e._id), { startsAt: at(13).toISOString(), endsAt: new Date(at(13).getTime() + 3_600_000).toISOString() });
  const [premier] = await emis(e._id);
  check('e-mail encore juste : il part', (await reminders.appointmentUpdateStillRelevant(premier)).relevant === true);
  await calendar.updateEvent(String(e._id), { startsAt: at(14).toISOString(), endsAt: new Date(at(14).getTime() + 3_600_000).toISOString() });
  check('re-déplacé avant l’envoi : le premier e-mail ne part plus', (await reminders.appointmentUpdateStillRelevant(premier)).relevant === false);
  await calendar.cancelEvent(String(e._id), { reason: 'Test' });
  const [, second] = await emis(e._id);
  check('annulé avant l’envoi : l’e-mail de modification ne part plus', (await reminders.appointmentUpdateStillRelevant(second)).relevant === false);
}

console.log('\n5. Rappels recalés sur la nouvelle date');
{
  const cfg = { enabled: true, reminders: [{ value: 24, unit: 'HOURS' }, { value: 2, unit: 'HOURS' }] };
  const now = new Date();
  const created = new Date(now.getTime() - 10 * DAY);
  // Avancé à dans 20 h : le « 24 h avant » est déjà dépassé — il ne part pas en rafale.
  const moved = { startsAt: new Date(now.getTime() + 20 * 3_600_000), createdAt: created, rescheduledAt: new Date(now.getTime() - 60_000) };
  const due = reminders.dueReminders({ startsAt: moved.startsAt, bookedAt: reminders.reminderBookedAt(moved) }, cfg, now);
  check('rendez-vous avancé : pas de rappel « 24 h » tiré dans la foulée', due.length === 0, JSON.stringify(due));
  const sansDeplacement = { startsAt: moved.startsAt, createdAt: created };
  check('jamais déplacé : rien ne change (24 h dû)', reminders.dueReminders({ startsAt: sansDeplacement.startsAt, bookedAt: reminders.reminderBookedAt(sansDeplacement) }, cfg, now).length === 1);
  check('le point de départ est le plus récent des deux', reminders.reminderBookedAt(moved).getTime() === moved.rescheduledAt.getTime());
  const plusTard = { startsAt: new Date(now.getTime() + 1.5 * 3_600_000), createdAt: created, rescheduledAt: new Date(now.getTime() - 3 * DAY) };
  check('déplacé il y a 3 jours : le rappel « 2 h » part normalement', reminders.dueReminders({ startsAt: plusTard.startsAt, bookedAt: reminders.reminderBookedAt(plusTard) }, cfg, now).length >= 1);
}

await disconnectDatabase();
await mongod.stop();
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail ? 1 : 0);
