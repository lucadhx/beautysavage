/**
 * PRÉSENTATION PUBLIQUE DU PROJET — ce que le Panel affiche d'un client.
 *
 * ── LE MANQUE QUE CE MODULE COMBLE ──────────────────────────────────────────
 * Le manifeste ne publiait qu'une identité TECHNIQUE : clé, versions, et
 * l'URL de l'API comme unique adresse. Le Panel affichait donc « SB Auto 06 »
 * et « api.demo-sbauto.lycarz.com » là où l'équipe attend le nom commercial du
 * garage, son logo et l'adresse de son site.
 *
 * Ces informations existent déjà, configurées dans le Manager : elles vivent
 * dans `Company` (nom, slogan, logos, médias) et dans la Configuration Système
 * (`network.websiteUrl`, `managerUrl`, `backendUrl`). Ce module les LIT et les
 * met en forme ; il ne crée aucune donnée et n'en invente aucune.
 *
 * Le projet reste propriétaire : le Panel n'en reçoit qu'une projection, et
 * la moindre modification dans le Manager repart au prochain rafraîchissement
 * du manifeste.
 */
import { getSingleton } from '../../utils/singleton.js';
import { Company } from '../../models/Company.model.js';
import SystemConfiguration from '../../models/SystemConfiguration.model.js';
import { resolvePublicAssetUrl } from '../networkConfig.service.js';
import { publishableProjectDescriptor } from '../media/projectMedia.service.js';

/**
 * Médias RETENUS pour le Panel métier, et eux seuls.
 *
 * `MEDIA_CATALOG` porte aussi Instagram, Facebook, Snapchat et l'adresse
 * postale : utiles à la vitrine, sans emploi sur une fiche de suivi client.
 * On ne transporte que ce que le Panel affiche réellement — et jamais les
 * clés techniques du catalogue (`icon`, `order`, `label`).
 */
const PANEL_MEDIA_KEYS = Object.freeze({ email: 'email', phone: 'phone' });

const trimmed = (value) => String(value ?? '').trim();

/**
 * Projection des médias activés vers les contacts du manifeste.
 * Une entrée désactivée ou vide n'est pas publiée : l'absence est une
 * information, une chaîne vide n'en est pas une.
 */
function contactsFrom(media, websiteUrl) {
  const contacts = {};
  for (const entry of media ?? []) {
    if (entry?.enabled !== true) continue;
    const target = PANEL_MEDIA_KEYS[entry.key];
    if (!target) continue;
    const value = trimmed(entry.value);
    if (value.length > 0) contacts[target] = value;
  }
  // Le « site web » n'est pas un média du catalogue : c'est l'adresse publique
  // du projet, tenue par la Configuration Système.
  const site = trimmed(websiteUrl);
  if (site.length > 0) contacts.website = site;
  return Object.keys(contacts).length > 0 ? contacts : undefined;
}

/**
 * Présentation + URLs publiques du projet, prêtes pour le manifeste.
 *
 * Ne lève jamais : l'appelant (le pont) traite l'absence comme un manque, pas
 * comme une panne. Tous les champs sont optionnels et omis s'ils sont vides —
 * le Panel doit pouvoir distinguer « non configuré » de « vide ».
 *
 * @returns {Promise<{presentation?: object, urls?: object}>}
 */
export async function describeProjectPresentation() {
  const [company, cfg] = await Promise.all([
    getSingleton(Company),
    getSingleton(SystemConfiguration),
  ]);

  const network = cfg?.network ?? {};
  const backendUrl = trimmed(network.backendUrl);
  const websiteUrl = trimmed(network.websiteUrl);
  const managerUrl = trimmed(network.managerUrl);

  /**
   * ── LE DESCRIPTEUR ACCOMPAGNE L'URL — il ne la remplace pas ───────────────
   *
   * Le Panel ne recevait qu'une adresse. Il ne pouvait répondre à aucune des
   * questions dont il a besoin : est-ce la même image qu'hier (aucune
   * empreinte) ? quel type réel ? quelles dimensions, donc quelle place
   * réserver à l'écran ? cette projection est-elle plus récente que celle
   * déjà appliquée ? Il ne pouvait que recharger l'adresse et espérer — d'où
   * des images remplacées qui restaient affichées depuis le cache.
   *
   * Le Panel publie ces descripteurs depuis toujours. Le projet, non : le
   * Bridge était asymétrique. Il ne l'est plus.
   *
   * `logoUrl` reste publié : un Panel antérieur au descripteur continue de
   * fonctionner sans rien changer.
   *
   * ── L'ADRESSE VIENT DU RÉSOLVEUR, PAS D'UNE CONCATÉNATION ─────────────────
   * `resolveProjectMediaUrl` est le seul producteur d'adresse : il connaît le
   * cycle de vie de la destination et l'environnement. Recomposer ici « base +
   * chemin » aurait fini par en diverger — et aurait publié l'adresse d'une
   * destination retirée.
   */
  const [logo, favicon] = await Promise.all([
    publishableProjectDescriptor(
      company?.logosMedia?.header?.objectKey ?? company?.logos?.header, { role: 'logo' },
    ).catch(() => null),
    publishableProjectDescriptor(
      company?.logosMedia?.favicon?.objectKey ?? company?.logos?.favicon, { role: 'favicon' },
    ).catch(() => null),
  ]);

  /**
   * REPLI pour les fiches antérieures au registre des médias : un fichier
   * présent sous `/uploads` sans descripteur reste publiable par son adresse.
   * Sans lui, une mise à jour ferait disparaître des logos qui fonctionnaient.
   */
  const logoUrl = logo?.url ?? resolvePublicAssetUrl(company?.logos?.header, backendUrl);
  const faviconUrl = favicon?.url ?? resolvePublicAssetUrl(company?.logos?.favicon, backendUrl);

  const companyName = trimmed(company?.name);
  const tagline = trimmed(company?.tagline);
  const contacts = contactsFrom(company?.media, websiteUrl);

  const presentation = {
    ...(companyName.length > 0 ? { companyName } : {}),
    ...(tagline.length > 0 ? { tagline } : {}),
    ...(logoUrl ? { logoUrl } : {}),
    ...(faviconUrl ? { faviconUrl } : {}),
    // ADDITIF : le descripteur complet, à côté de l'URL historique.
    ...(logo ? { logo } : {}),
    ...(favicon ? { favicon } : {}),
    ...(contacts ? { contacts } : {}),
  };

  const urls = {
    ...(websiteUrl.length > 0 ? { website: websiteUrl } : {}),
    ...(managerUrl.length > 0 ? { manager: managerUrl } : {}),
    ...(backendUrl.length > 0 ? { backend: backendUrl } : {}),
  };

  return {
    ...(Object.keys(presentation).length > 0 ? { presentation } : {}),
    ...(Object.keys(urls).length > 0 ? { urls } : {}),
  };
}

export default { describeProjectPresentation };
