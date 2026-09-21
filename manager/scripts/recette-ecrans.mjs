/**
 * RECETTE DE TOUS LES ÉCRANS DU MANAGER — débordement, états, accessibilité.
 *
 * ══ CE QU'ELLE AJOUTE À `recette-mobile.mjs` ════════════════════════════════
 *
 * L'autre recette éprouve UNE page en PROFONDEUR : le défilement, le tiroir,
 * la modale, le geste tactile. Elle prouve que l'architecture de défilement
 * tient — mais sur un seul écran.
 *
 * Celle-ci fait l'inverse : elle passe sur TOUS les écrans, à quatre largeurs,
 * et contrôle ce qui ne se voit qu'en les parcourant :
 *
 *   1. AUCUN DÉBORDEMENT HORIZONTAL — et, s'il y en a un, elle NOMME l'élément
 *      coupable. « scrollWidth > clientWidth » ne se corrige pas ; « ce tableau
 *      fait 812 px dans un écran de 320 » se corrige.
 *   2. AUCUN ÉCRAN BLANC — une route qui rend moins de trois éléments de texte
 *      n'affiche ni contenu, ni état vide, ni erreur : c'est le trou noir que
 *      le référentiel interdit.
 *   3. AUCUNE FUITE TECHNIQUE — « undefined », « null », « NaN », « [object
 *      Object] » ou une trace d'erreur visibles dans le texte rendu.
 *   4. AUCUNE ERREUR DE CONSOLE — y compris les avertissements React sur les
 *      clés dupliquées, qui signalent une liste dont l'identité est fausse.
 *   5. LES COMMANDES SONT ATTEIGNABLES — tout bouton ou lien doit être
 *      entièrement DANS la largeur de l'écran, et assez grand pour un doigt.
 *   6. LES COMMANDES ONT UN NOM — un bouton sans texte ni `aria-label` est
 *      muet pour un lecteur d'écran, et il y en a beaucoup (icônes seules).
 *
 * ══ POURQUOI DES BOUCHONS, ET NON LE VRAI BACKEND ═══════════════════════════
 *
 * Parce que ce qu'on éprouve ici est le RENDU, pas la donnée. Un backend réel
 * imposerait une base, un compte, un contrat, un appairage — et rendrait la
 * recette dépendante de l'état d'une machine. Les bouchons donnent au contraire
 * des jeux de données CHOISIS : des listes assez longues pour déborder, des
 * chaînes assez larges pour casser une grille.
 *
 * ══ LANCEMENT ══════════════════════════════════════════════════════════════
 *
 *   npm run build
 *   npm i --no-save playwright && npx playwright install chromium
 *   npm run test:ecrans
 *
 * Playwright n'est PAS une dépendance du manager : `npm test` doit rester
 * exécutable sans navigateur.
 */
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, dirname, resolve } from 'node:path';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error(
    [
      'Cette recette a besoin de Playwright, qui n’est pas une dépendance du manager.',
      '  npm i --no-save playwright && npx playwright install chromium',
      'puis relancez : npm run test:ecrans',
    ].join('\n'),
  );
  process.exit(2);
}

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = resolve(ICI, '..');
const DIST = join(RACINE, 'dist');
const PORT = 4788;

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('`dist/` est absent : lancez `npm run build` avant cette recette.');
  process.exit(2);
}

/** La clé de stockage de CE projet — même dérivation que `vite.config.ts`. */
const CLE_SESSION = `${JSON.parse(
  await readFile(join(RACINE, 'package.json'), 'utf8'),
).name.replace(/-manager$/, '')}.manager.session.token`;

/* ══════════════════════════════════════════════════════════════════════════
   SERVEUR STATIQUE — le build, servi comme le fait nginx (repli SPA)
   ══════════════════════════════════════════════════════════════════════════ */

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.webp': 'image/webp', '.woff': 'font/woff',
};

