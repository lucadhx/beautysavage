import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { Company } from '../models/Company.model.js';
import { Theme } from '../models/Theme.model.js';
import { Customer } from '../models/Customer.model.js';
import { CommerceProduct } from '../models/CommerceProduct.model.js';
import { CommerceSale } from '../models/CommerceSale.model.js';
import { CommerceCommission } from '../models/CommerceCommission.model.js';
import { Review } from '../models/Review.model.js';
import { TrainingSubmission } from '../models/TrainingSubmission.model.js';
import { CalendarEvent } from '../models/CalendarEvent.model.js';
import { logger } from '../utils/logger.js';

const STREAMABLE_URL = 'https://streamable.com/eff6ci';
const STREAMABLE_SHORTCODE = 'eff6ci';
const VIDEO_COVER_URL = '/training-video-cover.png';
const cover = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1200&q=85`;

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function minutes(value) {
  const text = String(value || '').trim().toLowerCase();
  const h = Number(text.match(/(\d+)\s*h/)?.[1] || 0);
  const m = Number(text.match(/(\d+)\s*min/)?.[1] || 0);
  return h * 60 + m;
}

function nextWeek(dayOffset, hour, minute = 0, durationMinutes = 90) {
  const startsAt = new Date();
  startsAt.setDate(startsAt.getDate() + dayOffset);
  startsAt.setHours(hour, minute, 0, 0);
  return { startsAt, endsAt: new Date(startsAt.getTime() + durationMinutes * 60 * 1000) };
}

async function upsertCustomer(email, firstName, lastName, extra = {}) {
  let doc = await Customer.findOne({ email }).select('+password');
  if (!doc) doc = new Customer({ email });
  doc.firstName = firstName;
  doc.lastName = lastName;
  doc.phone = extra.phone || '0600000000';
  doc.password = '123pass!';
  doc.emailVerified = extra.emailVerified ?? true;
  doc.billingAddress = { line1: '12 rue Massena', line2: '', postalCode: '06000', city: 'Nice', country: 'FR' };
  doc.emailVerification = { ...(doc.emailVerification || {}), verifiedAt: doc.emailVerified ? new Date() : null };
  await doc.save();
  return doc;
}

async function product(slug, data) {
  return CommerceProduct.findOneAndUpdate(
    { slug },
    { $set: { slug, ...data } },
    { upsert: true, new: true, runValidators: true }
  );
}

function video(title, order) {
  return {
    id: `video_${order}`,
    title,
    description: 'Video de demonstration a regarder avant de passer au module suivant.',
    provider: 'STREAMABLE',
    sourceUrl: STREAMABLE_URL,
    streamableShortcode: STREAMABLE_SHORTCODE,
    coverUrl: VIDEO_COVER_URL,
    order,
  };
}

function file(title, order) {
  return {
    id: `file_${order}`,
    title,
    description: 'Support PDF a consulter et conserver.',
    fileName: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`,
    url: `/demo/formations/${order}.pdf`,
    order,
  };
}

