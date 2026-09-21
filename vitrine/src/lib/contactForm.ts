/**
 * Logique du formulaire de contact — module PUR (aucun React, aucun DOM, aucun
 * import d'alias), donc testable directement sous Node.
 *
 * ─── AUTONOME PAR CONSTRUCTION ───────────────────────────────────────────────
 *
 * Ce fichier n'importe RIEN : la vitrine n'a pas de résolveur d'alias `@/` (le
 * Manager, si). Rester sans dépendance permet de le tester avec Node seul, sans
 * ajouter d'infrastructure à la vitrine pour un unique module.
 *
 * ─── LE CLIENT VALIDE POUR AIDER, LE SERVEUR VALIDE POUR DÉCIDER ─────────────
 *
 * Cette validation existe pour donner un retour immédiat, pas pour protéger : le
 * backend revalide tout, et c'est lui l'autorité. Les règles sont volontairement
 * un MIROIR des siennes (mêmes bornes, mêmes motifs) — si elles divergent, c'est
 * le serveur qui gagne, et le visiteur voit une erreur qu'il n'avait pas anticipée.
 */

/**
 * Motifs — miroir de `backend/src/utils/contactConstants.js`.
 *
 * Ils décrivent la NATURE du projet, pas la nature de la demande : « devis »,
 * « information », « problème avec le site » étaient les motifs d'un site de
 * prestataire. Ici, la première question est de savoir si l'entreprise part de
 * rien, reprend quelque chose, ou revient.
 */
export const CONTACT_REASONS = [
  { value: 'NEW_PRESENCE', label: 'Prendre rendez-vous pour une prestation' },
  { value: 'REDESIGN', label: 'Question sur une formation' },
  { value: 'EVOLUTION', label: 'Carte cadeau ou achat' },
  { value: 'OTHER', label: 'Autre demande' },
] as const;

export type ContactReason = (typeof CONTACT_REASONS)[number]['value'];

export const MAX_NAME_LENGTH = 120;
/**
 * L'ENTREPRISE ET SON ACTIVITÉ — bornes en miroir du serveur.
 *
 * Le plan de site fixe le contenu du formulaire : « Entreprise, activité,
 * projet, coordonnées — le strict nécessaire ». Ce sont donc des CHAMPS, et
 * pas des lignes noyées dans le message.
 */
export const MAX_COMPANY_LENGTH = 160;
export const MAX_ACTIVITY_LENGTH = 120;
export const MAX_MESSAGE_LENGTH = 4000;

export interface ContactFormValues {
  name: string;
  companyName: string;
  activity: string;
  email: string;
  phone: string;
  reason: ContactReason | '';
  message: string;
  /**
   * Honeypot. Nom NON SÉMANTIQUE (`hpCheck`) : ni « website », ni « url », ni un
   * nom qu'un navigateur ou un gestionnaire de mots de passe reconnaît et
   * remplit automatiquement. Un autofill ne doit pas viser ce champ — et même
   * s'il le fait, le serveur ne bloque plus sur ce seul signal.
   */
  hpCheck: string;
}

export type ContactField = 'name' | 'companyName' | 'activity' | 'email' | 'phone' | 'reason' | 'message';

export const EMPTY_FORM: ContactFormValues = {
  name: '',
  companyName: '',
  activity: '',
  email: '',
  phone: '',
  reason: '',
  message: '',
  hpCheck: '',
};

/**
 * Validation d'e-mail volontairement PERMISSIVE.
 *
 * Même expression que le serveur. On ne cherche pas à prouver qu'une adresse
 * existe — seul un envoi le prouverait. Une expression trop stricte rejetterait
 * des adresses valides (`prénom+tag@`, TLD longs) : le coût d'un faux positif est
 * un client perdu, celui d'un faux négatif est un e-mail qui rebondit.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Erreurs par champ. Les CODES sont ceux du backend. */
export type ContactErrors = Partial<Record<ContactField, string>>;

/**
 * Valide le formulaire. Le honeypot n'est JAMAIS validé : il ne doit pas produire
 * d'erreur visible, sans quoi un humain piégé verrait un message incompréhensible
 * sur un champ qu'il ne voit pas.
 */
export function validateContactForm(values: ContactFormValues): ContactErrors {
  const errors: ContactErrors = {};

  const name = values.name.trim();
  if (!name) errors.name = 'CONTACT_NAME_REQUIRED';
  else if (name.length > MAX_NAME_LENGTH) errors.name = 'CONTACT_NAME_TOO_LONG';

  const entreprise = values.companyName.trim();
  if (!entreprise) errors.companyName = 'CONTACT_COMPANY_REQUIRED';
  else if (entreprise.length > MAX_COMPANY_LENGTH) errors.companyName = 'CONTACT_COMPANY_TOO_LONG';

  // L'activité est FACULTATIVE : le projet la dira souvent mieux qu'un mot.
  if (values.activity.trim().length > MAX_ACTIVITY_LENGTH) errors.activity = 'CONTACT_ACTIVITY_TOO_LONG';

  const email = values.email.trim();
  if (!email || !EMAIL_RE.test(email)) errors.email = 'CONTACT_EMAIL_INVALID';

  if (!values.reason) errors.reason = 'CONTACT_REASON_INVALID';
  else if (!CONTACT_REASONS.some((r) => r.value === values.reason)) errors.reason = 'CONTACT_REASON_INVALID';

  const message = values.message.trim();
  if (!message) errors.message = 'CONTACT_MESSAGE_REQUIRED';
  else if (message.length > MAX_MESSAGE_LENGTH) errors.message = 'CONTACT_MESSAGE_TOO_LONG';

  return errors;
}

