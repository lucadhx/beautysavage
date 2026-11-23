/**
 * JOURNÉES EXCEPTIONNELLES ET RENDEZ-VOUS UN JOUR BLOQUÉ.
 *
 *   1. la règle pure : une exception remplace la semaine type ce jour-là ;
 *   2. la validation : dates et plages illisibles refusées ;
 *   3. les créneaux en ligne : un samedi fermé ouvert à la main en propose,
 *      un mardi ouvert fermé à la main n'en propose plus, et « revenir aux
 *      horaires classiques » rend la règle d'origine ;
 *   4. enregistrer les horaires classiques n'efface pas une journée ouverte ;
 *   5. le Manager pose un rendez-vous un jour fermé, et sur un blocage
 *      seulement s'il le demande (jamais sur un autre rendez-vous).
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'day_overrides_test';
process.env.DB_PROD = 'day_overrides_prod';
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
const rejects = async (fn, pattern) => {
  try { await fn(); return false; } catch (err) { return pattern ? pattern.test(String(err?.message || '')) : true; }
};

const { regleEffective, normaliserException } = await import('../services/dayOverrides.js');
const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();
const calendar = await import('../services/calendar.service.js');
const { CalendarEvent } = await import('../models/CalendarEvent.model.js');

/* Semaine type : du mardi au vendredi, 9 h – 17 h ; samedi, dimanche, lundi fermés. */
const WEEK = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
  weekday,
  enabled: [2, 3, 4, 5].includes(weekday),
  ranges: [2, 3, 4, 5].includes(weekday) ? [{ start: '09:00', end: '17:00' }] : [],
}));
const SAMEDI = '2027-03-06';
const MARDI = '2027-03-09';
const slotsOf = (iso) => calendar.listAvailability({ from: `${iso}T00:00:00+01:00`, to: `${iso}T23:59:00+01:00`, durationMinutes: 60 });
const paris = (iso, hhmm) => new Date(`${iso}T${hhmm}:00+01:00`);

section('1. La règle du jour');
{
  const sched = { exceptions: [{ date: SAMEDI, closed: false, ranges: [{ start: '10:00', end: '14:00' }] }, { date: MARDI, closed: true, ranges: [] }] };
  const samedi = regleEffective(sched, 2027, 3, 6, WEEK[5]);
  check('samedi fermé, ouvert à la main : ouvert', samedi.enabled === true);
  check('… avec SES plages, pas celles de la semaine', samedi.ranges.length === 1 && samedi.ranges[0].start === '10:00');
  check('mardi ouvert, fermé à la main : fermé', regleEffective(sched, 2027, 3, 9, WEEK[1]).enabled === false);
  check('un autre jour garde la semaine type', regleEffective(sched, 2027, 3, 10, WEEK[2]) === WEEK[2]);
  check('sans exception du tout : la semaine type', regleEffective({}, 2027, 3, 6, WEEK[5]) === WEEK[5]);
}

section('2. Validation');
check('date illisible refusée', await rejects(() => normaliserException('6 mars', { closed: true }), /illisible/));
check('date inexistante refusée (30 février)', await rejects(() => normaliserException('2027-02-30', { closed: true }), /existe pas/));
check('ouvrir sans plage refusé', await rejects(() => normaliserException(SAMEDI, { closed: false, ranges: [] }), /au moins une plage/));
check('plage à l’envers refusée', await rejects(() => normaliserException(SAMEDI, { ranges: [{ start: '14:00', end: '10:00' }] }), /finit avant/));
check('plages qui se chevauchent refusées', await rejects(() => normaliserException(SAMEDI, { ranges: [{ start: '09:00', end: '12:00' }, { start: '11:00', end: '15:00' }] }), /chevauchent/));
check('heure mal écrite refusée', await rejects(() => normaliserException(SAMEDI, { ranges: [{ start: '9h', end: '12:00' }] }), /HH:MM/));
{
  const ok = normaliserException(SAMEDI, { ranges: [{ start: '14:00', end: '17:00' }, { start: '09:00', end: '12:00' }], reason: '  Fêtes  ' });
  check('plages remises dans l’ordre', ok.ranges[0].start === '09:00' && ok.ranges[1].start === '14:00');
  check('motif nettoyé', ok.reason === 'Fêtes');
  check('fermer ne garde aucune plage', normaliserException(SAMEDI, { closed: true, ranges: [{ start: '09:00', end: '12:00' }] }).ranges.length === 0);
}

section('3. Créneaux en ligne');
await calendar.saveSchedule({ weeklyHours: WEEK, timezone: 'Europe/Paris', slotStepMinutes: 15 });
check('samedi fermé : aucun créneau', (await slotsOf(SAMEDI)).length === 0);
check('mardi ouvert : des créneaux', (await slotsOf(MARDI)).length > 0);

