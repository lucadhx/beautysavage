import type {
  DeliveryServiceStatus,
  EmailConfiguration,
  EmailModeConfiguration,
  EmailOperational,
  EmailOperationalState,
  EmailTestStatus,
  WebhookConfigurationStatus,
} from '@/types';
import { EMAIL_STATE, configState, type EmailState, type EmailTone, type EmailIcon } from '@/lib/emailStates';

/*
 * ── LES AIDES DE FORMULAIRE D'EXPÉDITEUR ONT ÉTÉ RETIRÉES (R10.5B) ──────────
 *
 * `SenderForm`, ses validations, son payload, ainsi que tout l'outillage de
 * l'envoi de test local (destinataire par défaut, motif de blocage, garde de
 * clic) n'ont plus aucun consommateur : le From du parc est administré dans le
 * Panel, et le test d'expédition y vit aussi.
 *
 * Les garder « au cas où » aurait laissé un formulaire prêt à être rebranché —
 * c'est-à-dire la surface que ce lot supprime, à un import près.
 */
/**
 * Logique de la carte « Configuration des emails » (module PUR, sans React).
 *
 * Tout ce qui décide vit ici ; le composant ne fait qu'afficher. C'est ce qui
 * rend ces règles testables — le Manager n'exécute pas de rendu de composants
 * sous test (cf. `src/lib/*.test.mjs`).
 *
 * RÈGLE CARDINALE : ce module ne DÉDUIT aucun statut. Le backend calcule
 * `status` à partir de la configuration locale, de la présence de la clé et du
 * dernier envoi réel ; on ne fait que choisir un libellé et une couleur. Aucune
 * fonction ici ne peut produire « Fonctionnel » à partir d'autre chose que le
 * backend le disant.
 */

/* --- Statut global --------------------------------------------------------- */

/*
 * ─── SUPPRIMÉ : `emailStatusMeta` ────────────────────────────────────────────
 *
 * Cette fonction traduisait le statut de configuration en libellé et couleur.
 * Depuis que le vocabulaire est centralisé, elle n'était plus qu'un alias de
 * `configState` — un intermédiaire sans valeur, mais qui rouvrait la porte à un
 * libellé divergent le jour où quelqu'un l'aurait « enrichi ». Les appelants
 * utilisent `configState` (ou `cardState`, qui décide de l'état à montrer).
 */

/**
 * État du mode ACTIF. Point de passage unique : c'est lui qui garantit qu'un
 * statut n'est jamais hérité d'un autre mode après une bascule TEST/PROD — un
 * test réussi en TEST ne doit jamais afficher « Livré » en PROD.
 */
/**
 * Le bloc de configuration du monde ACTIF.
 *
 * Le second paramètre a disparu : il obligeait l'appelant à extraire lui-même
 * le monde de la configuration, et c'est précisément là que la régression
 * s'était logée (il lisait `cfg.activeMode`, un champ que le serveur n'envoie
 * plus). Une fonction qui reçoit l'objet entier n'a pas besoin qu'on lui
 * répète l'un de ses champs.
 */
export function selectActiveMode(
  cfg: EmailConfiguration | null
): EmailModeConfiguration | null {
  const environment = cfg?.environment ?? null;
  if (!cfg || !environment) return null;
  return cfg.modes[environment] ?? null;
}

export interface OperationalView {
  ready: boolean;
  /** Étiquette courte de l'état, pour le bandeau. */
  label: string;
  /** Pourquoi l'envoi est indisponible, en une phrase compréhensible. */
  explanation: string;
  /** Les causes, telles que le backend les a rédigées. Affichées en liste. */
  causes: string[];
  /** Le geste attendu. `null` quand il n'y a rien à faire. */
  action: string | null;
  tone: EmailTone;
}

/**
 * Chaque libellé nomme SON OBJET. « Configuration requise » ou « Réparation
 * nécessaire » laissaient l'utilisateur deviner de quoi on parlait — au milieu
 * d'un écran de configuration email, il pouvait légitimement croire qu'il
 * s'agissait de l'expéditeur qu'il venait de saisir.
 */
