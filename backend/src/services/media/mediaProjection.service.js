/**
 * PROJECTION DES MÉDIAS D'UNE FICHE — le descripteur devient une adresse.
 *
 * ══ LE DÉFAUT QUE CE MODULE FERME ═══════════════════════════════════════════
 *
 * Les fiches ont gagné leurs descripteurs, mais les LECTURES continuaient de
 * prendre l'ancienne chaîne d'URL : `company.logos.header`, `service.bannerImage`,
 * `review.photo`, `beforeAfter.imageBefore`. Le modèle disait une chose, les
 * consommateurs en lisaient une autre. Deux vérités, et c'est toujours la
 * mauvaise qui gagne le jour d'un changement de domaine.
 *
 * ══ POURQUOI ICI, ET PAS DANS CHAQUE COMPOSANT ══════════════════════════════
 *
 * On aurait pu apprendre à chaque `<img>` à lire un descripteur. Il y en a des
 * dizaines, dans deux applications, et il s'en ajoutera. Chacun aurait fini
 * par redécouvrir la règle à sa façon — c'est ainsi qu'on obtient trois
 * fonctions homonymes et un composant qui recompose `/uploads/…` à la main.
 *
 * La résolution a donc lieu UNE FOIS, au moment où la fiche quitte le backend.
 * Les consommateurs continuent de lire le même champ ; ce qu'ils y trouvent
 * est désormais DÉRIVÉ du descripteur, jamais l'adresse stockée.
 *
 * ══ L'ORDRE DE LECTURE, ET IL NE S'INVERSE JAMAIS ═══════════════════════════
 *
 *   1. le DESCRIPTEUR de la fiche, s'il existe ;
 *   2. résolu par la FRONTIÈRE D'AUTORITÉ — un média du projet suit la
 *      destination active, un média du Panel garde l'adresse que le Panel a
 *      publiée ;
 *   3. à défaut seulement, le média retrouvé depuis l'ancienne chaîne ;
 *   4. à défaut de tout, la chaîne telle quelle — compatibilité de lecture
 *      pour les données antérieures, et rien d'autre.
 *
 * Le champ historique n'est plus ÉCRIT par personne : il est seulement encore
 * LU, et seulement quand aucun descripteur n'existe.
 *
 * ══ POURQUOI LA DÉCISION N'EST PLUS PRISE ICI ═══════════════════════════════
 *
 * Ce module testait `descriptor?.objectKey` pour conclure « média du projet ».
 * Le Panel décrit les siens de la même façon : son logo était donc recomposé
 * contre le domaine du client, et répondait 404. La question « à qui
 * appartient ce média ? » a désormais UN seul répondant — `mediaAuthority` —
 * et il ne devine rien : il lit ce que l'émetteur a déclaré.
 */
import { findProjectMedia, resolveProjectMediaUrl } from './projectMedia.service.js';
import { authorityOf, isMediaDescriptor, resolveMediaUrl, PROJECT } from './mediaAuthority.js';
import { config } from '../../config/env.js';

/**
 * L'AUTORITÉ QUE LE SCHÉMA DE CES CHAMPS GARANTIT.
 *
 * `logosMedia`, `heroImageMedia`, `bannerImageMedia`, `photoMedia`,
 * `imageBefore/AfterMedia` sont tous typés `mediaDescriptorSchema` et ne sont
 * écrits que par l'import de médias MÉTIER de ce projet. Une projection
 * antérieure à `authority` qu'on y trouve est donc, par construction, un média
 * du PROJET — ce n'est pas une déduction sur son contenu, c'est ce que le
 * schéma autorise à y écrire.
 */
const CONTEXTE_FICHE = { legacyAuthority: PROJECT };

/**
 * Résout UN média : descripteur d'abord, ancienne chaîne en dernier recours.
 *
 * @param {object|null} descriptor  le descripteur stocké par la fiche
 * @param {string|null} legacyUrl   l'ancienne chaîne, pour les données antérieures
 * @param {string} environment      environnement du LECTEUR
 * @param {object} [contexte]       autorité garantie par le schéma du champ lu
 * @returns {Promise<string|null>}
 */
