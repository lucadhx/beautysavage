import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSingleton } from '../../utils/singleton.js';
import { Company } from '../../models/Company.model.js';
import { HomeContent } from '../../models/HomeContent.model.js';
import { Theme } from '../../models/Theme.model.js';
import { SiteStatus } from '../../models/SiteStatus.model.js';
import { SitePage } from '../../models/SitePage.model.js';
import { SystemConfiguration } from '../../models/SystemConfiguration.model.js';
import { CommerceProduct, PRODUCT_STATUS } from '../../models/CommerceProduct.model.js';
import { Review } from '../../models/Review.model.js';
import { BookingSchedule } from '../../models/BookingSchedule.model.js';
import { SeoSettings } from '../../models/SeoSettings.model.js';
import { listPublicCollections } from '../serviceCollection.service.js';
import { projectCompanyMedia, projectHomeContentMedia, resolveOne } from '../media/mediaProjection.service.js';
import { iconVersion } from './siteIcon.service.js';

/**
 * LE RÉFÉRENCEMENT DE LA VITRINE — SEO (moteurs) et GEO (assistants IA).
 *
 * ══ LE PROBLÈME ═════════════════════════════════════════════════════════════
 *
 * La vitrine est une application à page unique : toutes ses adresses livrent
 * la même coquille HTML, que React remplit ensuite. Google exécute le
 * JavaScript, avec retard ; les robots des assistants IA (GPTBot, ClaudeBot,
 * PerplexityBot…) n'en exécutent AUCUN. Ils ne voyaient donc qu'un titre et
 * une description hérités du projet source — ceux d'une autre entreprise.
 *
 * ══ LE PRINCIPE ═════════════════════════════════════════════════════════════
 *
 * Tout est DÉRIVÉ des données, à chaque requête (cache de 30 s, vidé à chaque
 * enregistrement) : ce que l'institut modifie dans le Manager — une offre, un
 * prix, une session, un avis publié, un horaire — se retrouve dans le titre,
 * la description, les données structurées, le plan du site, le robots.txt et
 * le llms.txt, sans aucune action de sa part. Les réglages de référencement
 * (SeoSettings) et les champs SEO d'une fiche ne font que PRENDRE LA MAIN sur
 * une valeur dérivée.
 *
 * Une seule fonction décrit chaque adresse (`resolveRoute`) ; elle sert à la
 * fois au rendu serveur (robots) et à l'application (navigation), qui
 * l'interroge par `/api/public/seo`. Les deux ne peuvent donc pas diverger.
 *
 * Règle tenue partout : n'affirmer que ce qui est VRAI et VISIBLE sur la page
 * (prix, avis, horaires, FAQ). Aucune note n'est posée sur l'établissement
 * lui-même : les avis publiés concernent les offres, et c'est là qu'ils sont
 * déclarés.
 */

const TTL_MS = 30_000;
let dataCache = { at: 0, promise: null };
const htmlCache = new Map();

/** Vidé après chaque écriture réussie (voir app.js) et à l'enregistrement des réglages. */
export function invalidateSeoCache() {
  dataCache = { at: 0, promise: null };
  htmlCache.clear();
}

const KIND_GROUP = {
  SERVICE: 'service',
  DISTANCE_TRAINING: 'training',
  IN_PERSON_TRAINING: 'training',
  GIFT_CARD: 'gift',
  PRODUCT: 'product',
};

const KIND_LABEL = {
  SERVICE: 'Prestation',
  DISTANCE_TRAINING: 'Formation en ligne',
  IN_PERSON_TRAINING: 'Formation en présentiel',
  GIFT_CARD: 'Carte cadeau',
  PRODUCT: 'Produit',
};

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const JOURS_COURTS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

/** Adresses privées : jamais indexées, et fermées dans le robots.txt. */
const PRIVATE_PREFIXES = ['/panier', '/paiement', '/espace-client', '/connexion-client', '/inscription-client', '/verification-email'];
const PRIVATE_TITLES = {
  '/panier': 'Panier',
  '/paiement/succes': 'Paiement confirmé',
  '/connexion-client': 'Connexion à votre espace',
  '/inscription-client': 'Créer votre espace client',
  '/verification-email': 'Vérifiez votre e-mail',
  '/espace-client': 'Votre espace client',
  '/espace-client/formations': 'Vos formations',
  '/espace-client/mot-de-passe': 'Mot de passe',
};

const LEGAL_ROUTES = {
  '/mentions-legales': { type: 'LEGAL_NOTICE', title: 'Mentions légales' },
  '/politique-de-confidentialite': { type: 'PRIVACY_POLICY', title: 'Politique de confidentialité' },
};

const CATALOGS = {
  '/prestations': { group: 'service', label: 'Prestations' },
  '/formations': { group: 'training', label: 'Formations' },
  '/cartes-cadeaux': { group: 'gift', label: 'Cartes cadeaux' },
  '/boutique': { group: 'all', label: 'Boutique' },
};

/* ── Outils de texte ─────────────────────────────────────────────────────── */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç' };

export function stripHtml(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h[1-6]|div)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, code) => {
      if (code[0] === '#') {
        const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[code.toLowerCase()] ?? m;
    })
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

const oneLine = (text) => String(text || '').replace(/\s+/g, ' ').trim();

/** Deux phrases bout à bout, sans double ponctuation (« soin.. Un soin »). */
function joinSentences(...parts) {
  return parts.map(oneLine).filter(Boolean).reduce((acc, part) => (acc ? `${/[.!?…]$/.test(acc) ? acc : `${acc}.`} ${part}` : part), '');
}

/** Coupe proprement, au mot, avec une ellipse. */
export function clip(text, max) {
  const t = oneLine(text);
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.–—-]+$/, '')}…`;
}

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const euroFmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2, minimumFractionDigits: 0 });
const eur = (cents) => euroFmt.format((Number(cents) || 0) / 100).replace(/\u202f|\u00a0/g, ' ');

function duration(minutes) {
  const m = Number(minutes) || 0;
  if (m <= 0) return '';
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r} min`;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
}

const dateFr = (d, tz) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: tz });

/* ── Données ─────────────────────────────────────────────────────────────── */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(HERE, '..', '..', '..');

export async function loadSeoData() {
  if (dataCache.promise && Date.now() - dataCache.at < TTL_MS) return dataCache.promise;
  const promise = (async () => {
    const { listAvailableLegalDocuments } = await import('../panelConfiguration/legalDocument.service.js');
    const [cfg, company, home, theme, status, settings, schedule, products, reviews, pages, legal, collections] = await Promise.all([
      getSingleton(SystemConfiguration),
      getSingleton(Company),
      getSingleton(HomeContent),
      getSingleton(Theme),
      getSingleton(SiteStatus),
      getSingleton(SeoSettings),
      BookingSchedule.findOne().lean(),
      CommerceProduct.find({ status: PRODUCT_STATUS.PUBLISHED }).sort({ boostRank: 1, title: 1 }).lean(),
      Review.find({ status: 'PUBLISHED' }).select('productId rating comment displayName createdAt').sort({ createdAt: -1 }).lean(),
      SitePage.find({ published: true }).sort({ navOrder: 1, order: 1, createdAt: 1 }).lean(),
      listAvailableLegalDocuments().catch(() => []),
      listPublicCollections().catch(() => []),
    ]);
    const [companyP, homeP, shareImage] = await Promise.all([
      projectCompanyMedia(company),
      projectHomeContentMedia(home),
      resolveOne(settings.shareImageMedia, settings.shareImage),
    ]);
    const base = String(cfg.network?.websiteUrl ?? '').replace(/\/+$/, '');

    const byProduct = new Map();
    for (const r of reviews) {
      const key = String(r.productId);
      if (!byProduct.has(key)) byProduct.set(key, []);
      byProduct.get(key).push(r);
    }
    const media = Object.fromEntries(
      (company.media || []).filter((m) => m.enabled && String(m.value || '').trim()).map((m) => [m.key, String(m.value).trim()]),
    );
    const s = settings.toObject ? settings.toObject() : settings;
    return {
      base,
      company: companyP,
      home: homeP,
      theme: theme.toObject ? theme.toObject() : theme,
      suspended: status.status === 'SUSPENDED',
      settings: s,
      shareImage: shareImage || '',
      schedule,
      products,
      reviewsByProduct: byProduct,
      reviewCount: reviews.length,
      pages,
      collections,
      legal: new Set((legal || []).map((d) => d.type)),
      media,
    };
  })();
  dataCache = { at: Date.now(), promise };
  promise.catch(() => { dataCache = { at: 0, promise: null }; });
  return promise;
}