export function isContactFormValid(values: ContactFormValues): boolean {
  return Object.keys(validateContactForm(values)).length === 0;
}

/**
 * Messages affichés. Le CODE vient du serveur ou de la validation locale ; le
 * texte vit ici. Un code inconnu (règle serveur plus récente que la vitrine)
 * tombe sur un message générique plutôt que sur un blanc.
 */
export const ERROR_MESSAGE: Record<string, string> = {
  CONTACT_NAME_REQUIRED: 'Indiquez votre nom.',
  CONTACT_NAME_TOO_LONG: `Nom trop long (${MAX_NAME_LENGTH} caractères maximum).`,
  CONTACT_COMPANY_REQUIRED: 'Indiquez le sujet de votre demande.',
  CONTACT_COMPANY_TOO_LONG: `Sujet trop long (${MAX_COMPANY_LENGTH} caractères maximum).`,
  CONTACT_ACTIVITY_TOO_LONG: `Preference trop longue (${MAX_ACTIVITY_LENGTH} caractères maximum).`,
  CONTACT_EMAIL_INVALID: 'Indiquez une adresse e-mail valide.',
  CONTACT_PHONE_INVALID: 'Numéro de téléphone invalide.',
  CONTACT_REASON_INVALID: 'Choisissez le motif de votre demande.',
  CONTACT_MESSAGE_REQUIRED: 'Ajoutez votre message.',
  CONTACT_MESSAGE_TOO_LONG: `Message trop long (${MAX_MESSAGE_LENGTH} caractères maximum).`,
  CONTACT_PAGE_URL_INVALID: 'Page d’origine invalide.',
  CONTACT_RATE_LIMITED: 'Trop de demandes envoyées. Réessayez dans quelques minutes.',
};

export function errorMessage(code: string | undefined): string {
  if (!code) return '';
  return ERROR_MESSAGE[code] || 'Ce champ est invalide.';
}

/** Caractères restants. Négatif = dépassement (l'appelant colore en rouge). */
export function remainingChars(message: string): number {
  return MAX_MESSAGE_LENGTH - message.trim().length;
}

/** Le compteur mérite-t-il d'être affiché ? Inutile sur un message de trois mots. */
export function shouldShowCounter(message: string): boolean {
  return message.length > MAX_MESSAGE_LENGTH * 0.75;
}

export interface ContactPayload {
  name: string;
  companyName: string;
  activity?: string;
  email: string;
  phone?: string;
  reason: string;
  message: string;
  pageUrl?: string;
  clientSubmissionId: string;
  hpCheck?: string;
  formStartedAt?: string;
}

/**
 * Construit le corps de la requête.
 *
 * Le backend est en `.strict()` : un champ en trop fait échouer la requête
 * entière. On n'envoie donc QUE ce qu'il attend — les champs facultatifs vides
 * sont omis, jamais envoyés à `''`.
 *
 * `clientSubmissionId` est la clé d'idempotence : généré UNE fois par formulaire
 * (pas par tentative), il fait qu'un double clic ou un retry réseau produit une
 * seule demande. Le regénérer à chaque envoi supprimerait toute la protection.
 */
export function buildContactPayload(
  values: ContactFormValues,
  options: { clientSubmissionId: string; formStartedAt?: number | null; pageUrl?: string }
): ContactPayload {
  const payload: ContactPayload = {
    name: values.name.trim(),
    companyName: values.companyName.trim(),
    email: values.email.trim().toLowerCase(),
    reason: values.reason as string,
    message: values.message.trim(),
    clientSubmissionId: options.clientSubmissionId,
  };

  const phone = values.phone.trim();
  if (phone) payload.phone = phone;

  const activity = values.activity.trim();
  if (activity) payload.activity = activity;

  // Envoyé seulement s'il est rempli : `hpCheck: ''` serait du bruit dans chaque
  // requête légitime.
  if (values.hpCheck) payload.hpCheck = values.hpCheck;

  if (options.formStartedAt) payload.formStartedAt = new Date(options.formStartedAt).toISOString();

  // http/https uniquement — le backend refuse le reste, autant ne pas l'envoyer.
  if (options.pageUrl && /^https?:\/\//i.test(options.pageUrl)) {
    payload.pageUrl = options.pageUrl.slice(0, 500);
  }

  return payload;
}

/**
 * Identifiant de soumission.
 *
 * `crypto.randomUUID` n'existe qu'en contexte sécurisé (HTTPS ou localhost). Le
 * repli couvre le HTTP simple — un aléa moindre est sans conséquence ici : cette
 * clé déduplique, elle ne protège rien.
 */
export function newClientSubmissionId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Message de succès.
 *
 * Ne mentionne AUCUNE infrastructure. Écrire « un e-mail a été envoyé aux
 * administrateurs » serait deux fois faux : le visiteur n'a pas à connaître notre
 * fonctionnement, et l'e-mail peut parfaitement avoir échoué — sa demande, elle,
 * est bien enregistrée. C'est cela qu'on lui dit, et c'est vrai.
 */
export const SUCCESS_MESSAGE =
  'Votre demande est bien envoyee. L institut revient vers vous rapidement.';

/** Erreur réseau : neutre, et surtout pas alarmante. */
export const NETWORK_ERROR_MESSAGE =
  "L'envoi a échoué. Vérifiez votre connexion et réessayez : votre message est conservé.";