const serveur = createServer(async (req, res) => {
  let chemin = join(DIST, decodeURIComponent(req.url.split('?')[0]));
  if (!existsSync(chemin) || !extname(chemin)) chemin = join(DIST, 'index.html');
  try {
    res.writeHead(200, { 'Content-Type': MIME[extname(chemin)] ?? 'application/octet-stream' });
    res.end(await readFile(chemin));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((ok) => serveur.listen(PORT, ok));

/* ══════════════════════════════════════════════════════════════════════════
   LES BOUCHONS — des données CHOISIES pour mettre la mise en page en défaut
   ══════════════════════════════════════════════════════════════════════════

   Les chaînes sont volontairement longues : un libellé court ne casse jamais
   une grille, et une recette qui ne rend que des cas faciles ne prouve rien.  */

const LONG = 'Un libellé délibérément long pour éprouver les grilles étroites';
const UTILISATEUR = {
  _id: 'u1', email: 'recette@ly-solution.test', name: 'Recette Écrans', role: 'DEV',
  createdAt: '2026-01-01T00:00:00.000Z',
};
const ENTREPRISE = {
  _id: 'c1', name: 'Entreprise de recette au nom particulièrement long', tagline: LONG,
  homeIntro: LONG, keyFigures: [
    { _id: 'k1', value: 'Identité', label: LONG, icon: 'Fingerprint', order: 10 },
    { _id: 'k2', value: 'Expérience', label: LONG, icon: 'Compass', order: 20 },
    { _id: 'k3', value: 'Technologie', label: LONG, icon: 'Cpu', order: 30 },
    { _id: 'k4', value: 'Maîtrise', label: LONG, icon: 'KeyRound', order: 40 },
  ],
  media: [], logos: { header: '', favicon: '' }, heroImage: '',
  businessHours: [], address: {}, mediaResolution: {},
};
const ACCUEIL = {
  hero: {
    kicker: 'Sites vitrines', title: LONG, subtitle: LONG,
    primaryLabel: 'Présenter mon projet', primaryUrl: '/presenter-un-projet',
    secondaryLabel: 'Voir la méthode', secondaryUrl: '/conception',
    proofs: [{ _id: 'p1', text: LONG, order: 10 }],
  },
  showcase: {
    browserUrl: 'www.exemple.fr', siteName: 'Exemple', navItems: ['La carte', 'Le lieu'],
    headline: LONG, subline: LONG, ctaLabel: 'Réserver', badge: 'Ouvert',
    cards: [{ _id: 'sc1', title: 'Tuile', text: LONG, order: 10 }],
  },
  outcomes: { eyebrow: 'Résultats', title: LONG, lead: LONG, items: [{ _id: 'o1', value: '30 s', title: LONG, text: LONG, order: 10 }] },
  positioning: { eyebrow: 'Positionnement', title: LONG, text: LONG },
  trust: { eyebrow: 'Engagements', title: LONG, items: [{ _id: 't1', title: LONG, text: LONG, order: 10 }] },
  invitation: { title: LONG, text: LONG, buttonLabel: 'Nous écrire', buttonUrl: '/contact' },
};
const CHAPITRES = Array.from({ length: 9 }, (_, i) => ({
  _id: `c${i}`, slug: `chapitre-${i + 1}`, title: `${LONG} ${i + 1}`, navLabel: `Chapitre ${i + 1}`,
  kicker: `0${(i % 9) + 1} / RECETTE`, lead: LONG, layout: 'PILLARS',
  items: [{ _id: `v${i}`, title: LONG, text: LONG, icon: 'Minus', label: 'Volet', order: 10 }],
  published: i % 3 !== 0, showInNav: true, navOrder: i * 10, order: i, heroImage: '',
  seo: { metaTitle: '', metaDescription: '' },
}));
const PAGES = Array.from({ length: 7 }, (_, i) => ({
  _id: `p${i}`, slug: `page-${i + 1}`, title: `${LONG} ${i + 1}`, navLabel: `Page ${i + 1}`,
  intro: LONG, blocks: [], published: i % 2 === 0, showInNav: true, order: i, heroImage: '',
  seo: { metaTitle: '', metaDescription: '' },
}));
/*
  LES BOUCHONS SUIVENT LES TYPES DU CLIENT, PAS L'IDÉE QU'ON S'EN FAIT.

  Deux d'entre eux mentaient — une demande de contact porte son identité dans
  `contact.{name,email,phone}` et non à plat, et `/my-invoices` rend un TABLEAU
  de groupes de facturation, pas un objet. La recette signalait donc deux
  plantages du produit qui n'étaient que les siens. Les formes sont maintenant
  celles de `types/index.ts`.
*/
const DEMANDES = {
  items: Array.from({ length: 6 }, (_, i) => ({
    submissionId: `sub-${i}`,
    contact: {
      name: `Demandeur ${i + 1}`,
      email: `demandeur${i + 1}@exemple-de-domaine-tres-long.fr`,
      phone: '+33 6 00 00 00 0' + i,
    },
    reason: 'NEW_PRESENCE',
    state: i % 2 ? 'READ' : 'NEW',
    submittedAt: '2026-08-01T10:00:00.000Z',
    readAt: i % 2 ? '2026-08-02T10:00:00.000Z' : null,
    resolvedAt: null,
    messagePreview: LONG,
    notification: null,
  })),
  nextCursor: null, hasMore: false, unreadCount: 3,
};

const LIGNE_PRIX = { amountHt: 120000, taxRate: 20, taxAmount: 24000, amountTtc: 144000, currency: 'EUR' };
const FACTURES = [{
  contractId: 'ct1',
  reference: 'CTR-2026-0001',
  status: 'ACTIVE',
  pricing: { launchFee: LIGNE_PRIX, subscription: LIGNE_PRIX },
  subscription: { status: 'active', currentPeriodEnd: '2026-09-01T00:00:00.000Z', cancelAtPeriodEnd: false },
  payments: [],
  invoices: Array.from({ length: 5 }, (_, i) => ({
    invoiceId: `f${i}`, number: `FA-2026-000${i + 1}`,
    status: ['PAID', 'OPEN', 'VOID', 'PAID', 'OPEN'][i],
    issuedAt: `2026-08-0${i + 1}T10:00:00.000Z`,
    paidAt: i % 2 ? null : '2026-08-05T10:00:00.000Z',
    amountHt: 120000 + i, taxAmount: 24000, amountTtc: 144000 + i, currency: 'EUR',
    label: LONG, hostedUrl: '', pdfUrl: '', description: LONG,
  })),
}];

function corpsPour(chemin) {
  const finit = (s) => chemin.endsWith(s);
  const contient = (s) => chemin.includes(s);

  if (finit('/auth/me')) return UTILISATEUR;
  if (finit('/company')) return ENTREPRISE;
  if (finit('/my-company')) return null;
  if (finit('/home-content')) return ACCUEIL;
  if (finit('/chapters')) return CHAPITRES;
  if (finit('/pages')) return PAGES;
  if (contient('/chapters/')) return CHAPITRES[0];
  if (contient('/pages/')) return PAGES[0];
  if (finit('/site-status')) return { status: 'ACTIVE', reason: '', suspendedAt: null };
  /*
    LES SINGLETONS SONT RENDUS AVEC LEUR FORME COMPLÈTE.

    Un `{}` n'est pas « une valeur par défaut » : c'est un document que le
    backend ne produit jamais. Le servir faisait planter les écrans de thème et
    de rôles sur `colors.primary` ou `DEV`, et la recette signalait un défaut
    du produit là où c'était le bouchon qui mentait.
  */
  if (finit('/theme/manager')) {
    return {
      colors: {
        background: '#ffffff', foreground: '#0b0b0c', card: '#ffffff', muted: '#f4f4f5',
        border: '#e4e4e7', primary: '#111113', primaryForeground: '#ffffff', accent: '#7c5cff',
      },
      radius: '0.5rem', fontBody: 'inter', fontHeading: 'manrope',
    };
  }
  if (finit('/theme/vitrine') || finit('/theme')) {
    return {
      colors: {
        background: '#08080a', foreground: '#f4f4f5', primary: '#ededed',
        accent: '#7c5cff', border: '#26262a', card: '#101013', muted: '#18181b',
      },
      radius: '0.25rem', fontBody: 'inter', fontHeading: 'manrope',
      typography: { body: 'inter', heading: 'manrope' },
    };
  }
  if (finit('/role-appearance')) {
    return {
      _id: 'ra1',
      roles: {
        DEV: { background: '#7c5cff', foreground: '#ffffff' },
        ADMIN: { background: '#0ea5e9', foreground: '#ffffff' },
      },
    };
  }
  if (finit('/meta')) return { mediaCatalog: [], environment: 'TEST' };
  if (contient('/system-configuration')) {
    const reseau = {
      backendUrl: 'https://api.exemple.test', managerUrl: 'https://manager.exemple.test',
      websiteUrl: 'https://exemple.test', mode: 'TEST',
    };
    return { config: reseau, effective: reseau, network: reseau };
  }
  if (contient('/public/network-configuration')) return {};
  if (contient('/public/bootstrap')) return { company: ENTREPRISE, devCompany: null, network: {} };
  if (finit('/my-contract')) return null;
  if (contient('/my-invoices/payment-requests')) return { items: [] };
  if (contient('/my-invoices/subscription-incidents')) return { incidents: [] };
  if (contient('/my-invoices') || contient('/invoices')) return FACTURES;
  if (contient('/contact-submissions')) return DEMANDES;
  if (contient('/commerce/products')) {
    return [
      { _id: 'pf1', title: 'Formation prothesie ongulaire', slug: 'formation-prothesie', kind: 'DISTANCE_TRAINING', status: 'PUBLISHED', price: { amountCents: 49000, currency: 'EUR' } },
      { _id: 'ps1', title: 'Pose gel signature', slug: 'pose-gel-signature', kind: 'SERVICE', status: 'PUBLISHED', price: { amountCents: 6500, currency: 'EUR' } },
      { _id: 'pb1', title: 'Carte cadeau BeautySavage', slug: 'carte-cadeau', kind: 'GIFT_CARD', status: 'PUBLISHED', price: { amountCents: 5000, currency: 'EUR' } },
    ];
  }
  if (contient('/commerce/sales')) return [];
  if (contient('/commerce/customers')) return [];
  if (contient('/commerce/commissions')) return [];
  if (contient('/commerce/reviews')) return [
    { _id: 'rv1', rating: 5, comment: LONG, displayName: 'Cliente', status: 'PENDING', createdAt: '2026-09-01T10:00:00.000Z', customerId: { email: 'cliente@example.test' }, productId: { title: 'Pose gel signature', kind: 'SERVICE' } },
  ];
  if (contient('/commerce/refund-requests')) return [
    { _id: 'rr1', status: 'REQUESTED', requestedAmountCents: 2000, eligibleAmountCents: 2000, reason: LONG, createdAt: '2026-09-01T10:00:00.000Z', customerId: { email: 'cliente@example.test' }, saleId: { saleNumber: 'BS-20260901-ABC', totalCents: 6500 } },
  ];
  if (contient('/commerce/gift-cards')) return [
    { _id: 'gc1', codeMasked: 'BS-AB••••EF', recipientName: 'Cliente', initialAmountCents: 5000, balanceCents: 3000, status: 'ACTIVE', createdAt: '2026-09-01T10:00:00.000Z' },
  ];
  if (contient('/commerce/training-submissions')) return [
    { _id: 'ts1', attempt: 1, status: 'PENDING', evaluationVersion: 1, createdAt: '2026-09-01T10:00:00.000Z', customerId: { email: 'cliente@example.test' }, productId: { title: 'Formation prothesie ongulaire', kind: 'DISTANCE_TRAINING' }, answersSnapshot: { question: 'reponse cliente' }, deliverablesSnapshot: { photo: 'fichier protege' } },
  ];
  if (contient('/commerce/integrations')) return [
    { provider: 'STRIPE_INSTITUTE', mode: 'TEST', verified: false, publicKey: '••••1234', secretKey: '••••5678', webhookSecret: '••••9012' },
  ];
  if (contient('/calendar/schedule')) {
    return {
      timezone: 'Europe/Paris',
      slotStepMinutes: 15,
      weeklyHours: [
        { weekday: 1, enabled: true, ranges: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }] },
        { weekday: 2, enabled: true, ranges: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }] },
        { weekday: 3, enabled: true, ranges: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }] },
        { weekday: 4, enabled: true, ranges: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }] },
        { weekday: 5, enabled: true, ranges: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }] },
        { weekday: 6, enabled: true, ranges: [{ start: '09:00', end: '13:00' }] },
        { weekday: 7, enabled: false, ranges: [] },
      ],
    };
  }
  if (contient('/calendar/events')) return [
    {
      id: 'ev1',
      type: 'SERVICE_BOOKING',
      title: 'Pose gel signature',
      startsAt: '2026-09-21T08:00:00.000Z',
      endsAt: '2026-09-21T09:30:00.000Z',
      status: 'SCHEDULED',
      customerSnapshot: { name: 'Cliente Recette', email: 'cliente@example.test', phone: '+33 6 00 00 00 00' },
      paymentSnapshot: { totalCents: 6500, paidCents: 2000, depositCents: 2000, balanceDueCents: 4500, currency: 'EUR' },
      notes: 'Acompte regle en ligne.',
    },
  ];
  if (contient('/contact-diagnostics')) return { checks: [], ready: true };
  if (contient('/domain-events')) return { items: [], total: 0 };
  if (contient('/email-deliveries')) return { items: [], total: 0 };
  if (contient('/email-templates')) return [];
  if (contient('/email-configuration')) return { modes: {}, provider: null };
  if (contient('/managed-webhooks')) return { providers: [] };
  if (contient('/panel-connection')) {
    return {
      paired: false,
      pairing: { panelUrl: null, panelName: null, projectId: null, pairedAt: null },
      bridge: null,
      outbox: { pending: 0, rejected: 0 },
      scheduler: null,
      company: null,
      suggested: { panelUrl: null, publicBackendUrl: null, hasPairingCode: false },
    };
  }
  if (contient('/deployment/targets')) return [];
  if (contient('/deployment/runs')) return [];
  if (contient('/deployment')) return [];
  if (contient('/admin/deployments')) return { targets: [], releases: [] };
  if (contient('/accounts')) return [];
  if (contient('/team')) return [];
  if (contient('/contracts')) return [];
  if (contient('/version')) return { version: '0.0.0-recette', shortCommit: 'abc1234', isDirty: false };
  if (contient('/live')) return {};
  return {};
}

