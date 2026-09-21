/**
 * CE QUI A ÉCHOUÉ, ET SUR QUELLE MACHINE — dit à l'opérateur.
 *
 * ══ LE DÉFAUT QUE CE MODULE FERME ═══════════════════════════════════════════
 *
 * Trois pannes de natures opposées produisaient la même phrase :
 *
 *   · le backend du Manager ne répond pas ;
 *   · le backend répond, mais le VPS refuse les identifiants ;
 *   · le backend répond, le VPS aussi, mais la poignée de main SSH est trop
 *     lente.
 *
 * Toutes s'affichaient « Serveur injoignable. Vérifiez qu'il est démarré. » Un
 * opérateur relançait donc son backend — qui allait très bien — puis
 * réessayait ; parfois ça passait, parfois non. La panne semblait aléatoire
 * alors qu'elle ne l'était pas : c'est le MESSAGE qui était constant, pas la
 * cause.
 *
 * ══ LA RÈGLE ════════════════════════════════════════════════════════════════
 *
 * Deux machines, deux diagnostics. Si le backend a répondu, on ne dit JAMAIS
 * qu'il est hors ligne. Et l'on annonce si réessayer a un sens : réessayer un
 * mot de passe refusé n'en a aucun.
 */

/** Les issues distinctes, telles que le backend les nomme. */
export type ServerFailureCode =
  | 'BACKEND_INJOIGNABLE'
  | 'BACKEND_ERROR'
  | 'SERVICE_STARTING'
  | 'SERVICE_STOPPING'
  | 'DATABASE_UNAVAILABLE'
  | 'SSH_AUTH_FAILED'
  | 'SSH_TIMEOUT'
  | 'SSH_CONNECTION_REFUSED'
  | 'SSH_HOST_UNREACHABLE'
  | 'SSH_ERROR'
  | 'SESSION_EXPIRED'
  | 'SESSION_REQUIRED'
  | 'INSPECTION_FAILED';

export interface ServerFailure {
  code: ServerFailureCode | 'UNKNOWN';
  /** Ce qui n'a pas marché, en une phrase. */
  title: string;
  /** QUELLE machine est en cause — la confusion coûtait des redémarrages. */
  scope: 'manager' | 'vps' | 'session' | 'unknown';
  /** Réessayer à l'identique peut-il aboutir ? */
  retryable: boolean;
}

const TABLE: Record<ServerFailureCode, Omit<ServerFailure, 'code'>> = {
  BACKEND_INJOIGNABLE: {
    title: 'Le backend du Manager n’a pas répondu. Vérifiez qu’il est démarré, puis réessayez.',
    scope: 'manager',
    retryable: true,
  },
  BACKEND_ERROR: {
    title: 'Le backend a répondu par une erreur interne. Il est en ligne : le détail est dans ses journaux.',
    scope: 'manager',
    retryable: false,
  },
  /**
   * ── TROIS INDISPONIBILITÉS TEMPORAIRES, ET AUCUNE N'EST UNE PANNE ─────────
   *
   * Elles arrivaient jusqu'ici sous le seul visage de `BACKEND_INJOIGNABLE`,
   * dont le message dit « vérifiez qu'il est démarré ». C'était le mauvais
   * conseil au pire moment : l'opérateur redémarrait un backend qui était en
   * train de démarrer, ce qui relançait l'amorçage depuis le début et
   * prolongeait exactement la panne qu'il cherchait à corriger.
   *
   * Toutes trois sont `retryable` et n'appellent AUCUNE action : attendre
   * quelques secondes suffit. Aucune ne remet la session en cause.
   */
  SERVICE_STARTING: {
    title: 'Le service démarre et n’est pas encore prêt. Aucune action n’est requise : '
      + 'il sera disponible dans quelques secondes.',
    scope: 'manager',
    retryable: true,
  },
  SERVICE_STOPPING: {
    title: 'Le service s’arrête. Réessayez dans quelques instants, une fois le redémarrage terminé.',
    scope: 'manager',
    retryable: true,
  },
  DATABASE_UNAVAILABLE: {
    title: 'La base de données est momentanément injoignable. Le backend, lui, répond : '
      + 'le redémarrer ne changerait rien.',
    scope: 'manager',
    retryable: true,
  },
  SSH_AUTH_FAILED: {
    title: 'Le serveur a refusé ces identifiants. Réessayer à l’identique donnera le même refus.',
    scope: 'vps',
    retryable: false,
  },
  SSH_TIMEOUT: {
    title: 'Le serveur n’a pas terminé la négociation SSH à temps. Vos identifiants ne sont pas en cause.',
    scope: 'vps',
    retryable: true,
  },
  SSH_CONNECTION_REFUSED: {
    title: 'La machine répond, mais rien n’écoute sur le port SSH.',
    scope: 'vps',
    retryable: false,
  },
  SSH_HOST_UNREACHABLE: {
    title: 'Cette adresse ne mène à aucune machine joignable.',
    scope: 'vps',
    retryable: false,
  },
  SSH_ERROR: {
    title: 'La connexion SSH a échoué.',
    scope: 'vps',
    retryable: true,
  },
  SESSION_EXPIRED: {
    title: 'La session serveur a expiré. Reconnectez-vous au serveur.',
    scope: 'session',
    retryable: false,
  },
  SESSION_REQUIRED: {
    title: 'Une session serveur est nécessaire pour lire l’état réel.',
    scope: 'session',
    retryable: false,
  },
  INSPECTION_FAILED: {
    title: 'L’inventaire du serveur n’a pas pu être lu. Le backend, lui, a répondu.',
    scope: 'vps',
    retryable: true,
  },
};

/**
 * Le verdict correspondant à un code d'erreur du backend.
 *
 * Le `message` du serveur reste PRIORITAIRE quand il existe : il en sait
 * toujours plus que cette table — il connaît l'hôte, le port, le motif exact.
 * Cette table donne la portée et la reprise, qu'aucune phrase ne porte.
 */
export function describeServerFailure(
  code: string | undefined,
  message?: string,
): ServerFailure {
  const connu = code && code in TABLE ? (code as ServerFailureCode) : null;
  if (!connu) {
    return {
      code: 'UNKNOWN',
      title: message || 'L’opération a échoué.',
      scope: 'unknown',
      retryable: true,
    };
  }
  return { code: connu, ...TABLE[connu], title: message || TABLE[connu].title };
}

/** Vrai si l'erreur accuse le BACKEND — et lui seul. */
export function blamesManagerBackend(code: string | undefined): boolean {
  return describeServerFailure(code).scope === 'manager';
}
