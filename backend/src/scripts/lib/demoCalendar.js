import { CalendarEvent } from '../../models/CalendarEvent.model.js';
import { CommerceProduct } from '../../models/CommerceProduct.model.js';
import { CommerceSale } from '../../models/CommerceSale.model.js';
import { Customer } from '../../models/Customer.model.js';

/**
 * LE PLANNING DE DÉMONSTRATION — sans un seul chevauchement.
 *
 * Le seed d'origine remplissait la semaine sans regarder ce qui s'y trouvait
 * déjà : la session présentielle (9 h 30 – 16 h 30) tombait sur quatre
 * rendez-vous, le rendez-vous « Client Mail » de 15 h sur deux autres, et des
 * « sessions de formation » étaient posées comme de simples rendez-vous au nom
 * d'une cliente — y compris pour des formations EN LIGNE, qui n'ont pas de
 * date. Le planning montrait donc exactement ce que l'application interdit.
 *
 * Désormais :
 *   - les formations présentielles ont de VRAIES sessions (sur leur fiche),
 *     avec de vraies inscrites (commandes payées) ;
 *   - les rendez-vous de démonstration ne sont posés que sur des créneaux
 *     libres — sessions et rendez-vous existants compris ;
 *   - le rendez-vous « Client Mail » est un samedi matin, hors du planning dense.
 *
 * Partagé par le seed complet et par la migration qui corrige une base déjà
 * seedée : une seule règle, deux points d'entrée.
 */

export const DEMO_PRESENTIEL_SLUG = 'formation-prothesie-ongulaire-presentiel';
export const DEMO_APPOINTMENT_KEY = 'client-mail-pose-gel-next-week';

export function nextMonday(from = new Date()) {
  const date = new Date(from);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() + (8 - day));
  date.setHours(0, 0, 0, 0);
  return date;
}

export function at(base, week, day, hour, minute = 0, durationMinutes = 60) {
  const startsAt = new Date(base);
  startsAt.setDate(base.getDate() + week * 7 + day);
  startsAt.setHours(hour, minute, 0, 0);
  return { startsAt, endsAt: new Date(startsAt.getTime() + durationMinutes * 60 * 1000) };
}

const overlaps = (a, b) => a.startsAt < b.endsAt && a.endsAt > b.startsAt;

/**
 * Tout ce qui occupe l'agenda, sous la forme que `assertNoOverlap` protège :
 * les événements stockés non annulés ET les sessions de formation non annulées.
 */
export async function busyIntervals({ excludeDemoPlanning = false } = {}) {
  const eventFilter = { status: { $ne: 'CANCELLED' } };
  if (excludeDemoPlanning) eventFilter['source.demoPlanning'] = { $ne: true };
  const [events, products] = await Promise.all([
    CalendarEvent.find(eventFilter).select('type title startsAt endsAt source').lean(),
    CommerceProduct.find({ kind: 'IN_PERSON_TRAINING', 'sessions.0': { $exists: true } }).select('title slug sessions').lean(),
  ]);
  const intervals = events.map((event) => ({
    id: `event:${event._id}`,
    label: `${event.type} ${event.title}`,
    demo: Boolean(event.source?.demoPlanning || event.source?.demoKey),
    startsAt: new Date(event.startsAt),
    endsAt: new Date(event.endsAt),
  }));
  for (const product of products) {
    for (const session of product.sessions || []) {
      if (session.status === 'CANCELLED' || !session.startsAt || !session.endsAt) continue;
      intervals.push({
        id: `session:${product._id}:${session._id}`,
        label: `SESSION ${product.title}`,
        demo: product.slug === DEMO_PRESENTIEL_SLUG,
        productSlug: product.slug,
        startsAt: new Date(session.startsAt),
        endsAt: new Date(session.endsAt),
      });
    }
  }
  return intervals.sort((a, b) => a.startsAt - b.startsAt);
}