/* ══════════════════════════════════════════════════════════════════════════
   LES ÉCRANS ET LES LARGEURS
   ══════════════════════════════════════════════════════════════════════════ */

const ECRANS = [
  ['Tableau de bord', '/'],
  ['Demandes de contact', '/demandes-contact'],
  ['Accueil (édition)', '/accueil'],
  ['Commerce - Formations', '/commerce/formations'],
  ['Commerce - Prestations', '/commerce/prestations'],
  ['Commerce - Calendrier', '/commerce/calendrier'],
  ['Commerce - Vente en ligne', '/commerce/vente'],
  ['Commerce - Cartes cadeaux', '/commerce/cartes-cadeaux'],
  ['Commerce - Validation formations', '/commerce/validation-formations'],
  ['Commerce - Avis', '/commerce/avis'],
  ['Commerce - Remboursements', '/commerce/remboursements'],
  ['Commerce - Commissions', '/commerce/commissions'],
  ['Commerce - Cles API', '/commerce/cles-api'],
  ['Commerce - Clients', '/commerce/clients'],
  ['Commerce - Ventes', '/commerce/ventes'],
  ['Pages (liste)', '/pages'],
  ['Page (fiche)', '/pages/p0'],
  ['Entreprise', '/entreprise'],
  ['Coordonnées', '/contacts'],
  ['Thème du site', '/theme'],
  ['Statut du site', '/statut'],
  ['Mon entreprise', '/mon-entreprise'],
  ['Mon contrat', '/contrat'],
  ['Factures', '/factures'],
  ['Mon profil', '/profil'],
  ['Aide', '/support/information'],
  ['DEV — Configuration', '/dev/configuration'],
  ['DEV — Panel', '/dev/panel'],
  ['DEV — Templates e-mail', '/dev/templates-email'],
  ['DEV — Livraisons e-mail', '/dev/livraisons-email'],
  ['DEV — Événements', '/dev/evenements'],
  ['DEV — Déploiement', '/dev/deploiement'],
  ['DEV — Destinations', '/dev/deploiements'],
  ['DEV — Comptes', '/dev/comptes'],
  ['DEV — Équipe', '/dev/equipe'],
  ['DEV — Entreprise', '/dev/entreprise'],
  ['DEV — Contrats', '/dev/contrats'],
  ['DEV — Thème manager', '/dev/theme-manager'],
  ['DEV — Couleurs des rôles', '/dev/roles'],
  ['Route inconnue (404)', '/cette-route-nexiste-pas'],
];

