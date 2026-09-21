import { User } from '../../models/User.model.js';
import { Customer } from '../../models/Customer.model.js';
import { Company } from '../../models/Company.model.js';
import { ExternalPrincipal, EXTERNAL_PROVIDERS } from '../../models/ExternalPrincipal.model.js';
import { getSingleton } from '../../utils/singleton.js';
import { ROLES } from '../../utils/constants.js';
import { keyHash } from '../../utils/eventPayloadSafety.js';
import { RECIPIENT_RESOLVER, TEST_ONLY_RESOLVERS } from '../../utils/emailTemplateConstants.js';

/**
 * Registre des RÉSOLVEURS DE DESTINATAIRES — hardcodé, code-first.
 *
 * ─── POURQUOI LE DESTINATAIRE EST SÉPARÉ DU TEMPLATE ─────────────────────────
 *
 * Un template est du CONTENU, éditable depuis une interface web. Un destinataire
 * est une DÉCISION MÉTIER (« qui doit être prévenu quand ceci arrive ? »). Les
 * mélanger aurait deux conséquences, toutes deux mauvaises :
 *
 *  1. une adresse deviendrait modifiable par quiconque édite un template — donc
 *     un e-mail pourrait être détourné sans toucher au code ;
 *  2. l'adresse serait figée dans du contenu, alors qu'elle doit être RECALCULÉE
 *     à chaque envoi (un administrateur ajouté hier doit recevoir l'e-mail
 *     d'aujourd'hui, sans que personne ait à rééditer quoi que ce soit).
 *
 * Aucun template ne porte donc d'adresse, et aucun résolveur n'écrit dans un
 * template. C'est un invariant, pas une convention.
 *
 * ─── LA RÉSOLUTION A LIEU DEUX FOIS ──────────────────────────────────────────
 *
 * Une fois à la MATÉRIALISATION (pour créer une exécution par destinataire), une
 * fois à l'EXÉCUTION (pour retrouver l'adresse derrière la clé). Entre les deux,
 * la liste peut changer : un compte supprimé fait disparaître sa clé, et
 * l'exécution correspondante devient sans objet. C'est traité comme un SKIP
 * explicite, jamais comme une erreur — le compte n'existe plus, il n'y a rien à
 * réparer. Voir `sendEmailHandler`.
 *
 * ─── SUR LES « COMPTES INACTIFS » ────────────────────────────────────────────
 *
 * La spécification demande de les ignorer. CE PROJET N'A PAS CETTE NOTION :
 * `User.model.js` ne porte ni `active`, ni `disabled`, ni `suspended` — un compte
 * existe ou n'existe pas. Aucun filtre n'est donc appliqué, et il ne faut pas en
 * inventer un : un champ `active` créé ici serait ignoré partout ailleurs
 * (authentification comprise), ce qui ferait croire à une désactivation qui
 * n'existe pas. Le jour où la notion apparaîtra, `activeUserFilter()` ci-dessous
 * est le seul point à modifier.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Filtre « compte utilisable ». Vide aujourd'hui — voir l'en-tête.
 *
 * Isolé dans une fonction plutôt qu'omis : le jour où `User` portera un état,
 * c'est ICI que la règle se pose, et nulle part ailleurs.
 */
export function activeUserFilter() {
  return {};
}

/**
 * @typedef {object} Recipient
 * @property {string} email
 * @property {string} name
 * @property {string} key  Empreinte STABLE (keyHash) — jamais l'adresse en clair.
 */

/**
 * Normalise, valide et déduplique une liste de destinataires.
 *
 * La déduplication porte sur l'adresse NORMALISÉE (minuscules, sans espaces) :
 * deux comptes distincts partageant la même adresse ne doivent produire qu'UN
 * envoi. Sans cela, la même personne recevrait deux fois le même e-mail — et
 * l'index unique du dispatcher ne l'en empêcherait pas, puisqu'il porte sur la
 * clé, donc sur l'adresse déjà normalisée. C'est bien ici qu'il faut trancher.
 */