const PLANITY_SERVICE_ROWS = [
  ['vernis-semi-permanent-pieds', 'Vernis semi-permanent pieds', 'Beaute des pieds express + semi permanent', '35min', 4000],
  ['vernis-semi-permanent-pieds', 'Vernis semi-permanent pieds', 'Depose (exterieur) + beaute des pieds express + semi permanent', '40min', 4500],
  ['vernis-semi-permanent-pieds', 'Vernis semi-permanent pieds', 'Depose (du salon) + beaute des pieds express + semi permanent', '40min', 4000],
  ['vernis-semi-permanent-pieds', 'Vernis semi-permanent pieds', 'Beaute des pieds russe + semi permanent simple', '1h', 5000],
  ['vernis-semi-permanent-pieds', 'Vernis semi-permanent pieds', 'Depose exterieur + beaute des pieds russe + semi permanent simple', '1h 15min', 5500],
  ['remplissage-cils-3-semaines', 'Remplissage cils - 3 semaines', 'Remplissage effet plume aerien 3 semaines', '1h 40min', 7000],
  ['remplissage-cils-3-semaines', 'Remplissage cils - 3 semaines', 'Remplissage pose signature Regard pure 3 semaines', '1h 30min', 5000],
  ['remplissage-cils-3-semaines', 'Remplissage cils - 3 semaines', 'Remplissage pose signature Regard mascara 3 semaines', '1h 30min', 6500],
  ['remplissage-cils-3-semaines', 'Remplissage cils - 3 semaines', 'Remplissage Volume Russe leger 3 semaines', '1h 45min', 6500],
  ['remplissage-cils-3-semaines', 'Remplissage cils - 3 semaines', 'Remplissage Volume russe intense 3 semaines', '2h', 7000],
  ['remplissage-cils-2-semaines', 'Remplissage cils - 2 semaines', 'Remplissage effet plume aerien 2 semaines', '1h 30min', 6000],
  ['remplissage-cils-2-semaines', 'Remplissage cils - 2 semaines', 'Remplissage pose signature Regard pure 2 semaines', '1h 15min', 4000],
  ['remplissage-cils-2-semaines', 'Remplissage cils - 2 semaines', 'Remplissage pose signature Regard mascara 2 semaines', '1h 15min', 5500],
  ['remplissage-cils-2-semaines', 'Remplissage cils - 2 semaines', 'Remplissage volume russe leger 2 semaines', '1h 30min', 5500],
  ['remplissage-cils-2-semaines', 'Remplissage cils - 2 semaines', 'Remplissage volume russe intense 2 semaines', '1h 30min', 6000],
  ['pack-elegance', 'Pack Elegance', 'Cil a cil noir + beaute des pieds et semi permanent', '2h 45min', 9900],
  ['pack-elegance', 'Pack Elegance', 'Cil a cil noir + depose du salon + beaute des pieds et semi permanent', '2h 55min', 9900],
  ['pack-elegance', 'Pack Elegance', 'Cil a cil noir + depose exterieur + beaute des pieds et semi permanent', '2h 55min', 10400],
  ['signature-rehaussement-korean-regard-naturel', 'Signature rehaussement de cils Korean Regard Naturel', 'Korean lash lift', '50min', 7000],
  ['signature-rehaussement-korean-regard-naturel', 'Signature rehaussement de cils Korean Regard Naturel', 'Korean lash lift + teinture', '40min', 7500],
  ['pack-korean-glow', 'Pack Korean Glow', 'Korean lash lift, teinture + beaute des pieds express et semi permanent', '1h 45min', 10200],
  ['pack-korean-glow', 'Pack Korean Glow', 'Korean lash lift, teinture + depose du salon + beaute des pieds express et semi permanent', '1h 55min', 10200],
  ['pack-korean-glow', 'Pack Korean Glow', 'Korean lash lift, teinture + depose exterieur + beaute des pieds express et semi permanent', '1h 55min', 10700],
  ['pack-signature-effet-mascara', 'Pack Signature effet mascara', 'Pose signature effet mascara noir + beaute des pieds express et semi permanent', '3h', 10900],
  ['pack-signature-effet-mascara', 'Pack Signature effet mascara', 'Pose signature effet mascara noir + depose du salon + beaute des pieds express et semi permanent', '3h 10min', 10900],
  ['pack-signature-effet-mascara', 'Pack Signature effet mascara', 'Pose signature effet mascara noir + depose exterieur + beaute des pieds express et semi permanent', '3h 10min', 11400],
  ['autres-poses-extensions-cils', 'Les autres poses d extensions de cils', 'Effet plume aerien', '2h 15min', 8500],
  ['autres-poses-extensions-cils', 'Les autres poses d extensions de cils', 'Volume russe leger', '2h 15min', 8500],
  ['autres-poses-extensions-cils', 'Les autres poses d extensions de cils', 'Volume Russe intense', '2h 15min', 9000],
  ['autres-poses-extensions-cils', 'Les autres poses d extensions de cils', 'Option Effet kim K', '15min', 1000],
  ['autres-poses-extensions-cils', 'Les autres poses d extensions de cils', 'Option Courbure M', '10min', 1000],
  ['pose-signature-effet-mascara', 'Pose signature Effet Mascara', 'Pose effet mascara', '2h', 8000],
  ['pose-signature-effet-mascara', 'Pose signature Effet Mascara', 'Option Effet kim K', '15min', 1000],
  ['pose-signature-effet-mascara', 'Pose signature Effet Mascara', 'Option Courbure M', '10min', 1000],
  ['pose-signature-effet-mascara', 'Pose signature Effet Mascara', 'Option Extensions de couleur', '10min', 500],
  ['pose-signature-effet-mascara', 'Pose signature Effet Mascara', 'Decoration dans les cils a l unite', '10min', 50],
  ['pose-cils-a-cils-regard-pure', 'Pose cils a cils Regard Pure', 'Pose cils a cils', '2h', 7000],
  ['pose-cils-a-cils-regard-pure', 'Pose cils a cils Regard Pure', 'Option Effet kim K', '15min', 1000],
  ['pose-cils-a-cils-regard-pure', 'Pose cils a cils Regard Pure', 'Option Courbure M', '10min', 1000],
  ['pose-cils-a-cils-regard-pure', 'Pose cils a cils Regard Pure', 'Option Extensions de couleur', '15min', 500],
  ['pose-cils-a-cils-regard-pure', 'Pose cils a cils Regard Pure', 'Decoration dans les cils a l unite', '10min', 50],
];