export async function resolveOne(descriptor, legacyUrl, environment = config.env, contexte = CONTEXTE_FICHE) {
  if (isMediaDescriptor(descriptor)) {
    const { url } = await resolveMediaUrl(descriptor, { environment, ...contexte });
    if (url) return url;
    // Un descripteur qui ne résout pas (autre environnement, média supprimé,
    // autorité inconnue) ne doit PAS retomber sur l'ancienne chaîne : ce serait
    // publier précisément l'adresse que la résolution vient de refuser.
    return null;
  }

  const brut = String(legacyUrl ?? '').trim();
  if (!brut) return null;
  // Une valeur absolue est déjà une adresse : on ne la réécrit pas.
  if (/^https?:\/\//i.test(brut) || brut.startsWith('data:')) return brut;

  // Compatibilité : la fiche ne porte qu'un chemin. On tente de retrouver son
  // descripteur pour le résoudre correctement ; sinon on rend le chemin.
  const media = await findProjectMedia(brut).catch(() => null);
  if (media) {
    const { url } = await resolveProjectMediaUrl(media, environment);
    return url ?? brut;
  }
  return brut;
}

/** Un objet nu, qu'il vienne de Mongoose ou déjà d'un `.lean()`. */
const nu = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

/**
 * ENTREPRISE — logo, favicon, image d'accueil.
 *
 * Les champs historiques (`logos.header`, `logos.favicon`, `heroImage`) sont
 * RÉÉCRITS avec l'adresse dérivée : tous les consommateurs existants lisent
 * donc la bonne valeur sans changer une ligne, et aucun d'eux n'a à connaître
 * l'existence du descripteur.
 */
export async function projectCompanyMedia(company, environment = config.env) {
  const c = nu(company);
  if (!c) return c;
  const [header, favicon, hero] = await Promise.all([
    resolveOne(c.logosMedia?.header, c.logos?.header, environment),
    resolveOne(c.logosMedia?.favicon, c.logos?.favicon, environment),
    resolveOne(c.heroImageMedia, c.heroImage, environment),
  ]);
  return {
    ...c,
    logos: { ...(c.logos ?? {}), header: header ?? '', favicon: favicon ?? '' },
    heroImage: hero ?? '',
  };
}

/**
 * LE CONTENU D'ACCUEIL — deux images : le fond de bannière, et celle de la
 * maquette.
 *
 * Même contrat que partout : le descripteur fait autorité, le chemin sert de
 * repli, l'adresse est dérivée à la lecture. Les deux savent être absentes —
 * la bannière retombe sur l'image de la fiche entreprise, la maquette se peint
 * d'un dégradé du thème — donc une résolution qui échoue rend une chaîne vide
 * plutôt que de retirer quoi que ce soit.
 */
export async function projectHomeContentMedia(home, environment = config.env) {
  const h = nu(home);
  if (!h) return h;
  const hero = nu(h.hero) ?? {};
  const showcase = nu(h.showcase) ?? {};
  const [banniere, maquette] = await Promise.all([
    resolveOne(hero.imageMedia, hero.image, environment),
    resolveOne(showcase.imageMedia, showcase.image, environment),
  ]);
  return {
    ...h,
    hero: { ...hero, image: banniere ?? '' },
    showcase: { ...showcase, image: maquette ?? '' },
  };
}

/**
 * UN CHAPITRE DU RÉCIT — son image de tête, et les visuels de ses volets.
 *
 * ══ MÊME CONTRAT QUE PARTOUT AILLEURS ═══════════════════════════════════════
 *
 * Le descripteur fait autorité, le chemin historique sert de repli, et
 * l'adresse est DÉRIVÉE à la lecture. Un chapitre lu depuis un poste de
 * développement — dont le backend local ne détient aucun octet — obtient donc
 * l'adresse de la destination qui sert réellement le fichier, au lieu d'un
 * `/uploads/…` pointant vers un dossier vide.
 *
 * Un volet dont l'image ne résout pas garde son objet et perd son adresse : le
 * rendu sait ne rien peindre pour une chaîne vide, et retirer le volet ferait
 * disparaître SON TEXTE — qui, lui, était bon.
 */
export async function projectChapterMedia(chapter, environment = config.env) {
  const c = nu(chapter);
  if (!c) return c;
  const [hero, items] = await Promise.all([
    resolveOne(c.heroImageMedia, c.heroImage, environment),
    Promise.all((c.items ?? []).map(async (item) => {
      const i = nu(item);
      const url = await resolveOne(i?.imageMedia, i?.image, environment);
      return { ...i, image: url ?? '' };
    })),
  ]);
  return { ...c, heroImage: hero ?? '', items };
}

/**
 * UNE PAGE ÉDITORIALE — l'image d'en-tête, et TOUTES celles de ses blocs.
 *
 * ══ UNE IMAGE QUI NE RÉSOUT PAS EST RETIRÉE, PAS RENDUE VIDE ════════════════
 *
 * Même règle que les galeries de service, et pour la même raison : un bloc
 * « galerie » est une suite d'images, pas une suite d'emplacements dont
 * certains sont troués. Un bloc « image » dont l'image ne résout pas garde en
 * revanche son objet — c'est l'éditeur qui décidera de le retirer, et le rendu
 * sait déjà ne rien peindre pour une adresse vide.
 */
export async function projectSitePageMedia(page, environment = config.env) {
  const p = nu(page);
  if (!p) return p;

  const resoudreImage = async (image) => {
    const i = nu(image);
    if (!i) return null;
    const url = await resolveOne(i.media, i.url, environment);
    return { ...i, url: url ?? '' };
  };

  const [hero, blocks] = await Promise.all([
    resolveOne(p.heroImageMedia, p.heroImage, environment),
    Promise.all((p.blocks ?? []).map(async (bloc) => {
      const b = nu(bloc);
      /**
       * LES PORTRAITS DE L'ÉQUIPE SE RÉSOLVENT ICI AUSSI.
       *
       * Un bloc `TEAM` porte une image PAR ÉLÉMENT, et non une image de bloc.
       * Sans cette ligne, `items[].image` traverserait la projection intacte :
       * le descripteur arriverait tel quel à la vitrine, qui n'a que l'URL de
       * repli à afficher — c'est-à-dire rien du tout sur un média récent, et
       * une adresse périmée au premier changement de domaine sur un ancien.
       *
       * Les éléments sont TOUS conservés, même sans photo : à la différence
       * d'une galerie, un membre d'équipe sans portrait garde sa section.
       * Filtrer ici ferait disparaître une personne de la page.
       */
      const [image, images, items] = await Promise.all([
        resoudreImage(b?.image),
        Promise.all((b?.images ?? []).map(resoudreImage)),
        Promise.all((b?.items ?? []).map(async (item) => {
          const it = nu(item);
          if (!it?.image) return it;
          return { ...it, image: await resoudreImage(it.image) };
        })),
      ]);
      return { ...b, image, images: images.filter((i) => i && i.url), items };
    })),
  ]);

  return { ...p, heroImage: hero ?? '', blocks };
}

/**
 * LES ADRESSES D'AFFICHAGE DES MÉDIAS DE L'ENTREPRISE — bloc PARALLÈLE.
 *
 * ── POURQUOI PAS DANS LES CHAMPS EUX-MÊMES ────────────────────────────────
 * La fiche entreprise est éditée : ce que l'écran reçoit, il le renvoie au
 * prochain enregistrement. Y écrire une adresse calculée la ferait persister
 * en base, et l'on retrouverait le défaut d'origine — une URL figée dans une
 * fiche, fausse au premier changement de domaine.
 *
 * Ce bloc est donc consultable en lecture et ignoré à l'écriture. Il est
 * indexé par le CHEMIN du descripteur, comme le fait le Panel.
 */
export async function companyMediaResolution(company, environment = config.env) {
  const c = nu(company);
  if (!c) return {};
  const cibles = [
    ['logos.header', c.logosMedia?.header, c.logos?.header],
    ['logos.favicon', c.logosMedia?.favicon, c.logos?.favicon],
    ['heroImage', c.heroImageMedia, c.heroImage],
  ];
  const resolus = await Promise.all(cibles.map(async ([chemin, descripteur, ancienne]) => {
    const url = await resolveOne(descripteur, ancienne, environment);
    // « Servi par une destination » — pas « enregistré ». Un média local est
    // parfaitement valide ; il n'est simplement visible que d'ici.
    const published = Boolean(url && /^https?:\/\//i.test(url));
    return [chemin, {
      url,
      published,
      fromDescriptor: isMediaDescriptor(descripteur),
      // L'écran doit pouvoir dire POURQUOI une adresse ne bouge pas quand la
      // destination change : parce qu'elle n'appartient pas à ce projet.
      authority: authorityOf(descripteur, CONTEXTE_FICHE),
    }];
  }));
  return Object.fromEntries(resolus);
}

const liste = (fn) => async (docs, environment = config.env) =>
  Promise.all((docs ?? []).map((d) => fn(d, environment)));

export const projectChaptersMedia = liste(projectChapterMedia);
export const projectSitePagesMedia = liste(projectSitePageMedia);

export default {
  resolveOne,
  companyMediaResolution,
  projectCompanyMedia,
  projectHomeContentMedia,
  projectChapterMedia,
  projectChaptersMedia,
  projectSitePageMedia,
  projectSitePagesMedia,
};