const OPERATIONAL_LABELS: Record<EmailOperationalState, { label: string; tone: EmailTone }> = {
  READY: { label: 'Suivi opérationnel', tone: 'ok' },
  CONFIGURATION_REQUIRED: { label: 'Suivi à configurer', tone: 'warn' },
  REPAIR_REQUIRED: { label: 'Suivi à réparer', tone: 'error' },
  WEBHOOK_UNAVAILABLE: { label: EMAIL_STATE.TRACKING_UNAVAILABLE.label, tone: 'warn' },
};

/**
 * Traduit l'autorisation d'envoi en un état affichable.
 *
 * ─── POURQUOI L'ENVOI EST BLOQUÉ, ET POURQUOI C'EST UN PROGRÈS ──────────────
 *
 * Brevo ne confirme la remise d'un message que par webhook. Sans lui, un envoi
 * reste indéfiniment « accepté » : personne ne peut savoir s'il est arrivé, et
 * un expéditeur refusé passe pour un succès. La règle « pas de suivi, pas
 * d'envoi » échange donc un blocage visible et réparable contre un mensonge
 * silencieux. Le texte affiché doit porter ce sens — sans jargon.
 */
export function operationalView(mode: EmailModeConfiguration | null): OperationalView {
  const op = mode?.operational;
  if (!op || op.ready) {
    return { ready: true, ...OPERATIONAL_LABELS.READY, causes: [], explanation: '', action: null };
  }
  const meta = OPERATIONAL_LABELS[op.state] ?? OPERATIONAL_LABELS.REPAIR_REQUIRED;
  // Les causes viennent du backend, déjà rédigées et sûres. On les reprend telles
  // quelles plutôt que d'en réinventer une traduction qui divergerait à la
  // première évolution des blocages — mais on ne les COLLE plus bout à bout dans
  // une phrase : deux causes produisaient un paragraphe illisible. Elles
  // s'affichent en liste.
  return {
    ready: false,
    label: meta.label,
    tone: meta.tone,
    causes: op.blockers.map((b) => b.message),
    explanation:
      "Aucun email ne peut partir tant que le suivi de livraison n'est pas rétabli. " +
      "Sans lui, impossible de savoir si un email arrive à destination — un envoi refusé passerait pour un succès. " +
      'Aucun email n’est perdu : les envois reprendront automatiquement.',
    action: op.state === 'CONFIGURATION_REQUIRED' ? 'Configurer le suivi' : 'Réparer le suivi',
  };
}

/* --- L'ÉTAT AFFICHÉ : une seule vérité pour toute la carte ------------------ */

export interface CardState {
  state: EmailState;
  /** Le suivi bloque-t-il les envois ? Le bandeau devient alors prioritaire. */
  blocked: boolean;
  /** Causes à énumérer (blocage) — vide sinon. */
  causes: string[];
  /** Geste attendu, si l'utilisateur peut agir. */
  action: string | null;
  /** Explication affichée sous le titre. */
  help: string;
}

/**
 * L'ÉTAT UNIQUE de la carte, dont dérivent le badge ET le bandeau.
 *
 * ─── POURQUOI CETTE FONCTION EXISTE ──────────────────────────────────────────
 *
 * La carte affichait jusqu'ici trois états simultanés calculés séparément : un
 * badge, un bandeau « Statut : … », et un bandeau de blocage. Ils pouvaient se
 * contredire — badge « Livré » au-dessus d'un bandeau « envois suspendus » —
 * et l'utilisateur devait arbitrer lui-même lequel croire. Un écran qui affiche
 * trois états affiche en réalité zéro état.
 *
 * L'ordre de priorité répond à « qu'est-ce qui empêche l'utilisateur d'avancer,
 * maintenant ? » :
 *  1. les envois sont bloqués — rien d'autre ne compte ;
 *  2. un test attend une confirmation qui ne vient plus ;
 *  3. sinon, l'état de la configuration.
 */
export function cardState(
  mode: EmailModeConfiguration | null,
  stalled: TrackingStalled | null
): CardState {
  const op = operationalView(mode);
  if (!op.ready) {
    return {
      state: { label: op.label, help: op.explanation, tone: op.tone, icon: 'warning' },
      blocked: true,
      causes: op.causes,
      action: op.action,
      help: op.explanation,
    };
  }
  if (stalled) {
    return {
      state: { ...EMAIL_STATE.TRACKING_UNAVAILABLE, label: stalled.title, help: stalled.message },
      blocked: false,
      causes: [],
      action: null,
      help: stalled.message,
    };
  }
  const state = configState(mode?.status);
  return { state, blocked: false, causes: [], action: null, help: state.help };
}