async function seedPlanityServices() {
  let order = 20;
  for (const [groupSlug, groupTitle, title, durationText, priceCents] of PLANITY_SERVICE_ROWS) {
    const slug = `${groupSlug}-${slugify(title)}`;
    await product(slug, {
      title,
      subtitle: groupTitle,
      description: `${groupTitle}. Prestation institut BeautySavage, duree indicative ${durationText}.`,
      kind: 'SERVICE',
      status: 'PUBLISHED',
      price: { amountCents: priceCents, currency: 'EUR' },
      coverUrl: cover(order % 2 ? 'photo-1516975080664-ed2fc6a32937' : 'photo-1604654894610-df63bc536371'),
      gallery: [cover('photo-1487412947147-5cebf100ffc2'), cover('photo-1521590832167-7bcbfaa6381f')],
      durationMinutes: minutes(durationText),
      sessions: [],
      options: [],
      paymentRules: { depositMode: 'FIXED', depositCents: Math.min(2000, priceCents) },
      bookingRules: { bufferAfterMinutes: 10 },
      boostRank: order,
    });
    order += 1;
  }
}

function modules(prefix) {
  return [
    {
      id: `${prefix}_m1`,
      title: 'Bases, hygiene et materiel',
      description: 'Installer son poste, preparer la cliente, reconnaitre le materiel et appliquer les regles d hygiene.',
      text: 'La qualite du resultat commence avant le geste technique : poste propre, protocole clair et diagnostic precis.',
      order: 1,
      videos: [video('Accueil formation et materiel', 1), video('Preparation du poste', 2)],
      files: [file('Checklist materiel', 1), file('Protocole hygiene', 2)],
    },
    {
      id: `${prefix}_m2`,
      title: 'Technique pas a pas',
      description: 'Deroule complet du geste avec focus sur la precision, la posture et les erreurs a eviter.',
      text: 'Chaque etape est detaillee pour aider la stagiaire a reproduire le geste avec regularite.',
      order: 2,
      videos: [video('Demonstration complete', 3), video('Corrections frequentes', 4)],
      files: [file('Fiche protocole technique', 3)],
    },
    {
      id: `${prefix}_m3`,
      title: 'Finition, photos et conseil cliente',
      description: 'Finaliser proprement, conseiller l entretien et preparer le dossier final a transmettre.',
      text: 'Les finitions, les photos et le conseil apres prestation renforcent la satisfaction et la fidelisation.',
      order: 3,
      videos: [video('Finitions et entretien', 5), video('Photos avant apres', 6)],
      files: [file('Guide photo livrable', 4)],
    },
  ];
}

function evaluation(title) {
  return {
    enabled: true,
    version: 2,
    showScoreToCustomer: true,
    deliverables: [
      { id: 'liv_photo_face', type: 'PHOTO_BEFORE_AFTER', label: 'Photos avant / apres', description: 'Ajoutez des photos nettes, lumiere naturelle si possible.', required: true },
      { id: 'liv_video_geste', type: 'VIDEO', label: 'Video du geste', description: 'Courte video montrant votre geste principal.', required: true, maxDurationSeconds: 120 },
      { id: 'liv_galerie_modele', type: 'PHOTO_GALLERY', label: 'Galerie photo finale', description: 'Ajoutez plusieurs photos du resultat final sous differents angles.', required: true, maxImages: 6 },
      { id: 'liv_fiche', type: 'FILE', label: 'Fiche diagnostic', description: 'Votre fiche cliente completee.', required: false },
    ],
    sections: [
      {
        id: 'sec_hygiene',
        title: `${title} - hygiene`,
        description: 'Valider les bases indispensables avant correction.',
        order: 1,
        items: [
          { id: 'q_desinfection', type: 'TRUE_FALSE', label: 'Desinfection', prompt: 'Le materiel doit etre desinfecte entre deux clientes.', required: true, points: 4, correctOptionIds: ['true'] },
          {
            id: 'q_prepa',
            type: 'SINGLE',
            label: 'Preparation',
            prompt: 'Quelle etape vient avant le geste technique ?',
            required: true,
            points: 4,
            options: [
              { id: 'diagnostic', label: 'Diagnostic et preparation', correct: true },
              { id: 'photo_finale', label: 'Photo finale', correct: false },
              { id: 'vente', label: 'Encaissement', correct: false },
            ],
            correctOptionIds: ['diagnostic'],
          },
        ],
      },
      {
        id: 'sec_conseil',
        title: `${title} - conseil`,
        description: 'Verifier la capacite a accompagner la cliente apres prestation.',
        order: 2,
        items: [
          {
            id: 'q_conseils',
            type: 'MULTIPLE',
            label: 'Conseils apres prestation',
            prompt: 'Quels conseils sont adaptes ?',
            required: true,
            points: 6,
            options: [
              { id: 'eau', label: 'Eviter eau chaude et vapeur au debut', correct: true },
              { id: 'arracher', label: 'Arracher les extensions soi-meme', correct: false },
              { id: 'entretien', label: 'Respecter les conseils d entretien', correct: true },
            ],
            correctOptionIds: ['eau', 'entretien'],
          },
        ],
      },
    ],
  };
}