const LARGEURS = [
  { nom: '320', width: 320, height: 640, mobile: true },
  { nom: '390', width: 390, height: 844, mobile: true },
  { nom: '768', width: 768, height: 1024, mobile: true },
  { nom: '1440', width: 1440, height: 900, mobile: false },
];

/* ══════════════════════════════════════════════════════════════════════════
   LA SONDE — tout ce qui se mesure sur un écran rendu
   ══════════════════════════════════════════════════════════════════════════ */

const SONDE = `(() => {
  const doc = document.documentElement;
  const largeur = doc.clientWidth;

  /* Les coupables du débordement : les éléments dont la boîte SORT de l'écran.
     On remonte le DOM et on ne garde que les plus HAUTS — signaler quarante
     descendants d'un même tableau n'aide personne. */
  /* Un élément CLIPPÉ par un ancêtre ne fait pas défiler la page : sa boîte
     sort de l'écran, son PIXEL non. Sans ce filtre, la recette accusait des
     décors posés en absolu dans une carte à débordement masqué — et signalait un
     débordement là où scrollWidth valait exactement la largeur de l'écran. */
  const estClippe = (el) => {
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o === 'hidden' || o === 'clip' || o === 'auto' || o === 'scroll') return true;
    }
    return false;
  };

  const deborde = [];
  for (const el of document.body.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right <= largeur + 1 && r.left >= -1) continue;
    if (getComputedStyle(el).position === 'fixed') continue;
    if (estClippe(el)) continue;
    if (deborde.some((d) => d.el.contains(el))) continue;
    deborde.push({ el, info: {
      tag: el.tagName.toLowerCase(),
      cls: String(el.className?.baseVal ?? el.className ?? '').slice(0, 80),
      texte: (el.textContent || '').trim().slice(0, 40),
      gauche: Math.round(r.left), droite: Math.round(r.right),
    } });
  }

  /* Les commandes : bouton, lien, champ. On mesure leur nom accessible et leur
     surface tactile. Les éléments cachés ne comptent pas. */
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
      && Number(cs.opacity) > 0.05;
  };
  const nomAccessible = (el) => (
    (el.getAttribute('aria-label') || '').trim()
    || (el.getAttribute('title') || '').trim()
    || (el.textContent || '').trim()
    || (el.getAttribute('alt') || '').trim()
    || (el.labels && el.labels.length ? [...el.labels].map((l) => l.textContent).join(' ').trim() : '')
    || (el.getAttribute('placeholder') || '').trim()
    || (el.getAttribute('aria-labelledby')
      ? [...el.getAttribute('aria-labelledby').split(/\\s+/)]
        .map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim()
      : '')
  );

  const muets = [];
  const trop_petits = [];
  for (const el of document.querySelectorAll('button, a[href], [role="button"], [role="switch"]')) {
    if (!visible(el)) continue;
    if (!nomAccessible(el)) {
      muets.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 60) });
    }
    /*
      UN LIEN DANS UNE PHRASE N'EST PAS UNE CIBLE TACTILE.

      « ← Tous les chapitres » est un lien de texte : sa hauteur est celle de sa
      ligne, et l'exiger à vingt-quatre pixels reviendrait à interdire les liens
      en ligne. La règle des cibles vise les COMMANDES — boutons, interrupteurs,
      liens dessinés en bouton. On les reconnaît à leur affichage : un lien en
      display inline est du texte ; en inline-flex, flex ou block, c'est un
      bouton.
    */
    const cs2 = getComputedStyle(el);
    const estTexte = el.tagName === 'A' && cs2.display.startsWith('inline')
      && cs2.display !== 'inline-flex' && cs2.display !== 'inline-block';
    if (estTexte) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 24 || r.width < 24) {
      trop_petits.push({
        nom: nomAccessible(el).slice(0, 30),
        w: Math.round(r.width), h: Math.round(r.height),
      });
    }
  }

  const champsSansNom = [];
  for (const el of document.querySelectorAll('input, textarea, select')) {
    if (!visible(el)) continue;
    if (el.type === 'hidden') continue;
    if (!nomAccessible(el)) {
      champsSansNom.push({ type: el.type || el.tagName.toLowerCase(), name: el.name || '', id: el.id || '' });
    }
  }

  const texte = document.body.innerText || '';
  return {
    largeur,
    scrollWidth: doc.scrollWidth,
    deborde: deborde.map((d) => d.info).slice(0, 6),
    muets: muets.slice(0, 6),
    trop_petits: trop_petits.slice(0, 6),
    champsSansNom: champsSansNom.slice(0, 6),
    longueurTexte: texte.trim().length,
    extrait: texte.trim().slice(0, 120),
    fuites: [
      ...(/(^|\\s)undefined(\\s|$)/.test(texte) ? ['undefined'] : []),
      ...(/(^|\\s)null(\\s|$)/.test(texte) ? ['null'] : []),
      ...(/\\bNaN\\b/.test(texte) ? ['NaN'] : []),
      ...(/\\[object Object\\]/.test(texte) ? ['[object Object]'] : []),
      ...(/\\bat [A-Za-z$_][\\w$]*\\s+\\(/.test(texte) ? ['trace de pile'] : []),
    ],
    chargement: /chargement/i.test(texte) && texte.trim().length < 200,
  };
})()`;

