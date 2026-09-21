import { api, ApiError } from '@/lib/api';
import { cleProjet } from '@/lib/projectIdentity';

/**
 * LE PARCOURS DE CONNEXION L.Y SOLUTION, CÔTÉ NAVIGATEUR (L12.B-UI).
 *
 * Un module minuscule, et volontairement : tout ce qui décide vit côté
 * serveur. Ce fichier ne fait que deux choses — se souvenir du `state` le temps
 * d'un aller-retour, et traduire un code de refus en une phrase.
 */

/**
 * OÙ L'ON GARDE LE `state` PENDANT LE VOYAGE.
 *
 * `sessionStorage` et non `localStorage` : le parcours appartient à CET onglet
 * et à cette visite. Un `state` qui survivrait à la fermeture du navigateur
 * traînerait sans raison — et il n'a de toute façon aucune valeur passé les dix
 * minutes que le serveur lui accorde.
 *
 * Ce n'est pas la garde de sécurité — celle-ci vit côté serveur, qui seul sait
 * si un `state` a été émis, s'il a expiré, s'il a déjà servi. C'est un
 * garde-fou d'onglet, qui évite d'envoyer au backend un retour visiblement
 * étranger au départ pris ici.
 */
/**
 * ── ET IL APPARTIENT À CE PROJET ──────────────────────────────────────────
 *
 * `sb_federation_state` — un reliquat SB Auto, identique dans tout le parc, sur
 * une origine partagée en développement. Un aller-retour de fédération ouvert
 * depuis le manager d'un projet pouvait alors être « reconnu » par celui d'un
 * autre : le garde-fou d'onglet comparait un `state` étranger et le laissait
 * passer. Le préfixe de projet lui rend le sens qu'il prétend avoir.
 */
export const FEDERATION_STATE_KEY = cleProjet('federation.state');

/** Le chemin de retour, servi par le manager. Public, sans garde d'auth. */
export const FEDERATION_CALLBACK_PATH = '/connexion/ly-solution/retour';

/**
 * LES REFUS, TRADUITS POUR UN HUMAIN.
 *
 * ── CE QU'ON DIT, ET CE QU'ON TAIT ─────────────────────────────────────────
 *
 * On ne répète jamais un motif cryptographique : « signature invalide »,
 * « mauvaise audience » ou « kid inconnu » n'apprennent rien à l'utilisateur et
 * renseignent qui cherche à comprendre ce qui a été détecté. Ces trois-là
 * partagent donc une seule phrase.
 *
 * En revanche, ce qui est ACTIONNABLE est dit franchement : un accès non
 * accordé, un compte désactivé, un Panel injoignable appellent des gestes
 * différents, et confondre les trois ferait perdre du temps à tout le monde.
 */
const MESSAGES: Record<string, string> = {
  /* — Actionnable : quelqu'un doit faire quelque chose — */
  FEDERATION_PANEL_NOT_PAIRED:
    'Ce projet n’est relié à aucun Panel L.Y Solution.',
  FEDERATED_PANEL_UNREACHABLE:
    'Le Panel L.Y Solution n’a pas répondu. Réessayez dans un instant.',
  FEDERATED_PRINCIPAL_INACTIVE:
    'Votre compte n’est pas autorisé à accéder à ce projet.',

  /* — Le parcours a mal tourné : il suffit de recommencer — */
  FEDERATED_STATE_INVALID:
    'Cette connexion a expiré ou a déjà été utilisée. Relancez-la.',
  FEDERATED_ASSERTION_REPLAY:
    'Cette autorisation a déjà servi. Relancez la connexion.',
  FEDERATED_ASSERTION_EXPIRED:
    'L’autorisation a expiré avant d’arriver. Relancez la connexion.',

  /* — Détails cryptographiques : une seule phrase pour tous — */
  FEDERATED_ASSERTION_INVALID_SIGNATURE: 'Cette autorisation n’a pas pu être validée.',
  FEDERATED_ASSERTION_WRONG_AUDIENCE: 'Cette autorisation n’a pas pu être validée.',
  FEDERATED_ASSERTION_WRONG_ISSUER: 'Cette autorisation n’a pas pu être validée.',
  FEDERATED_ASSERTION_UNKNOWN_KEY: 'Cette autorisation n’a pas pu être validée.',
  FEDERATED_ASSERTION_MALFORMED: 'Cette autorisation n’a pas pu être validée.',
  FEDERATED_ASSERTION_CONTRACT_VIOLATION: 'Cette autorisation n’a pas pu être validée.',
  FEDERATED_ASSERTION_ENVIRONMENT_MISMATCH: 'Cette autorisation ne vaut pas pour cet environnement.',

  /* — Refus côté Panel, à l'émission — */
  FEDERATION_USER_DISABLED: 'Votre compte L.Y Solution est désactivé.',
  FEDERATION_ROLE_FORBIDDEN: 'Votre rôle ne donne pas accès aux projets.',
  FEDERATION_PROJECT_ACCESS_DENIED: 'Votre compte n’a pas d’accès déclaré à ce projet.',
  FEDERATION_PROJECT_NOT_PAIRED: 'Ce projet n’est pas ouvert aux accès L.Y Solution.',
};

/** Le message d'un refus, ou une phrase neutre si le code est inconnu. */
export function federatedErrorMessage(error: ApiError): string {
  const code = (error.details as { code?: string } | undefined)?.code ?? error.code;
  if (code && MESSAGES[code]) return MESSAGES[code];
  return error.message || 'La connexion L.Y Solution n’a pas abouti.';
}

/**
 * OUVRIR LE PARCOURS L.Y SOLUTION — le seul chemin, pour tous les écrans.
 *
 * ══ POURQUOI CE DÉPART VIT ICI ET NON DANS UN COMPOSANT ═════════════════════
 *
 * Deux écrans le déclenchent : le bloc « Accès L.Y Solution » du formulaire de
 * connexion, et le widget de recette. Recopier les quatre gestes dans le second
 * aurait créé un second parcours — et le jour où l'un gagne une garde, l'autre
 * ne l'a pas. Or ces gestes sont exactement ceux qui décident de la sûreté du
 * voyage :
 *
 *   1. le SERVEUR compose l'URL et émet le `state` — le navigateur n'invente
 *      ni l'un ni l'autre ;
 *   2. le `state` est gardé AVANT le départ, dans `sessionStorage` : écrire
 *      après la redirection serait écrire dans une page qui n'existe plus ;
 *   3. `returnUrl` est PROPOSÉE, jamais imposée — le Panel la confrontera aux
 *      origines qu'il connaît pour ce projet ;
 *   4. `assign` et non `replace` : on doit pouvoir revenir en arrière.
 *
 * ── CE QUE CETTE FONCTION NE FAIT JAMAIS ────────────────────────────────────
 *
 * Elle ne prend AUCUN identifiant de compte. Pas d'`email`, pas de
 * `panelUserId`. Le Panel émet pour la session qui s'y trouve, et lui seul sait
 * laquelle. Un paramètre « quel compte » ici serait un mensonge d'interface :
 * il ne changerait rien au jeton délivré.
 */
export async function beginFederatedLogin(redirectPath = '/'): Promise<void> {
  const parcours = await api.federationStart({
    redirectPath,
    returnUrl: `${window.location.origin}${FEDERATION_CALLBACK_PATH}`,
  });
  sessionStorage.setItem(FEDERATION_STATE_KEY, parcours.state);
  window.location.assign(parcours.authorizeUrl);
}