await calendar.setDayException(SAMEDI, { closed: false, ranges: [{ start: '10:00', end: '13:00' }], reason: 'Samedi exceptionnel' });
let samedi = await slotsOf(SAMEDI);
check('samedi ouvert à la main : des créneaux', samedi.length > 0, `${samedi.length}`);
check('… le premier à 10 h', samedi[0] && new Date(samedi[0].startsAt).getTime() === paris(SAMEDI, '10:00').getTime());
check('… le dernier finit à 13 h au plus tard', samedi.every((s) => new Date(s.endsAt) <= paris(SAMEDI, '13:00')));

await calendar.setDayException(SAMEDI, { closed: false, ranges: [{ start: '14:00', end: '16:00' }] });
const sched = await calendar.getSchedule();
check('une seule exception par date (la nouvelle remplace)', sched.exceptions.filter((e) => e.date === SAMEDI).length === 1);
samedi = await slotsOf(SAMEDI);
check('… et ce sont ses nouvelles plages', samedi[0] && new Date(samedi[0].startsAt).getTime() === paris(SAMEDI, '14:00').getTime());

await calendar.setDayException(MARDI, { closed: true, reason: 'Congé' });
check('mardi fermé à la main : plus aucun créneau', (await slotsOf(MARDI)).length === 0);
check('le mercredi suivant n’est pas touché', (await slotsOf('2027-03-10')).length > 0);

section('4. Les horaires classiques ne l’effacent pas');
await calendar.saveSchedule({ weeklyHours: WEEK, timezone: 'Europe/Paris', slotStepMinutes: 15, exceptions: [] });
check('après « Horaires classiques » enregistrés, le samedi reste ouvert', (await slotsOf(SAMEDI)).length > 0);
check('… et le mardi reste fermé', (await slotsOf(MARDI)).length === 0);
await calendar.clearDayException(MARDI);
check('« revenir aux horaires classiques » rouvre le mardi', (await slotsOf(MARDI)).length > 0);
check('… et ne touche pas au samedi', (await slotsOf(SAMEDI)).length > 0);

section('5. Rendez-vous manuel un jour bloqué');
const LUNDI = '2027-03-08';
const rdvLundi = await calendar.createEvent({ type: 'SERVICE_BOOKING', title: 'Remplissage', startsAt: paris(LUNDI, '10:00').toISOString(), endsAt: paris(LUNDI, '11:00').toISOString() });
check('un rendez-vous manuel un jour FERMÉ est accepté', Boolean(rdvLundi?.id));
check('… et ce jour reste fermé en ligne', (await slotsOf(LUNDI)).length === 0);

const JEUDI = '2027-03-11';
await calendar.createEvent({ type: 'MANUAL_BLOCK', title: 'Journée bloquée', startsAt: paris(JEUDI, '08:00').toISOString(), endsAt: paris(JEUDI, '19:00').toISOString() });
check('sur un blocage, sans le demander : refusé', await rejects(() => calendar.createEvent({ type: 'SERVICE_BOOKING', title: 'Pose', startsAt: paris(JEUDI, '10:00').toISOString(), endsAt: paris(JEUDI, '11:00').toISOString() }), /chevauche/));
const surBlocage = await calendar.createEvent({ type: 'SERVICE_BOOKING', title: 'Pose', overBlocks: true, startsAt: paris(JEUDI, '10:00').toISOString(), endsAt: paris(JEUDI, '11:00').toISOString() });
check('sur un blocage, en le demandant : accepté', Boolean(surBlocage?.id));
check('… mais jamais sur un autre rendez-vous', await rejects(() => calendar.createEvent({ type: 'SERVICE_BOOKING', title: 'Autre', overBlocks: true, startsAt: paris(JEUDI, '10:30').toISOString(), endsAt: paris(JEUDI, '11:30').toISOString() }), /chevauche/));
check('un BLOCAGE ne passe jamais outre un rendez-vous', await rejects(() => calendar.createEvent({ type: 'MANUAL_BLOCK', title: 'Pause', overBlocks: true, startsAt: paris(JEUDI, '10:15').toISOString(), endsAt: paris(JEUDI, '10:45').toISOString() }), /chevauche/));
const moved = await calendar.updateEvent(rdvLundi.id, { overBlocks: true, startsAt: paris(JEUDI, '12:00').toISOString(), endsAt: paris(JEUDI, '13:00').toISOString() });
check('déplacer un rendez-vous sur le blocage, en le demandant : accepté', new Date(moved.startsAt).getTime() === paris(JEUDI, '12:00').getTime());
check('les deux rendez-vous sont au planning', (await CalendarEvent.countDocuments({ type: 'SERVICE_BOOKING', status: 'SCHEDULED' })) === 2);

await disconnectDatabase();
await mongod.stop();
console.log(`\n${pass} réussi(s), ${fail} échoué(s)`);
process.exit(fail ? 1 : 0);