/* ══════════════════════════════════════════════════════════════════════════
   LA RECETTE
   ══════════════════════════════════════════════════════════════════════════ */

const navigateur = await chromium.launch();
const resultats = [];

for (const vp of LARGEURS) {
  const context = await navigateur.newContext({
    viewport: { width: vp.width, height: vp.height },
    hasTouch: vp.mobile,
    isMobile: vp.mobile,
    deviceScaleFactor: vp.mobile ? 3 : 1,
  });

  await context.route('**/api/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: corpsPour(new URL(route.request().url()).pathname) }),
    });
  });
  await context.addInitScript((cle) => {
    localStorage.setItem(cle, 'jeton-de-recette');
  }, CLE_SESSION);

  const page = await context.newPage();

  for (const [nom, route] of ECRANS) {
    const journal = [];
    const onConsole = (m) => {
      if (m.type() === 'error' || m.type() === 'warning') journal.push(`${m.type()}: ${m.text()}`);
    };
    const onErreur = (e) => journal.push(`pageerror: ${String(e)}`);
    page.on('console', onConsole);
    page.on('pageerror', onErreur);

    let sonde = null;
    let echecNavigation = null;
    try {
      await page.goto(`http://localhost:${PORT}${route}`, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(500);
      sonde = await page.evaluate(SONDE);
    } catch (e) {
      echecNavigation = String(e).split('\n')[0];
    }

    page.off('console', onConsole);
    page.off('pageerror', onErreur);

    /*
      LE BRUIT QUI N'EN EST PAS.

      Les bouchons ne servent pas d'images : le navigateur journalise donc des
      échecs de ressources qui n'existent pas dans le produit. On les écarte
      NOMMÉMENT plutôt que de baisser le niveau de toute la recette.
    */
    const pertinents = journal.filter((l) => !(
      /Failed to load resource/i.test(l)
      || /favicon/i.test(l)
      || /net::ERR_/i.test(l)
      || /Download the React DevTools/i.test(l)
    ));

    resultats.push({
      viewport: vp.nom, nom, route, echecNavigation, sonde, journal: pertinents,
    });
  }

  await context.close();
}