export function normalizeRecipients(candidates) {
  const seen = new Set();
  const out = [];
  for (const c of candidates) {
    const email = String(c?.email || '').trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) continue; // une adresse invalide n'est pas une erreur : c'est un non-destinataire
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({ email, name: String(c?.name || '').trim(), key: keyHash(email) });
  }
  return out;
}

/** Tous les comptes d'un rôle, en destinataires. */
async function usersByRole(role) {
  const users = await User.find({ role, ...activeUserFilter() }).select('email name').lean();
  return normalizeRecipients(users);
}

/** Sources possibles de la résolution des destinataires de contact. */
export const CONTACT_RECIPIENTS_SOURCE = Object.freeze({
  CONFIGURED: 'CONFIGURED', // liste métier Company.contactNotificationRecipients
  ADMIN_FALLBACK: 'ADMIN_FALLBACK', // aucun configuré → comptes ADMIN valides
  NONE: 'NONE', // personne — l'envoi échouera en EMAIL_RECIPIENTS_NOT_FOUND
});

/**
 * Résolution des destinataires de contact AVEC sa provenance.
 *
 * Exportée séparément pour que l'endpoint de configuration puisse afficher à
 * l'administrateur QUI recevra réellement les notifications (« fallback ADMIN
 * utilisé »), sans dupliquer la règle métier.
 *
 * @returns {Promise<{source: string, recipients: Recipient[]}>}
 */
export async function resolveContactRecipients() {
  const company = await getSingleton(Company);
  const configured = normalizeRecipients(
    (company?.contactNotificationRecipients || []).map((email) => ({ email }))
  );
  if (configured.length > 0) return { source: CONTACT_RECIPIENTS_SOURCE.CONFIGURED, recipients: configured };

  const admins = await usersByRole(ROLES.ADMIN);
  if (admins.length > 0) return { source: CONTACT_RECIPIENTS_SOURCE.ADMIN_FALLBACK, recipients: admins };

  return { source: CONTACT_RECIPIENTS_SOURCE.NONE, recipients: [] };
}

/** Provenance d'un destinataire développeur — pour l'introspection et la recette. */
export const DEVELOPER_RECIPIENT_SOURCE = Object.freeze({
  NATIVE: 'NATIVE_PROJECT_DEV',
  FEDERATED: 'FEDERATED_PANEL_DEV',
});

/**
 * LES DÉVELOPPEURS RESPONSABLES DE CE PROJET, AVEC LEUR PROVENANCE.
 *
 * ══ DEUX POPULATIONS, UNE SEULE LISTE ═══════════════════════════════════════
 *
 *   1. les comptes DEV LOCAUX (`User`) — le développeur autonome du projet,
 *      celui qui existe même sans Panel ;
 *   2. les identités FÉDÉRÉES (`ExternalPrincipal`) — les développeurs
 *      L.Y Solution, qui n'ont aucun mot de passe ici et dont le compte vit
 *      dans le Panel.
 *
 * Les deux travaillent sur ce projet. N'en prévenir qu'une revient à choisir,
 * sans le dire, qui apprend qu'un incident technique s'est produit.
 *
 * ══ POURQUOI LA PRÉSENCE D'UNE PROJECTION VAUT AUTORISATION ═════════════════
 *
 * C'est le point délicat, et il ne se devine pas en lisant ce fichier seul :
 * un `ExternalPrincipal` n'apparaît QUE dans `completeFederatedLogin`, après
 * qu'une assertion signée par le Panel a été vérifiée avec
 * `audience: currentProjectId()`. Le Panel n'émet cette assertion que pour un
 * projet auquel le compte a accès.
 *
 * Autrement dit : la projection n'existe pas tant que le Panel n'a pas
 * affirmé, pour CE projet, que cette personne y a sa place. Un compte DEV du
 * Panel sans droit sur ce projet — ou un rôle DEV « global » — n'a jamais de
 * projection ici, et se trouve donc exclu PAR CONSTRUCTION, sans qu'aucune
 * liste locale n'ait à être tenue à jour.
 *
 * C'est la réponse à « faut-il écrire à tous les développeurs du Panel ? » :
 * non — à ceux que le Panel a autorisés ici, ce que cette collection dit déjà.
 *
 * ══ `enabled` EST UN REFLET, ET ON S'EN SERT QUAND MÊME — VOLONTAIREMENT ════
 *
 * `ExternalPrincipal.model.js` prévient : la SÉCURITÉ ne lit pas ce champ, elle
 * redemande au Panel. La règle vaut pour un ACCÈS. Une notification n'est pas
 * un accès : elle n'ouvre aucune porte, et le pire qu'un reflet périmé puisse
 * produire ici est un e-mail de trop — jamais une permission de trop.
 *
 * L'utiliser fait donc gagner ce qui compte : un développeur révoqué cesse de
 * recevoir les incidents du projet dès la révocation constatée, sans qu'un
 * appel au Panel soit ajouté sur le chemin d'un envoi d'e-mail — chemin qui,
 * lui, doit rester capable de partir quand tout va mal.
 *
 * @returns {Promise<{recipients: Recipient[], sources: Array<{email: string, source: string}>}>}
 */