/* --- L'ÉCRAN UTILISATEUR : trois états, pas un de plus ---------------------- */

export type ServiceState = 'WORKING' | 'ACTION_NEEDED' | 'CHECKING';

export interface ServiceView {
  state: ServiceState;
  title: string;
  subtitle: string;
  tone: EmailTone;
  icon: EmailIcon;
  /** Le test est-il proposable ? */
  canTest: boolean;
}

/**
 * L'ÉTAT DU SERVICE, tel qu'un utilisateur non technique doit le lire en moins
 * de trois secondes.
 *
 * ─── POURQUOI IL N'Y A QUE TROIS ÉTATS ───────────────────────────────────────
 *
 * L'écran exposait quatre vérités simultanées et indépendantes : le webhook
 * est-il enregistré, a-t-il déjà servi, est-il joignable maintenant, et les
 * envois sont-ils possibles. On pouvait donc lire « Actif » en vert au-dessus
 * d'un bandeau orange « Suivi indisponible », les deux étant exacts dans leur
 * registre. Pour qui doit décider s'il peut envoyer un e-mail, seule la
 * quatrième compte — les trois autres sont des détails de mise en œuvre.
 *
 * Un seul statut positif est autorisé, et il exige que le système soit
 * RÉELLEMENT autorisé à envoyer : provider, expéditeur, webhook enregistré,
 * URL alignée, joignabilité prouvée et non périmée. Un webhook enregistré dont
 * le tunnel est tombé n'est pas « actif » : il est hors service.
 */
export function serviceView(
  mode: EmailModeConfiguration | null,
  checking: boolean
): ServiceView {
  if (checking) {
    return {
      state: 'CHECKING',
      title: 'Vérification en cours…',
      subtitle: 'Nous vérifions que le service d’e-mail fonctionne correctement.',
      tone: 'pending',
      icon: 'waiting',
      canTest: false,
    };
  }
  const op = mode?.operational ?? null;
  if (op && emailCanSend(op)) {
    const degraded = deliveryStatusOf(op) === 'degraded';
    return {
      state: 'WORKING',
      title: 'Tout fonctionne',
      subtitle: degraded
        ? 'Les e-mails peuvent être envoyés. Le suivi de livraison est à configurer (panneau ci-dessous).'
        : 'Les e-mails peuvent être envoyés et leur livraison est suivie.',
      tone: 'ok',
      icon: 'success',
      canTest: true,
    };
  }
  return {
    state: 'ACTION_NEEDED',
    title: 'Action nécessaire',
    subtitle: 'Les e-mails sont désactivés.',
    tone: 'warn',
    icon: 'warning',
    canTest: false,
  };
}

/* --- LOT « états séparés » : canal d'envoi / installation du suivi / activité --- */

/**
 * Compatibilité : un backend antérieur ne renvoie pas les champs séparés. On
 * retombe alors sur l'ancienne lecture (`ready`) plutôt que d'afficher un état
 * inventé.
 */
export function deliveryStatusOf(op: EmailOperational): DeliveryServiceStatus {
  if (op.deliveryServiceStatus) return op.deliveryServiceStatus;
  return op.ready ? 'operational' : 'disabled';
}

export function emailCanSend(op: EmailOperational): boolean {
  if (typeof op.canSend === 'boolean') return op.canSend;
  return op.ready;
}

export interface TrackingView {
  /** null = donnée absente (vieux backend) : ne rien afficher plutôt qu'inventer. */
  status: WebhookConfigurationStatus | null;
  tone: EmailTone;
  title: string;
  subtitle: string;
  /** Ligne d'activité — informative, jamais un warning. */
  activity: string;
  /** Proposer l'action « Configurer/Réparer le suivi » ? */
  needsAction: boolean;
  /** URL publique du backend + webhook CALCULÉ — lecture seule, jamais saisis. */
  publicBackendUrl: string;
  /** Provenance lisible de l'URL publique ('' si inconnue). */
  publicUrlSourceLabel: string;
  expectedWebhookUrl: string;
}