async function seedThemeAndCompany() {
  await Theme.findOneAndUpdate({}, {
    $set: {
      colors: {
        background: '#ffffff',
        foreground: '#111111',
        primary: '#111111',
        accent: '#c7a98a',
        menuBackground: '#050505',
        menuForeground: '#ffffff',
      },
      radius: '0.5rem',
      typography: { headingFont: 'playfair-display', bodyFont: 'inter' },
    },
  }, { upsert: true, new: true });

  await Company.findOneAndUpdate({}, {
    $set: {
      name: 'BeautySavage',
      tagline: 'Institut de beaute et formations a Nice',
      homeIntro: 'Prestations regard, ongles, cartes cadeaux et formations professionnelles dans un univers elegant et precis.',
      heroImage: cover('photo-1522337360788-8b13dee7a37e'),
    },
  }, { upsert: true, new: true });
}

async function seedProducts() {
  const products = {};
  products.cils = await product('pose-cils-a-cils-regard-pure', {
    title: 'Pose cils a cils - Regard Pure',
    subtitle: 'Pose naturelle inspiree du tarif Planity Beauty Concept by Romane.',
    description: 'Une pose cils a cils pour ouvrir le regard avec un rendu fin, doux et elegant. Duree indicative 2h.',
    kind: 'SERVICE',
    status: 'PUBLISHED',
    price: { amountCents: 7000, currency: 'EUR' },
    coverUrl: cover('photo-1516975080664-ed2fc6a32937'),
    gallery: [cover('photo-1487412947147-5cebf100ffc2'), cover('photo-1521590832167-7bcbfaa6381f')],
    durationMinutes: 120,
    sessions: [],
    options: [
      { key: 'effet-kim-k', label: 'Option effet Kim K', description: 'Effet structure et volume supplementaire.', priceCents: 1000, active: true },
      { key: 'courbure-m', label: 'Option courbure M', description: 'Courbure plus marquee selon diagnostic.', priceCents: 1000, active: true },
    ],
    paymentRules: { depositMode: 'FIXED', depositCents: 2000 },
  });
  products.rehaussement = await product('rehaussement-cils-soin', {
    title: 'Rehaussement de cils avec soin',
    subtitle: 'Regard naturel, courbure et soin.',
    description: 'Un soin complet pour rehausser les cils naturels, apporter de la courbure et faciliter la routine quotidienne.',
    kind: 'SERVICE',
    status: 'PUBLISHED',
    price: { amountCents: 5500, currency: 'EUR' },
    coverUrl: cover('photo-1515377905703-c4788e51af15'),
    gallery: [cover('photo-1500835556837-99ac94a94552'), cover('photo-1522335789203-aabd1fc54bc9')],
    durationMinutes: 75,
    sessions: [],
    options: [{ key: 'teinture', label: 'Teinture cils', description: 'Intensifie le resultat.', priceCents: 1000, active: true }],
    paymentRules: { depositMode: 'FIXED', depositCents: 1500 },
  });
  products.ongles = await product('pose-gel-signature', {
    title: 'Pose gel signature',
    subtitle: 'Manucure, gainage et finition soignee.',
    description: 'Pose gel elegante avec diagnostic, preparation de l ongle et finition adaptee a votre style.',
    kind: 'SERVICE',
    status: 'PUBLISHED',
    price: { amountCents: 6500, currency: 'EUR' },
    coverUrl: cover('photo-1604654894610-df63bc536371'),
    gallery: [cover('photo-1610992015732-2449b76344bc'), cover('photo-1607779097040-26e80aa78e66')],
    durationMinutes: 105,
    sessions: [],
    options: [
      { key: 'nail-art', label: 'Nail art detail', description: 'Decoration fine sur plusieurs ongles.', priceCents: 1500, active: true },
      { key: 'depose', label: 'Depose exterieure', description: 'Depose douce avant nouvelle pose.', priceCents: 1000, active: true },
    ],
    paymentRules: { depositMode: 'FIXED', depositCents: 2000 },
  });

  products.brow = await product('formation-brow-lift-distanciel', {
    title: 'Formation Browlift & Lashlift - en ligne',
    subtitle: 'Parcours distanciel avec videos, supports et validation finale.',
    description: 'Formation inspiree des parcours beaute du regard : theorie, demonstration, pratique guidee et dossier final corrige par l institut.',
    kind: 'DISTANCE_TRAINING',
    status: 'PUBLISHED',
    price: { amountCents: 39000, currency: 'EUR' },
    coverUrl: cover('photo-1521590832167-7bcbfaa6381f'),
    gallery: [cover('photo-1487412947147-5cebf100ffc2')],
    distanceDeliveryMode: 'IMMEDIATE',
    requiresLegalWaiver: true,
    trailer: { title: 'Bande-annonce Browlift & Lashlift', provider: 'STREAMABLE', sourceUrl: STREAMABLE_URL, streamableShortcode: STREAMABLE_SHORTCODE, coverUrl: VIDEO_COVER_URL },
    whatsappGroup: { label: 'Groupe WhatsApp Browlift & Lashlift', url: 'https://chat.whatsapp.com/beautysavage-browlift-demo' },
    modules: modules('brow'),
    evaluation: evaluation('Browlift & Lashlift'),
  });
  products.cilFormation = await product('formation-extension-cils-distanciel', {
    title: 'Formation Extension de cils - en ligne',
    subtitle: 'Bases cils a cils, isolation, mapping et retouche.',
    description: 'Un parcours complet pour apprendre la pose cil a cil avec methode, securite, entrainement progressif et correction finale.',
    kind: 'DISTANCE_TRAINING',
    status: 'PUBLISHED',
    price: { amountCents: 49000, currency: 'EUR' },
    coverUrl: cover('photo-1516975080664-ed2fc6a32937'),
    gallery: [cover('photo-1522337360788-8b13dee7a37e')],
    distanceDeliveryMode: 'IMMEDIATE',
    requiresLegalWaiver: true,
    trailer: { title: 'Bande-annonce Extension de cils', provider: 'STREAMABLE', sourceUrl: STREAMABLE_URL, streamableShortcode: STREAMABLE_SHORTCODE, coverUrl: VIDEO_COVER_URL },
    whatsappGroup: { label: 'Groupe WhatsApp Extension de cils', url: 'https://chat.whatsapp.com/beautysavage-cils-demo' },
    modules: modules('cils'),
    evaluation: evaluation('Extension de cils'),
  });
  products.presentiel = await product('formation-prothesie-ongulaire-presentiel', {
    title: 'Formation Prothesie ongulaire - presentiel',
    subtitle: 'Session institut, pratique guidee et suivi.',
    description: 'Formation presentielle inspiree des parcours professionnels : hygiene, preparation, gainage, construction et finition sur modele.',
    kind: 'IN_PERSON_TRAINING',
    status: 'PUBLISHED',
    price: { amountCents: 99000, currency: 'EUR' },
    coverUrl: cover('photo-1604654894610-df63bc536371'),
    training: { durationDays: 2, location: 'Institut BeautySavage - Nice', formalities: 'Materiel fourni, modele recommande jour 2.', cancellationPolicy: 'Report possible selon delai et disponibilites.' },
    sessions: [{ ...nextWeek(8, 9, 30, 420), capacity: 6, reservedCount: 2, status: 'ACTIVE' }],
    trailer: { title: 'Bande-annonce Prothesie ongulaire', provider: 'STREAMABLE', sourceUrl: STREAMABLE_URL, streamableShortcode: STREAMABLE_SHORTCODE, coverUrl: VIDEO_COVER_URL },
    whatsappGroup: { label: 'Groupe WhatsApp Prothesie ongulaire', url: 'https://chat.whatsapp.com/beautysavage-ongles-demo' },
    modules: modules('ongles'),
    evaluation: evaluation('Prothesie ongulaire'),
  });
  products.gift = await product('carte-cadeau-beautysavage', {
    title: 'Carte cadeau BeautySavage',
    subtitle: 'Offrir une experience institut.',
    description: 'Carte cadeau personnalisee, envoyee en PDF apres paiement et utilisable sur les prestations BeautySavage.',
    kind: 'GIFT_CARD',
    status: 'PUBLISHED',
    price: { amountCents: 3000, currency: 'EUR' },
    coverUrl: '/gift-card-master.jpg',
    gallery: ['/gift-card-master.jpg'],
  });
  await CommerceProduct.deleteMany({ title: /^pose complete gel$/i });
  await seedPlanityServices();
  return products;
}

