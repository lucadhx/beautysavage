/**
 * ══ « LE SERVEUR REDÉMARRE » N'EST PAS « L'OPÉRATION A ÉCHOUÉ » ═════════════
 *
 * ── L'INCIDENT ────────────────────────────────────────────────────────────
 *
 * L'opérateur lance un déploiement ; le backend local redémarre au même
 * instant (une source surveillée a changé) ; l'appel d'ouverture de session VPS
 * meurt en `ECONNRESET`. L'écran affichait aussitôt un bandeau rouge d'échec —
 * alors que le backend revenait deux secondes plus tard, prêt, et que rien
 * n'avait échoué.
 *
 * Le geste demandé à l'opérateur était donc de recommencer une opération qui
 * n'avait pas eu lieu, en cherchant une panne qui n'existait pas.
 *
 * ── LA DISTINCTION, ET ELLE EST TOUT LE SUJET ─────────────────────────────
 *
 * TRANSITOIRE — « je n'ai pas pu demander » : socket coupée, passerelle sans
 * amont, service en cours de démarrage. Rien n'a été refusé, donc rien n'est
 * décidé. On attend, on redemande.
 *
 * DÉFINITIF — le serveur a RÉPONDU, et sa réponse est un refus : mot de passe
 * VPS invalide, authentification SSH rejetée, hôte injoignable depuis le
 * serveur, droits insuffisants. Réessayer ne changerait rien, et masquerait la
 * cause.
 *
 * Les confondre dans un sens fait paniquer pour rien ; dans l'autre, cela ferait
 * boucler sur un mot de passe faux. D'où deux familles nommées, et aucune
 * heuristique implicite.
 */

/**
 * ── CE MODULE NE DÉPEND DE RIEN, ET C'EST VOULU ────────────────────────────
 *
 * Il juge une FORME d'erreur (`status`, `code`, `details.retryable`), pas une
 * classe : il n'importe donc ni le client HTTP ni les types de l'application.
 * Deux bénéfices concrets — il s'éprouve dans un simple runner Node, sans
 * résolveur d'alias ni navigateur, et il ne peut pas devenir le prétexte d'un
 * cycle d'imports entre le client HTTP et la couche qui le protège.
 *
 * `OFFLINE_STATUS` (0) est la convention du client HTTP pour « aucune réponse
 * n'est jamais arrivée ». Elle est redéclarée ici, et une recette vérifie que
 * les deux valeurs ne divergent pas.
 */
const OFFLINE_STATUS = 0;

/** L'erreur telle que le client HTTP la construit — lue par sa forme. */
interface EchecHttp {
  status?: number;
  code?: string;
  details?: unknown;
}

/** Statuts HTTP d'une indisponibilité — le serveur n'a pas tranché. */
const STATUTS_TRANSITOIRES = new Set([
  OFFLINE_STATUS, // 0 — aucune réponse : ECONNRESET, connexion refusée, fetch rompu
  502, // passerelle sans amont
  503, // service en cours de démarrage / dépendance absente
  504, // amont trop lent
]);

/**
 * Codes que le backend rend PENDANT son amorçage. Il les publie explicitement
 * (`requireServiceReady`) avec `retryable: true` — on lit son verdict plutôt
 * que de le deviner.
 */
const CODES_TRANSITOIRES = new Set([
  'BACKEND_INJOIGNABLE',
  'SERVICE_STARTING',
  'PANEL_SERVICE_STARTING',
  'DATABASE_UNAVAILABLE',
]);

/**
 * L'échec dit-il « je n'ai pas pu demander » plutôt que « c'est refusé » ?
 *
 * Un 401/403 n'entre JAMAIS ici : ce sont des réponses, et elles appartiennent
 * à la doctrine d'authentification — voir `AuthContext`.
 */
export function estIndisponibiliteTransitoire(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const echec = err as EchecHttp;
  if (typeof echec.status !== 'number') return false;
  if (echec.status === 401 || echec.status === 403) return false;
  if (STATUTS_TRANSITOIRES.has(echec.status)) return true;
  if (typeof echec.code === 'string' && CODES_TRANSITOIRES.has(echec.code)) return true;
  // Le backend annonce lui-même qu'un nouvel essai a du sens.
  const details = echec.details as { retryable?: boolean } | undefined;
  return details?.retryable === true;
}

/**
 * LES PAUSES, ET POURQUOI ELLES SONT COURTES PUIS PLATES.
 *
 * Un redémarrage de backend local se compte en secondes. On redemande vite au
 * début — le cas fréquent est « il est déjà revenu » — puis on se cale sur le
 * `Retry-After: 2` que le service annonce pendant son amorçage. Total borné :
 * environ dix secondes, après quoi on cesse et on le DIT.
 */
export const RECULS_MS = [500, 1000, 2000, 2000, 2000, 2000] as const;

export interface OptionsReprise {
  /** Appelé au premier échec transitoire, puis à chaque nouvelle tentative. */
  onAttente?: (tentative: number, totalTentatives: number) => void;
  /** Appelé une fois si l'opération finit par aboutir APRÈS une attente. */
  onRetabli?: () => void;
  /** Injectable pour les recettes — jamais fourni en exploitation. */
  patienter?: (ms: number) => Promise<void>;
}

/**
 * Exécute `operation`, en la redemandant tant que l'échec n'est qu'une
 * indisponibilité — jamais au-delà d'une fenêtre bornée.
 *
 * Rend ce que rend l'opération. Relance la DERNIÈRE erreur si la fenêtre est
 * épuisée, ou IMMÉDIATEMENT toute erreur définitive : une erreur métier ne doit
 * pas attendre dix secondes pour s'afficher.
 */
export async function malgreUnRedemarrage<T>(
  operation: () => Promise<T>,
  { onAttente, onRetabli, patienter = defaut }: OptionsReprise = {},
): Promise<T> {
  let attendu = false;
  for (let tentative = 0; ; tentative += 1) {
    try {
      const issue = await operation();
      if (attendu) onRetabli?.();
      return issue;
    } catch (err) {
      const encore = tentative < RECULS_MS.length;
      if (!encore || !estIndisponibiliteTransitoire(err)) throw err;
      attendu = true;
      onAttente?.(tentative + 1, RECULS_MS.length);
      await patienter(RECULS_MS[tentative]);
    }
  }
}

const defaut = (ms: number) => new Promise<void>((r) => { setTimeout(r, ms); });

export default { estIndisponibiliteTransitoire, malgreUnRedemarrage, RECULS_MS };