/** Provenance de l'URL publique, en clair pour l'écran. */
const PUBLIC_URL_SOURCE_LABELS: Record<string, string> = {
  NGROK: 'détectée automatiquement (tunnel ngrok)',
  SYSTEM_CONFIGURATION: 'Configuration Système (écrite par le déploiement)',
  ENVIRONMENT: "variable d'environnement",
  LOCALHOST: 'localhost — les webhooks ne peuvent pas être livrés ici',
  NONE: '',
};

/**
 * PANNEAU DU SUIVI DE LIVRAISON — distinct du canal d'envoi.
 *
 * Règles (LOT 4) :
 *  - installé + aucun événement reçu → VERT, « Aucun événement reçu pour le
 *    moment » (l'absence d'activité n'est pas une panne) ;
 *  - absent/désynchronisé → panneau « Configurer le suivi », sans toucher au
 *    panneau du canal d'envoi ;
 *  - injoignable → panneau dédié également.
 */
export function trackingView(mode: EmailModeConfiguration | null): TrackingView | null {
  const op = mode?.operational;
  if (!op?.webhookConfigurationStatus) return null;
  const act = op.trackingActivity;
  const activity = act?.lastEventAt
    ? `Dernier événement : ${act.lastEventType || 'reçu'} · ${new Date(act.lastEventAt).toLocaleString()}`
    : 'Aucun événement reçu pour le moment.';
  const urls = {
    publicBackendUrl: op.webhook?.publicBackendUrl || '',
    publicUrlSourceLabel: PUBLIC_URL_SOURCE_LABELS[op.webhook?.publicUrlSource || 'NONE'] || '',
    expectedWebhookUrl: op.webhook?.expectedUrl || '',
  };
  switch (op.webhookConfigurationStatus) {
    case 'installed':
      return {
        ...urls,
        status: 'installed', tone: 'ok', needsAction: false,
        title: 'Suivi de livraison installé',
        subtitle: 'Le webhook est enregistré et conforme. Les résultats d’envoi seront constatés automatiquement.',
        activity,
      };
    case 'missing':
      return {
        ...urls,
        status: 'missing', tone: 'warn', needsAction: true,
        title: 'Configurer le suivi',
        subtitle: 'Le suivi de livraison n’est pas encore activé : les e-mails partent, mais leur remise ne sera pas constatée.',
        activity,
      };
    case 'mismatched':
      return {
        ...urls,
        status: 'mismatched', tone: 'warn', needsAction: true,
        title: 'Réparer le suivi',
        subtitle: 'Le webhook existe mais diverge de la configuration attendue (adresse, événements ou secret).',
        activity,
      };
    case 'unreachable':
    default:
      return {
        ...urls,
        status: 'unreachable', tone: 'warn', needsAction: true,
        title: 'Suivi injoignable',
        subtitle: 'Le webhook est installé mais l’adresse publique ne répond pas.',
        activity,
      };
  }
}

/* --- Résultat de « Rétablir le service » ----------------------------------- */

export interface RestoreOutcome {
  ok: boolean;
  message: string;
}

/**
 * Que dire après une tentative de rétablissement ?
 *
 * ─── LA RÈGLE QUI MANQUAIT ───────────────────────────────────────────────────
 *
 * Le message de succès s'affichait dès que la resynchronisation n'avait pas
 * échoué. Or resynchroniser parle à l'API du fournisseur, qui reste joignable
 * quand c'est NOTRE adresse publique qui est tombée : l'action « réussissait »
 * donc toujours, et annonçait un problème corrigé qui ne l'était pas.
 *
 * Désormais un seul fait autorise le succès : `ready` après sonde réelle. Ne
 * jamais dire « corrigé » tant que le système n'envoie pas.
 *
 * @param isTestMode  En TEST, l'adresse publique passe par un tunnel local qu'on
 *   peut nommer : c'est la cause la plus fréquente, et la seule que le
 *   développeur puisse lever en une seconde. En PROD, la nommer n'aiderait pas.
 */
export function restoreOutcome(ready: boolean, code: string, isTestMode: boolean): RestoreOutcome {
  if (ready) return { ok: true, message: 'Le service d’e-mail fonctionne à nouveau.' };

  const unreachable = code === 'WEBHOOK_URL_UNREACHABLE' || code === 'WEBHOOK_HEALTH_EXPIRED';
  if (unreachable && isTestMode) {
    return {
      ok: false,
      message:
        'Le service n’est pas encore disponible. Le tunnel de test semble arrêté — démarrez-le, puis réessayez.',
    };
  }
  return {
    ok: false,
    message: 'Le service n’est pas encore disponible. Vérifiez que l’accès public est démarré.',
  };
}

