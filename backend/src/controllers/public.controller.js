import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { getSingleton } from '../utils/singleton.js';
import { Company } from '../models/Company.model.js';
import { HomeContent } from '../models/HomeContent.model.js';
import { Theme } from '../models/Theme.model.js';
import { SiteStatus } from '../models/SiteStatus.model.js';
import { Chapter } from '../models/Chapter.model.js';
import { SitePage } from '../models/SitePage.model.js';
import { SystemConfiguration } from '../models/SystemConfiguration.model.js';
import { PanelCompanyConfiguration } from '../models/PanelConfiguration.model.js';
import {
  projectCompanyMedia,
  projectHomeContentMedia,
  projectChaptersMedia,
  projectSitePageMedia, projectSitePagesMedia,
} from '../services/media/mediaProjection.service.js';
import { assertAuthority, PANEL } from '../services/media/mediaAuthority.js';

/** Section réseau filtrée pour la vitrine (jamais l'URL du manager). */
async function publicNetwork() {
  const cfg = await getSingleton(SystemConfiguration);
  return { backendUrl: cfg.network.backendUrl, websiteUrl: cfg.network.websiteUrl };
}

/**
 * QUI A RÉALISÉ CE SITE — et personne d'autre.
 *
 * ── LE DÉFAUT CORRIGÉ ─────────────────────────────────────────────────────
 * Cette fonction retombait sur `DevCompany`, l'identité éditée localement dans
 * le Manager. Résultat : un projet dont le Panel n'a AUCUNE entreprise
 * configurée affichait quand même « Réalisé par … », avec un nom saisi sur
 * place. Le footer annonçait donc un éditeur que l'autorité ne connaissait pas.
 *
 * Le Panel est désormais la seule source. Sans configuration reçue, le bloc
 * n'existe pas — c'est une information manquante, pas un vide à combler.
 * Le projet conserve en revanche la DERNIÈRE configuration reçue : une panne
 * du Panel n'efface pas ce qu'on sait déjà.
 */
async function publicDeveloper() {
  const panel = await PanelCompanyConfiguration.findOne({ key: 'SINGLETON' })
    .lean()
    .catch(() => null);

  const nom = panel?.identity?.name?.trim() || '';
  // Sans nom, aucun bloc — même si une adresse existe : « Réalisé par » suivi
  // d'un lien anonyme n'apprend rien à personne.
  if (!nom) return null;

  // Seule une URL absolue est publiée : un lien relatif pointerait sur le site
  // du client, ce qui serait pire que pas de lien du tout.
  const brut = panel?.domains?.websiteUrl?.trim() || '';
  const websiteUrl = /^https?:\/\//i.test(brut) ? brut : null;

  /**
   * LE LOGO DU DÉVELOPPEUR — chargé depuis le PANEL, jamais recopié ici.
   *
   * Le descripteur canonique (>= 1.5.0) porte l'adresse absolue, l'empreinte,
   * le type et les dimensions. Les dimensions ne sont pas décoratives : sans
   * elles, le pied de page saute au chargement de l'image.
   *
   * Sans descripteur, on retombe sur l'URL historique. Sans URL absolue, il
   * n'y a pas de logo — et surtout pas un logo pris dans les médias du
   * client, qui appartiennent au garage et non à l'agence.
   */
  const logo = descriptorOf(panel?.branding?.logo)
    ?? urlOnlyDescriptor(panel?.branding?.logoUrl);

  return { name: nom, websiteUrl, logo, logoUrl: logo?.url ?? null };
}

/**
 * Le descripteur reçu, retenu seulement s'il porte une adresse absolue.
 *
 * ── L'AUTORITÉ EST TRANSPORTÉE, PAS RECOMPOSÉE ──────────────────────────────
 * Ce bloc décrit le logo du DÉVELOPPEUR, servi par le Panel. L'adresse part
 * telle quelle jusqu'à la vitrine : personne, en aval, ne doit la recomposer
 * contre le domaine du client — c'est ainsi qu'elle devenait un 404. Le champ
 * `authority` le DIT, jusqu'au navigateur et jusqu'au healthcheck.
 */