export async function resolveProjectDeveloperRecipients() {
  const natifs = await User.find({ role: ROLES.DEV, ...activeUserFilter() })
    .select('email name')
    .lean();

  const federes = await ExternalPrincipal.find({
    provider: EXTERNAL_PROVIDERS.LY_SOLUTION_PANEL,
    // Un accès révoqué ne reçoit plus les incidents du projet — voir l'en-tête.
    enabled: { $ne: false },
  })
    .select('email displayName role')
    .lean();

  /**
   * L'ORDRE COMPTE POUR LA DÉDUPLICATION, ET IL EST DÉLIBÉRÉ.
   *
   * `normalizeRecipients` garde la PREMIÈRE occurrence d'une adresse. Les
   * natifs passent donc devant : quand la même personne existe des deux côtés
   * — cas banal d'un développeur qui possède aussi un compte local — c'est son
   * nom local, celui que le projet affiche partout ailleurs, qui apparaît dans
   * l'e-mail. Un seul message part, jamais deux.
   */
  const candidats = [
    ...natifs.map((u) => ({ email: u.email, name: u.name || '', source: DEVELOPER_RECIPIENT_SOURCE.NATIVE })),
    ...federes.map((p) => ({ email: p.email, name: p.displayName || '', source: DEVELOPER_RECIPIENT_SOURCE.FEDERATED })),
  ];

  const recipients = normalizeRecipients(candidats);

  /**
   * La PROVENANCE de chaque adresse retenue — jamais utilisée pour envoyer,
   * seulement pour expliquer. Un écran d'exploitation (et la recette) doit
   * pouvoir répondre « pourquoi cette personne est-elle prévenue ? » sans
   * rejouer le raisonnement de cette fonction.
   */
  const vues = new Set();
  const sources = [];
  for (const c of candidats) {
    const email = String(c.email || '').trim().toLowerCase();
    if (!email || vues.has(email)) continue;
    if (!recipients.some((r) => r.email === email)) continue;
    vues.add(email);
    sources.push({ email, source: c.source });
  }

  return { recipients, sources };
}

/**
 * @type {Record<string, (context: object) => Promise<Recipient[]>>}
 */