/* --- Messages d'échec : une CAUSE et un GESTE ------------------------------ */

export interface TestErrorMeta {
  /** Phrase affichée. Dit quoi faire, pas ce qui s'est techniquement passé. */
  message: string;
  /** Le lien vers Brevo aide-t-il à résoudre CE problème ? DEV uniquement. */
  offersBrevoLink: boolean;
}

/**
 * Code métier -> phrase actionnable.
 *
 * La copie produit vit ICI, pas dans le backend : elle se retouche bien plus
 * souvent que le code métier, et la retoucher côté serveur ne réécrirait pas les
 * traces déjà persistées. Le backend reste l'autorité sur le CODE ; c'est lui
 * qu'on mappe, jamais un texte.
 *
 * Le commerçant ne doit JAMAIS lire « SENDER_REFUSED », « invalid_parameter »,
 * « HTTP 403 », un message brut Brevo ou un payload fournisseur. Un code affiché
 * tel quel n'est pas une information : c'est un aveu que le produit n'a pas su
 * traduire ce qu'il a compris.
 */
export const TEST_ERROR_META: Record<string, TestErrorMeta> = {
  SENDER_REFUSED: {
    // Le seul échec que le commerçant peut réellement corriger lui-même : la
    // phrase décrit donc les gestes, dans l'ordre, jusqu'au retour ici.
    message:
      "L'adresse email utilisée comme expéditeur n'a pas encore été autorisée dans votre compte Brevo. " +
      'Connectez-vous à votre tableau de bord Brevo, ajoutez cette adresse dans les Expéditeurs, ' +
      'validez-la, puis relancez un email de test.',
    offersBrevoLink: true,
  },
  // Clé d'accès absente ou refusée : rien que le commerçant puisse corriger
  // lui-même. Nommer « la clé API » ne l'aiderait pas — lui dire QUI peut agir, si.
  API_KEY_INVALID: {
    message: "L'accès au service d'envoi a été refusé. Contactez votre prestataire technique.",
    offersBrevoLink: false,
  },
  API_KEY_MISSING: {
    message: "L'accès au service d'envoi n'est pas configuré. Contactez votre prestataire technique.",
    offersBrevoLink: false,
  },
  RECIPIENT_INVALID: {
    message: "L'adresse du destinataire est invalide. Vérifiez-la puis relancez le test.",
    offersBrevoLink: false,
  },
  MAILBOX_UNAVAILABLE: {
    message: "La boîte du destinataire est momentanément pleine ou indisponible. Réessayez plus tard.",
    offersBrevoLink: false,
  },
  SPAM_REJECTED: {
    message:
      "Le message a été classé indésirable par la messagerie du destinataire. " +
      'Essayez une autre adresse pour vérifier votre configuration.',
    offersBrevoLink: false,
  },
  PROVIDER_ERROR: {
    message:
      "Le service d'envoi a signalé une erreur après avoir pris le message en charge. " +
      'Relancez un test ; si le problème persiste, contactez votre prestataire technique.',
    offersBrevoLink: false,
  },
  // Rejet ASYNCHRONE du destinataire (adresse inexistante, boîte fermée),
  // constaté après coup. Distinct de RECIPIENT_INVALID (forme fautive, refusée
  // avant tout envoi).
  RECIPIENT_REJECTED: {
    message:
      "L'adresse du destinataire n'existe pas ou n'accepte plus de messages. Vérifiez-la puis relancez le test.",
    offersBrevoLink: false,
  },
  NETWORK_ERROR: {
    message: "Le service d'envoi n'a pas pu être contacté. Réessayez dans quelques instants.",
    offersBrevoLink: false,
  },
  SERVICE_UNAVAILABLE: {
    message: "Le service d'envoi est momentanément indisponible. Réessayez plus tard.",
    offersBrevoLink: false,
  },
  SENDER_NOT_CONFIGURED: {
    message: "Renseignez le nom d'expéditeur et l'adresse email, puis enregistrez.",
    offersBrevoLink: false,
  },
  // Refus de NOTRE garde-fou : rien n'a été tenté, rien n'est perdu.
  BREVO_NOT_OPERATIONAL: {
    message:
      "L'envoi est suspendu tant que le suivi de livraison n'est pas rétabli. " +
      'Aucun email ne sera perdu : les envois reprendront automatiquement.',
    offersBrevoLink: false,
  },
};

