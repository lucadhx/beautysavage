/**
 * L'IDENTITÉ DU DÉVELOPPEUR — une seule lecture, une seule source.
 *
 * ── CE QUI EXISTAIT AVANT ───────────────────────────────────────────────────
 * Trois endroits lisaient trois fois la même chose, et pas au même endroit :
 * le pied de page interrogeait la configuration publiée par le Panel, tandis
 * que la génération de contrats et les e-mails lisaient `DevCompany`, une fiche
 * éditée localement dans chaque projet.
 *
 * Conséquence observée : un contrat pouvait être signé au nom d'une entreprise
 * que le Panel ne connaissait pas, pendant que le site du même projet affichait
 * l'autre nom en bas de page. Deux vérités, et rien pour dire laquelle était la
 * bonne.
 *
 * Ce module est désormais le SEUL point de lecture. Tout ce qui a besoin de
 * savoir qui édite ce projet passe par ici.
 *
 * ── AUCUN ACCÈS RÉSEAU ──────────────────────────────────────────────────────
 * On lit la DERNIÈRE configuration reçue, persistée localement. Générer un
 * contrat ou envoyer un e-mail n'interroge donc jamais le Panel : une panne du
 * Panel ne bloque pas le métier, elle fige simplement ce qu'on sait déjà.
 *
 * ── AUCUN REPLI SILENCIEUX ──────────────────────────────────────────────────
 * Sans configuration publiée, ces fonctions renvoient `null` ou lèvent une
 * erreur métier explicite selon ce que l'appelant peut supporter. Elles ne
 * retombent JAMAIS sur `DevCompany` : c'est cette retombée qui a produit le
 * défaut ci-dessus.
 */
import { ApiError } from '../../utils/ApiError.js';
import { getCompanyConfiguration } from './panelConfiguration.service.js';
import { assertAuthority, PANEL } from '../media/mediaAuthority.js';

/** Une adresse e-mail plausible — la forme, pas l'existence. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * L'identité publiée, ou `null` si le Panel n'a rien publié.
 *
 * @returns {Promise<null|{
 *   name: string, tagline: string|null, legalName: string|null,
 *   logoUrl: string|null, websiteUrl: string|null,
 *   signer: object|null, references: object[], team: object[],
 *   supportEmail: string|null, version: number|null,
 * }>}
 */
export async function getPublishedDeveloperIdentity() {
  const cfg = await getCompanyConfiguration().catch(() => null);
  const name = String(cfg?.identity?.name ?? '').trim();
  // Sans NOM, il n'y a pas d'entreprise à présenter : le reste (logo, slogan,
  // références) n'a aucun sens seul.
  if (!name) return null;

  const references = Array.isArray(cfg.references) ? cfg.references : [];

  return {
    name,
    tagline: cfg.identity?.tagline ?? null,
    legalName: cfg.identity?.legalName ?? null,
    logoUrl: mediaUrl(cfg.branding?.logo, cfg.branding?.logoUrl),
    faviconUrl: mediaUrl(cfg.branding?.favicon, cfg.branding?.faviconUrl),
    /**
     * DESCRIPTEURS CANONIQUES (>= 1.5.0) — empreinte, type, dimensions,
     * version. Ce sont eux qui permettent de dire « c'est une AUTRE image »
     * plutôt que de recharger la même adresse en espérant.
     *
     * Un Panel antérieur ne les envoie pas : ils valent alors `null`, et les
     * écrans retombent sur l'URL seule. Aucun écran ne casse.
     */
    logo: descriptorOf(cfg.branding?.logo),
    favicon: descriptorOf(cfg.branding?.favicon),
    // Seule une adresse absolue est retenue : un lien relatif pointerait sur le
    // site du client, ce qui serait pire que pas de lien.
    websiteUrl: /^https?:\/\//i.test(String(cfg.domains?.websiteUrl ?? '').trim())
      ? cfg.domains.websiteUrl.trim()
      : null,
    signer: cfg.signer ?? null,
    references,
    // Chaque membre porte, lui aussi, son descripteur à côté de son URL.
    team: (Array.isArray(cfg.team) ? cfg.team : []).map((m) => ({
      ...m,
      photoUrl: mediaUrl(m?.photo, m?.photoUrl),
      photo: descriptorOf(m?.photo),
    })),
    supportEmail: publicContactEmail(cfg),
    version: cfg.version ?? null,
  };
}