/* ── Faits dérivés ───────────────────────────────────────────────────────── */

function abs(data, url) {
  const u = String(url || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  return `${data.base}${u.startsWith('/') ? '' : '/'}${u}`;
}

const productUrl = (data, p) => `${data.base}/catalogue/${encodeURIComponent(p.slug)}`;
const productImage = (data, p) => abs(data, p.coverUrl || p.gallery?.[0] || '');

function rating(list) {
  if (!list?.length) return null;
  const avg = list.reduce((sum, r) => sum + Number(r.rating || 0), 0) / list.length;
  return { value: Math.round(avg * 10) / 10, count: list.length };
}

function city(data) {
  return oneLine(data.settings.address?.city || '');
}

function futureSessions(p) {
  const now = Date.now();
  return (p.sessions || [])
    .filter((s) => s.status === 'ACTIVE' && new Date(s.startsAt).getTime() > now)
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
}

/** Horaires d'ouverture, lisibles : « Lun–Ven 09:00–12:00, 14:00–18:00 · Sam 09:00–13:00 ». */
function hoursText(data) {
  const days = (data.schedule?.weeklyHours || []).filter((d) => d.enabled && d.ranges?.length).sort((a, b) => a.weekday - b.weekday);
  if (!days.length) return '';
  const groups = [];
  for (const d of days) {
    const key = d.ranges.map((r) => `${r.start}–${r.end}`).join(', ');
    const last = groups[groups.length - 1];
    if (last && last.key === key && last.to === d.weekday - 1) last.to = d.weekday;
    else groups.push({ from: d.weekday, to: d.weekday, key });
  }
  return groups.map((g) => `${JOURS_COURTS[g.from - 1]}${g.to !== g.from ? `–${JOURS_COURTS[g.to - 1]}` : ''} ${g.key}`).join(' · ');
}

function openingHoursSpec(data) {
  const out = [];
  for (const d of data.schedule?.weeklyHours || []) {
    if (!d.enabled) continue;
    for (const r of d.ranges || []) {
      out.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: `https://schema.org/${WEEKDAYS[d.weekday - 1]}`, opens: r.start, closes: r.end });
    }
  }
  return out;
}

function addressText(data) {
  const a = data.settings.address || {};
  const structured = [a.street, [a.postalCode, a.city].filter(Boolean).join(' ')].filter((x) => oneLine(x)).join(', ');
  return structured || data.media.address || '';
}