/** Repli d'un code inconnu. Neutre et sûr — jamais le code lui-même. */
const UNKNOWN_TEST_ERROR: TestErrorMeta = {
  message: "L'envoi n'a pas abouti. Réessayez dans quelques instants.",
  offersBrevoLink: false,
};

/**
 * Traduit l'erreur persistée en message affichable.
 *
 * Un code inconnu (backend plus récent que ce Manager) retombe sur une phrase
 * neutre plutôt que d'afficher le code brut : mieux vaut être vague que
 * d'exposer du vocabulaire interne.
 */
export function testErrorMeta(error: { code: string; message?: string } | null | undefined): TestErrorMeta {
  if (!error?.code) return UNKNOWN_TEST_ERROR;
  return TEST_ERROR_META[error.code] ?? UNKNOWN_TEST_ERROR;
}

/**
 * Faut-il proposer « Ouvrir Brevo » ?
 *
 * Deux conditions cumulatives : l'utilisateur est DEV, et le dernier échec se
 * résout effectivement dans Brevo. Proposer ce lien à un commerçant l'enverrait
 * dans une interface qu'il ne connaît pas, sur un compte qui n'est pas le sien.
 */
export function shouldOfferBrevoLink(
  mode: EmailModeConfiguration | null,
  isDev: boolean
): boolean {
  // Vaut pour un refus IMMÉDIAT (FAILED) comme pour un rejet ASYNCHRONE (REJECTED)
  // de l'expéditeur : dans les deux cas, la réparation est dans Brevo.
  if (!isDev || !mode) return false;
  if (mode.test.status !== 'FAILED' && mode.test.status !== 'REJECTED') return false;
  return testErrorMeta(mode.test.lastErrorSafe).offersBrevoLink;
}

/** Accueil de Brevo. Jamais une page profonde : leurs URLs internes bougent. */
export const BREVO_DASHBOARD_URL = 'https://app.brevo.com';

/* --- Bloc « Dernier test » -------------------------------------------------- */

export interface LastTestView {
  /** `pending` = accepté mais livraison non confirmée. */
  outcome: 'success' | 'failure' | 'pending' | 'deferred';
  label: string;
  at: string;
  /** Renseigné en cas d'échec (message métier) ou d'attente (honnêteté). */
  detail: string | null;
}

/**
 * Projection du dernier test. `null` tant qu'aucun n'a eu lieu.
 *
 * On ne conserve que le dernier de chaque issue — pas un historique. Le webhook
 * fait évoluer ACCEPTED → DELIVERED / REJECTED ; ce bloc reflète l'issue courante.
 */
export function lastTestView(mode: EmailModeConfiguration | null): LastTestView | null {
  if (!mode || mode.test.status === 'NOT_TESTED' || !mode.test.lastTestedAt) return null;
  const t = mode.test;
  const fallback: string = mode.test.lastTestedAt; // non-null après la garde ci-dessus
  if (t.status === 'DELIVERED') {
    return {
      outcome: 'success',
      label: EMAIL_STATE.DELIVERED.label,
      at: t.deliveredAt ?? fallback,
      detail: null,
    };
  }
  // DEFERRED : le fournisseur a expliqué l'attente. On affiche SON explication,
  // pas un « nous n'avons rien reçu » qui la contredirait.
  if (t.status === 'DEFERRED') {
    return {
      outcome: 'deferred',
      label: EMAIL_STATE.DEFERRED.label,
      at: t.lastTestedAt ?? fallback,
      detail: EMAIL_STATE.DEFERRED.help,
    };
  }
  if (t.status === 'ACCEPTED') {
    return {
      outcome: 'pending',
      label: EMAIL_STATE.AWAITING_CONFIRMATION.label,
      at: t.acceptedAt ?? fallback,
      // Dit où en est L'UTILISATEUR, pas ce que fait le fournisseur : « Brevo
      // traite le message » nommait un tiers dont il n'a que faire, et laissait
      // entendre qu'une action était en cours alors qu'on ne sait qu'attendre.
      detail: EMAIL_STATE.AWAITING_CONFIRMATION.help,
    };
  }
  // REJECTED / FAILED : la cause métier, jamais un code ni un texte fournisseur.
  return {
    outcome: 'failure',
    label: EMAIL_STATE.FAILED.label,
    at: t.rejectedAt ?? fallback,
    detail: testErrorMeta(t.lastErrorSafe).message,
  };
}