/* ══════════════════════════════════════════════════════════════════════════
   LE PARCOURS DE LA CONTRAINTE — ce que la balayage ne peut pas voir
   ══════════════════════════════════════════════════════════════════════════

   Le balayage ci-dessus regarde des écrans au repos. Il ne dit rien de ce qui
   se passe quand on TAPE : la limite est-elle appliquée à la saisie ? le
   compteur apparaît-il ? le bouton d'ajout dit-il pourquoi il ne répond plus ?

   C'est exactement le défaut d'origine — une contrainte qui n'existait qu'au
   moment d'enregistrer —, et c'est donc le parcours qui doit être figé.        */

const parcours = [];
{
  const context = await navigateur.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route('**/api/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: corpsPour(new URL(route.request().url()).pathname) }),
    });
  });
  await context.addInitScript((cle) => {
    localStorage.setItem(cle, 'jeton-de-recette');
  }, CLE_SESSION);

  const page = await context.newPage();
  const noteP = (nom, ok, detail) => parcours.push({ nom, ok, detail: detail ?? '' });

  await page.goto(`http://localhost:${PORT}/entreprise`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  /* Le bouchon sert QUATRE principes : c'est le nombre que la vitrine dessine,
     et celui que la graine livrait pendant que l'écran en refusait un. */
  const lignes = await page.locator('input[placeholder="Identité"]').count();
  noteP('les quatre principes sont éditables', lignes === 4, `lignes=${lignes}`);

  const ajout = page.locator('button', { hasText: 'Ajouter' }).first();
  noteP('le bouton « Ajouter » reste VISIBLE à la limite', await ajout.isVisible());
  noteP('…et il est désactivé', await ajout.isDisabled());
  const raison = await ajout.getAttribute('title');
  noteP(
    '…et il PORTE SA RAISON',
    Boolean(raison) && /maximum/i.test(raison ?? ''),
    `title=${raison}`,
  );

  /* La contrainte est appliquée à la SAISIE, pas au moment d'enregistrer. */
  const explication = page.locator('input[placeholder^="Ce qui vous distingue"]').first();
  const maxAttendu = await explication.getAttribute('maxlength');
  noteP('l’explication porte une longueur maximale', maxAttendu === '120', `maxlength=${maxAttendu}`);

  await explication.fill('');
  await explication.type('x'.repeat(130), { delay: 0 });
  const saisi = await explication.inputValue();
  noteP(
    'le champ REFUSE la 121ᵉ frappe au lieu de la refuser au serveur',
    saisi.length === 120,
    `saisi=${saisi.length}`,
  );

  /* Et le blocage s'explique : sans compteur, un champ qui n'accepte plus rien
     se lit comme un clavier cassé. */
  const compteur = await page.locator('[aria-live="polite"]', { hasText: '120 / 120' }).count();
  noteP('un compteur annonce la limite atteinte', compteur > 0, `compteurs=${compteur}`);

  /* ── L'ACCUEIL : mêmes règles, autre écran ─────────────────────────────── */
  await page.goto(`http://localhost:${PORT}/accueil`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  const titreBanniere = page.locator('input[placeholder^="Ex : Un site qui transforme"]').first();
  noteP(
    'le titre de bannière porte lui aussi sa limite',
    (await titreBanniere.getAttribute('maxlength')) === '80',
    `maxlength=${await titreBanniere.getAttribute('maxlength')}`,
  );

  /* Les listes bornées annoncent leur plafond AVANT d'être pleines. */
  const annonces = await page.locator('text=/au maximum/').count();
  noteP('les listes bornées annoncent leur plafond', annonces >= 3, `annonces=${annonces}`);

  await context.close();
}

await navigateur.close();
serveur.close();

/* ══════════════════════════════════════════════════════════════════════════
   LE RAPPORT
   ══════════════════════════════════════════════════════════════════════════ */

let pass = 0;
let fail = 0;
const echecs = [];

function noter(cle, ok, detail) {
  if (ok) pass += 1;
  else { fail += 1; echecs.push(`${cle} — ${detail}`); }
}

for (const r of resultats) {
  const cle = `${r.viewport}px · ${r.nom}`;
  if (r.echecNavigation) {
    noter(cle, false, `navigation impossible : ${r.echecNavigation}`);
    continue;
  }
  const s = r.sonde;
  noter(`${cle} · débordement horizontal`, s.deborde.length === 0 && s.scrollWidth <= s.largeur + 1,
    `scrollWidth=${s.scrollWidth}/${s.largeur} · ${JSON.stringify(s.deborde)}`);
  noter(`${cle} · écran non vide`, s.longueurTexte > 40, `${s.longueurTexte} caractères · « ${s.extrait} »`);
  noter(`${cle} · aucun chargement figé`, !s.chargement, `« ${s.extrait} »`);
  noter(`${cle} · aucune fuite technique`, s.fuites.length === 0, s.fuites.join(', '));
  noter(`${cle} · commandes nommées`, s.muets.length === 0, JSON.stringify(s.muets));
  noter(`${cle} · champs étiquetés`, s.champsSansNom.length === 0, JSON.stringify(s.champsSansNom));
  noter(`${cle} · cibles tactiles ≥ 24 px`, s.trop_petits.length === 0, JSON.stringify(s.trop_petits));
  noter(`${cle} · console propre`, r.journal.length === 0, r.journal.slice(0, 3).join(' | '));
}

for (const c of parcours) {
  noter(`parcours · ${c.nom}`, c.ok, c.detail);
}

console.log(`\n${'═'.repeat(74)}`);
console.log(`RECETTE DES ÉCRANS — ${ECRANS.length} écrans × ${LARGEURS.length} largeurs`);
console.log('═'.repeat(74));

if (echecs.length) {
  console.log(`\n${echecs.length} contrôle(s) en échec :\n`);
  for (const e of echecs) console.log(`  ✗ ${e}`);
}

console.log(`\n${pass} réussis, ${fail} échoués`);
console.log(`\nVERDICT : ${fail === 0 ? 'PASS' : 'FAIL'}`);
process.exit(fail === 0 ? 0 : 1);