async function seedVideoCovers() {
  await CommerceProduct.updateMany(
    { 'modules.videos.0': { $exists: true } },
    { $set: { 'modules.$[].videos.$[].coverUrl': VIDEO_COVER_URL } }
  );
  await CommerceProduct.updateMany(
    {
      $or: [
        { 'trailer.streamableShortcode': { $exists: true, $ne: '' } },
        { 'trailer.sourceUrl': { $exists: true, $ne: '' } },
        { 'trailer.url': { $exists: true, $ne: '' } },
      ],
    },
    { $set: { 'trailer.coverUrl': VIDEO_COVER_URL } }
  );
}

async function seedSalesAndProgress(client, products) {
  const saleDistance = await CommerceSale.findOneAndUpdate({ idempotencyKey: 'demo-client-mail-formations-distance' }, {
    $set: {
      saleNumber: 'BS-DEMO-CLIENT-FORM',
      customerId: client._id,
      status: 'PAID',
      paymentStatus: 'PAID',
      currency: 'EUR',
      totalCents: products.brow.price.amountCents + products.cilFormation.price.amountCents,
      stripeAmountCents: products.brow.price.amountCents + products.cilFormation.price.amountCents,
      giftCardAmountCents: 0,
      finalizedAt: new Date(),
      lines: [
        { productId: products.brow._id, productSnapshot: { id: String(products.brow._id), title: products.brow.title, kind: products.brow.kind, slug: products.brow.slug, modulesCount: products.brow.modules.length }, quantity: 1, unitPriceCents: products.brow.price.amountCents, totalCents: products.brow.price.amountCents },
        { productId: products.cilFormation._id, productSnapshot: { id: String(products.cilFormation._id), title: products.cilFormation.title, kind: products.cilFormation.kind, slug: products.cilFormation.slug, modulesCount: products.cilFormation.modules.length }, quantity: 1, unitPriceCents: products.cilFormation.price.amountCents, totalCents: products.cilFormation.price.amountCents },
      ],
      invoice: { number: 'FAC-BS-DEMO-CLIENT-FORM', issuedAt: new Date(), pdfUrl: '' },
    },
  }, { upsert: true, new: true });

  await TrainingSubmission.findOneAndUpdate({ customerId: client._id, productId: products.brow._id, status: 'PENDING' }, {
    $set: {
      saleId: saleDistance._id,
      attempt: 1,
      evaluationVersion: 2,
      answersSnapshot: { q_desinfection: 'true', q_prepa: 'diagnostic', q_conseils: ['eau', 'entretien'] },
      deliverablesSnapshot: {
        liv_photo_face: {
          before: { url: '/demo/livrables/brow-before.jpg', name: 'avant-brow.jpg', type: 'image/jpeg' },
          after: { url: '/demo/livrables/brow-after.jpg', name: 'apres-brow.jpg', type: 'image/jpeg' },
        },
        liv_video_geste: { url: STREAMABLE_URL, name: 'video-geste.mp4', type: 'video/mp4', streamableShortcode: STREAMABLE_SHORTCODE },
        liv_galerie_modele: [
          { url: '/demo/livrables/brow-gallery-1.jpg', name: 'resultat-1.jpg', type: 'image/jpeg' },
          { url: '/demo/livrables/brow-gallery-2.jpg', name: 'resultat-2.jpg', type: 'image/jpeg' },
        ],
      },
      progressSnapshot: { completedModules: 2, totalModules: products.brow.modules.length },
      scoreSnapshot: { totalPoints: 14, earnedPoints: 14, percent: 100, calculatedAt: new Date() },
    },
  }, { upsert: true, new: true });

  await TrainingSubmission.findOneAndUpdate({ customerId: client._id, productId: products.cilFormation._id, status: 'REJECTED' }, {
    $set: {
      saleId: saleDistance._id,
      attempt: 1,
      evaluationVersion: 2,
      answersSnapshot: { q_desinfection: 'true', q_prepa: 'photo_finale', q_conseils: ['eau'] },
      deliverablesSnapshot: {},
      progressSnapshot: { completedModules: 1, totalModules: products.cilFormation.modules.length },
      scoreSnapshot: { totalPoints: 14, earnedPoints: 4, percent: 29, calculatedAt: new Date() },
      decision: { status: 'REJECTED', comment: 'Ajoutez des photos plus nettes et reprenez la question sur la preparation.', decidedAt: new Date(), decidedBy: null, certificateUrl: '' },
    },
  }, { upsert: true, new: true });

  const appointment = nextWeek(3, 15, 0, 105);
  const saleService = await CommerceSale.findOneAndUpdate({ idempotencyKey: 'demo-client-mail-reservation-prestation' }, {
    $set: {
      saleNumber: 'BS-DEMO-CLIENT-RDV',
      customerId: client._id,
      status: 'PAID',
      paymentStatus: 'PAID',
      currency: 'EUR',
      totalCents: products.ongles.price.amountCents,
      stripeAmountCents: 2000,
      giftCardAmountCents: 0,
      finalizedAt: new Date(),
      lines: [
        { productId: products.ongles._id, productSnapshot: { id: String(products.ongles._id), title: products.ongles.title, kind: products.ongles.kind, slug: products.ongles.slug }, quantity: 1, unitPriceCents: products.ongles.price.amountCents, totalCents: products.ongles.price.amountCents },
      ],
      invoice: { number: 'FAC-BS-DEMO-CLIENT-RDV', issuedAt: new Date(), pdfUrl: '' },
    },
  }, { upsert: true, new: true });

  await CalendarEvent.findOneAndUpdate({ source: { demoKey: 'client-mail-pose-gel-next-week' } }, {
    $set: {
      type: 'SERVICE_BOOKING',
      title: 'Pose gel signature - Client Mail',
      productId: products.ongles._id,
      customerSnapshot: { name: 'Client Demo', email: client.email, phone: client.phone },
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      paymentSnapshot: { totalCents: products.ongles.price.amountCents, paidCents: 2000, depositCents: 2000, balanceDueCents: products.ongles.price.amountCents - 2000, currency: 'EUR' },
      notes: `Reservation demo liee a ${saleService.saleNumber}.`,
      source: { demoKey: 'client-mail-pose-gel-next-week' },
    },
  }, { upsert: true, new: true });
}