const RESOLVERS = Object.freeze({
  [RECIPIENT_RESOLVER.ADMIN_EMAILS]: () => usersByRole(ROLES.ADMIN),
  [RECIPIENT_RESOLVER.DEV_EMAILS]: () => usersByRole(ROLES.DEV),
  [RECIPIENT_RESOLVER.CUSTOMER_EMAIL]: async ({ event }) => {
    const customerId = event?.entityType === 'Customer'
      ? event?.entityId
      : event?.payloadSafe?.customerId;
    if (!customerId) return [];
    const customer = await Customer.findById(customerId).select('email firstName lastName').lean();
    if (!customer) return [];
    return normalizeRecipients([{
      email: customer.email,
      name: `${customer.firstName || ''} ${customer.lastName || ''}`.trim(),
    }]);
  },

  /**
   * Les développeurs responsables du projet — natifs ET fédérés autorisés.
   * La règle, et la raison pour laquelle une projection vaut autorisation,
   * vivent dans `resolveProjectDeveloperRecipients` : ce n'est qu'un pointeur.
   */
  [RECIPIENT_RESOLVER.PROJECT_DEVELOPER_RECIPIENTS]: () =>
    resolveProjectDeveloperRecipients().then((r) => r.recipients),

  /**
   * Destinataires des nouvelles demandes de contact. Chaîne de fallback (§11) :
   *  1. `Company.contactNotificationRecipients` valides → toutes ces adresses ;
   *  2. sinon les comptes de rôle ADMIN possédant une adresse valide — JAMAIS
   *     les comptes DEV (comptes techniques), JAMAIS l'adresse support (c'est
   *     un EXPÉDITEUR : s'auto-notifier masquerait l'absence de destinataire
   *     réel — c'est exactement ce qui a produit l'incident PROD
   *     EMAIL_RECIPIENTS_NOT_FOUND quand elle était vide) ;
   *  3. sinon RIEN — le handler trace alors EMAIL_RECIPIENTS_NOT_FOUND
   *     (DEAD_LETTER, visible côté DEV) et la demande reste enregistrée. La
   *     notification n'est jamais une condition de la demande.
   *
   * Un envoi INDIVIDUEL est produit par destinataire (le dispatcher matérialise
   * une exécution par adresse) : les administrateurs ne voient jamais les
   * adresses les uns des autres — confidentialité par construction (§12).
   */
  [RECIPIENT_RESOLVER.CONTACT_NOTIFICATION_RECIPIENTS]: () => resolveContactRecipients().then((r) => r.recipients),

  /**
   * Adresse fournie par l'appelant. RÉSERVÉ à la route DEV d'envoi de test :
   * `assertResolverAllowedForEvents` interdit son usage depuis une action.
   */
  [RECIPIENT_RESOLVER.EXPLICIT_TEST_RECIPIENT]: async (context) =>
    normalizeRecipients([{ email: context?.recipientEmail, name: context?.recipientName || '' }]),
});

export function hasResolver(name) {
  return Object.prototype.hasOwnProperty.call(RESOLVERS, name);
}

/**
 * Résout les destinataires d'un résolveur.
 *
 * Lève sur un résolveur INCONNU plutôt que de renvoyer une liste vide : un
 * résolveur mal orthographié dans le registre d'actions produirait sinon un
 * « zéro destinataire » silencieux, c'est-à-dire un e-mail que personne ne
 * reçoit et dont personne ne s'aperçoit.
 *
 * @returns {Promise<Recipient[]>}
 */
export async function resolveRecipients(name, context = {}) {
  if (!hasResolver(name)) {
    throw new Error(`Résolveur de destinataires inconnu : « ${name} ».`);
  }
  return RESOLVERS[name](context);
}

/**
 * Un résolveur réservé aux tests ne doit JAMAIS être atteignable par un
 * événement métier : sinon un événement porterait lui-même son destinataire,
 * exactement ce que la séparation template/destinataire interdit.
 */
export function assertResolverAllowedForEvents(name) {
  if (TEST_ONLY_RESOLVERS.includes(name)) {
    throw new Error(
      `Le résolveur « ${name} » est réservé à l'envoi de test DEV et ne peut pas être utilisé par une action d'événement.`
    );
  }
}

/** Introspection SÛRE (routes DEV) — aucune adresse n'est renvoyée. */
export function describeResolvers() {
  return Object.keys(RESOLVERS).map((name) => ({
    name,
    testOnly: TEST_ONLY_RESOLVERS.includes(name),
  }));
}

export default {
  resolveRecipients,
  hasResolver,
  normalizeRecipients,
  assertResolverAllowedForEvents,
  resolveProjectDeveloperRecipients,
};