/** Toutes les paires qui se chevauchent — la preuve, avant comme après correction. */
export async function findCalendarOverlaps() {
  const intervals = await busyIntervals();
  const pairs = [];
  for (let i = 0; i < intervals.length; i += 1) {
    for (let j = i + 1; j < intervals.length && intervals[j].startsAt < intervals[i].endsAt; j += 1) {
      if (overlaps(intervals[i], intervals[j])) pairs.push([intervals[i], intervals[j]]);
    }
  }
  return pairs;
}

async function demoParticipant(email, firstName, lastName) {
  let doc = await Customer.findOne({ email }).select('+password');
  if (!doc) {
    doc = new Customer({ email, password: '123pass!', firstName, lastName, phone: '0600000000', emailVerified: true });
    await doc.save();
  }
  return doc;
}

/**
 * Deux sessions présentielles, deux mercredis, et leurs inscrites RÉELLES :
 * chaque participante a une commande payée qui vise la session. C'est ce que
 * la fiche de session du planning affiche.
 */
export async function seedPresentielSessions(base = nextMonday()) {
  const product = await CommerceProduct.findOne({ slug: DEMO_PRESENTIEL_SLUG });
  if (!product) return null;
  /**
   * Les VRAIS rendez-vous (hors planning de démo, hors sessions de cette
   * fiche) décident des dates : un mercredi déjà pris décale la session d'une
   * semaine. Une démonstration ne doit jamais recouvrir une cliente réelle.
   */
  const occupied = (await busyIntervals({ excludeDemoPlanning: true }))
    .filter((interval) => interval.productSlug !== DEMO_PRESENTIEL_SLUG);
  const freeWednesday = (fromWeek) => {
    for (let week = fromWeek; week < fromWeek + 12; week += 1) {
      const dates = at(base, week, 2, 9, 30, 420);
      if (!occupied.some((interval) => overlaps(interval, dates))) {
        occupied.push({ ...dates, productSlug: DEMO_PRESENTIEL_SLUG });
        return dates;
      }
    }
    throw new Error('Aucun mercredi libre pour la session de demonstration.');
  };
  const plan = [
    { dates: freeWednesday(1), capacity: 6, participants: [['client@mail.com', 'Client', 'Demo'], ['avis.lina@beautysavage.test', 'Lina', 'Morel'], ['avis.manon@beautysavage.test', 'Manon', 'Rossi']] },
    { dates: freeWednesday(3), capacity: 6, participants: [['avis.jade@beautysavage.test', 'Jade', 'Martin']] },
  ];
  product.sessions = plan.map((item) => ({ ...item.dates, capacity: item.capacity, reservedCount: item.participants.length, status: 'ACTIVE' }));
  await product.save();

  await CommerceSale.deleteMany({ idempotencyKey: /^demo-formation-session-/ });
  for (let index = 0; index < plan.length; index += 1) {
    const session = product.sessions[index];
    for (const [email, firstName, lastName] of plan[index].participants) {
      const customer = await demoParticipant(email, firstName, lastName);
      const key = `demo-formation-session-${index + 1}-${email}`;
      await CommerceSale.create({
        saleNumber: `BS-DEMO-SESS${index + 1}-${firstName.toUpperCase()}`,
        idempotencyKey: key,
        customerId: customer._id,
        status: 'PAID',
        paymentStatus: 'PAID',
        currency: 'EUR',
        totalCents: product.price.amountCents,
        stripeAmountCents: product.price.amountCents,
        giftCardAmountCents: 0,
        finalizedAt: new Date(),
        lines: [{
          productId: product._id,
          productSnapshot: { id: String(product._id), title: product.title, kind: product.kind, slug: product.slug },
          quantity: 1,
          unitPriceCents: product.price.amountCents,
          totalCents: product.price.amountCents,
          sessionId: session._id,
        }],
        invoice: { number: `FAC-${key}`, issuedAt: new Date(), pdfUrl: '' },
      });
    }
  }
  return product;
}

/**
 * Fiches présentielles posées par des scripts (seed, import) : leurs sessions
 * ont été datées à la main, sans regarder les autres. Deux d'entre elles
 * tombaient le même lundi à la même heure.
 */
export const SEEDED_PRESENTIEL_SLUGS = Object.freeze([
  'formation-lash-artist-presentiel-demo',
  'formation-perfectionnement-presentiel',
]);