function monthBounds(offset) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - offset, 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() - offset + 1, 0, 23, 59, 59, 999);
  const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
  return { key, start, end };
}

async function seedCommissions() {
  for (let index = 0; index < 6; index += 1) {
    const period = monthBounds(index);
    const basisCents = 180000 + index * 42000;
    const amountCents = Math.round(basisCents * 0.08);
    await CommerceCommission.findOneAndUpdate(
      { periodKey: period.key, label: 'Commission mensuelle BeautySavage' },
      {
        $set: {
          label: 'Commission mensuelle BeautySavage',
          periodKey: period.key,
          periodStart: period.start,
          periodEnd: period.end,
          status: index < 2 ? 'DUE' : index === 2 ? 'PAYMENT_PENDING' : 'PAID',
          amountCents,
          currency: 'EUR',
          basisCents,
          rateBps: 800,
          sourceSnapshot: { source: 'Seed demo', detail: 'Commissions institut de demonstration' },
          dueAt: new Date(period.end.getTime() + 7 * 24 * 60 * 60 * 1000),
          paidAt: index >= 3 ? new Date(period.end.getTime() + 4 * 24 * 60 * 60 * 1000) : null,
          paymentReference: index >= 3 ? `BS-COM-${period.key}` : '',
        },
      },
      { upsert: true, new: true }
    );
  }
}