function descriptorOf(brut) {
  if (!brut || typeof brut !== 'object') return null;
  // Un descripteur qui se déclarerait PROJECT dans le bloc développeur est une
  // violation de contrat : on refuse plutôt que de corriger en silence.
  if (!assertAuthority(brut, PANEL)) return null;
  const url = String(brut.url ?? '').trim();
  if (!/^https?:\/\//i.test(url)) return null;
  return {
    authority: PANEL,
    mediaId: brut.mediaId ?? null,
    url,
    mime: brut.mime ?? null,
    width: brut.width ?? null,
    height: brut.height ?? null,
    sha256: brut.sha256 ?? null,
    version: brut.version ?? null,
  };
}

/**
 * Repli pour un Panel antérieur au descripteur : on publie l'adresse, et on
 * dit explicitement qu'on ne sait rien d'autre. Inventer une empreinte
 * laisserait croire qu'on peut comparer deux versions.
 */
function urlOnlyDescriptor(valeur) {
  const url = String(valeur ?? '').trim();
  if (!/^https?:\/\//i.test(url)) return null;
  return {
    authority: PANEL,
    mediaId: null, url, mime: null, width: null, height: null, sha256: null, version: null,
  };
}

/**
 * Single bootstrap endpoint for the vitrine: returns everything needed to
 * render the site (or the suspended page), without authentication.
 */
export const bootstrap = asyncHandler(async (req, res) => {
  // `devCompany` a disparu de cette liste : c'était l'identité développeur
  // ÉDITÉE LOCALEMENT, que la vitrine n'a plus à connaître. Ce qu'elle
  // affiche vient de `publicDeveloper()`, c'est-à-dire du Panel.
  const [company, theme, siteStatus, homeContent] = await Promise.all([
    getSingleton(Company),
    getSingleton(Theme),
    getSingleton(SiteStatus),
    /**
     * LE CONTENU D'ACCUEIL VOYAGE DANS LE BOOTSTRAP, pas dans une route à part.
     *
     * C'est la PREMIÈRE chose que la page d'accueil doit peindre : son titre,
     * ses boutons, sa maquette. Le charger séparément ferait apparaître la
     * bannière vide puis se remplir — le défaut de rendu que tout le reste de
     * ce site s'applique à éviter.
     *
     * Il reste petit : quelques dizaines de lignes de texte, aucune liste
     * longue, aucune image encapsulée. C'est l'inverse des BLOCS d'une page
     * éditoriale, écartés du bootstrap quelques lignes plus bas parce qu'ils
     * grossissent à proportion de ce que le client rédige.
     */
    getSingleton(HomeContent),
  ]);

  // When suspended, only expose the minimum needed for the suspended page.
  if (siteStatus.status === 'SUSPENDED') {
    const vitrine = await projectCompanyMedia(company);
    return ok(res, {
      siteStatus,
      theme,
      company: { name: vitrine.name, logos: vitrine.logos },
      suspended: true,
    });
  }

  const [chapters, pages] = await Promise.all([
    /**
     * LES CHAPITRES ARRIVENT ENTIERS — et c'est l'inverse du choix fait pour
     * les pages, juste en dessous. La différence tient au volume : les quatre
     * chapitres SONT la page d'accueil (leurs volets s'y résument), et les
     * charger à l'ouverture de chacun ferait payer un aller-retour pour du
     * texte que l'accueil vient déjà de peindre.
     */
    Chapter.find({ published: true }).sort({ navOrder: 1, order: 1, createdAt: 1 }),
    /**
     * LES PAGES ARRIVENT SANS LEURS BLOCS — et c'est délibéré.
     *
     * Le bootstrap sert à peindre la barre de navigation et l'accueil : il a
     * besoin du titre, du slug et du rang de chaque page, pas de son contenu.
     * Le porter ici ferait grossir la première requête du site à proportion de
     * ce que le client rédige — une page riche en galeries pèse plus que tout
     * le reste du bootstrap réuni, et personne ne l'a encore demandée.
     *
     * Le contenu est chargé à l'ouverture de la page, par `/public/pages/:slug`.
     */
    SitePage.find({ published: true })
      .select('title slug navLabel showInNav navOrder intro heroImage heroImageMedia order seo')
      .sort({ navOrder: 1, order: 1, createdAt: 1 }),
  ]);

  /**
   * LES ADRESSES DES MÉDIAS SONT DÉRIVÉES ICI, ET NULLE PART AILLEURS.
   *
   * La vitrine lit les mêmes champs qu'avant — `logos.header`, `heroImage` —
   * mais ce qu'elle y trouve vient du DESCRIPTEUR, résolu contre la
   * destination active. Aucun composant n'a à connaître le descripteur, et
   * aucun ne recompose `/uploads/…` à la main.
   */
  const [companyResolue, homeResolu, chaptersResolus, pagesResolues] = await Promise.all([
    projectCompanyMedia(company),
    projectHomeContentMedia(homeContent),
    projectChaptersMedia(chapters),
    projectSitePagesMedia(pages),
  ]);

  return ok(res, {
    company: companyResolue,
    home: homeResolu,
    theme,
    siteStatus,
    developer: await publicDeveloper(),
    /**
     * CE QUE LE PIED DE PAGE DOIT PROPOSER — les LIBELLÉS, pas les documents.
     *
     * Le pied affiche les liens seulement si le Panel a réellement publié ces
     * documents pour ce projet. Un lien codé en dur mènerait à une 404 sur un
     * projet sans affectation — un lien mort en pied de chaque page.
     */
    legalDocuments: await (
      await import('../services/panelConfiguration/legalDocument.service.js')
    ).listAvailableLegalDocuments(),
    chapters: chaptersResolus,
    pages: pagesResolues,
    network: await publicNetwork(),
    suspended: false,
  });
});

/**
 * GET /public/pages/:slug — le CONTENU d'une page éditoriale.
 *
 * Séparé du bootstrap pour la raison dite plus haut : le contenu long ne doit
 * pas peser sur la première requête du site. Une page dépubliée répond 404 et
 * non « page vide » — une page qu'on a retirée n'existe pas, elle n'est pas
 * blanche.
 */
export const getPageBySlug = asyncHandler(async (req, res) => {
  const page = await SitePage.findOne({ slug: req.params.slug, published: true });
  if (!page) throw ApiError.notFound('Page introuvable');
  return ok(res, await projectSitePageMedia(page));
});

/**
 * UN DOCUMENT LÉGAL — `GET /public/legal/:type`.
 *
 * ══ POURQUOI UNE ROUTE À PART, ET NON UN CHAMP DU BOOTSTRAP ═══════════════
 *
 * Le bootstrap est chargé à CHAQUE visite pour rendre l'accueil. Y embarquer
 * deux documents complets ferait payer à chaque visiteur le poids de deux
 * pages que l'immense majorité n'ouvrira jamais.
 *
 * Le pied de page a seulement besoin de SAVOIR qu'elles existent : c'est ce
 * que porte `bootstrap.legalDocuments` (deux libellés), et c'est tout.
 *
 * ══ 404 SANS REPLI ═══════════════════════════════════════════════════════
 *
 * Sans document publié, on répond 404. On ne retombe ni sur un texte
 * générique, ni sur la fiche `Company` locale, ni sur l'autre type. Des
 * mentions légales approximatives seraient pires qu'absentes : elles sont
 * opposables.
 *
 * ══ AUCUN APPEL AU PANEL ═════════════════════════════════════════════════
 *
 * On sert la réplique locale. Une panne du Panel fige le contenu, elle ne
 * vide pas la page.
 */
export const getLegalDocumentByType = asyncHandler(async (req, res) => {
  const { getLegalDocument } = await import('../services/panelConfiguration/legalDocument.service.js');
  const type = String(req.params.type ?? '').toUpperCase();
  if (!['LEGAL_NOTICE', 'PRIVACY_POLICY'].includes(type)) {
    throw ApiError.notFound('Document légal introuvable');
  }
  const document = await getLegalDocument(type);
  if (!document) throw ApiError.notFound('Document légal introuvable');
  return ok(res, document);
});

/**
 * UN CHAPITRE PAR SON SLUG — servi entier, médias résolus.
 *
 * Le bootstrap porte déjà les chapitres publiés ; cette route existe pour
 * l'accès DIRECT (un lien partagé, un rechargement sur `/architecture`) et
 * pour qu'un chapitre reste lisible si l'on décide un jour de l'alléger du
 * bootstrap. Un chapitre dépublié répond 404 et non « chapitre vide » : un
 * chapitre qu'on a retiré n'existe pas, il n'est pas blanc.
 */
export const getChapterBySlug = asyncHandler(async (req, res) => {
  const { projectChapterMedia } = await import('../services/media/mediaProjection.service.js');
  const chapitre = await Chapter.findOne({ slug: req.params.slug, published: true });
  if (!chapitre) throw ApiError.notFound('Chapitre introuvable');
  return ok(res, await projectChapterMedia(chapitre));
});

/**
 * GET /public/sitemap.xml — le plan du site, DÉRIVÉ du contenu publié.
 *
 * ══ POURQUOI IL EST SERVI PAR L'API, ET NON POSÉ DANS `public/` ═════════════
 *
 * Un fichier statique aurait été plus simple à écrire, et faux le lendemain :
 * les chapitres et les pages éditoriales se créent depuis le Manager, sans
 * redéploiement. Un plan de site figé aurait donc annoncé aux moteurs un site
 * qui n'existe plus — en taisant les pages ajoutées, et en citant celles qu'on
 * a retirées.
 *
 * ══ CE QU'IL RÉPARE ════════════════════════════════════════════════════════
 *
 * `robots.txt` annonçait `/sitemap.xml`. Cette adresse n'existait pas : le
 * serveur d'une application à page unique répond `index.html` à tout ce qu'il
 * ne connaît pas. Les moteurs recevaient donc du HTML en 200 à la place d'un
 * XML — une erreur silencieuse, visible seulement dans leur console.
 *
 * ══ CE QU'IL CONTIENT, ET CE QU'IL TAIT ════════════════════════════════════
 *
 * Les adresses PUBLIQUES et indexables : l'accueil, les chapitres publiés, les
 * pages éditoriales publiées, la page de contact, et les documents légaux
 * RÉELLEMENT servis. Pas la page 404 (elle porte `noindex`), pas le Manager,
 * pas l'API.
 *
 * L'hôte vient de la configuration réseau du projet, jamais d'un en-tête de la
 * requête : un `Host` falsifié ferait publier un plan de site pointant
 * ailleurs. Sans URL publique configurée, on répond 404 plutôt qu'un plan
 * relatif — un sitemap sans adresse absolue n'est pas exploitable.
 */
export const sitemap = asyncHandler(async (req, res) => {
  const cfg = await getSingleton(SystemConfiguration);
  const base = String(cfg.network?.websiteUrl ?? '').replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) throw ApiError.notFound('Plan du site indisponible');

  const { listAvailableLegalDocuments } = await import(
    '../services/panelConfiguration/legalDocument.service.js'
  );
  const [chapters, pages, legaux] = await Promise.all([
    Chapter.find({ published: true }).select('slug updatedAt').sort({ navOrder: 1, order: 1 }).lean(),
    SitePage.find({ published: true }).select('slug updatedAt').sort({ navOrder: 1, order: 1 }).lean(),
    listAvailableLegalDocuments(),
  ]);

  /** Type de document légal → route française. Même table que la vitrine. */
  const ROUTES_LEGALES = { LEGAL_NOTICE: '/mentions-legales', PRIVACY_POLICY: '/politique-de-confidentialite' };

  const entrees = [
    { loc: '/', priority: '1.0', changefreq: 'monthly' },
    ...chapters.map((c) => ({ loc: `/${c.slug}`, lastmod: c.updatedAt, priority: '0.8', changefreq: 'monthly' })),
    { loc: '/presenter-un-projet', priority: '0.9', changefreq: 'yearly' },
    ...pages.map((p) => ({ loc: `/p/${p.slug}`, lastmod: p.updatedAt, priority: '0.5', changefreq: 'monthly' })),
    ...(legaux ?? [])
      .filter((d) => ROUTES_LEGALES[d.type])
      .map((d) => ({ loc: ROUTES_LEGALES[d.type], priority: '0.2', changefreq: 'yearly' })),
  ];

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entrees.map((e) => [
      '  <url>',
      `    <loc>${base}${e.loc}</loc>`,
      e.lastmod ? `    <lastmod>${new Date(e.lastmod).toISOString().slice(0, 10)}</lastmod>` : null,
      `    <changefreq>${e.changefreq}</changefreq>`,
      `    <priority>${e.priority}</priority>`,
      '  </url>',
    ].filter(Boolean).join('\n')),
    '</urlset>',
    '',
  ].join('\n');

  res.type('application/xml').send(xml);
});

/** GET /public/network-configuration — section réseau publique (filtrée). */
export const networkConfiguration = asyncHandler(async (req, res) => {
  return ok(res, await publicNetwork());
});