/* --- Présentation d'un ÉCHEC de test --------------------------------------- */

export interface TestFailureView {
  /** Cause métier, actionnable. */
  message: string;
  /** Adresse expéditrice réellement testée — le commerçant doit la voir. */
  testedSender: string;
  /** Geste attendu. */
  action: string;
  /** Le lien Brevo aide-t-il ici ? (DEV, cf. shouldOfferBrevoLink) */
  senderIssue: boolean;
}

/**
 * Vue d'un échec, avec ce qu'il faut pour AGIR : la cause, l'adresse fautive, le
 * geste. `null` tant que le dernier test n'a pas échoué.
 *
 * Le cas « expéditeur refusé » nomme explicitement l'adresse testée : sans elle,
 * l'utilisateur ne sait pas QUELLE adresse Brevo a rejetée.
 */
export function testFailureView(mode: EmailModeConfiguration | null): TestFailureView | null {
  if (!mode || (mode.test.status !== 'REJECTED' && mode.test.status !== 'FAILED')) return null;
  const meta = testErrorMeta(mode.test.lastErrorSafe);
  const senderIssue = mode.test.lastErrorSafe.code === 'SENDER_REFUSED';
  return {
    message: meta.message,
    testedSender: mode.sender.email,
    action: senderIssue
      ? "Corrigez l’adresse d’expéditeur (ou autorisez-la dans Brevo), puis relancez le test."
      : 'Corrigez le point signalé, puis relancez le test.',
    senderIssue,
  };
}

/*
 * ─── SUPPRIMÉ : `deliveryUnconfirmed` / `shouldWarnDeliveryTracking` ─────────
 *
 * Ces deux fonctions avertissaient que « les statuts de livraison ne remonteront
 * pas faute d'URL publique ». Elles datent d'une époque où l'on pouvait envoyer
 * sans suivi. Depuis que le suivi est OBLIGATOIRE, cette situation ne produit
 * plus un avertissement mais un blocage — déjà énoncé, avec sa cause et son
 * geste, par `operationalView`. Les conserver affichait donc deux messages pour
 * un seul fait, dont l'un disait « vous ne saurez pas » et l'autre « vous ne
 * pouvez pas ».
 */

/**
 * Au-delà de ce délai en ACCEPTED sans confirmation, on cesse de prétendre que
 * « Brevo traite encore le message ». Quelques minutes suffisent : une livraison
 * transactionnelle se confirme en secondes quand le suivi fonctionne.
 */
export const DELIVERY_CONFIRMATION_TIMEOUT_MS = 5 * 60 * 1000;

/* --- Rafraîchissement après un test (statut piloté par webhook) ------------ */

/** Cadence de relecture tant que l'issue n'est pas connue. */
export const TEST_POLL_INTERVAL_MS = 3_000;
/** Durée maximale de relecture — au-delà, on l'annonce au lieu de tourner sans fin. */
export const TEST_POLL_MAX_MS = 90_000;

/**
 * L'issue du test est-elle encore susceptible de changer ?
 *
 * `ACCEPTED` est le SEUL état transitoire : Brevo a pris le message, le webhook
 * de livraison (ou de rejet) n'est pas encore arrivé. `DELIVERED`, `REJECTED` et
 * `FAILED` sont TERMINAUX — on arrête immédiatement de relire, sinon on
 * interrogerait le serveur indéfiniment pour un résultat acquis.
 */
export function isTestStatusTransitory(status: EmailTestStatus | undefined): boolean {
  return status === 'ACCEPTED' || status === 'DEFERRED';
}

/**
 * Budget de suivi, par état.
 *
 * Une acceptation se confirme en secondes quand le suivi fonctionne : au-delà de
 * 90 s, insister n'apprend plus rien. Une remise DIFFÉRÉE, elle, se rejoue par
 * paliers de plusieurs minutes côté messagerie destinataire — la suivre aussi
 * brièvement reviendrait à abandonner juste avant la réponse.
 */