/**
 * L'ADRESSE À AFFICHER — descripteur d'abord, URL historique ensuite.
 *
 * ── AUCUN REPLI LOCAL ───────────────────────────────────────────────────────
 * Si le Panel n'a rien publié, on rend `null`. On ne cherche PAS une image
 * dans les médias du projet : les médias du développeur et ceux du client
 * n'ont rien à voir, et afficher le logo du garage à la place de celui de
 * l'agence serait pire qu'une absence.
 */
function mediaUrl(descripteur, urlHistorique) {
  // Un descripteur qui se déclare PROJECT dans le bloc du DÉVELOPPEUR décrit un
  // média du client. On ne lit même pas son adresse : afficher le logo du
  // garage à la place de celui de l'agence serait pire qu'une absence.
  const depuisDescripteur = assertAuthority(descripteur, PANEL)
    ? String(descripteur?.url ?? '').trim()
    : '';
  if (/^https?:\/\//i.test(depuisDescripteur)) return depuisDescripteur;
  const brut = String(urlHistorique ?? '').trim();
  // Seule une adresse ABSOLUE est retenue : un chemin relatif pointerait sur
  // le site du client, pas sur le Panel.
  return /^https?:\/\//i.test(brut) ? brut : null;
}

/**
 * Le descripteur, normalisé — ou `null`.
 *
 * On ne fabrique jamais un descripteur à partir d'une simple URL : annoncer
 * une empreinte qu'on n'a pas ferait croire qu'on peut comparer deux versions,
 * alors qu'on ne le peut pas.
 */
function descriptorOf(brut) {
  if (!brut || typeof brut !== 'object') return null;

  /**
   * CE BLOC APPARTIENT AU PANEL, ET SEULEMENT À LUI.
   *
   * `branding.logo`, `branding.favicon`, `team[].photo` sont publiés par le
   * Panel : leur autorité est PANEL par le schéma du champ. Un descripteur qui
   * s'y déclarerait PROJECT serait une violation de contrat — on le REFUSE au
   * lieu de le corriger, parce qu'un correctif silencieux ferait afficher le
   * logo du garage à la place de celui de l'agence.
   */
  if (!assertAuthority(brut, PANEL)) return null;

  const url = String(brut.url ?? '').trim();
  if (!/^https?:\/\//i.test(url)) return null;
  return {
    /** Déclarée à l'aval : personne ne doit recomposer cette adresse. */
    authority: PANEL,
    mediaId: brut.mediaId ?? null,
    url,
    mime: brut.mime ?? null,
    size: brut.size ?? null,
    width: brut.width ?? null,
    height: brut.height ?? null,
    sha256: brut.sha256 ?? null,
    version: brut.version ?? null,
    updatedAt: brut.updatedAt ?? null,
    role: brut.role ?? null,
  };
}

/**
 * L'ADRESSE DE CONTACT PUBLIC — CELLE QUE LE PANEL A PUBLIÉE, et rien d'autre.
 *
 * ══ CE QU'ELLE N'EST PAS ════════════════════════════════════════════════════
 *
 * Ni `contacts.supportEmail` — c'est l'adresse transmise à Let's Encrypt pour
 * les alertes d'expiration de certificat, une donnée d'exploitation qui n'a
 * rien à faire dans le pied d'un e-mail client. Ni l'expéditeur du parc : le
 * `From` peut être une boîte technique que personne ne relève, et inviter un
 * client à y répondre serait une impasse. Ni une variable d'environnement de
 * ce projet, ni un réglage local, ni l'adresse d'un compte administrateur.
 *
 * ══ POURQUOI CE N'EST PLUS DÉDUIT DES RÉFÉRENCES ════════════════════════════
 *
 * Cette fonction balayait `references[]` et retenait la première valeur qui
 * ressemblait à une adresse. Le contact public dépendait donc de l'ORDRE d'une
 * liste de liens hétéroclites — LinkedIn, site, téléphone, e-mail — que
 * l'opérateur réorganise pour des raisons d'affichage, sans savoir qu'il
 * change au passage l'adresse imprimée au bas de chaque message client.
 *
 * Le Panel porte désormais un champ explicite, publié dans `contacts`. Le repli
 * sur les références demeure UNIQUEMENT pour un Panel non encore mis à jour :
 * il reproduit à l'identique l'ancien comportement, ce qui évite qu'une
 * plateforme en cours de mise à niveau perde l'adresse qu'elle affichait hier.
 * Il disparaîtra avec la dernière version antérieure du Panel.
 */
function publicContactEmail(cfg) {
  const publie = String(cfg?.contacts?.publicContactEmail ?? '').trim();
  if (EMAIL.test(publie)) return publie;
  /* Panel antérieur au champ explicite : ancien comportement, à l'identique. */
  if (cfg?.contacts?.publicContactEmail === undefined) {
    return supportEmailFromReferences(Array.isArray(cfg?.references) ? cfg.references : []);
  }
  /* Le champ existe et il est vide : c'est une DÉCISION non prise, pas une
     donnée manquante. On rend `null` — le refus se fera plus haut, avec un
     message qui nomme l'écran à remplir, plutôt qu'un pied de page muet. */
  return null;
}

/**
 * L'ancienne déduction, conservée pour le repli ci-dessus et pour la recette.
 *
 * Les références gardent leur ordre significatif : la première adresse e-mail
 * déclarée était celle que l'agence mettait en avant.
 */
export function supportEmailFromReferences(references = []) {
  const triees = [...references].sort((a, b) => (a?.order ?? 0) - (b?.order ?? 0));
  for (const r of triees) {
    const valeur = String(r?.value ?? '').trim().replace(/^mailto:/i, '');
    if (EMAIL.test(valeur)) return valeur;
  }
  return null;
}

/**
 * L'identité, ou un REFUS explicite.
 *
 * Réservé aux parcours qui ne peuvent pas continuer sans elle — signer un
 * contrat, par exemple. Le message dit quoi faire, parce que la personne qui
 * le lira n'est pas celle qui configure le Panel.
 */
export async function requirePublishedDeveloperIdentity() {
  const identite = await getPublishedDeveloperIdentity();
  if (!identite) {
    throw ApiError.badRequest(
      'Aucune entreprise développeur n’a été publiée par le Panel : impossible de savoir qui édite ce projet.',
      { code: 'DEVELOPER_IDENTITY_NOT_PUBLISHED' },
    );
  }
  return identite;
}

/**
 * Le SIGNATAIRE publié, ou un refus.
 *
 * Un signataire incomplet est refusé ici plutôt qu'au moment de la signature :
 * découvrir qu'il manque un prénom face au client serait le pire moment.
 */
export async function requirePublishedSigner() {
  const identite = await requirePublishedDeveloperIdentity();
  const s = identite.signer;
  const manquants = ['firstName', 'lastName', 'email']
    .filter((k) => !String(s?.[k] ?? '').trim());

  if (manquants.length) {
    throw ApiError.badRequest(
      `Le signataire publié par le Panel est incomplet (${manquants.join(', ')}) : la validation d’un contrat est refusée.`,
      { code: 'DEVELOPER_SIGNER_INCOMPLETE', missing: manquants },
    );
  }
  if (!EMAIL.test(String(s.email).trim())) {
    throw ApiError.badRequest(
      'L’adresse e-mail du signataire publié par le Panel est invalide : la validation d’un contrat est refusée.',
      { code: 'DEVELOPER_SIGNER_INVALID_EMAIL' },
    );
  }
  return { identity: identite, signer: s };
}

export default {
  getPublishedDeveloperIdentity,
  requirePublishedDeveloperIdentity,
  requirePublishedSigner,
  supportEmailFromReferences,
};

export { descriptorOf, mediaUrl };