async function seedReviews(client) {
  const products = await CommerceProduct.find({
    status: 'PUBLISHED',
    kind: { $in: ['SERVICE', 'DISTANCE_TRAINING', 'IN_PERSON_TRAINING', 'GIFT_CARD'] },
  }).sort({ kind: 1, boostRank: 1, title: 1 });
  const reviewers = [
    client,
    await upsertCustomer('avis.lina@beautysavage.test', 'Lina', 'Morel', { emailVerified: true }),
    await upsertCustomer('avis.manon@beautysavage.test', 'Manon', 'Rossi', { emailVerified: true }),
    await upsertCustomer('avis.jade@beautysavage.test', 'Jade', 'Martin', { emailVerified: true }),
  ];
  const reviewSale = await CommerceSale.findOneAndUpdate({ idempotencyKey: 'demo-reviews-all-products' }, {
    $set: {
      saleNumber: 'BS-DEMO-AVIS',
      customerId: client._id,
      status: 'PAID',
      paymentStatus: 'PAID',
      currency: 'EUR',
      totalCents: products.reduce((sum, item) => sum + (item.price?.amountCents || 0), 0),
      stripeAmountCents: 0,
      giftCardAmountCents: 0,
      finalizedAt: new Date(),
      lines: products.map((item) => ({
        productId: item._id,
        productSnapshot: { id: String(item._id), title: item.title, kind: item.kind, slug: item.slug },
        quantity: 1,
        unitPriceCents: item.price?.amountCents || 0,
        totalCents: item.price?.amountCents || 0,
      })),
    },
  }, { upsert: true, new: true });

  const comments = [
    'Resultat tres soigne et explications claires, je recommande les yeux fermes.',
    'Accueil doux, prestation precise et rendu exactement comme demande.',
    'Formation complete, supports utiles et correction vraiment constructive.',
    'Tres belle experience, on sent le souci du detail et de l hygiene.',
    'Carte cadeau simple a offrir, la personne etait ravie de son rendez-vous.',
  ];
  for (let index = 0; index < products.length; index += 1) {
    const item = products[index];
    const reviewer = reviewers[index % reviewers.length];
    await Review.findOneAndUpdate(
      { customerId: reviewer._id, productId: item._id },
      {
        $set: {
          saleId: reviewSale._id,
          targetKind: item.kind === 'SERVICE' ? 'SERVICE' : item.kind.includes('TRAINING') ? 'TRAINING' : item.kind,
          rating: index % 6 === 0 ? 4 : 5,
          comment: comments[index % comments.length],
          displayName: `${reviewer.firstName} ${String(reviewer.lastName || '').slice(0, 1)}.`,
          status: 'PUBLISHED',
          moderatedAt: new Date(),
          manual: index % 5 === 0,
          sourceLabel: index % 5 === 0 ? 'Avis libre institut' : item.title,
        },
      },
      { upsert: true, new: true }
    );
  }
}