export function pollBudgetMs(status: EmailTestStatus | undefined): number {
  return status === 'DEFERRED' ? 5 * 60_000 : TEST_POLL_MAX_MS;
}

/**
 * Cadence DÉGRESSIVE du suivi.
 *
 * Le suivi interrogeait le serveur toutes les 3 s sans fin, ce qui faisait
 * clignoter la page et donnait l'impression qu'elle travaillait en permanence.
 * L'information arrive presque toujours dans les premières secondes ; passé ce
 * moment, insister au même rythme ne change rien au résultat et se voit.
 */
export function nextPollDelayMs(attempt: number): number {
  if (attempt <= 0) return 3_000;
  if (attempt === 1) return 5_000;
  return 10_000;
}

/**
 * Faut-il continuer à relire le statut ?
 *
 * Trois conditions : une issue encore ouverte, un test réellement en cours de
 * suivi, et le budget de temps non épuisé. Sans la borne, un webhook qui
 * n'arrive jamais ferait tourner une requête toutes les 3 s pour toujours.
 */
export function shouldPollTestStatus(
  mode: EmailModeConfiguration | null,
  elapsedMs: number
): boolean {
  if (!mode || !isTestStatusTransitory(mode.test.status)) return false;
  return elapsedMs < TEST_POLL_MAX_MS;
}

export interface TrackingStalled {
  /** Titre affiché à la place de « Accepté ». */
  title: string;
  /** Message honnête sous le titre. */
  message: string;
  /** Le suivi DEVRAIT fonctionner (webhook actif) mais n'a rien confirmé. */
  trackingBroken: boolean;
}

/**
 * Le test est-il coincé en ACCEPTED sans confirmation depuis trop longtemps ?
 *
 * Sans cela, le Manager affichait « livraison en attente de confirmation »
 * indéfiniment — trois heures plus tard on croyait encore que Brevo traitait le
 * message. Passé le délai, on dit la vérité :
 *  - webhook actif mais rien reçu  → « Le suivi Brevo ne fonctionne pas » ;
 *  - webhook absent/incomplet      → « Suivi indisponible ».
 *
 * `null` tant qu'on est dans les temps, ou si le statut n'est pas ACCEPTED.
 */
export function trackingStalled(
  mode: EmailModeConfiguration | null,
  _webhook: null,
  now: number = Date.now()
): TrackingStalled | null {
  // ⚠️ ACCEPTED SEULEMENT. Un test en « livraison différée » n'est pas un
  // silence : le fournisseur a dit pourquoi la remise tarde. Y superposer
  // « la confirmation n'est pas arrivée » effacerait la seule explication
  // disponible — c'est exactement ce que l'écran faisait.
  if (!mode || mode.test.status !== 'ACCEPTED' || !mode.test.acceptedAt) return null;
  const acceptedAt = new Date(mode.test.acceptedAt).getTime();
  if (!Number.isFinite(acceptedAt) || now - acceptedAt < DELIVERY_CONFIRMATION_TIMEOUT_MS) return null;

  // L'état opérationnel suffit désormais à trancher : il porte DÉJÀ le fait que
  // le suivi est en état de fonctionner. Interroger l'état distant du webhook
  // pour le redécouvrir imposait une seconde requête HTTP à chaque affichage de
  // la carte, pour une information qu'on avait sous la main. Depuis la
  // séparation des états, c'est l'INSTALLATION du webhook qui fait foi (le
  // canal d'envoi peut être vert avec un suivi absent) ; repli sur `ready`
  // pour un backend antérieur.
  const trackingBroken = mode.operational?.webhookConfigurationStatus
    ? mode.operational.webhookConfigurationStatus === 'installed'
    : mode.operational?.ready !== false;
  return {
    title: EMAIL_STATE.TRACKING_UNAVAILABLE.label,
    // Deux situations, deux gestes. Quand le suivi est censé fonctionner, le
    // problème est ailleurs et mérite le diagnostic ; quand il ne l'est pas,
    // c'est le suivi qu'il faut rétablir. Un message unique enverrait la moitié
    // des utilisateurs au mauvais endroit.
    message: trackingBroken
      ? "L'email est parti mais aucune confirmation n'est revenue. Lancez un diagnostic pour en connaître la raison."
      : "L'email est parti, mais sa réception ne peut pas être confirmée tant que le suivi n'est pas rétabli.",
    trackingBroken,
  };
}
