import { ApiError, isOffline, isRateLimited, messageTropDeTentatives } from '@/lib/api';

/**
 * CE QU'ON MONTRE À L'UTILISATEUR QUAND QUELQUE CHOSE ÉCHOUE.
 *
 * ══ CE QUI EXISTAIT ═════════════════════════════════════════════════════════
 *
 * `toast.error(err.message)`, à deux endroits qui couvrent presque tout le
 * Manager : le chargement d'une ressource (`useResource`) et l'exécution d'une
 * action (`useAction`). Le message affiché était donc, mot pour mot, celui du
 * serveur.
 *
 * Ce n'est pas une mauvaise idée en soi — les `ApiError` de ce backend sont
 * RÉDIGÉES pour être lues, et les traduire une seconde fois côté client aurait
 * créé deux vérités. Le défaut est ailleurs : rien ne garantissait que la
 * phrase reçue soit destinée à un humain. Trois sources la fabriquaient sans
 * que personne l'ait écrite :
 *
 *   · zod et mongoose, en anglais (corrigé à la source — `utils/validationFr`) ;
 *   · une passerelle en panne, qui répond du HTML ;
 *   · une exception non prévue, dont le message est un détail d'implémentation.
 *
 * ══ LA RÈGLE ════════════════════════════════════════════════════════════════
 *
 * Le message du serveur reste PRIORITAIRE — il en sait toujours plus que nous.
 * Mais il doit d'abord ressembler à une phrase adressée à quelqu'un. Sinon on
 * répond par le statut HTTP, qui dit au moins la NATURE de l'échec, et le
 * détail technique part dans la console.
 *
 * ══ CE QUE CE MODULE NE FAIT PAS ════════════════════════════════════════════
 *
 * Il ne masque aucune erreur MÉTIER. « Impossible de supprimer : ce modèle est
 * utilisé » est une phrase française destinée à un humain : elle passe telle
 * quelle. On ne remplace que ce qui n'était adressé à personne.
 */

/**
 * Les marqueurs d'une phrase qui n'a pas été écrite pour un utilisateur.
 *
 * Deux familles : les messages par défaut des bibliothèques de validation
 * (anglais, reconnaissables à leur vocabulaire) et les traces techniques
 * (balises HTML, JSON, chemins, noms d'erreurs JavaScript).
 */
const TECHNIQUE = [
  /\b(?:String|Array|Number|Boolean)\s+must\b/i,
  /\bmust (?:contain|be|match|include)\b/i,
  /\bat (?:most|least)\b/i,
  /\bis (?:required|invalid|not a valid|longer than)\b/i,
  /\b(?:Invalid|Unexpected|Unauthorized|Forbidden|Internal Server Error|Bad Gateway)\b/,
  /\b(?:TypeError|ReferenceError|SyntaxError|AbortError|NetworkError|Error):/,
  /\b(?:undefined|null|NaN)\b/,
  /^\s*[[{<]/,
  /<\/?[a-z][\s\S]*>/i,
  /\b[a-z]+:\/\/|\b[A-Za-z]:\\|\/(?:usr|var|home|src|node_modules)\//,
];

/** Vrai si la phrase ressemble à un détail d'implémentation plutôt qu'à un message. */
export function estMessageTechnique(message: unknown): boolean {
  if (typeof message !== 'string') return true;
  const texte = message.trim();
  if (!texte) return true;
  /*
    Une phrase française porte presque toujours l'un de ces signes. Ce n'est pas
    un détecteur de langue — c'en serait un mauvais — mais un garde-fou : en
    l'absence de tout indice de rédaction française, on préfère le message
    générique au message brut.
  */
  const francais = /[éèêàçûôîùâëïœ’]|\b(?:le|la|les|un|une|des|est|pas|vous|votre|pour|avec|sur|dans|qui|que|ne|au|aux|du|de|et|ou|aucun|cette|ce|impossible|réessayez)\b/i;
  if (!francais.test(texte)) return true;
  return TECHNIQUE.some((re) => re.test(texte));
}

/** Ce que dit un statut HTTP quand la réponse n'a rien dit d'utile. */
const PAR_STATUT: Record<number, string> = {
  400: 'La demande a été refusée : certaines valeurs ne sont pas acceptées.',
  401: 'Votre session n’est plus valide. Reconnectez-vous.',
  403: 'Vous n’avez pas les droits nécessaires pour cette action.',
  404: 'Cet élément est introuvable. Il a peut-être été supprimé entre-temps.',
  409: 'Les données ont changé entre-temps. Rechargez la page, puis réessayez.',
  413: 'Le contenu envoyé est trop volumineux.',
  422: 'La demande a été refusée : certaines valeurs ne sont pas acceptées.',
  429: 'Trop de demandes en peu de temps. Patientez quelques instants.',
  500: 'Le serveur a rencontré une erreur. Réessayez dans un instant.',
  502: 'Le serveur n’a pas répondu. Réessayez dans un instant.',
  503: 'Le service est momentanément indisponible. Réessayez dans un instant.',
  504: 'Le serveur a mis trop de temps à répondre. Réessayez dans un instant.',
};

/**
 * La phrase à montrer pour une erreur quelconque.
 *
 * @param err   Ce qui a été attrapé — `ApiError`, `Error`, ou n'importe quoi.
 * @param repli Ce qu'on dit quand rien d'autre ne s'applique. Chaque appelant
 *              connaît son geste ; « l'enregistrement a échoué » vaut mieux
 *              que « une erreur est survenue ».
 */
export function messageUtilisateur(err: unknown, repli = 'Une erreur est survenue.'): string {
  // Le serveur n'a jamais répondu : ce n'est pas un refus, et le dire évite de
  // faire chercher une faute dans la saisie.
  if (isOffline(err)) return (err as ApiError).message;
  // Un 429 porte sa propre phrase, avec le délai annoncé par le serveur.
  if (isRateLimited(err)) return messageTropDeTentatives(err);

  if (err instanceof ApiError) {
    if (!estMessageTechnique(err.message)) return err.message;
    /*
      Le message ne s'adressait à personne : on garde le diagnostic pour le
      journal et on répond par la NATURE de l'échec.
    */
    console.error('[api] message non destiné à l’utilisateur', {
      status: err.status, code: err.code, message: err.message,
    });
    return PAR_STATUT[err.status] ?? repli;
  }

  if (err instanceof Error) {
    console.error('[ui] erreur inattendue', err);
    return repli;
  }

  console.error('[ui] échec sans erreur exploitable', err);
  return repli;
}

export default messageUtilisateur;