function nextMonday() {
  const date = new Date();
  const day = date.getDay() || 7;
  date.setDate(date.getDate() + (8 - day));
  date.setHours(0, 0, 0, 0);
  return date;
}

function at(base, week, day, hour, minute = 0, durationMinutes = 60) {
  const startsAt = new Date(base);
  startsAt.setDate(base.getDate() + week * 7 + day);
  startsAt.setHours(hour, minute, 0, 0);
  return { startsAt, endsAt: new Date(startsAt.getTime() + durationMinutes * 60 * 1000) };
}

async function seedDenseCalendar(client) {
  const services = await CommerceProduct.find({ kind: 'SERVICE', status: 'PUBLISHED' }).sort({ boostRank: 1, title: 1 }).limit(20);
  const trainings = await CommerceProduct.find({ kind: { $in: ['IN_PERSON_TRAINING', 'DISTANCE_TRAINING'] }, status: 'PUBLISHED' }).sort({ title: 1 }).limit(4);
  const base = nextMonday();
  await CalendarEvent.deleteMany({ 'source.demoPlanning': true });
  let cursor = 0;
  for (let week = 0; week < 8; week += 1) {
    for (let day = 0; day < 5; day += 1) {
      const slots = [
        { hour: 9, duration: 120, training: false },
        { hour: 11, duration: 60, training: false },
        { hour: 14, duration: 120, training: day % 3 === 0 },
        { hour: 16, duration: 120, training: day % 4 === 0 },
      ];
      for (const slot of slots) {
        const catalogue = slot.training && trainings.length ? trainings : services;
        const item = catalogue[cursor % catalogue.length];
        const dates = at(base, week, day, slot.hour, 0, slot.duration);
        const totalCents = item.price?.amountCents || 0;
        const paidCents = Math.min(totalCents, slot.training ? 5000 : 2000);
        await CalendarEvent.create({
          type: slot.training ? 'FORMATION_SESSION' : 'SERVICE_BOOKING',
          title: `${item.title} - ${client.firstName}`,
          productId: item._id,
          customerSnapshot: { name: `${client.firstName} ${client.lastName}`, email: client.email, phone: client.phone },
          startsAt: dates.startsAt,
          endsAt: dates.endsAt,
          status: 'SCHEDULED',
          paymentSnapshot: {
            totalCents,
            paidCents,
            depositCents: paidCents,
            balanceDueCents: Math.max(0, totalCents - paidCents),
            currency: 'EUR',
          },
          notes: 'Reservation de demonstration seedee pour remplir le planning hebdomadaire.',
          source: { demoPlanning: true, week, day, cursor },
        });
        cursor += 1;
      }
    }
  }
}

async function main() {
  await connectDatabase();
  await seedThemeAndCompany();
  const client = await upsertCustomer('client@mail.com', 'Client', 'Demo', { emailVerified: true, phone: '0611223344' });
  await upsertCustomer('romane.demo@beautysavage.test', 'Romane', 'Demo', { emailVerified: true });
  const products = await seedProducts();
  await seedVideoCovers();
  await seedSalesAndProgress(client, products);
  await seedCommissions();
  await seedReviews(client);
  await seedDenseCalendar(client);
  logger.success('Seed demo BeautySavage complet termine');
  await disconnectDatabase();
}

main().catch(async (err) => {
  logger.error('Seed demo BeautySavage echoue', err);
  await disconnectDatabase().catch(() => null);
  process.exitCode = 1;
});