/**
 * DÉCALE les sessions seedées qui chevauchent une autre session ou un
 * rendez-vous hors planning dense : même horaire, jour ouvré suivant libre.
 * Une session qui a des inscrites est traitée en dernier recours seulement —
 * elle garde sa date si elle est libre, et ce sont les autres qui bougent.
 */
export async function relocateSeededSessions(slugs = SEEDED_PRESENTIEL_SLUGS) {
  const moved = [];
  const products = await CommerceProduct.find({ slug: { $in: slugs }, kind: 'IN_PERSON_TRAINING' });
  const withSales = new Set();
  for (const product of products) {
    for (const session of product.sessions) {
      if (await CommerceSale.exists({ 'lines.sessionId': session._id })) withSales.add(String(session._id));
    }
  }
  // Les sessions avec inscrites se placent d'abord : ce sont elles qui gardent leur date.
  const queue = products.flatMap((product) => product.sessions.map((session) => ({ product, session })))
    .filter(({ session }) => session.status !== 'CANCELLED' && session.startsAt && session.endsAt)
    .sort((a, b) => Number(withSales.has(String(b.session._id))) - Number(withSales.has(String(a.session._id))));
  const placed = (await busyIntervals({ excludeDemoPlanning: true }))
    .filter((interval) => !interval.id.startsWith('session:') || !slugs.includes(interval.productSlug));
  for (const { product, session } of queue) {
    let dates = { startsAt: new Date(session.startsAt), endsAt: new Date(session.endsAt) };
    const duration = dates.endsAt - dates.startsAt;
    let guard = 0;
    while (placed.some((interval) => overlaps(interval, dates)) && guard < 90) {
      const next = new Date(dates.startsAt);
      do next.setDate(next.getDate() + 1); while (next.getDay() === 0 || next.getDay() === 6);
      dates = { startsAt: next, endsAt: new Date(next.getTime() + duration) };
      guard += 1;
    }
    if (dates.startsAt.getTime() !== new Date(session.startsAt).getTime()) {
      moved.push({ title: product.title, from: session.startsAt, to: dates.startsAt });
      session.startsAt = dates.startsAt;
      session.endsAt = dates.endsAt;
      product.markModified('sessions');
      await product.save();
    }
    placed.push({ ...dates, id: `session:${product._id}:${session._id}`, productSlug: product.slug });
  }
  return moved;
}

/**
 * Les rendez-vous de démonstration nommés (`source.demoKey`) qui tombent sur
 * une session ou sur un autre rendez-vous nommé glissent d'une semaine, au même
 * jour et à la même heure, jusqu'à trouver la place.
 */
export async function relocateDemoKeyedEvents() {
  const moved = [];
  const events = await CalendarEvent.find({ 'source.demoKey': { $exists: true }, status: { $ne: 'CANCELLED' } }).sort({ startsAt: 1 });
  const placed = (await busyIntervals({ excludeDemoPlanning: true })).filter((interval) => !interval.demo || interval.id.startsWith('session:'));
  for (const event of events) {
    let dates = { startsAt: new Date(event.startsAt), endsAt: new Date(event.endsAt) };
    let guard = 0;
    while (placed.some((interval) => interval.id !== `event:${event._id}` && overlaps(interval, dates)) && guard < 12) {
      dates = { startsAt: new Date(dates.startsAt.getTime() + 7 * 86400_000), endsAt: new Date(dates.endsAt.getTime() + 7 * 86400_000) };
      guard += 1;
    }
    if (dates.startsAt.getTime() !== new Date(event.startsAt).getTime()) {
      moved.push({ title: event.title, from: event.startsAt, to: dates.startsAt });
      event.startsAt = dates.startsAt;
      event.endsAt = dates.endsAt;
      await event.save();
    }
    placed.push({ ...dates, id: `event:${event._id}` });
  }
  return moved;
}