function socialProfiles(data) {
  const out = [];
  const ig = data.media.instagram;
  if (ig) out.push(/^https?:/i.test(ig) ? ig : `https://www.instagram.com/${ig.replace(/^@/, '')}`);
  const li = data.media.linkedin;
  if (li && /^https?:/i.test(li)) out.push(li);
  for (const u of data.settings.sameAs || []) if (/^https?:\/\//i.test(u)) out.push(u);
  return [...new Set(out)];
}

const siteName = (data) => oneLine(data.company.name) || 'Institut';

function composeTitle(data, title) {
  const name = siteName(data);
  const t = oneLine(title);
  if (!t) return name;
  if (t.toLowerCase().includes(name.toLowerCase())) return t;
  return `${t} · ${name}`;
}

/* ── Descriptions automatiques ──────────────────────────────────────────── */

function productFacts(data, p) {
  const c = city(data);
  const price = eur(p.price?.amountCents);
  switch (p.kind) {
    case 'SERVICE': {
      const d = duration(p.durationMinutes);
      return `Prestation${d ? ` de ${d}` : ''} à ${price}${c ? ` à ${c}` : ''}. Réservation en ligne.`;
    }
    case 'DISTANCE_TRAINING':
      return `Formation en ligne à ${price}, accès à votre espace après l’achat.`;
    case 'IN_PERSON_TRAINING': {
      const next = futureSessions(p)[0];
      const lieu = oneLine(p.training?.location) || c;
      const tz = data.schedule?.timezone || 'Europe/Paris';
      return `Formation en présentiel${lieu ? ` à ${lieu}` : ''} à ${price}${next ? `, prochaine session le ${dateFr(next.startsAt, tz)}` : ''}.`;
    }
    case 'GIFT_CARD':
      return `Carte cadeau à ${price}, envoyée par e-mail.`;
    default:
      return `${price}.`;
  }
}

function productDescription(data, p) {
  if (oneLine(p.seo?.metaDescription)) return clip(p.seo.metaDescription, 160);
  const facts = productFacts(data, p);
  const intro = oneLine(p.subtitle) || stripHtml(p.description);
  if (!intro) return clip(`${p.title} — ${facts}`, 160);
  const room = Math.max(60, 158 - facts.length - 1);
  return clip(`${clip(intro, room)} ${facts}`, 160);
}

/**
 * Le titre d'une offre, dans la limite de ce qu'affiche un moteur (~60 signes) :
 * on tente la forme la plus informative, puis on retire le type, puis la marque.
 * Le type n'est pas répété s'il figure déjà dans le nom (« Formation … »).
 */
function productTitle(data, p) {
  if (oneLine(p.seo?.metaTitle)) return composeTitle(data, p.seo.metaTitle);
  const name = siteName(data);
  const title = oneLine(p.title);
  const c = city(data);
  const label = KIND_LABEL[p.kind] || '';
  const redundant = label && title.toLowerCase().includes(label.split(' ')[0].toLowerCase());
  const place = p.kind === 'SERVICE' && c ? ` à ${c}` : '';
  const qualified = label && !redundant ? `${title} — ${label}${place}` : `${title}${place}`;
  const candidates = [`${qualified} · ${name}`, `${title}${place} · ${name}`, `${title} · ${name}`, title];
  return candidates.find((t) => t.length <= 65) || clip(title, 65);
}

function homeDescription(data) {
  if (oneLine(data.settings.homeDescription)) return clip(data.settings.homeDescription, 160);
  const intro = oneLine(data.company.homeIntro) || oneLine(data.home?.hero?.subtitle);
  const tagline = oneLine(data.company.tagline);
  const text = joinSentences(tagline, intro);
  return clip(text || `${siteName(data)} — prestations et formations.`, 160);
}

/* ── Données structurées (schema.org, JSON-LD) ──────────────────────────── */

function businessNode(data, { withCatalog = false } = {}) {
  const s = data.settings;
  const a = s.address || {};
  const logo = abs(data, data.company.logos?.header);
  const image = abs(data, data.shareImage || data.home?.hero?.image || data.company.heroImage) || logo;
  const node = {
    '@type': s.businessType || 'BeautySalon',
    '@id': `${data.base}/#business`,
    name: siteName(data),
    url: `${data.base}/`,
    description: homeDescription(data),
    slogan: oneLine(data.company.tagline) || undefined,
    logo: logo ? { '@type': 'ImageObject', url: logo } : undefined,
    image: image || undefined,
    telephone: data.media.phone || undefined,
    email: data.media.email || undefined,
    priceRange: oneLine(s.priceRange) || undefined,
    areaServed: oneLine(s.areaServed) || (city(data) || undefined),
    sameAs: socialProfiles(data),
    openingHoursSpecification: openingHoursSpec(data),
  };
  if (oneLine(a.street) || oneLine(a.city)) {
    node.address = {
      '@type': 'PostalAddress',
      streetAddress: oneLine(a.street) || undefined,
      postalCode: oneLine(a.postalCode) || undefined,
      addressLocality: oneLine(a.city) || undefined,
      addressRegion: oneLine(a.region) || undefined,
      addressCountry: oneLine(a.country) || 'FR',
    };
  } else if (data.media.address) {
    node.address = data.media.address;
  }
  if (Number.isFinite(s.geo?.latitude) && Number.isFinite(s.geo?.longitude) && s.geo.latitude !== null) {
    node.geo = { '@type': 'GeoCoordinates', latitude: s.geo.latitude, longitude: s.geo.longitude };
  }
  const nda = oneLine(data.company.trainingDeclaration?.number);
  if (nda) {
    node.identifier = { '@type': 'PropertyValue', propertyID: 'NDA', name: 'Numéro de déclaration d’activité (organisme de formation)', value: nda };
  }
  const knows = [...new Set(data.products.filter((p) => p.kind === 'SERVICE').map((p) => oneLine(p.title)))].slice(0, 12);
  if (knows.length) node.knowsAbout = knows;
  if (withCatalog && data.products.length) {
    const group = (kinds, label) => {
      const items = data.products.filter((p) => kinds.includes(p.kind));
      if (!items.length) return null;
      return {
        '@type': 'OfferCatalog',
        name: label,
        itemListElement: items.map((p) => ({
          '@type': 'Offer',
          url: productUrl(data, p),
          price: ((p.price?.amountCents || 0) / 100).toFixed(2),
          priceCurrency: 'EUR',
          itemOffered: { '@id': `${productUrl(data, p)}#offer-item`, '@type': p.kind === 'SERVICE' ? 'Service' : p.kind.includes('TRAINING') ? 'Course' : 'Product', name: p.title },
        })),
      };
    };
    const catalogs = [group(['SERVICE'], 'Prestations'), group(['DISTANCE_TRAINING', 'IN_PERSON_TRAINING'], 'Formations'), group(['GIFT_CARD', 'PRODUCT'], 'Cartes cadeaux')].filter(Boolean);
    node.hasOfferCatalog = { '@type': 'OfferCatalog', name: `Offres ${siteName(data)}`, itemListElement: catalogs };
  }
  return node;
}

function websiteNode(data) {
  return {
    '@type': 'WebSite',
    '@id': `${data.base}/#website`,
    url: `${data.base}/`,
    name: siteName(data),
    inLanguage: 'fr-FR',
    publisher: { '@id': `${data.base}/#business` },
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${data.base}/boutique?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };
}

function breadcrumbNode(data, url, trail) {
  return {
    '@type': 'BreadcrumbList',
    '@id': `${url}#breadcrumb`,
    itemListElement: [{ name: 'Accueil', url: `${data.base}/` }, ...trail].map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

function webPageNode(data, { url, type = 'WebPage', name, description, image, breadcrumb, dateModified, extra = {} }) {
  return {
    '@type': type,
    '@id': `${url}#webpage`,
    url,
    name,
    description,
    inLanguage: 'fr-FR',
    isPartOf: { '@id': `${data.base}/#website` },
    about: { '@id': `${data.base}/#business` },
    primaryImageOfPage: image ? { '@type': 'ImageObject', url: image } : undefined,
    breadcrumb: breadcrumb ? { '@id': `${url}#breadcrumb` } : undefined,
    dateModified: dateModified ? new Date(dateModified).toISOString() : undefined,
    ...extra,
  };
}

function offerOf(data, p, url) {
  return {
    '@type': 'Offer',
    url,
    price: ((p.price?.amountCents || 0) / 100).toFixed(2),
    priceCurrency: 'EUR',
    availability: 'https://schema.org/InStock',
    seller: { '@id': `${data.base}/#business` },
  };
}

function reviewNodes(list) {
  return list.slice(0, 5).map((r) => ({
    '@type': 'Review',
    author: { '@type': 'Person', name: oneLine(r.displayName) || 'Cliente' },
    datePublished: new Date(r.createdAt).toISOString().slice(0, 10),
    reviewBody: oneLine(r.comment) || undefined,
    reviewRating: { '@type': 'Rating', ratingValue: r.rating, bestRating: 5, worstRating: 1 },
  }));
}

function productNode(data, p) {
  const url = productUrl(data, p);
  const list = data.reviewsByProduct.get(String(p._id)) || [];
  const r = rating(list);
  const image = [p.coverUrl, ...(p.gallery || [])].map((u) => abs(data, u)).filter(Boolean);
  const common = {
    '@id': `${url}#offer-item`,
    name: p.title,
    description: clip(joinSentences(oneLine(p.subtitle), stripHtml(p.description)), 5000) || undefined,
    image: image.length ? image : undefined,
    url,
    aggregateRating: r ? { '@type': 'AggregateRating', ratingValue: r.value, reviewCount: r.count, bestRating: 5, worstRating: 1 } : undefined,
    review: list.length ? reviewNodes(list) : undefined,
  };
  if (p.kind === 'SERVICE') {
    return {
      ...common,
      '@type': 'Service',
      serviceType: p.title,
      provider: { '@id': `${data.base}/#business` },
      areaServed: oneLine(data.settings.areaServed) || city(data) || undefined,
      offers: offerOf(data, p, url),
      ...(p.durationMinutes ? { additionalProperty: { '@type': 'PropertyValue', name: 'Durée', value: duration(p.durationMinutes) } } : {}),
    };
  }
  if (p.kind === 'DISTANCE_TRAINING' || p.kind === 'IN_PERSON_TRAINING') {
    const online = p.kind === 'DISTANCE_TRAINING';
    const address = oneLine(p.training?.location) || addressText(data);
    const instances = online
      ? [{ '@type': 'CourseInstance', courseMode: 'Online', inLanguage: 'fr' }]
      : futureSessions(p).slice(0, 10).map((s) => ({
        '@type': 'CourseInstance',
        courseMode: 'Onsite',
        startDate: new Date(s.startsAt).toISOString(),
        endDate: new Date(s.endsAt).toISOString(),
        location: address ? { '@type': 'Place', name: siteName(data), address } : undefined,
        inLanguage: 'fr',
      }));
    return {
      ...common,
      '@type': 'Course',
      provider: { '@type': 'Organization', name: siteName(data), sameAs: `${data.base}/` },
      inLanguage: 'fr',
      educationalCredentialAwarded: p.evaluation?.enabled ? 'Attestation de formation après évaluation finale' : undefined,
      offers: { ...offerOf(data, p, url), category: 'Paid' },
      hasCourseInstance: instances.length ? instances : [{ '@type': 'CourseInstance', courseMode: 'Onsite', inLanguage: 'fr' }],
    };
  }
  return {
    ...common,
    '@type': 'Product',
    brand: { '@type': 'Brand', name: siteName(data) },
    offers: offerOf(data, p, url),
  };
}

function faqNode(url, faq) {
  const rows = (faq || [])
    .map((f) => ({ q: oneLine(f?.question), a: stripHtml(f?.answer) }))
    .filter((f) => f.q && f.a);
  if (!rows.length) return null;
  return {
    '@type': 'FAQPage',
    '@id': `${url}#faq`,
    mainEntity: rows.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
}

function itemListNode(data, url, items) {
  return {
    '@type': 'ItemList',
    '@id': `${url}#list`,
    numberOfItems: items.length,
    itemListElement: items.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: productUrl(data, p), name: p.title })),
  };
}

/** Retire les clés vides — une donnée structurée ne déclare que ce qu'elle sait. */
function prune(value) {
  if (Array.isArray(value)) {
    const arr = value.map(prune).filter((v) => v !== undefined);
    return arr.length ? arr : undefined;
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const p = prune(v);
      if (p !== undefined && p !== '') out[k] = p;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return value === null ? undefined : value;
}

/** Les prestations publiées rangées dans aucune collection (même règle que la vitrine). */
function otherServicesGroup(data) {
  if (!(data.collections || []).length) return null;
  const placed = new Set(data.collections.flatMap((c) => c.productIds));
  const ids = data.products.filter((p) => p.kind === 'SERVICE' && !placed.has(String(p._id))).map((p) => String(p._id));
  return ids.length ? { slug: 'autres-prestations', title: 'Autres prestations', description: 'Les prestations qui ne sont rangées dans aucune collection.', coverUrl: '', productIds: ids } : null;
}

/* ── Résolution d'une adresse ───────────────────────────────────────────── */

function normalizePath(raw) {
  let p = String(raw || '/').split('?')[0].split('#')[0];
  try { p = decodeURIComponent(p); } catch { /* garde la forme brute */ }
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p || '/';
}

const byGroup = (data, group) => data.products.filter((p) => group === 'all' || KIND_GROUP[p.kind] === group);

function featured(items) {
  const chosen = items.filter((p) => p.homeFeatured).sort((a, b) => (a.homeFeaturedRank ?? Infinity) - (b.homeFeaturedRank ?? Infinity));
  return chosen.length ? chosen : items.slice(0, 3);
}

/**
 * CE QU'UNE ADRESSE DE LA VITRINE DÉCLARE — titre, description, canonique,
 * directives robots, image de partage, données structurées, et le contenu
 * lisible servi aux robots qui n'exécutent pas le JavaScript.
 */
export async function resolveRoute(rawPath, { originFallback = '' } = {}) {
  const data = await loadSeoData();
  if (!data.base) data.base = originFallback.replace(/\/+$/, '');
  const pathname = normalizePath(rawPath);
  const name = siteName(data);
  const defaultImage = abs(data, data.shareImage || data.home?.hero?.image || data.company.heroImage || data.company.logos?.header);
  const indexable = data.settings.indexable !== false && !data.suspended;
  const url = `${data.base}${pathname === '/' ? '/' : pathname}`;

  const route = {
    pathname,
    status: 200,
    title: name,
    description: homeDescription(data),
    canonical: url,
    robots: indexable ? 'index, follow, max-image-preview:large, max-snippet:-1' : 'noindex, nofollow',
    ogType: 'website',
    image: defaultImage,
    imageAlt: name,
    jsonLd: [],
    body: '',
    preload: [],
    // Empreinte du favicon du Manager : les balises d'icône la portent (voir siteIcon.service).
    iconVersion: iconVersion(data),
  };
  const graph = [businessNode(data, { withCatalog: pathname === '/' }), websiteNode(data)];

  if (data.suspended) route.status = 503;

  if (pathname === '/') {
    route.title = composeTitle(data, oneLine(data.settings.homeTitle) || [name, oneLine(data.company.tagline)].filter(Boolean).join(' · '));
    graph.push(webPageNode(data, { url, name: route.title, description: route.description, image: defaultImage }));
    if (data.home?.hero?.image) route.preload.push(abs(data, data.home.hero.image));
    route.body = homeBody(data);
  } else if (pathname.startsWith('/prestations/')) {
    const slug = pathname.slice('/prestations/'.length);
    const col = slug === 'autres-prestations' ? otherServicesGroup(data) : (data.collections || []).find((c) => c.slug === slug);
    if (!col) return notFound(data, route, graph);
    const items = col.productIds.map((id) => data.products.find((p) => String(p._id) === id)).filter(Boolean);
    const c = city(data);
    route.title = composeTitle(data, `${col.title}${c ? ` à ${c}` : ''}`);
    route.description = clip(oneLine(col.description) || `${items.length} prestation${items.length > 1 ? 's' : ''} ${col.title} chez ${name} : ${items.slice(0, 4).map((p) => p.title).join(', ')}.`, 160);
    route.image = abs(data, col.coverUrl) || defaultImage;
    const parent = { name: 'Prestations', url: `${data.base}/prestations` };
    graph.push(
      webPageNode(data, { url, type: 'CollectionPage', name: route.title, description: route.description, image: route.image, breadcrumb: true }),
      breadcrumbNode(data, url, [parent, { name: col.title, url }]),
      itemListNode(data, url, items),
    );
    route.body = shell(data, `<nav aria-label="Fil d’Ariane"><a href="/">Accueil</a> › <a href="/prestations">Prestations</a> › ${esc(col.title)}</nav><h1>${esc(col.title)}</h1>${col.description ? `<p>${esc(col.description)}</p>` : ''}<ul>${items.map((p) => offerLine(data, p)).join('')}</ul><p><a href="/prestations">Toutes les collections</a></p>`);
  } else if (CATALOGS[pathname]) {
    const cat = CATALOGS[pathname];
    const items = byGroup(data, cat.group);
    const c = city(data);
    const titles = items.slice(0, 4).map((p) => p.title).join(', ');
    const headings = {
      '/prestations': `Prestations beauté${c ? ` à ${c}` : ''}`,
      '/formations': 'Formations beauté en ligne et en présentiel',
      '/cartes-cadeaux': 'Cartes cadeaux',
      '/boutique': 'Boutique : prestations, formations et cartes cadeaux',
    };
    route.title = composeTitle(data, headings[pathname]);
    const count = items.length;
    const lead = {
      '/prestations': `${count} prestation${count > 1 ? 's' : ''} à réserver en ligne chez ${name}${c ? ` à ${c}` : ''}`,
      '/formations': (() => {
        const online = items.filter((p) => p.kind === 'DISTANCE_TRAINING').length;
        const onsite = count - online;
        return `${count} formation${count > 1 ? 's' : ''} ${name} : ${online} en ligne, ${onsite} en présentiel`;
      })(),
      '/cartes-cadeaux': `Offrez un moment ${name} avec une carte cadeau envoyée par e-mail`,
      '/boutique': `Toutes les offres ${name} dans un panier commun`,
    }[pathname];
    route.description = clip(`${lead}${titles ? ` : ${titles}` : ''}.`, 160);
    graph.push(
      webPageNode(data, { url, type: 'CollectionPage', name: route.title, description: route.description, image: defaultImage, breadcrumb: true }),
      breadcrumbNode(data, url, [{ name: cat.label, url }]),
      itemListNode(data, url, items),
    );
    route.body = pathname === '/prestations' && (data.collections || []).length
      ? shell(data, `<h1>${esc(headings[pathname])}</h1><p>${esc(route.description)}</p><ul>${[...data.collections, otherServicesGroup(data)].filter(Boolean).map((col) => `<li><h2><a href="/prestations/${esc(encodeURIComponent(col.slug))}">${esc(col.title)}</a></h2>${col.description ? `<p>${esc(col.description)}</p>` : ''}<p>${col.productIds.length} prestation${col.productIds.length > 1 ? 's' : ''}</p></li>`).join('')}</ul>`)
      : catalogBody(data, headings[pathname], route.description, items);
  } else if (pathname.startsWith('/catalogue/')) {
    const slug = pathname.slice('/catalogue/'.length);
    const p = data.products.find((x) => x.slug === slug);
    if (!p) return notFound(data, route, graph);
    const pUrl = productUrl(data, p);
    route.canonical = pUrl;
    route.title = productTitle(data, p);
    route.description = productDescription(data, p);
    route.ogType = 'product';
    route.image = productImage(data, p) || defaultImage;
    route.imageAlt = p.title;
    const group = KIND_GROUP[p.kind];
    const parent = group === 'service' ? { name: 'Prestations', url: `${data.base}/prestations` }
      : group === 'training' ? { name: 'Formations', url: `${data.base}/formations` }
        : { name: 'Cartes cadeaux', url: `${data.base}/cartes-cadeaux` };
    const faq = faqNode(pUrl, p.faq);
    graph.push(
      webPageNode(data, { url: pUrl, type: faq ? ['WebPage', 'ItemPage'] : 'ItemPage', name: route.title, description: route.description, image: route.image, breadcrumb: true, dateModified: p.updatedAt, extra: { mainEntity: { '@id': `${pUrl}#offer-item` } } }),
      breadcrumbNode(data, pUrl, [parent, { name: p.title, url: pUrl }]),
      productNode(data, p),
    );
    if (faq) graph.push(faq);
    if (route.image) route.preload.push(route.image);
    route.body = productBody(data, p, parent);
  } else if (pathname.startsWith('/p/')) {
    const slug = pathname.slice(3);
    const page = data.pages.find((x) => x.slug === slug);
    if (!page) return notFound(data, route, graph);
    route.title = composeTitle(data, oneLine(page.seo?.metaTitle) || page.title);
    route.description = clip(oneLine(page.seo?.metaDescription) || oneLine(page.intro) || pageText(page) || homeDescription(data), 160);
    const image = abs(data, page.heroImage) || defaultImage;
    route.image = image;
    graph.push(
      webPageNode(data, { url, type: /propos|qui-sommes|presentation/i.test(slug) ? 'AboutPage' : 'WebPage', name: route.title, description: route.description, image, breadcrumb: true, dateModified: page.updatedAt }),
      breadcrumbNode(data, url, [{ name: page.title, url }]),
    );
    route.body = pageBody(data, page);
  } else if (pathname === '/contact' || pathname === '/presenter-un-projet') {
    route.canonical = `${data.base}/contact`;
    route.title = composeTitle(data, `Contact et accès${city(data) ? ` — ${city(data)}` : ''}`);
    const facts = [addressText(data), data.media.phone, hoursText(data)].filter(Boolean).join(' · ');
    route.description = clip(`Contactez ${name} pour une prestation, une formation ou une carte cadeau.${facts ? ` ${facts}.` : ''}`, 160);
    graph.push(
      webPageNode(data, { url: route.canonical, type: 'ContactPage', name: route.title, description: route.description, breadcrumb: true }),
      breadcrumbNode(data, route.canonical, [{ name: 'Contact', url: route.canonical }]),
    );
    route.body = contactBody(data);
  } else if (LEGAL_ROUTES[pathname]) {
    const legal = LEGAL_ROUTES[pathname];
    if (!data.legal.has(legal.type)) return notFound(data, route, graph);
    route.title = composeTitle(data, legal.title);
    route.description = clip(`${legal.title} du site ${name}.`, 160);
    graph.push(webPageNode(data, { url, name: route.title, description: route.description }));
    route.body = shell(data, `<h1>${esc(legal.title)}</h1><p>${esc(route.description)}</p>`);
  } else if (PRIVATE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    route.title = composeTitle(data, PRIVATE_TITLES[pathname] || 'Espace client');
    route.robots = 'noindex, nofollow';
    route.canonical = '';
    route.body = shell(data, `<h1>${esc(PRIVATE_TITLES[pathname] || 'Espace client')}</h1>`);
    return finalize(data, route, []);
  } else {
    return notFound(data, route, graph);
  }
  return finalize(data, route, graph);
}

function notFound(data, route, graph) {
  route.status = data.suspended ? 503 : 404;
  route.title = composeTitle(data, 'Page introuvable');
  route.description = 'Cette page n’existe pas ou n’est plus disponible.';
  route.robots = 'noindex, follow';
  route.canonical = '';
  route.body = shell(data, '<h1>Page introuvable</h1><p>Cette page n’existe pas ou n’est plus disponible.</p>');
  return finalize(data, route, graph.slice(0, 2));
}

function finalize(data, route, graph) {
  route.jsonLd = graph.length ? [prune({ '@context': 'https://schema.org', '@graph': graph })] : [];
  route.siteName = siteName(data);
  route.themeColor = data.theme?.colors?.background || '#ffffff';
  route.logo = abs(data, data.company.logos?.header);
  return route;
}

/* ── Contenu lisible (robots sans JavaScript) ───────────────────────────── */

function navHtml(data) {
  const links = [['/', 'Accueil'], ['/prestations', 'Prestations'], ['/formations', 'Formations']];
  if (data.products.some((p) => p.kind === 'GIFT_CARD')) links.push(['/cartes-cadeaux', 'Cartes cadeaux']);
  links.push(['/boutique', 'Boutique']);
  for (const page of data.pages.filter((p) => p.showInNav !== false)) links.push([`/p/${page.slug}`, page.navLabel || page.title]);
  links.push(['/contact', 'Contact']);
  return `<nav aria-label="Navigation principale"><ul>${links.map(([href, label]) => `<li><a href="${esc(href)}">${esc(label)}</a></li>`).join('')}</ul></nav>`;
}

function footerHtml(data) {
  const parts = [];
  const address = addressText(data);
  if (address) parts.push(`<p>Adresse : ${esc(address)}</p>`);
  if (data.media.phone) parts.push(`<p>Téléphone : <a href="tel:${esc(data.media.phone.replace(/\s+/g, ''))}">${esc(data.media.phone)}</a></p>`);
  if (data.media.email) parts.push(`<p>E-mail : <a href="mailto:${esc(data.media.email)}">${esc(data.media.email)}</a></p>`);
  const hours = hoursText(data);
  if (hours) parts.push(`<p>Horaires : ${esc(hours)}</p>`);
  const legal = Object.entries(LEGAL_ROUTES).filter(([, l]) => data.legal.has(l.type)).map(([href, l]) => `<a href="${href}">${esc(l.title)}</a>`);
  if (legal.length) parts.push(`<p>${legal.join(' · ')}</p>`);
  return `<footer><p><strong>${esc(siteName(data))}</strong>${data.company.tagline ? ` — ${esc(data.company.tagline)}` : ''}</p>${parts.join('')}</footer>`;
}

function shell(data, main) {
  return `<div class="seo-prerender"><header><p><a href="/">${esc(siteName(data))}</a></p>${navHtml(data)}</header><main>${main}</main>${footerHtml(data)}</div>`;
}

function offerLine(data, p) {
  const bits = [KIND_LABEL[p.kind], p.kind === 'SERVICE' ? duration(p.durationMinutes) : '', eur(p.price?.amountCents)].filter(Boolean).join(' · ');
  const r = rating(data.reviewsByProduct.get(String(p._id)));
  const desc = oneLine(p.subtitle) || clip(stripHtml(p.description), 180);
  return `<li><h3><a href="/catalogue/${esc(encodeURIComponent(p.slug))}">${esc(p.title)}</a></h3><p>${esc(bits)}${r ? ` · ${String(r.value).replace('.', ',')}/5 (${r.count} avis)` : ''}</p>${desc ? `<p>${esc(desc)}</p>` : ''}</li>`;
}

function homeBody(data) {
  const services = featured(byGroup(data, 'service'));
  const trainings = featured(byGroup(data, 'training'));
  const all = data.products.flatMap((p) => data.reviewsByProduct.get(String(p._id)) || []);
  const r = rating(all);
  const intro = oneLine(data.company.homeIntro) || oneLine(data.home?.hero?.subtitle);
  return shell(data, [
    `<h1>${esc(oneLine(data.home?.hero?.title) || siteName(data))}</h1>`,
    data.company.tagline ? `<p>${esc(data.company.tagline)}</p>` : '',
    intro ? `<p>${esc(intro)}</p>` : '',
    oneLine(data.company.trainingDeclaration?.number) ? `<p>Organisme de formation déclaré — NDA ${esc(oneLine(data.company.trainingDeclaration.number))}.</p>` : '',
    services.length ? `<section><h2>Prestations à la une</h2><ul>${services.map((p) => offerLine(data, p)).join('')}</ul><p><a href="/prestations">Toutes les prestations</a></p></section>` : '',
    trainings.length ? `<section><h2>Formations à la une</h2><ul>${trainings.map((p) => offerLine(data, p)).join('')}</ul><p><a href="/formations">Toutes les formations</a></p></section>` : '',
    r ? `<section><h2>Avis clientes</h2><p>Note moyenne de ${String(r.value).replace('.', ',')}/5 sur ${r.count} avis publiés.</p></section>` : '',
  ].join(''));
}

function catalogBody(data, heading, lead, items) {
  return shell(data, `<h1>${esc(heading)}</h1><p>${esc(lead)}</p>${items.length ? `<ul>${items.map((p) => offerLine(data, p)).join('')}</ul>` : '<p>Aucune offre pour le moment.</p>'}`);
}

function productBody(data, p, parent) {
  const tz = data.schedule?.timezone || 'Europe/Paris';
  const facts = [
    ['Type', KIND_LABEL[p.kind]],
    ['Prix', eur(p.price?.amountCents)],
    p.kind === 'SERVICE' && p.durationMinutes ? ['Durée', duration(p.durationMinutes)] : null,
    p.kind === 'IN_PERSON_TRAINING' && p.training?.durationDays ? ['Durée', `${p.training.durationDays} jour${p.training.durationDays > 1 ? 's' : ''}`] : null,
    p.kind === 'IN_PERSON_TRAINING' && oneLine(p.training?.location) ? ['Lieu', oneLine(p.training.location)] : null,
    p.kind === 'DISTANCE_TRAINING' ? ['Format', 'En ligne, à votre rythme'] : null,
  ].filter(Boolean);
  const sessions = p.kind === 'IN_PERSON_TRAINING' ? futureSessions(p).slice(0, 8) : [];
  const options = (p.options || []).filter((o) => o.active !== false && oneLine(o.label));
  const faq = (p.faq || []).filter((f) => oneLine(f?.question) && stripHtml(f?.answer));
  const list = data.reviewsByProduct.get(String(p._id)) || [];
  const r = rating(list);
  const description = stripHtml(p.description);
  return shell(data, [
    `<nav aria-label="Fil d’Ariane"><a href="/">Accueil</a> › <a href="${esc(parent.url.replace(data.base, '') || '/')}">${esc(parent.name)}</a> › ${esc(p.title)}</nav>`,
    `<article><h1>${esc(p.title)}</h1>`,
    p.subtitle ? `<p>${esc(p.subtitle)}</p>` : '',
    `<ul>${facts.map(([k, v]) => `<li><strong>${esc(k)} :</strong> ${esc(v)}</li>`).join('')}</ul>`,
    description ? `<section><h2>Description</h2>${description.split('\n').filter(Boolean).map((line) => `<p>${esc(line)}</p>`).join('')}</section>` : '',
    sessions.length ? `<section><h2>Prochaines sessions</h2><ul>${sessions.map((s) => `<li>${esc(dateFr(s.startsAt, tz))}</li>`).join('')}</ul></section>` : '',
    options.length ? `<section><h2>Options</h2><ul>${options.map((o) => `<li>${esc(o.label)} (+${esc(eur(o.priceCents))})${o.description ? ` — ${esc(o.description)}` : ''}</li>`).join('')}</ul></section>` : '',
    faq.length ? `<section><h2>Questions fréquentes</h2>${faq.map((f) => `<h3>${esc(oneLine(f.question))}</h3><p>${esc(stripHtml(f.answer))}</p>`).join('')}</section>` : '',
    r ? `<section><h2>Avis clientes</h2><p>${String(r.value).replace('.', ',')}/5 sur ${r.count} avis.</p><ul>${list.slice(0, 5).map((x) => `<li><strong>${esc(oneLine(x.displayName) || 'Cliente')}</strong> — ${x.rating}/5${x.comment ? ` : « ${esc(clip(x.comment, 280))} »` : ''}</li>`).join('')}</ul></section>` : '',
    '</article>',
  ].join(''));
}

function pageText(page) {
  const parts = [];
  for (const b of page.blocks || []) {
    parts.push(b.title, b.subtitle, b.text, stripHtml(b.html));
    for (const it of b.items || []) parts.push(it.title, it.text, it.value);
  }
  return parts.map(oneLine).filter(Boolean).join(' ');
}

function pageBody(data, page) {
  const blocks = [...(page.blocks || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((b) => {
    const items = (b.items || []).map((it) => [it.value, it.title, it.text].map(oneLine).filter(Boolean).join(' — ')).filter(Boolean);
    return [
      b.title ? `<h2>${esc(b.title)}</h2>` : '',
      b.subtitle ? `<p>${esc(b.subtitle)}</p>` : '',
      b.text ? `<p>${esc(b.text)}</p>` : '',
      b.html ? stripHtml(b.html).split('\n').filter(Boolean).map((l) => `<p>${esc(l)}</p>`).join('') : '',
      items.length ? `<ul>${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '',
    ].join('');
  }).join('');
  return shell(data, `<h1>${esc(page.title)}</h1>${page.intro ? `<p>${esc(page.intro)}</p>` : ''}${blocks}`);
}

function contactBody(data) {
  const hours = (data.schedule?.weeklyHours || []).slice().sort((a, b) => a.weekday - b.weekday)
    .map((d) => `<li>${JOURS[d.weekday - 1]} : ${d.enabled && d.ranges?.length ? esc(d.ranges.map((r) => `${r.start}–${r.end}`).join(', ')) : 'fermé'}</li>`).join('');
  return shell(data, `<h1>Contact</h1><p>Contactez ${esc(siteName(data))} pour une prestation, une formation ou une carte cadeau.</p>${hours ? `<h2>Horaires d’ouverture</h2><ul>${hours}</ul>` : ''}`);
}

/* ── Page HTML servie aux robots (et aux premiers visiteurs) ────────────── */

const TEMPLATE_CANDIDATES = [
  process.env.VITRINE_INDEX_HTML,
  path.resolve(BACKEND_ROOT, '..', 'vitrine', 'dist', 'index.html'),
  path.resolve(BACKEND_ROOT, '..', 'vitrine', 'index.html'),
].filter(Boolean);
let templateCache = { file: '', mtime: 0, html: '' };

async function readTemplate() {
  for (const file of TEMPLATE_CANDIDATES) {
    try {
      const stat = await fs.stat(file);
      if (templateCache.file === file && templateCache.mtime === stat.mtimeMs) return templateCache.html;
      const html = await fs.readFile(file, 'utf8');
      // La coquille SOURCE de Vite (dev) pointe /src/main.tsx : elle ne sert à rien ici.
      if (html.includes('/src/main.tsx') && file !== TEMPLATE_CANDIDATES.at(-1)) continue;
      templateCache = { file, mtime: stat.mtimeMs, html };
      return html;
    } catch { /* candidat suivant */ }
  }
  return null;
}

/**
 * LES ICÔNES, DÉCLARÉES DANS LE HTML QUE GOOGLE LIT. Le favicon des résultats
 * de recherche vient de là, jamais du JavaScript. Adresses du site public,
 * empreinte du fichier en paramètre : un changement dans le Manager se voit.
 */
function iconTags(version) {
  if (!version) return [];
  const v = `?v=${version}`;
  return [
    `<link rel="icon" href="/favicon.ico${v}" sizes="48x48" />`,
    `<link rel="icon" type="image/png" sizes="192x192" href="/favicon-192.png${v}" />`,
    `<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png${v}" />`,
    `<link rel="manifest" href="/site.webmanifest${v}" />`,
  ];
}

function headTags(route) {
  const tags = [
    `<title>${esc(route.title)}</title>`,
    `<meta name="description" content="${esc(route.description)}" />`,
    `<meta name="robots" content="${esc(route.robots)}" />`,
    route.canonical ? `<link rel="canonical" href="${esc(route.canonical)}" />` : '',
    `<meta name="theme-color" content="${esc(route.themeColor)}" />`,
    `<meta property="og:site_name" content="${esc(route.siteName)}" />`,
    `<meta property="og:locale" content="fr_FR" />`,
    `<meta property="og:type" content="${esc(route.ogType)}" />`,
    `<meta property="og:title" content="${esc(route.title)}" />`,
    `<meta property="og:description" content="${esc(route.description)}" />`,
    route.canonical ? `<meta property="og:url" content="${esc(route.canonical)}" />` : '',
    route.image ? `<meta property="og:image" content="${esc(route.image)}" />` : '',
    route.image ? `<meta property="og:image:alt" content="${esc(route.imageAlt)}" />` : '',
    `<meta name="twitter:card" content="${route.image ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${esc(route.title)}" />`,
    `<meta name="twitter:description" content="${esc(route.description)}" />`,
    route.image ? `<meta name="twitter:image" content="${esc(route.image)}" />` : '',
    ...iconTags(route.iconVersion),
    ...route.preload.map((href) => `<link rel="preload" as="image" href="${esc(href)}" fetchpriority="high" />`),
    ...route.jsonLd.map((json) => `<script type="application/ld+json" data-seo="1">${JSON.stringify(json).replace(/</g, '\\u003c')}</script>`),
  ];
  return tags.filter(Boolean).join('\n    ');
}

const PRERENDER_CSS = '#root .seo-prerender{max-width:960px;margin:0 auto;padding:24px 16px;font-family:system-ui,sans-serif;line-height:1.6}#root .seo-prerender nav ul{display:flex;flex-wrap:wrap;gap:12px;list-style:none;padding:0}';

export function injectIntoTemplate(template, route) {
  let html = template
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<meta\s[^>]*?(?:name|property)\s*=\s*"(?:description|robots|theme-color|og:[^"]*|twitter:[^"]*)"[^>]*>/gis, '')
    .replace(/<link\s[^>]*?rel\s*=\s*"canonical"[^>]*>/gis, '')
    .replace(/<!--\s*(?:OpenGraph|Twitter Card)\s*-->/gi, '');
  // L'icône vide de la coquille (`data:,`) cède la place aux vraies, quand il y en a une.
  if (route.iconVersion) html = html.replace(/<link\s[^>]*?rel\s*=\s*"(?:icon|shortcut icon|apple-touch-icon|manifest)"[^>]*>/gis, '');
  html = html.replace(/<head(\s[^>]*)?>/i, (m) => `${m.replace(/>$/, '')} data-seo-path="${esc(route.pathname)}">`);
  html = html.replace(/<\/head>/i, `    ${headTags(route)}\n    <style>${PRERENDER_CSS}</style>\n  </head>`);
  const cover = `<div id="boot-cover" aria-hidden="true" style="position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:${esc(route.themeColor)}">${route.logo ? `<img src="${esc(route.logo)}" alt="" style="max-width:min(220px,60vw);max-height:120px;object-fit:contain" />` : ''}</div>`
    + '<noscript><style>#boot-cover{display:none}</style></noscript>'
    + '<script>setTimeout(function(){var c=document.getElementById("boot-cover");if(c)c.remove()},8000)</script>';
  html = html.replace(/<div id="root">\s*<\/div>/i, `${cover}<div id="root">${route.body}</div>`);
  return html;
}

/** La page complète, prête à servir — ou null si la coquille est introuvable. */
export async function renderVitrinePage(rawPath, opts = {}) {
  const key = normalizePath(rawPath);
  const cached = htmlCache.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const [template, route] = await Promise.all([readTemplate(), resolveRoute(rawPath, opts)]);
  if (!template) return null;
  const value = { status: route.status, html: injectIntoTemplate(template, route), robots: route.robots };
  if (htmlCache.size > 500) htmlCache.clear();
  htmlCache.set(key, { at: Date.now(), value });
  return value;
}

/** Ce que l'application applique à chaque navigation (sans le contenu lisible). */
export async function publicSeo(rawPath) {
  const route = await resolveRoute(rawPath);
  const { body, ...head } = route;
  void body;
  return head;
}

/* ── Plan du site, robots.txt, llms.txt ─────────────────────────────────── */

export async function sitemapXml() {
  const data = await loadSeoData();
  if (!/^https?:\/\//i.test(data.base)) return null;
  const entries = [];
  if (data.settings.indexable !== false) {
    const newest = data.products.reduce((max, p) => Math.max(max, new Date(p.updatedAt || 0).getTime()), 0);
    entries.push({ loc: '/', lastmod: newest || null, priority: '1.0', changefreq: 'weekly' });
    const groups = [['/prestations', 'service'], ['/formations', 'training'], ['/cartes-cadeaux', 'gift']];
    for (const [loc, group] of groups) {
      if (byGroup(data, group).length) entries.push({ loc, priority: '0.9', changefreq: 'weekly' });
    }
    entries.push({ loc: '/boutique', priority: '0.6', changefreq: 'weekly' });
    for (const col of data.collections || []) entries.push({ loc: `/prestations/${encodeURIComponent(col.slug)}`, priority: '0.8', changefreq: 'weekly', image: abs(data, col.coverUrl), imageTitle: col.title });
    for (const p of data.products) {
      entries.push({ loc: `/catalogue/${encodeURIComponent(p.slug)}`, lastmod: p.updatedAt, priority: p.kind === 'GIFT_CARD' ? '0.6' : '0.8', changefreq: 'weekly', image: productImage(data, p), imageTitle: p.title });
    }
    for (const page of data.pages) entries.push({ loc: `/p/${encodeURIComponent(page.slug)}`, lastmod: page.updatedAt, priority: '0.5', changefreq: 'monthly' });
    entries.push({ loc: '/contact', priority: '0.6', changefreq: 'yearly' });
    for (const [loc, legal] of Object.entries(LEGAL_ROUTES)) if (data.legal.has(legal.type)) entries.push({ loc, priority: '0.2', changefreq: 'yearly' });
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
    ...entries.map((e) => [
      '  <url>',
      `    <loc>${esc(`${data.base}${e.loc}`)}</loc>`,
      e.lastmod ? `    <lastmod>${new Date(e.lastmod).toISOString().slice(0, 10)}</lastmod>` : null,
      `    <changefreq>${e.changefreq}</changefreq>`,
      `    <priority>${e.priority}</priority>`,
      e.image ? `    <image:image><image:loc>${esc(e.image)}</image:loc><image:title>${esc(e.imageTitle)}</image:title></image:image>` : null,
      '  </url>',
    ].filter(Boolean).join('\n')),
    '</urlset>',
    '',
  ].join('\n');
}

/** Robots des moteurs et des assistants IA explicitement accueillis (visibilité GEO). */
const AI_AGENTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'Bingbot', 'CCBot'];

export async function robotsTxt() {
  const data = await loadSeoData();
  const base = /^https?:\/\//i.test(data.base) ? data.base : '';
  if (data.settings.indexable === false) {
    return `# ${siteName(data)} — référencement désactivé depuis le Manager\nUser-agent: *\nDisallow: /\n`;
  }
  const rules = ['Allow: /', ...PRIVATE_PREFIXES.map((p) => `Disallow: ${p}`), 'Disallow: /api/'].join('\n');
  return [
    `# robots.txt — ${siteName(data)}${base ? ` (${base})` : ''}`,
    '# Généré à partir des données du site : ne pas éditer à la main.',
    '',
    'User-agent: *',
    rules,
    '',
    '# Moteurs de réponse et assistants IA : bienvenus (le contenu public est fait pour être cité).',
    ...AI_AGENTS.map((a) => `User-agent: ${a}`),
    rules,
    '',
    base ? `Sitemap: ${base}/sitemap.xml` : '',
    '',
  ].join('\n');
}

/**
 * LLMS.TXT — le résumé que les assistants IA peuvent lire en une fois
 * (convention llmstxt.org). Complément, pas substitut : les pages restent la
 * source, et chaque ligne y renvoie.
 */
export async function llmsTxt() {
  const data = await loadSeoData();
  const b = data.base;
  const name = siteName(data);
  const lines = [`# ${name}`, ''];
  const summary = joinSentences(data.company.tagline, data.company.homeIntro);
  if (summary) lines.push(`> ${summary}`, '');
  const facts = [];
  const address = addressText(data);
  if (address) facts.push(`- Adresse : ${address}`);
  if (oneLine(data.settings.areaServed)) facts.push(`- Zone desservie : ${oneLine(data.settings.areaServed)}`);
  if (data.media.phone) facts.push(`- Téléphone : ${data.media.phone}`);
  if (data.media.email) facts.push(`- E-mail : ${data.media.email}`);
  const hours = hoursText(data);
  if (hours) facts.push(`- Horaires : ${hours}`);
  const all = data.products.flatMap((p) => data.reviewsByProduct.get(String(p._id)) || []);
  const r = rating(all);
  if (r) facts.push(`- Avis clientes publiés : ${String(r.value).replace('.', ',')}/5 sur ${r.count} avis`);
  const nda = oneLine(data.company.trainingDeclaration?.number);
  if (nda) facts.push(`- Organisme de formation déclaré : NDA ${nda}${oneLine(data.company.trainingDeclaration?.region) ? ` (préfet de la région ${oneLine(data.company.trainingDeclaration.region)})` : ''} — cet enregistrement ne vaut pas agrément de l’État`);
  facts.push(`- Réservation et achat en ligne : ${b}/boutique`);
  lines.push(...facts, '');
  const section = (title, kinds) => {
    const items = data.products.filter((p) => kinds.includes(p.kind));
    if (!items.length) return;
    lines.push(`## ${title}`, '');
    for (const p of items) {
      const desc = oneLine(p.subtitle) || clip(stripHtml(p.description), 140);
      lines.push(`- [${p.title}](${productUrl(data, p)}): ${[KIND_LABEL[p.kind], p.kind === 'SERVICE' ? duration(p.durationMinutes) : '', eur(p.price?.amountCents), desc].filter(Boolean).join(' — ')}`);
    }
    lines.push('');
  };
  section('Prestations', ['SERVICE']);
  section('Formations', ['DISTANCE_TRAINING', 'IN_PERSON_TRAINING']);
  section('Cartes cadeaux', ['GIFT_CARD', 'PRODUCT']);
  lines.push('## Pages', '', `- [Contact](${b}/contact): coordonnées et horaires`);
  for (const page of data.pages) lines.push(`- [${page.title}](${b}/p/${page.slug})${page.intro ? `: ${clip(page.intro, 140)}` : ''}`);
  lines.push('');
  const legal = Object.entries(LEGAL_ROUTES).filter(([, l]) => data.legal.has(l.type));
  if (legal.length) {
    lines.push('## Optional', '');
    for (const [loc, l] of legal) lines.push(`- [${l.title}](${b}${loc})`);
    lines.push('');
  }
  return lines.join('\n');
}

/* ── Aperçu d'une fiche (Manager) ───────────────────────────────────────── */

/**
 * Ce que le référencement AUTOMATIQUE d'une fiche donne — même non publiée —
 * pour que l'éditeur montre l'aperçu Google et sache ce qu'il remplace.
 */
export async function productSeoPreview(productId) {
  const data = await loadSeoData();
  const p = await CommerceProduct.findById(productId).lean();
  if (!p) return null;
  const bare = { ...p, seo: {} };
  return {
    url: productUrl(data, p),
    published: p.status === PRODUCT_STATUS.PUBLISHED,
    autoTitle: productTitle(data, bare),
    autoDescription: productDescription(data, bare),
    title: productTitle(data, p),
    description: productDescription(data, p),
  };
}

/* ── Diagnostic (Manager) ───────────────────────────────────────────────── */

export async function seoDiagnostic() {
  invalidateSeoCache();
  const data = await loadSeoData();
  const s = data.settings;
  const checks = [];
  const add = (id, level, label, detail, action) => checks.push({ id, level, label, detail, action });

  add('url', /^https?:\/\//i.test(data.base) ? 'ok' : 'error', 'Adresse publique du site', data.base || 'Non configurée : plan du site et liens canoniques impossibles.');
  add('indexable', s.indexable !== false ? 'ok' : 'error', 'Indexation autorisée', s.indexable !== false ? 'Le site est ouvert aux moteurs et aux assistants IA.' : 'Le site demande à ne pas être indexé.', 'settings');
  const a = s.address || {};
  add('address', oneLine(a.street) && oneLine(a.postalCode) && oneLine(a.city) ? 'ok' : 'warning', 'Adresse structurée', oneLine(a.city) ? addressText(data) : 'Rue, code postal et ville : indispensables au référencement local (Google Maps, « institut près de moi »).', 'settings');
  add('contact', data.media.phone || data.media.email ? 'ok' : 'warning', 'Téléphone ou e-mail affiché', data.media.phone || data.media.email || 'Aucun moyen de contact visible : activez-en un dans Coordonnées.', '/contacts');
  add('hours', hoursText(data) ? 'ok' : 'warning', 'Horaires d’ouverture', hoursText(data) || 'Aucun horaire dans le planning de réservation.', '/commerce/calendrier');
  add('logo', data.company.logos?.header ? 'ok' : 'warning', 'Logo', data.company.logos?.header ? 'Présent.' : 'Aucun logo : les moteurs n’ont pas d’image de marque.', '/entreprise');
  add('share', data.shareImage || data.home?.hero?.image || data.company.heroImage ? 'ok' : 'warning', 'Image de partage', 'Visible quand un lien du site est partagé (réseaux, messageries).', 'settings');
  const profiles = socialProfiles(data);
  add('sameAs', profiles.length ? 'ok' : 'warning', 'Profils externes', profiles.length ? `${profiles.length} profil(s) relié(s).` : 'Ajoutez votre fiche Google Business Profile et vos réseaux : ils confirment l’identité de l’institut aux moteurs et aux IA.', 'settings');
  const noCover = data.products.filter((p) => !p.coverUrl && !p.gallery?.length);
  add('covers', noCover.length ? 'warning' : 'ok', 'Visuels des offres', noCover.length ? `${noCover.length} offre(s) sans visuel : ${noCover.slice(0, 5).map((p) => p.title).join(', ')}` : 'Toutes les offres publiées ont un visuel.');
  const thin = data.products.filter((p) => (oneLine(p.subtitle) + stripHtml(p.description)).length < 80);
  add('content', thin.length ? 'warning' : 'ok', 'Descriptions des offres', thin.length ? `${thin.length} offre(s) décrite(s) en moins de 80 caractères : ${thin.slice(0, 5).map((p) => p.title).join(', ')}` : 'Toutes les offres ont une description suffisante.');
  const withFaq = data.products.filter((p) => (p.faq || []).some((f) => oneLine(f?.question) && oneLine(f?.answer))).length;
  add('faq', withFaq ? 'ok' : 'warning', 'Questions fréquentes', withFaq ? `${withFaq} offre(s) avec FAQ : réponses directement citables par les assistants IA.` : 'Aucune FAQ : les questions-réponses sont le format le plus repris par les moteurs de réponse.');
  add('reviews', data.reviewCount >= 5 ? 'ok' : 'warning', 'Avis publiés', `${data.reviewCount} avis publié(s) sur les offres.`, '/commerce/avis');
  return {
    checks,
    score: Math.round((checks.filter((c) => c.level === 'ok').length / checks.length) * 100),
    urls: { site: data.base, sitemap: `${data.base}/sitemap.xml`, robots: `${data.base}/robots.txt`, llms: `${data.base}/llms.txt` },
    counts: { products: data.products.length, pages: data.pages.length, reviews: data.reviewCount },
    preview: { title: (await resolveRoute('/')).title, description: homeDescription(data), url: `${data.base}/` },
  };
}