/** Le rendez-vous « Client Mail » : un samedi matin, jour ouvert que le planning dense laisse libre. */
export async function placeDemoAppointment(client, base = nextMonday()) {
  const product = await CommerceProduct.findOne({ slug: 'pose-gel-signature' }).lean();
  if (!product || !client) return null;
  const occupied = (await busyIntervals({ excludeDemoPlanning: true }))
    .filter((interval) => !interval.id.startsWith('event:') || !interval.demo);
  let appointment = at(base, 0, 5, 10, 0, product.durationMinutes || 105);
  for (let week = 1; occupied.some((interval) => overlaps(interval, appointment)) && week < 12; week += 1) {
    appointment = at(base, week, 5, 10, 0, product.durationMinutes || 105);
  }
  return CalendarEvent.findOneAndUpdate({ 'source.demoKey': DEMO_APPOINTMENT_KEY }, {
    $set: {
      type: 'SERVICE_BOOKING',
      title: `${product.title} - ${client.firstName}`,
      productId: product._id,
      customerSnapshot: { customerId: String(client._id), name: `${client.firstName} ${client.lastName}`.trim(), email: client.email, phone: client.phone },
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      status: 'SCHEDULED',
      paymentSnapshot: { totalCents: product.price.amountCents, paidCents: 2000, depositCents: 2000, balanceDueCents: product.price.amountCents - 2000, currency: 'EUR' },
      notes: 'Reservation demo liee a BS-DEMO-CLIENT-RDV.',
      source: { demoKey: DEMO_APPOINTMENT_KEY },
    },
  }, { upsert: true, new: true });
}

/**
 * Le planning dense : huit semaines de rendez-vous PRESTATION en semaine, posés
 * uniquement là où rien n'occupe déjà l'agenda. Plus aucune « formation »
 * stockée comme un rendez-vous : les formations ont leurs sessions.
 */
export async function seedDenseCalendar(client, base = nextMonday()) {
  const services = await CommerceProduct.find({ kind: 'SERVICE', status: 'PUBLISHED' }).sort({ boostRank: 1, title: 1 }).limit(20);
  if (!client || services.length === 0) return { created: 0, skipped: 0 };
  await CalendarEvent.deleteMany({ 'source.demoPlanning': true });
  const busy = await busyIntervals();
  let cursor = 0;
  let created = 0;
  let skipped = 0;
  for (let week = 0; week < 8; week += 1) {
    for (let day = 0; day < 5; day += 1) {
      for (const slot of [{ hour: 9, duration: 120 }, { hour: 11, duration: 60 }, { hour: 14, duration: 120 }, { hour: 16, duration: 120 }]) {
        const dates = at(base, week, day, slot.hour, 0, slot.duration);
        if (busy.some((interval) => overlaps(interval, dates))) {
          skipped += 1;
          continue;
        }
        const item = services[cursor % services.length];
        cursor += 1;
        const totalCents = item.price?.amountCents || 0;
        const paidCents = Math.min(totalCents, 2000);
        await CalendarEvent.create({
          type: 'SERVICE_BOOKING',
          title: `${item.title} - ${client.firstName}`,
          productId: item._id,
          customerSnapshot: { customerId: String(client._id), name: `${client.firstName} ${client.lastName}`.trim(), email: client.email, phone: client.phone },
          startsAt: dates.startsAt,
          endsAt: dates.endsAt,
          status: 'SCHEDULED',
          paymentSnapshot: { totalCents, paidCents, depositCents: paidCents, balanceDueCents: Math.max(0, totalCents - paidCents), currency: 'EUR' },
          notes: 'Reservation de demonstration seedee pour remplir le planning hebdomadaire.',
          source: { demoPlanning: true, week, day, cursor },
        });
        busy.push({ ...dates, id: 'new', label: 'demo', demo: true });
        created += 1;
      }
    }
  }
  return { created, skipped };
}

/** Photos de démonstration RÉELLEMENT servies — les anciennes `/demo/livrables/*.jpg` n'existaient pas. */
const demoImage = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=80`;
export const DEMO_DELIVERABLE_IMAGES = Object.freeze({
  before: demoImage('photo-1516975080664-ed2fc6a32937'),
  after: demoImage('photo-1487412947147-5cebf100ffc2'),
  gallery1: demoImage('photo-1522337360788-8b13dee7a37e'),
  gallery2: demoImage('photo-1521590832167-7bcbfaa6381f'),
});
