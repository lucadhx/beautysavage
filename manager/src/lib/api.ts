import type {
  Chapter,
  Recurrence,
  ManagedWebhooksPayload,
  ProviderWebhooksActionReport,
  SitePage,
  Company,
  HomeContent,
  DestinationInspection,
  StoredMediaDescriptor,
  ManagerTheme,
  NetworkConfig,
  NetworkConfigResponse,
  NetworkTestResponse,
  PanelCompanyConfiguration,
  PanelConnectionStatus,
  PanelPairResult,
  PublicBootstrap,
  PublicNetwork,
  RoleAppearance,
  SiteStatus,
  DeploymentActiveRun,
  DeploymentObserveEvent,
  TeamMember,
  TestLoginDescription,
  Theme,
  User,
  MediaCatalogEntry,
  ProviderMode,
  EmailConfiguration,
  EmailConfigurationRestore,
  EmailTestStatusView,
  DomainEventView,
  DomainEventPage,
  Contract,
  PaymentMethodView,
  SubscriptionReconciliation,
  SignatureZone,
  BillingGroup,
  InvoiceView,
  ActivationView,
  TimelineEvent,
  LaunchFeeStatusView,
  SubscriptionStatusView,
  PaymentDetail,
  SyncResult,
  DeploymentTarget,
  VpsSession,
  PreflightResult,
  DuplicationResult,
  DeployStreamEvent,
  DuplicateStreamEvent,
  DuplicationPhaseContract,
  DeploymentStepContract,
  DeploymentRunSummary,
  DeploymentRunFull,
  ControlTarget,
  ControlRelease,
  VersionInfo,
  EmailTemplateSummary,
  EmailTemplateUsageEntry,
  EmailTemplateTestResult,
  EmailTemplateDetail,
  EmailTemplatePreview,
  EmailReadiness,
  EmailDeliveryView,
  EmailDeliveryPage,
  EmailDeliveryDetail,
  EmailDeliveryTimelineEvent,
  BrevoWebhookEventPage,
  BrevoWebhookEventView,
  BrevoWebhookState,
  BrevoWebhookActionResult,
  ContactSubmissionPage,
  ContactDiagnostics,
  ContactSubmissionDetail,
  ContactSubmissionSummary,
  PaymentRequestView,
  SubscriptionIncidentsView,
  MyCompanyView,
  ProjectAccountView,
} from '@/types';
import { estRunIdDeCeProjet, estSousRessourceDeRuns } from '@/lib/deploymentRunId';
import { cleProjet } from '@/lib/projectIdentity';

/**
 * LA CLÉ DE SESSION NOMME UN GESTE, PAS UN CLIENT.
 *
 * Elle valait `sbauto_manager_token`. Une clé de stockage local ISOLE un
 * navigateur ; elle n'identifie personne — et chaque projet dupliqué la
 * recopiait, si bien que le manager d'un garage annonçait « sbauto » dans le
 * stockage de ses visiteurs. Aucun risque, aucune fuite : simplement une
 * identité empruntée, propagée à tout le parc, que personne ne pensait à
 * réécrire parce qu'elle ne se voit pas.
 */
/**
 * ── ET ELLE APPARTIENT À CE PROJET ────────────────────────────────────────
 *
 * Elle valait `manager.session.token` : la même clé dans les quatre projets du
 * parc, qui partagent l'origine `localhost:6071` en développement. Ouvrir le
 * manager d'un projet après celui d'un autre faisait donc relire le jeton du
 * voisin. Il est signé d'un autre `JWT_SECRET` — le backend le refuse — et
 * c'est bien pire qu'une simple erreur : `hasSession()` répondait « oui », ce
 * qui AUTORISAIT l'hydratation du cache d'entreprise étranger. Le jeton partagé
 * était l'amorce de la fuite d'identité, pas seulement un 401 de plus.
 */
const TOKEN_KEY = cleProjet('manager.session.token');

/**
 * ══ LES CLÉS GLOBALES HÉRITÉES SONT PURGÉES, JAMAIS REPRISES ═══════════════
 *
 * Ce bloc RECOPIAIT `sbauto_manager_token` dans la clé courante — une reprise
 * écrite quand tous les projets partageaient la même clé, et qu'on croyait donc
 * migrer « son propre » jeton. Sur une origine partagée, cette recopie fait
 * exactement l'inverse : elle importe le jeton du DERNIER projet ouvert dans le
 * manager du suivant.
 *
 * Une clé globale ne peut plus être attribuée à personne : on l'efface. Le coût
 * est une reconnexion, une seule fois, et il est payé sciemment.
 */
const CLES_GLOBALES_HERITEES = ['sbauto_manager_token', 'manager.session.token'];
try {
  for (const morte of CLES_GLOBALES_HERITEES) localStorage.removeItem(morte);
} catch {
  /* stockage indisponible : rien à purger, et surtout rien à casser */
}

// URL initiale du backend fournie au build/runtime. Sert UNIQUEMENT à joindre
// l'API au démarrage (le paradoxe « découvrir l'URL du backend depuis le backend »
// ne peut pas être résolu sans cette valeur). Vide -> chemin relatif (proxy Vite en dev).
// `?.` : sous Vite `import.meta.env` est injecté ; sous Node (tests de modules
// purs) il est absent — l'optionnel évite un crash au chargement sans rien changer
// au build. Vide -> chemin relatif (proxy Vite en dev, Nginx en prod).
export const API_ROOT = (import.meta.env?.VITE_API_URL || '').replace(/\/+$/, '');
/**
 * Racine de l'API. Exportée parce qu'un flux NDJSON ne peut pas passer par
 * `request()` : celui-ci lit et parse la réponse d'un bloc, là où le retrait
 * doit être affiché ligne par ligne, pendant qu'il s'exécute.
 */
export const API_BASE = API_ROOT ? `${API_ROOT}/api` : '/api';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

/**
 * Y a-t-il une session ? Permet aux contextes de ne PAS lancer de requête
 * authentifiée sur l'écran de connexion : sans jeton, la réponse est un 401
 * certain — du bruit réseau et une source de courses inutiles.
 */
export const hasSession = () => Boolean(tokenStore.get());

export class ApiError extends Error {
  status: number;
  /**
   * Code métier STABLE renvoyé par le backend (ex. `INVALID_OTP`, `OTP_EXPIRED`).
   * À préférer TOUJOURS au message : un libellé se retraduit, un code non — et
   * relire le texte d'un fournisseur pour décider est un piège.
   */
  code?: string;
  details?: unknown;
  /**
   * Secondes à patienter avant de réessayer, quand le serveur l'a annoncé.
   * Jamais deviné côté client : un client qui invente une durée finit
   * toujours par la sous-estimer, et renvoie l'utilisateur se faire refuser.
   */
  retryAfterSeconds?: number;
  constructor(status: number, message: string, details?: unknown, code?: string,
    retryAfterSeconds?: number) {
    super(message);
    this.status = status;
    this.details = details;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * ── TROP DE TENTATIVES ────────────────────────────────────────────────────
 *
 * Un 429 n'est PAS un refus d'identifiants. Afficher « échec de la
 * connexion » enverrait changer un mot de passe qui fonctionne peut-être.
 *
 * La durée est arrondie à la minute SUPÉRIEURE : un compte à rebours à la
 * seconde est exactement ce qu'un script automatise, et pour un humain la
 * minute suffit. La phrase n'apprend rien sur le compte — ni s'il existe, ni
 * combien de tentatives restent, ni si le mot de passe était proche.
 */
export function isRateLimited(err: unknown): boolean {
  return err instanceof ApiError && err.status === 429;
}

export function messageTropDeTentatives(err: unknown): string {
  const base = 'Trop de tentatives. Votre compte n’est pas bloqué.';
  const secondes = err instanceof ApiError ? err.retryAfterSeconds : undefined;
  if (!secondes) return base + ' Réessayez dans quelques minutes.';
  const minutes = Math.max(1, Math.ceil(secondes / 60));
  return base + ' Réessayez dans ' + minutes + ' minute' + (minutes > 1 ? 's' : '') + '.';
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  auth?: boolean;
}

/** Réseau injoignable (backend arrêté, proxy sans réponse, coupure). */
export const OFFLINE_STATUS = 0;

/**
 * Vrai si l'erreur vient d'un serveur injoignable, et non d'une requête refusée.
 *
 * La distinction est essentielle : « je n'ai pas pu demander » n'est pas une
 * réponse. Confondre les deux fait tirer des conclusions fausses d'une panne
 * passagère (cf. la sonde d'environnement de l'écran de connexion).
 */
export function isOffline(err: unknown): boolean {
  return err instanceof ApiError && err.status === OFFLINE_STATUS;
}
const OFFLINE_MESSAGE = "Serveur injoignable. Vérifiez qu'il est démarré, puis réessayez.";

/**
 * Une seule redirection vers /login par chargement de page.
 *
 * Sans ce verrou, une rafale de requêtes qui expirent ensemble assignait
 * `location.href` autant de fois qu'il y avait de requêtes — chaque assignation
 * annulant les fetch en cours, ce qui amplifiait la cascade d'erreurs au lieu de
 * la calmer.
 */
let redirectingToLogin = false;

/**
 * UN 401 NE PARLE PAS FORCÉMENT DE NOTRE SESSION.
 *
 * ── CE QUI ARRIVAIT ─────────────────────────────────────────────────────────
 * Un développeur connecté saisissait un code d'appairage, cliquait
 * « Appairer », et se retrouvait sur l'écran de connexion. Sa session était
 * pourtant parfaitement valide.
 *
 * En face, le Panel refusait le code : `BRIDGE_PAIRING_CODE_INVALID`, dont le
 * statut canonique dans le contrat du pont est 401. Ce 401 remontait tel quel
 * jusqu'ici, où toute réponse 401 valait « votre session a expiré » : jeton
 * effacé, redirection. Une faute de frappe dans un code déconnectait
 * l'utilisateur.
 *
 * ── LA RÈGLE ────────────────────────────────────────────────────────────────
 * Deux garde-fous, du moins coûteux au plus sûr :
 *
 *   1. un 401 portant un code du PONT (`BRIDGE_*`) parle d'un autre système —
 *      jamais de la session du Manager ;
 *   2. dans tous les autres cas, on ne croit personne sur parole : seul
 *      `/auth/me` fait autorité sur la validité de la session.
 *
 * Une panne réseau pendant cette vérification ne déconnecte pas : on ne
 * confond pas « injoignable » et « refusé ».
 */
export function estErreurDuPont(code?: string): boolean {
  return typeof code === 'string' && code.startsWith('BRIDGE_');
}

async function sessionReellementExpiree(
  path: string,
  code: string | undefined,
  token: string
): Promise<boolean> {
  if (estErreurDuPont(code)) return false;
  // `/auth/me` est déjà la vérification : la refaire tournerait en rond.
  if (path.startsWith('/auth/me')) return true;
  try {
    const controle = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return controle.status === 401;
  } catch {
    return false;
  }
}

/**
 * ══ AUCUN IDENTIFIANT DE RUN ÉTRANGER NE FRANCHIT LE RÉSEAU ════════════════
 *
 * Le backend de ce projet a reçu quatre requêtes portant un identifiant qu'il
 * ne peut pas produire (un UUID, là où ses runs sont des ObjectId Mongo). Une
 * telle adresse ne peut rien donner de bon : elle traverse le garde
 * d'authentification, échoue, et le refus se lit comme une session invalide.
 *
 * Le contrôle est posé ICI, au point de sortie unique, plutôt que chez chaque
 * appelant : c'est la seule place où l'on est certain de le traverser. Il ne
 * juge que la FORME — il ne prétend pas savoir si le run existe.
 */
function refuserRunEtranger(path: string): void {
  const m = /^\/deployment\/runs\/([^/?]+)/.exec(path);
  if (!m) return;
  const identifiant = decodeURIComponent(m[1]);
  /**
   * `/runs/active` n'est pas un identifiant : c'est une sous-ressource. Voir
   * `SOUS_RESSOURCES_DE_RUNS` — la garde ne doit refuser que ce qui PRÉTEND
   * être un run de ce projet.
   */
  if (estSousRessourceDeRuns(identifiant)) return;
  if (estRunIdDeCeProjet(identifiant)) return;
  throw new ApiError(
    400,
    'Suivi de déploiement impossible : cet identifiant d’exécution n’appartient pas à ce projet.',
    undefined,
    'DEPLOYMENT_RUN_ID_ETRANGER',
  );
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = options;
  refuserRunEtranger(path);
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const token = auth ? tokenStore.get() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // fetch ne rejette que sur une panne réseau : le serveur n'a jamais répondu.
    // Ce n'est PAS une « erreur serveur » — le distinguer évite de faire chercher
    // un bug applicatif alors que le backend redémarre simplement.
    //
    // Le CODE compte autant que la phrase : un appelant qui pilote un serveur
    // distant doit pouvoir dire « mon backend est injoignable » plutôt que
    // « le VPS est injoignable ». Ce sont deux machines différentes.
    throw new ApiError(OFFLINE_STATUS, OFFLINE_MESSAGE, undefined, 'BACKEND_INJOIGNABLE');
  }

  if (res.status === 204) return null as T;

  const raw = await res.text();
  let json: { message?: string; code?: string; details?: unknown; data?: unknown } = {};
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    /* corps non-JSON (page d'erreur du proxy, HTML…) */
  }

  if (res.status === 401 && auth) {
    // Ne purger la session QUE si l'on avait effectivement un jeton. Une réponse
    // 401 tardive appartenant à une requête partie AVANT la connexion effaçait
    // sinon le jeton tout juste reçu — et toute la page repartait en erreur.
    //
    // Et surtout : un 401 ne parle pas forcément de NOTRE session. Voir
    // `sessionReellementExpiree`.
    if (token && (await sessionReellementExpiree(path, json.code, token))) {
      tokenStore.clear();
      if (!redirectingToLogin && !location.pathname.startsWith('/login')) {
        redirectingToLogin = true;
        location.href = '/login';
      }
    }
  }

  if (!res.ok) {
    /**
     * « PAS DE RÉPONSE » ET « RÉPONSE EN ERREUR » NE SONT PAS LA MÊME PANNE.
     *
     * Tout 5xx sans corps JSON valait « Serveur injoignable » — la phrase
     * réservée à l'absence totale de réponse. Un opérateur en train
     * d'authentifier un VPS lisait donc que SON backend était éteint, alors
     * que celui-ci venait de répondre. Il redémarrait le mauvais service.
     *
     * Une passerelle qui n'a pas joint le backend (502/503/504) est le SEUL
     * 5xx qui autorise ce diagnostic. Les autres disent ce qu'ils sont : le
     * serveur a répondu, et sa réponse est une erreur.
     */
    const passerelle = res.status === 502 || res.status === 503 || res.status === 504;
    const fallback = res.status >= 500 && !json.message
      ? (passerelle ? OFFLINE_MESSAGE : 'Le serveur a répondu par une erreur interne.')
      : 'Erreur serveur';
    const codeDeSecours = res.status >= 500 && !json.code
      ? (passerelle ? 'BACKEND_INJOIGNABLE' : 'BACKEND_ERROR')
      : undefined;
    // NORMALISATION DÉFENSIVE : `message` est TOUJOURS une string, `details`
    // TOUJOURS un tableau ou undefined — jamais une string ni un objet nu qu'un
    // consommateur pourrait itérer (source possible d'un « Cannot create property
    // 'code' on string »). Aucune mutation : on construit du neuf.
    const safeMessage = typeof json.message === 'string' && json.message ? json.message : fallback;
    const safeDetails = Array.isArray(json.details) ? json.details : undefined;
    const patienter = Number((json as { retryAfterSeconds?: unknown }).retryAfterSeconds);
    throw new ApiError(res.status, safeMessage, safeDetails,
      typeof json.code === 'string' ? json.code : codeDeSecours,
      Number.isFinite(patienter) && patienter > 0 ? patienter : undefined);
  }
  return json.data as T;
}

/**
 * Consomme un flux NDJSON (une ligne JSON par évènement) depuis un POST
 * authentifié. Utilisé pour la progression EN DIRECT des déploiements et
 * duplications (le backend émet un évènement par étape). `fetch` + reader
 * permet de conserver l'en-tête Authorization (contrairement à EventSource).
 */
export async function* streamNdjson<T = unknown>(
  path: string,
  body: unknown,
  signal?: AbortSignal
): AsyncGenerator<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch {
    throw new ApiError(OFFLINE_STATUS, OFFLINE_MESSAGE, undefined, 'BACKEND_INJOIGNABLE');
  }
  if (!res.ok || !res.body) {
    // Le serveur A RÉPONDU : il a simplement refusé d'ouvrir le flux. On
    // conserve son `code` et ses `details`, sans quoi l'appelant ne peut plus
    // distinguer un refus argumenté (prérequis non tenus) d'une panne réseau,
    // et retombe sur un « serveur injoignable » qui décrit l'inverse du réel.
    const raw = await res.text().catch(() => '');
    let msg = 'Erreur serveur';
    let code: string | undefined;
    let details: unknown;
    try {
      const parsed = raw ? JSON.parse(raw) : {};
      msg = parsed.message || msg;
      code = parsed.code;
      details = parsed.details;
    } catch {
      /* non-JSON */
    }
    throw new ApiError(res.status, msg, details, code);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) yield JSON.parse(line) as T;
    }
  }
  const tail = buffer.trim();
  if (tail) yield JSON.parse(tail) as T;
}

/**
 * OBSERVE un flux NDJSON en LECTURE — un `GET`, et c'est le point.
 *
 * ══ POURQUOI UNE SECONDE FONCTION PLUTÔT QU'UN DRAPEAU SUR LA PREMIÈRE ══════
 *
 * `streamNdjson` fait un `POST` : côté déploiement, ce POST **démarre** le
 * travail. Y ajouter une option « ne démarre pas » ferait dépendre un acte
 * métier d'un booléen que n'importe quel appelant pourrait oublier.
 *
 * Deux fonctions, deux verbes HTTP : reprendre le suivi d'un déploiement ne
 * peut PAS, structurellement, en lancer un second.
 */
export async function* observeNdjson<T = unknown>(
  path: string,
  signal?: AbortSignal
): AsyncGenerator<T> {
  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { method: 'GET', headers, signal });
  } catch {
    throw new ApiError(OFFLINE_STATUS, OFFLINE_MESSAGE, undefined, 'BACKEND_INJOIGNABLE');
  }
  if (!res.ok || !res.body) {
    const raw = await res.text().catch(() => '');
    let msg = 'Erreur serveur';
    let code: string | undefined;
    try {
      const parsed = raw ? JSON.parse(raw) : {};
      msg = parsed.message || msg;
      code = parsed.code;
    } catch { /* non-JSON */ }
    throw new ApiError(res.status, msg, undefined, code);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) yield JSON.parse(line) as T;
    }
  }
  const reste = buffer.trim();
  if (reste) yield JSON.parse(reste) as T;
}

/**
 * IMPORT D'UN MÉDIA MÉTIER — multipart.
 *
 * ── LE NAVIGATEUR NE PARLE QU'À SON PROPRE BACKEND ──────────────────────────
 * Celui-ci STOCKE s'il est l'autorité du projet (le backend déployé), sinon il
 * RELAIE. C'est ce qui fait qu'un média importé depuis un poste de
 * développement existe immédiatement sur le site déployé — il n'y a qu'un
 * seul dossier, et il n'est jamais sur le poste.
 *
 * `mediaType` dit ce que l'image REPRÉSENTE (logo, hero, galerie…). Il n'est
 * pas déduit d'un nom de fichier : un nom ne dit rien de son usage.
 */
/**
 * IMPORTE une image et rend ce que l'écran doit enregistrer.
 *
 * ── TROIS VALEURS, ET ELLES NE SE CONFONDENT PAS ────────────────────────────
 *   · `url`        le CHEMIN DE STOCKAGE (`/uploads/…`) ;
 *   · `descriptor` LA SOURCE DE VÉRITÉ — clé d'objet, empreinte, environnement,
 *                  type, dimensions. C'est lui que la fiche conserve ;
 *   · `publicUrl`  l'adresse utilisable MAINTENANT, absolue si une destination
 *                  sert déjà ce média, locale sinon. Elle sert l'aperçu, et
 *                  n'est JAMAIS enregistrée — l'écrire en fiche est exactement
 *                  le défaut que le descripteur supprime.
 */
export interface MediaLibraryItem {
  id: string;
  mediaId: string;
  mediaType: string;
  path: string;
  objectKey: string;
  publicUrl: string | null;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  sha256: string;
  createdBy?: string | null;
  createdAt?: string | null;
  publicationState?: string;
  descriptor: StoredMediaDescriptor | null;
}

export async function uploadFile(
  file: File,
  kind: 'image' | 'favicon' = 'image',
  mediaType?: string
): Promise<{
  url: string;
  publicUrl: string | null;
  descriptor: StoredMediaDescriptor | null;
  filename: string;
  media?: { mediaId: string; sha256: string; width: number | null; height: number | null };
}> {
  const form = new FormData();
  form.append('file', file);
  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;

  const query = mediaType ? `?mediaType=${encodeURIComponent(mediaType)}` : '';
  const res = await fetch(`${API_BASE}/uploads/${kind}${query}`, { method: 'POST', headers, body: form });
  const json = await res.json().catch(() => ({}));
  /**
   * LE CODE ET LES DÉTAILS SURVIVENT AU REFUS.
   *
   * Ils étaient perdus ici : seul le message remontait, et l'écran ne pouvait
   * donc pas distinguer « image trop lourde » (l'utilisateur peut agir) de
   * « stockage injoignable » (il ne peut rien). Le backend nomme désormais la
   * limite dans son message ET la publie dans `details.maxBytes` — les deux
   * doivent arriver jusqu'à l'interface.
   *
   * Aucune limite n'est recopiée côté client : il n'existe qu'UN nombre, celui
   * de la politique serveur, et il voyage avec le refus.
   */
  if (!res.ok) {
    // Signature : (status, message, details, code) — l'ordre compte.
    throw new ApiError(
      res.status,
      json.message || "Échec de l'upload",
      json.details,
      json.code,
    );
  }
  const brut = json.data ?? {};
  return {
    ...brut,
    // Repli sur le chemin quand l'autorité est une version antérieure : un
    // aperçu local vaut mieux qu'une image absente.
    publicUrl: brut.publicUrl ?? brut.url ?? null,
    descriptor: brut.descriptor ?? null,
  };
}

export async function uploadCommerceTrainingFile(file: File): Promise<{
  url: string;
  name: string;
  mimeType: string;
  size: number;
  kind: string;
  uploadedAt: string;
}> {
  const form = new FormData();
  form.append('file', file);
  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/commerce/training-files`, { method: 'POST', headers, body: form });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.message || "Echec de l'import", json.details, json.code);
  return json.data;
}

/**
 * RETRAIT D'UN MÉDIA — une opération UNIQUE sur l'autorité du projet.
 *
 * Ce n'est pas une synchronisation entre deux dossiers : il n'y en a qu'un.
 * Supprimer depuis un poste de développement retire donc le fichier là où il
 * vit réellement, et toutes les surfaces cessent de le voir au même instant.
 *
 * Un média encore référencé par une fiche est REFUSÉ : le supprimer laisserait
 * une image cassée dans la vitrine du client.
 */
export async function deleteMediaFile(filename: string): Promise<{ deleted: boolean; alreadyGone: boolean }> {
  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/uploads/image/${encodeURIComponent(filename)}`, {
    method: 'DELETE', headers,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.message || 'Suppression du média refusée');
  return json.data;
}

/** Upload multipart d'un PDF de contrat. */
export async function uploadContractPdf(contractId: string, file: File): Promise<Contract> {
  const form = new FormData();
  form.append('file', file);
  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/contracts/${contractId}/document`, {
    method: 'POST',
    headers,
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, json.message || "Échec de l'upload", json.details);
  return json.data as Contract;
}

/**
 * TÉLÉCHARGE un fichier derrière une route authentifiée.
 *
 * ── CE QUI NE MARCHAIT PAS ──────────────────────────────────────────────────
 * Le code précédent faisait `window.open(URL.createObjectURL(blob))`. Deux
 * défauts, un par environnement :
 *
 *   · en local, l'onglet s'ouvrait sur une URL `blob:` — le navigateur AFFICHE
 *     ce qu'il peut, il ne télécharge rien : aucun fichier n'arrivait sur le
 *     disque, et l'utilisateur voyait une adresse `blob:` incompréhensible ;
 *   · en production, rien du tout — `window.open` appelé APRÈS un `await` n'est
 *     plus rattaché au clic de l'utilisateur, et le bloqueur de fenêtres le
 *     refuse en silence. D'où le « clic sans effet ».
 *
 * ── CE QUI MARCHE ───────────────────────────────────────────────────────────
 * Un lien `download`, réellement inséré dans le document, cliqué, retiré. Et
 * l'URL objet n'est révoquée qu'APRÈS : la révoquer dans la foulée du clic
 * annule un téléchargement qui n'a pas encore commencé.
 *
 * On vérifie aussi que la réponse est bien un FICHIER. Une erreur JSON reçue en
 * `blob()` produit un « PDF » de trois lignes de JSON, que rien ne signale :
 * l'utilisateur enregistre un fichier illisible et croit le serveur en panne.
 */
export async function fetchAuthenticatedFile({
  url,
  fallbackFilename,
}: {
  url: string;
  fallbackFilename: string;
}): Promise<{ blob: Blob; filename: string }> {
  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { headers });

  if (!res.ok) {
    // Le vrai message du serveur, quand il en donne un.
    const corps = await res.json().catch(() => null);
    throw new ApiError(
      res.status,
      corps?.message || 'Le document n’a pas pu être téléchargé.',
      corps?.details
    );
  }

  const type = res.headers.get('content-type') ?? '';
  if (/application\/json|text\/html/i.test(type)) {
    const corps = await res.json().catch(() => null);
    throw new ApiError(
      res.status,
      corps?.message || 'Le serveur n’a pas renvoyé de fichier.',
      corps?.details
    );
  }

  // Le nom vient du serveur quand il le donne — c'est lui qui sait s'il rend
  // l'original ou le signé.
  const disposition = res.headers.get('content-disposition') ?? '';
  const trouve = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const filename = trouve ? decodeURIComponent(trouve[1].trim()) : fallbackFilename;

  const blob = await res.blob();
  if (blob.size === 0) {
    throw new ApiError(502, 'Le document reçu est vide.');
  }
  return { blob, filename };
}

/** Récupère ET enregistre le fichier sur le disque de l'utilisateur. */
export async function downloadAuthenticatedFile(params: {
  url: string;
  fallbackFilename: string;
}): Promise<void> {
  const { blob, filename } = await fetchAuthenticatedFile(params);

  const objectUrl = URL.createObjectURL(blob);
  const lien = document.createElement('a');
  lien.href = objectUrl;
  lien.download = filename;
  lien.rel = 'noopener';
  // Firefox ignore le clic d'un lien absent du document : il doit y entrer.
  lien.style.display = 'none';
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  // Après le clic, jamais avant — et au tour suivant, pour laisser le
  // navigateur s'emparer du flux.
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

/**
 * Les pièces d'un dossier contractuel.
 *
 * `certificate` est la PREUVE d'audit — qui a signé, quand, depuis où. Ce
 * n'est pas une variante du contrat : le nom de fichier proposé le dit, parce
 * qu'un « contrat-…-certificate.pdf » ferait croire à celui qui l'ouvre qu'il
 * tient l'engagement, et les deux finiraient par être produits l'un pour
 * l'autre.
 */
export type ContractDocumentKind = 'original' | 'signed' | 'certificate';

const contractDocumentUrl = (contractId: string, kind: ContractDocumentKind) => ({
  url: `${API_BASE}/contracts/${contractId}/documents/${kind}`,
  fallbackFilename: kind === 'certificate'
    ? `certificat-signature-${contractId}.pdf`
    : `contrat-${contractId}-${kind}.pdf`,
});

/** Télécharge une pièce d'un contrat — original, signé, ou preuve d'audit. */
export function downloadContractDocument(
  contractId: string,
  kind: ContractDocumentKind
): Promise<void> {
  return downloadAuthenticatedFile(contractDocumentUrl(contractId, kind));
}

/**
 * Récupère le PDF SANS l'enregistrer — pour l'afficher dans l'application,
 * comme l'éditeur de zones de signature. Ce n'est pas un téléchargement : le
 * fichier ne quitte pas la page.
 */
export async function fetchContractDocumentBlob(
  contractId: string,
  kind: ContractDocumentKind
): Promise<Blob> {
  return (await fetchAuthenticatedFile(contractDocumentUrl(contractId, kind))).blob;
}

export const api = {
  // Auth
  login: (email: string, password: string) =>
    request<{ token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: { email, password },
      auth: false,
    }),
  me: () => request<User>('/auth/me'),
  updateProfile: (data: { name: string }) =>
    request<User>('/auth/profile', { method: 'PATCH', body: data }),
  /**
   * LE WIDGET DE CONNEXION RAPIDE — deux populations, une seule forme.
   *
   * La réponse ne porte plus des `User` sérialisés mais la représentation
   * canonique du projet (`source`, `principalType`, `loginMode`). C'est ce qui
   * permet à l'écran de séparer « comptes du projet » et « accès L.Y Solution »
   * sans deviner, et d'ouvrir pour chacun le SEUL chemin qui lui convient.
   *
   * Hors TEST, le serveur répond `enabled: false` avec une liste vide — et il
   * n'a lu AUCUN compte pour le dire.
   */
  testAccounts: () => request<TestLoginDescription>('/auth/test-accounts', { auth: false }),
  devLogin: (email: string) =>
    request<{ token: string; user: User }>('/auth/dev-login', {
      method: 'POST',
      body: { email },
      auth: false,
    }),

  /* ── ACCÈS L.Y SOLUTION (L12.B-UI) ────────────────────────────────────────
   *
   * Trois appels, tous PUBLICS : personne n'est authentifié pendant un
   * parcours de connexion.
   *
   * Le manager ne collecte JAMAIS le mot de passe du Panel — il n'y a d'ailleurs
   * aucun champ pour cela ici. Il demande l'ouverture d'un parcours, envoie le
   * navigateur chez le Panel, et rapporte au serveur ce qui en revient.
   */
  /**
   * LES ACCÈS L.Y SOLUTION recensés dans CE projet — lecture seule.
   *
   * Aucune méthode d'écriture ne l'accompagne, et ce n'est pas un oubli : ce
   * projet n'est pas propriétaire de ces identités.
   */
  listExternalPrincipals: () =>
    request<{
      panelUserId: string;
      displayName: string;
      email: string;
      role: string;
      enabled: boolean;
      lastSyncedAt: string | null;
      lastSeenAt: string | null;
      source: string;
    }[]>('/accounts/external'),

  federationStatus: () =>
    request<{ available: boolean; provider: string; label: string }>(
      '/auth/federated/panel',
      { auth: false },
    ),
  /**
   * `state` et `authorizeUrl` sont produits par le SERVEUR. L'écran ne
   * fabrique ni l'un ni l'autre : un `state` construit dans le navigateur ne
   * prouverait rien, et une URL recomposée à l'écran ferait de `projectId` une
   * valeur que la page peut changer.
   */
  federationStart: (data: { redirectPath?: string; returnUrl?: string }) =>
    request<{
      state: string;
      panelUrl: string;
      projectId: string;
      authorizeUrl: string;
      expiresAt: string;
    }>('/auth/federated/panel/start', { method: 'POST', body: data, auth: false }),
  /**
   * Le retour. On transmet l'assertion telle qu'on l'a reçue et le `state`
   * qu'on avait gardé ; le serveur tranche. L'assertion n'est JAMAIS traitée
   * comme une session par le navigateur — c'est le callback qui la consomme.
   */
  federationCallback: (data: { assertion: string; state: string }) =>
    request<{ token: string; redirectPath: string; user: User }>(
      '/auth/federated/panel/callback',
      { method: 'POST', body: data, auth: false },
    ),
  forgotPassword: (email: string) =>
    request<{ message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: { email },
      auth: false,
    }),
  resetPassword: (token: string, newPassword: string, confirmPassword: string) =>
    request<{ message: string }>('/auth/reset-password', {
      method: 'POST',
      body: { token, newPassword, confirmPassword },
      auth: false,
    }),
  /**
   * ACTIVATION DU PREMIER ACCÈS (LOT 2C) — trois appels PUBLICS.
   *
   * `auth: false` sur les trois, et ce n'est pas un oubli : leur destinataire
   * n'a précisément aucune session à présenter — c'est tout l'objet de
   * l'activation.
   */
  describeActivation: (token: string) =>
    request<{ valid: boolean; name?: string; role?: string; projectName?: string; expiresAt?: string }>(
      `/auth/activation?token=${encodeURIComponent(token)}`,
      { auth: false },
    ),
  activateAccount: (token: string, newPassword: string, confirmPassword: string) =>
    request<{ email: string; role: string; name: string }>('/auth/activate-account', {
      method: 'POST',
      body: { token, newPassword, confirmPassword },
      auth: false,
    }),
  resendActivation: (email: string) =>
    request<{ message: string }>('/auth/activation/resend', {
      method: 'POST',
      body: { email },
      auth: false,
    }),
  changePassword: (currentPassword: string, newPassword: string, confirmPassword: string) =>
    request<User>('/auth/password', {
      method: 'PATCH',
      body: { currentPassword, newPassword, confirmPassword },
    }),

  // Meta
  meta: () =>
    request<{ mediaCatalog: MediaCatalogEntry[]; environment: ProviderMode }>('/meta', { auth: false }),
  mediaLibrary: (params: { mediaType?: string; q?: string; limit?: number } = {}) => {
    const query = new URLSearchParams();
    if (params.mediaType) query.set('mediaType', params.mediaType);
    if (params.q) query.set('q', params.q);
    if (params.limit) query.set('limit', String(params.limit));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<MediaLibraryItem[]>(`/uploads/library${suffix}`);
  },

  // Company
  getCompany: () => request<Company>('/company'),
  updateCompany: (data: Partial<Company>) => request<Company>('/company', { method: 'PUT', body: data }),

  /* ── LA PAGE D'ACCUEIL ───────────────────────────────────────────────────
     Bannière, maquette d'appareils, arguments, preuves, invitation. Un
     singleton, comme le thème : il n'y a qu'une page d'accueil, et lui donner
     une liste inviterait à en créer une seconde qui ne s'afficherait jamais. */
  getHomeContent: () => request<HomeContent>('/home-content'),
  updateHomeContent: (data: Partial<HomeContent>) =>
    request<HomeContent>('/home-content', { method: 'PUT', body: data }),

  /* ── LES CHAPITRES DU RÉCIT ──────────────────────────────────────────────
     Le référentiel de contenu structuré du site : Conception, Architecture,
     L'Expérience L.Y. `reorder` ne déplace QUE le rang de navigation — l'ordre
     des volets d'un chapitre, lui, est déduit de leur position à
     l'enregistrement (voir `chapter.controller.js`). */
  listChapters: () => request<Chapter[]>('/chapters'),
  getChapter: (id: string) => request<Chapter>(`/chapters/${id}`),
  createChapter: (data: Partial<Chapter>) => request<Chapter>('/chapters', { method: 'POST', body: data }),
  updateChapter: (id: string, data: Partial<Chapter>) =>
    request<Chapter>(`/chapters/${id}`, { method: 'PUT', body: data }),
  deleteChapter: (id: string) => request<null>(`/chapters/${id}`, { method: 'DELETE' }),
  reorderChapters: (items: { id: string; order: number }[]) =>
    request<Chapter[]>('/chapters/reorder', { method: 'PATCH', body: { items } }),

  // Les pages éditoriales, composées de blocs.
  listPages: () => request<SitePage[]>('/pages'),
  getPage: (id: string) => request<SitePage>(`/pages/${id}`),
  createPage: (data: Partial<SitePage>) => request<SitePage>('/pages', { method: 'POST', body: data }),
  updatePage: (id: string, data: Partial<SitePage>) =>
    request<SitePage>(`/pages/${id}`, { method: 'PUT', body: data }),
  deletePage: (id: string) => request<null>(`/pages/${id}`, { method: 'DELETE' }),
  reorderPages: (items: { id: string; order: number }[]) =>
    request<SitePage[]>('/pages/reorder', { method: 'PATCH', body: { items } }),

  // Theme
  getVitrineTheme: () => request<Theme>('/theme/vitrine'),
  updateVitrineTheme: (data: Partial<Theme>) => request<Theme>('/theme/vitrine', { method: 'PUT', body: data }),
  getManagerTheme: () => request<ManagerTheme>('/theme/manager'),
  updateManagerTheme: (data: Partial<ManagerTheme>) =>
    request<ManagerTheme>('/theme/manager', { method: 'PUT', body: data }),

  // Site status
  getSiteStatus: () => request<SiteStatus>('/site-status'),
  /**
   * SUSPENDRE LE SITE À LA MAIN (DEV) — motif facultatif, notification explicite.
   *
   * ══ `notifyAdmins` EST TOUJOURS ENVOYÉ ══════════════════════════════════
   *
   * Y compris à `false`. Omettre le champ laisserait le serveur appliquer son
   * défaut, ce qui reviendrait au même aujourd'hui — mais l'intention de NE PAS
   * prévenir est une décision de l'utilisateur, et elle mérite d'être dite
   * plutôt que déduite d'une absence.
   *
   * La réponse porte la fiche du site PLUS un rapport `notification` : l'écran
   * peut ainsi annoncer « suspendu, mais les administrateurs n'ont pas pu être
   * prévenus » au lieu de laisser croire à un envoi qui n'a pas eu lieu.
   */
  suspendSite: (reason: string, notifyAdmins = false, suspendedAt?: string) =>
    request<SiteStatus>('/site-status/suspend', {
      method: 'POST',
      body: { reason, notifyAdmins, suspendedAt },
    }),
  reactivateSite: () => request<SiteStatus>('/site-status/reactivate', { method: 'POST' }),
  /**
   * Protection contractuelle (DEV). Rend le statut RECALCULÉ : l'écran affiche
   * la conséquence constatée, il ne la suppose pas.
   */
  setContractProtection: (enabled: boolean) =>
    request<SiteStatus>('/site-status/contract-protection', { method: 'POST', body: { enabled } }),

  // Commerce BeautySavage
  commerceProducts: () => request<any[]>('/commerce/products'),
  saveCommerceProduct: (data: any) =>
    request<any>(data.id ? `/commerce/products/${data.id}` : '/commerce/products', {
      method: data.id ? 'PUT' : 'POST',
      body: data,
    }),
  deleteCommerceProduct: (id: string) =>
    request<{ deleted: boolean; archived: boolean }>(`/commerce/products/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  resolveDriveVideo: (url: string) =>
    request<{ sourceUrl: string; fileId: string; playbackUrl: string; playbackUrlExpiresAt: string | null; expiresInSeconds: number | null; streamPath: string; streamUrl: string; contentType: string; size: number; strategy: string; qualityLabel: string | null; width: number | null; height: number | null; bitrate: number | null; durationMs: number | null; resolvedAt: string }>(
      '/commerce/videos/resolve-drive',
      { method: 'POST', body: { url } },
    ),
  resolveStreamableVideo: (url: string) =>
    request<{ sourceUrl: string; provider: 'STREAMABLE'; shortcode: string; contentType: string; size: number; strategy: string; resolvedAt: string }>(
      '/commerce/videos/resolve-streamable',
      { method: 'POST', body: { url } },
    ),
  streamablePlaybackUrl: (shortcode: string) =>
    request<{ shortcode: string; sourceUrl: string; playbackUrl: string; contentType: string; mimeType: string; contentLength: number; strategy: string; resolvedAt: string }>(
      `/public/commerce/videos/streamable/${encodeURIComponent(shortcode)}/playback-url`,
      { auth: false },
    ),
  googleDrivePlaybackUrl: (fileId: string) =>
    request<{ fileId: string; playbackUrl: string; expiresAt: string | null; expiresInSeconds: number; contentType: string; mimeType: string; qualityLabel: string; width: number; height: number; bitrate: number; durationMs: number; resolvedAt: string }>(
      `/public/commerce/videos/google-drive/${encodeURIComponent(fileId)}/playback-url`,
      { auth: false },
    ),
  commerceSales: () => request<any[]>('/commerce/sales'),
  refundCommerceSale: (id: string, data: { amountCents?: number; reason?: string }) =>
    request<any>(`/commerce/sales/${id}/refund`, { method: 'POST', body: data }),
  commerceCustomers: () => request<any[]>('/commerce/customers'),
  commerceCommissions: () => request<any[]>('/commerce/commissions'),
  recalculateCommerceCommissions: () =>
    request<any[]>('/commerce/commissions/recalculate', { method: 'POST' }),
  payCommerceCommission: (id: string, data: { paymentReference?: string }) =>
    request<any>(`/commerce/commissions/${id}/pay`, { method: 'POST', body: data }),
  commerceIntegrations: () => request<any[]>('/commerce/integrations'),
  saveCommerceIntegration: (data: any) =>
    request<any>('/commerce/integrations', { method: 'PUT', body: data }),
  commerceReviews: () => request<any[]>('/commerce/reviews'),
  createManualCommerceReview: (data: any) =>
    request<any>('/commerce/reviews/manual', { method: 'POST', body: data }),
  moderateCommerceReview: (id: string, data: any) =>
    request<any>(`/commerce/reviews/${id}/moderate`, { method: 'POST', body: data }),
  commerceRefundRequests: () => request<any[]>('/commerce/refund-requests'),
  decideCommerceRefundRequest: (id: string, data: any) =>
    request<any>(`/commerce/refund-requests/${id}/decision`, { method: 'POST', body: data }),
  commerceGiftCards: () => request<any[]>('/commerce/gift-cards'),
  issueCommerceGiftCard: (data: any) =>
    request<any>('/commerce/gift-cards', { method: 'POST', body: data }),
  adjustCommerceGiftCard: (id: string, data: any) =>
    request<any>(`/commerce/gift-cards/${id}/adjust`, { method: 'POST', body: data }),
  commerceTrainingSubmissions: () => request<any[]>('/commerce/training-submissions'),
  decideCommerceTrainingSubmission: (id: string, data: any) =>
    request<any>(`/commerce/training-submissions/${id}/decision`, { method: 'POST', body: data }),

  calendarSchedule: () => request<any>('/calendar/schedule'),
  saveCalendarSchedule: (data: any) =>
    request<any>('/calendar/schedule', { method: 'PUT', body: data }),
  calendarEvents: (params: { from: string; to: string }) =>
    request<any[]>(`/calendar/events?from=${encodeURIComponent(params.from)}&to=${encodeURIComponent(params.to)}`),
  calendarAvailability: (params: { from: string; to: string; durationMinutes?: number; bufferAfterMinutes?: number }) => {
    const q = new URLSearchParams({ from: params.from, to: params.to });
    if (params.durationMinutes) q.set('durationMinutes', String(params.durationMinutes));
    if (params.bufferAfterMinutes) q.set('bufferAfterMinutes', String(params.bufferAfterMinutes));
    return request<any[]>(`/calendar/availability?${q.toString()}`);
  },
  createCalendarEvent: (data: any) =>
    request<any>('/calendar/events', { method: 'POST', body: data }),
  updateCalendarEvent: (id: string, data: any) =>
    request<any>(`/calendar/events/${id}`, { method: 'PUT', body: data }),
  cancelCalendarEvent: (id: string, data: any) =>
    request<any>(`/calendar/events/${id}/cancel`, { method: 'POST', body: data }),
  recordCalendarBalancePayment: (id: string, data: any) =>
    request<any>(`/calendar/events/${id}/balance-payment`, { method: 'POST', body: data }),

  // Dev company — LECTURE SEULE : le Panel est l'autorité de cette identité.
  // La méthode d'écriture a été retirée avec le formulaire ; la route serveur
  // refuse désormais toute modification (DEV_COMPANY_MANAGED_BY_PANEL).

  // Team
  /**
   * L'équipe telle que le PANEL l'a publiée.
   *
   * Les fonctions d'écriture ont disparu avec le formulaire : les conserver
   * aurait laissé un chemin vers des routes qui répondent désormais 409, et
   * donc un bouton capable d'échouer sans raison lisible.
   */
  listTeam: () => request<TeamMember[]>('/team'),

  // System configuration — réseau (DEV uniquement)
  getNetworkConfig: () => request<NetworkConfigResponse>('/system-configuration/network'),
  updateNetworkConfig: (data: NetworkConfig) =>
    request<NetworkConfigResponse>('/system-configuration/network', { method: 'PUT', body: data }),
  testNetworkConfig: (data: NetworkConfig) =>
    request<NetworkTestResponse>('/system-configuration/network/test', { method: 'POST', body: data }),
  // Section réseau publique (sans auth) — pour les liens applicatifs & médias
  getPublicNetwork: () => request<PublicNetwork>('/public/network-configuration', { auth: false }),
  // Bootstrap public (sans auth) — identité entreprise & développeur pour le login
  getPublicBootstrap: () => request<PublicBootstrap>('/public/bootstrap', { auth: false }),

  // Role appearance (badges) — lecture pour tous, édition DEV
  getRoleAppearance: () => request<RoleAppearance>('/role-appearance'),
  updateRoleAppearance: (data: Pick<RoleAppearance, 'roles'>) =>
    request<RoleAppearance>('/role-appearance', { method: 'PUT', body: data }),

  // Site status (réconciliation contractuelle)
  reconcileSite: () => request<SiteStatus>('/site-status/reconcile', { method: 'POST' }),

  // IntegratedAPI (DEV uniquement) — par MODE fournisseur (indépendant de l'ENV)
  /*
   * R11 — LE CLIENT D'ADMINISTRATION DES INTEGRATED API A DISPARU.
   *
   * Ses cinq verbes servaient la page « Intégrations API », supprimée avec elle :
   * les quatre domaines (paiement, e-mail, signature, hébergement) sont administrés
   * par le Panel L.Y Solution, et ce projet ne détient plus aucun credential.
   *
   * Les routes backend correspondantes ont été retirées elles aussi. Garder le
   * client sans la page aurait laissé une porte ouverte — un appel depuis la
   * console suffit à écrire — et c'est exactement ce que la centralisation ferme.
   */
  /*
   * ─── RETIRÉ : setActiveMode (lot L2.1) ────────────────────────────────────
   *
   * Le client appelait `POST /integrated-apis/:provider/active-mode` pour
   * basculer le monde fournisseur. Le backend refuse désormais cet appel
   * (409 ACTIVE_MODE_REVOKED) : le monde suit l'environnement de l'instance.
   *
   * La méthode est retirée du CLIENT, pas seulement de l'écran. Tant qu'elle
   * existait, réintroduire un bouton ne demandait qu'une ligne de JSX — et
   * rien n'aurait signalé que le geste était mort.
   */

  // Configuration e-mail (DEV). Chaque réponse renvoie la projection CANONIQUE
  // complète : le Manager remplace son état, il ne le rapièce jamais.
  //
  // Aucun `mode` n'est transmis : le backend écrit toujours dans le mode Brevo
  // ACTIF. Un écran affichant TEST ne peut donc pas écrire dans PROD.
  getEmailConfiguration: () => request<EmailConfiguration>('/email-configuration'),
  /*
   *  et  ont été RETIRÉS en R10.5.
   *
   * Le premier écrivait le From de ce site ; le second envoyait un e-mail en
   * appelant Brevo directement, avec une clé locale. Les deux surfaces vivent
   * désormais dans le Panel, où l’expéditeur est unique et où le test emprunte
   * la chaîne réelle jusqu’au webhook de livraison.
   */
  /**
   * « Rétablir le service » — une seule action, plusieurs sous-étapes côté
   * serveur (resynchronisation, sonde réelle, relecture). La réponse porte
   * l'état FINAL : c'est `restore.ready` qui dit si le service est revenu, et
   * lui seul autorise un message de succès. Une resynchronisation réussie ne
   * prouve rien — l'API du fournisseur reste joignable quand c'est notre propre
   * adresse publique qui est tombée.
   */
  restoreEmailService: () =>
    request<EmailConfigurationRestore>('/email-configuration/restore', { method: 'POST' }),

  /**
   * Suivi CIBLÉ du dernier test. Volontairement distinct de
   * `getEmailConfiguration` : suivre une livraison ne doit pas recharger
   * l'expéditeur, les clés ni l'état opérationnel des deux modes — c'est ce qui
   * faisait clignoter l'écran entier toutes les trois secondes.
   */
  getEmailTestStatus: () => request<EmailTestStatusView>('/email-configuration/test-status'),

  // Événements système (DEV) — lecture seule. Aucune route de création : un
  // événement est un fait, il ne se fabrique pas depuis une interface.
  listDomainEvents: (query = '') => request<DomainEventPage>(`/dev/domain-events${query}`),
  getDomainEvent: (eventId: string) => request<DomainEventView>(`/dev/domain-events/${eventId}`),
  /** Relance UNIQUEMENT les exécutions en échec. Un succès n'est jamais rejoué. */
  retryDomainEvent: (eventId: string) =>
    request<DomainEventView & { retried: number }>(`/dev/domain-events/${eventId}/retry`, { method: 'POST' }),

  // Contrats (DEV)
  listContracts: (archived = false) =>
    request<Contract[]>(`/contracts${archived ? '?archived=true' : ''}`),
  getContract: (id: string) => request<Contract>(`/contracts/${id}`),
  createContract: (name?: string) => request<Contract>('/contracts', { method: 'POST', body: name ? { name } : {} }),
  updateContractDraft: (
    id: string,
    /**
     * `recurrence` est la forme à envoyer. `interval` (l'UNITÉ seule) reste
     * accepté par le serveur, lu « tous les 1 » — il n'est plus émis d'ici.
     */
    data: { name?: string; launchFee?: { enabled: boolean; amountExcludingTax?: number }; subscription?: { enabled: boolean; amountExcludingTax?: number; recurrence?: Recurrence; interval?: 'MONTH' | 'YEAR' }; taxRate?: number; signatureRequirement?: 'REQUIRED' | 'NOT_REQUIRED' }
  ) => request<Contract>(`/contracts/${id}/draft`, { method: 'PUT', body: data }),
  /**
   * Politique de grâce en cas d'impayé. `null` retire la politique — l'impayé
   * reste suivi, mais aucune fermeture n'est programmée. Modifiable à tout
   * stade du contrat, y compris pendant un incident en cours.
   */
  updateContractPaymentGracePolicy: (id: string, paymentGraceDays: number | null) =>
    request<Contract>(`/contracts/${id}/payment-grace-policy`, {
      method: 'PUT',
      body: { paymentGraceDays },
    }),
  deleteContract: (id: string) => request<{ archived?: boolean; deleted?: boolean }>(`/contracts/${id}`, { method: 'DELETE' }),
  updateSignatureConfig: (id: string, zones: SignatureZone[]) =>
    request<Contract>(`/contracts/${id}/signature-configuration`, { method: 'PUT', body: { zones } }),
  validateContract: (id: string) => request<Contract>(`/contracts/${id}/validate`, { method: 'POST' }),
  startDevSignature: (id: string) =>
    request<{ contract: Contract; signatureLink: string | null }>(`/contracts/${id}/start-dev-signature`, { method: 'POST' }),
  cancelContract: (id: string) => request<Contract>(`/contracts/${id}/cancel`, { method: 'POST' }),
  /**
   * RÉSILIATION IMMÉDIATE — l'exception administrative, y compris en PROD.
   *
   * Route DISTINCTE de `cancelContract`, et c'est délibéré : fondre les deux
   * ferait dépendre l'effet d'un drapeau, et un drapeau finit toujours par être
   * envoyé par erreur. Deux verbes, deux intentions — « je résilie ce contrat »
   * et « je corrige un contrat qui n'aurait pas dû exister ».
   *
   * La permission DEV est revérifiée par le SERVICE : masquer le bouton ne
   * protège rien.
   */
  cancelContractImmediately: (id: string, reason?: string) =>
    request<{ contract: Contract; alreadyEnded: boolean; previousStatus: string | null }>(
      `/contracts/${id}/cancel-immediately`,
      { method: 'POST', body: { reason: reason ?? null } },
    ),
  reconcileContract: (id: string) =>
    request<{ result: SyncResult; contract: Contract }>(`/contracts/${id}/reconcile`, { method: 'POST' }),
  syncContract: (id: string) =>
    request<{ result: SyncResult; contract: Contract }>(`/contracts/${id}/sync`, { method: 'POST' }),
  restartSignature: (id: string) => request<Contract>(`/contracts/${id}/restart-signature`, { method: 'POST' }),
  /** Outils de recette — ENV=TEST uniquement (le backend refuse en PROD). */
  endContractNow: (id: string) => request<Contract>(`/contracts/${id}/test/end-now`, { method: 'POST' }),
  resetRecette: () =>
    request<{ contracts: number; payments: number; invoices: number }>('/contracts/test/reset-recette', {
      method: 'POST',
    }),
  getContractTimeline: (id: string) => request<TimelineEvent[]>(`/contracts/${id}/timeline`),
  getContractPayments: (id: string) => request<PaymentDetail[]>(`/contracts/${id}/payments`),
  syncContractPayment: (id: string) =>
    request<{ result: SyncResult; contract: Contract; payments: PaymentDetail[] }>(`/contracts/${id}/sync-payment`, { method: 'POST' }),
  syncContractSubscription: (id: string) =>
    request<{ result: SyncResult; contract: Contract }>(`/contracts/${id}/sync-subscription`, { method: 'POST' }),

  // Mon contrat (ADMIN)
  getMyContract: () => request<Contract | null>('/my-contract'),
  getMyTimeline: () => request<TimelineEvent[]>('/my-contract/timeline'),
  getMyActivation: () =>
    request<{ contract: Contract; activation: ActivationView }>('/my-contract/activation'),
  startAdminSignature: () => request<{ signatureLink: string | null }>('/my-contract/start-signature', { method: 'POST' }),
  createLaunchCheckout: () => request<{ url: string | null; reused: boolean; alreadyPaid: boolean }>('/my-contract/create-launch-checkout', { method: 'POST' }),
  getLaunchFeeStatus: () => request<LaunchFeeStatusView>('/my-contract/launch-fee-status'),
  getSubscriptionStatus: () => request<SubscriptionStatusView>('/my-contract/subscription-status'),
  // `alreadyPaid` : la session en cours était déjà complète chez Stripe. Le
  // serveur a réconcilié ; il n'y a rien à repayer et aucune URL à suivre.
  createSubscriptionCheckout: () => request<{ url: string | null; reused: boolean; alreadyPaid?: boolean }>('/my-contract/create-subscription-checkout', { method: 'POST' }),
  activateMyContract: () => request<Contract>('/my-contract/activate', { method: 'POST' }),
  /** Ce que l'ADMIN peut voir de son moyen de paiement — aucune donnée bancaire. */
  /**
   * Demande à Stripe où en est l'abonnement, et répare l'état local.
   *
   * Idempotent : ne crée jamais de souscription. C'est ce qui permet à la page
   * de retour de constater un paiement dont le webhook n'est pas encore arrivé,
   * au lieu de sonder indéfiniment un état local qui ne bougera pas.
   */
  reconcileSubscription: () =>
    request<SubscriptionReconciliation>('/my-contract/subscription/reconcile', { method: 'POST' }),
  getPaymentMethod: () => request<PaymentMethodView>('/my-contract/payment-method'),
  /**
   * Ouvre une session de portail client Stripe. La réponse ne contient que
   * l'URL : l'identifiant client Stripe ne sort jamais vers le navigateur.
   */
  openBillingPortal: () => request<{ url: string }>('/my-contract/billing-portal', { method: 'POST' }),
  cancelMyContract: () => request<Contract>('/my-contract/cancel', { method: 'POST' }),

  // Factures
  getMyInvoices: () => request<BillingGroup[]>('/my-invoices'),
  /**
   * LES PRESTATIONS A REGLER (L10.5) — lues dans la projection LOCALE.
   *
   * Aucun appel au Panel : cette page doit s'afficher meme quand le Panel est
   * indisponible. Ce que le client voit peut avoir quelques secondes de retard,
   * il ne doit jamais etre absent.
   */
  getMyPaymentRequests: () =>
    request<{ items: PaymentRequestView[] }>('/my-invoices/payment-requests'),
  /**
   * PAYER — le corps est VIDE, et c'est deliberé.
   *
   * L'identite vient du chemin, le montant du Panel. Il n'y a rien a falsifier
   * ici : aucun montant ne traverse cette requete.
   */
  payPaymentRequest: (paymentRequestId: string) =>
    request<{ url: string; creation: 'CREATED' | 'REUSED' }>(
      `/my-invoices/payment-requests/${paymentRequestId}/pay`,
      { method: 'POST' },
    ),
  /**
   * LES INCIDENTS DE PAIEMENT D'ABONNEMENT (L10.6B-3) — projection LOCALE.
   *
   * ══ UNE LECTURE QUI NE DÉCLENCHE RIEN ══════════════════════════════════
   *
   * Aucun appel au Panel, aucun appel à Stripe, aucune mutation. Un client
   * inquiet qui rafraîchit dix fois ne provoque aucune tentative de
   * prélèvement : Stripe est l'unique ordonnanceur, et cette route ne fait que
   * raconter ce qu'il a déjà fait.
   *
   * ══ ET AUCUN VERBE À CÔTÉ ══════════════════════════════════════════════
   *
   * Il n'existe volontairement pas de `retryPayment()`. Appeler
   * `invoices/{id}/pay` entrerait en course avec la tentative que Stripe a déjà
   * programmée sur la même facture — c'est-à-dire créerait le double débit. Le
   * client qui veut régler tout de suite ouvre `hostedInvoiceUrl`, la page de
   * paiement que Stripe a émise pour CETTE facture.
   */
  getMySubscriptionIncidents: () =>
    request<SubscriptionIncidentsView>('/my-invoices/subscription-incidents'),
  getAllInvoices: () => request<BillingGroup[]>('/invoices'),
  getInvoice: (id: string) => request<InvoiceView>(`/invoices/${id}`),
  /**
   * DEV — rattache une facture Stripe EXISTANTE depuis son lien/identifiant.
   * Ne crée rien chez Stripe : la facture est lue puis reflétée.
   */
  attachInvoice: (body: { url: string; label?: string }) =>
    request<{ invoice: InvoiceView; created: boolean; reference: string }>('/invoices/attach', {
      method: 'POST',
      body,
    }),
  syncContractInvoices: (id: string) =>
    request<{ result: { count: number; upserted: number }; invoices: InvoiceView[] }>(`/contracts/${id}/sync-invoices`, { method: 'POST' }),

  // Accounts
  /**
   * LA VUE CANONIQUE, pas le document. Voir `ProjectAccountView` : l'écrire
   * `User[]` a coûté trois défauts d'un coup sur l'écran des comptes.
   */
  listAccounts: () => request<ProjectAccountView[]>('/accounts'),
  createAccount: (data: { email: string; password: string; name?: string; role: string }) =>
    request<User>('/accounts', { method: 'POST', body: data }),
  updateAccount: (id: string, data: Partial<User> & { password?: string }) =>
    request<User>(`/accounts/${id}`, { method: 'PUT', body: data }),
  deleteAccount: (id: string) => request<null>(`/accounts/${id}`, { method: 'DELETE' }),

  // Moteur de déploiement industriel (DEV uniquement)
  deployment: {
    // Version courante du projet (SHA git).
    getVersion: () => request<{ version: string }>('/deployment/version'),

    // Sessions VPS — le mot de passe transite ici (HTTPS) puis n'existe qu'en RAM
    // serveur, jamais persisté. On ne reçoit qu'un sessionId opaque.
    /**
     * OUVRE UNE SESSION SERVEUR — et le serveur PROUVE la connexion.
     *
     * Le paramètre `keep` a disparu : la durée de vie d'un secret en RAM
     * n'est pas une décision d'utilisateur. Le backend applique une durée
     * unique, repoussée à chaque usage.
     */
    openVpsSession: (host: string, username: string, password: string) =>
      request<VpsSession>('/deployment/vps-session', {
        method: 'POST',
        body: { host, username, password },
      }),
    closeVpsSession: (sessionId: string) =>
      request<{ closed: boolean }>(`/deployment/vps-session/${sessionId}`, { method: 'DELETE' }),

    // Cibles de déploiement.
    listTargets: () => request<DeploymentTarget[]>('/deployment/targets'),
    /**
     * L'ENVIRONNEMENT est EXIGÉ à la création, et n'a pas de valeur par défaut.
     *
     * Il appartient à la destination, pas au geste de déploiement : c'est lui
     * qui décide de la base, de l'isolation des médias et de l'unicité de la
     * destination active. Il devient IMMUABLE une fois la fiche créée.
     */
    createTarget: (body: {
      name: string; url: string; environment: 'TEST' | 'PROD';
      dbName?: string; remoteRoot?: string; sshHost?: string; sshUser?: string;
    }) => request<DeploymentTarget>('/deployment/targets', { method: 'POST', body }),

    /**
     * INVENTAIRE RÉEL du serveur — avant toute confirmation de retrait.
     *
     * On ne fait pas confirmer une destruction sans montrer ce qui sera
     * détruit : sinon l'opérateur ne confirme pas un retrait, il valide une
     * phrase.
     */
    inspectTarget: (id: string, sessionId: string) =>
      request<DestinationInspection>(`/deployment/targets/${id}/inspect`, {
        method: 'POST', body: { sessionId },
      }),

    /**
     * SUPPRESSION — en POST, avec le nom d'hôte saisi.
     *
     * Un `DELETE` sans corps ne peut pas porter de confirmation, et c'est
     * précisément l'absence de confirmation qui a permis de supprimer la fiche
     * d'une destination encore en ligne.
     */
    deleteTarget: (id: string, confirmHostname: string) =>
      request<{ deleted: boolean; lifecycleStatus: string }>(
        `/deployment/targets/${id}/delete`, { method: 'POST', body: { confirmHostname } },
      ),
    listBackups: (id: string, sessionId: string) =>
      request<{ archives: string[] }>(`/deployment/targets/${id}/backups?sessionId=${encodeURIComponent(sessionId)}`),

    // Préflight (bloquant) sur une cible via une session VPS.
    preflight: (targetId: string, sessionId: string, remoteRoot?: string) =>
      request<PreflightResult>('/deployment/preflight', {
        method: 'POST',
        body: { targetId, sessionId, ...(remoteRoot ? { remoteRoot } : {}) },
      }),

    /**
     * `deploy()` A ÉTÉ SUPPRIMÉ — il n'y a plus qu'un déploiement, et il est en
     * direct.
     *
     * Il appelait `POST /deployment/deploy`, la route héritée qui contournait le
     * run durable, la barrière de publication et le verrou de destination. Aucun
     * écran ne s'en servait : `streamDeploy` est le parcours réel depuis
     * plusieurs lots. Garder le wrapper aurait suffi à faire revivre la route au
     * premier appel « juste pour tester ».
     */

    // Déploiement EN DIRECT (flux NDJSON d'évènements d'étapes).
    streamDeploy: (
      body: { targetId: string; sessionId: string; email?: string; env?: 'TEST' | 'PROD'; skipBuild?: boolean },
      signal?: AbortSignal
    ) => streamNdjson<DeployStreamEvent>('/deployment/deploy/stream', body, signal),

    // Préflight EN DIRECT (PRECHECK) — mêmes évènements/rapport qu'un déploiement.
    streamPreflight: (body: { targetId: string; sessionId: string }, signal?: AbortSignal) =>
      streamNdjson<DeployStreamEvent>('/deployment/preflight/stream', body, signal),

    /**
     * LE CONTRAT D'ÉTAPES DE DÉPLOIEMENT — demandé, jamais recopié.
     *
     * L'interface en tenait trois copies, dont deux se contredisaient sur les
     * libellés. La définition vit désormais dans le registre du moteur, et
     * cette route en est la seule porte d'entrée.
     */
    phases: () => request<DeploymentStepContract[]>('/deployment/phases'),

    /**
     * LE CONTRAT DE PHASES — demandé, jamais recopié.
     *
     * L'écran en tenait sa propre liste, avec les sous-projets Node en dur.
     * Elle a dérivé : des lignes attendaient un événement qui n'arrivait plus.
     * La définition vit désormais dans le registre backend, et cette route en
     * est la seule porte d'entrée côté Manager.
     */
    duplicationPhases: () => request<DuplicationPhaseContract[]>('/deployment/duplication/phases'),

    // Duplication du projet courant.
    duplicate: (body: {
      projectName: string;
      folderName?: string;
      dbTest: string;
      dbProd: string;
      devEmail: string;
      devName?: string;
      adminEmail: string;
      adminPassword: string;
      adminPasswordConfirmation: string;
      githubRepositoryUrl: string;
    }) => request<DuplicationResult>('/deployment/duplicate', { method: 'POST', body }),

    // Duplication EN DIRECT (flux NDJSON de phases nommées).
    streamDuplicate: (
      body: {
        projectName: string;
        folderName?: string;
        dbTest: string;
        dbProd: string;
        devEmail: string;
        devName?: string;
        adminEmail: string;
        adminPassword: string;
        adminPasswordConfirmation: string;
        githubRepositoryUrl: string;
      },
      signal?: AbortSignal
    ) => streamNdjson<DuplicateStreamEvent>('/deployment/duplicate/stream', body, signal),

    /**
     * La gestion DNS automatique est-elle utilisable POUR CET HÔTE ? (L9.2)
     *
     * Remplace `hostingerStatus()`, qui rendait l'état du credential LOCAL du
     * projet — devenu sans rapport avec la question. Le nom ne cite plus de
     * fournisseur : c'est la plateforme qui décide lequel administre le domaine.
     */
    dnsStatus: (hostname?: string) =>
      request<{
        authority: 'PANEL';
        code: string;
        available: boolean;
        message: string;
        zone: string | null;
        zoneSource: string | null;
        wildcard: boolean | null;
        checkedAt: string;
      }>(`/deployment/dns-status${hostname ? `?hostname=${encodeURIComponent(hostname)}` : ''}`),

    // Historique / rapports d'exécution (persistés).
    listRuns: (targetId?: string) =>
      request<DeploymentRunSummary[]>(`/deployment/runs${targetId ? `?targetId=${encodeURIComponent(targetId)}` : ''}`),
    getRun: (id: string) => request<DeploymentRunFull>(`/deployment/runs/${id}`),

    /* ── LA REPRISE DU SUIVI ────────────────────────────────────────────────
     *
     * Un déploiement appartient au backend. L'écran n'en est qu'un
     * observateur, et il peut disparaître puis revenir sans que le travail
     * s'en aperçoive.
     */
    /**
     * Y a-t-il un déploiement en cours ? Et quel est le dernier résultat ?
     *
     * Les deux réponses sont distinctes : un run `error` d'hier n'est pas un
     * déploiement à reprendre. Voir `active` / `latest`.
     */
    activeRun: (params?: { targetId?: string; operationType?: string }) => {
      const q = new URLSearchParams();
      if (params?.targetId) q.set('targetId', params.targetId);
      if (params?.operationType) q.set('operationType', params.operationType);
      const suffixe = q.toString() ? `?${q}` : '';
      return request<DeploymentActiveRun>(`/deployment/runs/active${suffixe}`);
    },
    /**
     * OBSERVE un run existant — instantané complet, puis progression.
     *
     * `GET`, donc incapable de démarrer quoi que ce soit : c'est ce qui rend
     * impossible le second déploiement au retour sur l'écran.
     */
    observeRun: (runId: string, signal?: AbortSignal) =>
      observeNdjson<DeploymentObserveEvent>(`/deployment/runs/${runId}/observe`, signal),

    // Backup / restauration d'une cible.
    backup: (targetId: string, sessionId: string) =>
      request<{ archive: string; dbName: string | null; version: string | null }>('/deployment/backup', {
        method: 'POST',
        body: { targetId, sessionId },
      }),
    restore: (targetId: string, sessionId: string, archive: string) =>
      request<{ restored: boolean; archive: string }>('/deployment/restore', {
        method: 'POST',
        body: { targetId, sessionId, archive },
      }),
  },

  // Version du backend (manifeste de build ou repli Git). Public, non sensible.
  getVersion: () => request<VersionInfo>('/version', { auth: false }),

  // Plan de contrôle des déploiements (P2, DEV) — destinations durables.
  controlPlane: {
    listTargets: () => request<ControlTarget[]>('/admin/deployments/targets'),
    getTarget: (id: string) => request<{ target: ControlTarget; activeRelease: ControlRelease | null; releases: ControlRelease[] }>(`/admin/deployments/targets/${id}`),
    listReleases: (id: string) => request<ControlRelease[]>(`/admin/deployments/targets/${id}/releases`),
    checkHealth: (id: string) => request<{ healthStatus: string; checks: Record<string, { url: string; code: number; ok: boolean }> }>(`/admin/deployments/targets/${id}/check-health`, { method: 'POST' }),
  },

  // Templates e-mail (DEV) — LECTURE SEULE (L12.1)
  //
  // `updateEmailTemplate`, `listEmailTemplateVersions`, `getEmailTemplateVersion`
  // et `restoreEmailTemplateVersion` ont été SUPPRIMÉS avec les routes qu'ils
  // appelaient. Le contenu des e-mails appartient au Panel : ce projet le
  // consulte, il ne l'écrit pas. Leur absence est la propriété principale de ce
  // lot, et elle se vérifie ici en une lecture — aucun verbe d'écriture ne
  // subsiste sur `/dev/email-templates`.
  listEmailTemplates: () => request<EmailTemplateSummary[]>('/dev/email-templates'),
  /** Ce que CE projet déclare consommer — à confronter à ce que le Panel sert. */
  listEmailTemplateUsage: () => request<EmailTemplateUsageEntry[]>('/dev/email-templates/usage'),
  getEmailTemplate: (templateId: string) =>
    request<EmailTemplateDetail>(`/dev/email-templates/${templateId}`),
  /**
   * N'envoie AUCUN e-mail. Rend ce que le PANEL a résolu, avec SES variables
   * d'exemple : aucun brouillon ne peut être passé — il n'y a plus de brouillon.
   */
  previewEmailTemplate: (templateId: string) =>
    request<EmailTemplatePreview>(`/dev/email-templates/${templateId}/preview`, {
      method: 'POST',
      body: {},
    }),
  /** Envoie POUR DE VRAI, exécuté par le Panel avec l'autorité du Panel. */
  testSendEmailTemplate: (templateId: string, recipientEmail: string) =>
    request<EmailTemplateTestResult>(`/dev/email-templates/${templateId}/test-send`, {
      method: 'POST',
      body: { recipientEmail },
    }),
  emailTemplateReadiness: (templateId: string) =>
    request<EmailReadiness>(`/dev/email-templates/${templateId}/readiness`),
  listEmailDeliveries: (templateId: string) =>
    request<EmailDeliveryView[]>(`/dev/email-templates/${templateId}/deliveries`),

  // Suivi réel des livraisons (DEV) — lecture seule, jamais de renvoi ici.
  listEmailDeliveriesAll: (query = '') => request<EmailDeliveryPage>(`/dev/email-deliveries${query}`),
  getEmailDelivery: (deliveryId: string) =>
    request<EmailDeliveryDetail>(`/dev/email-deliveries/${deliveryId}`),
  getEmailDeliveryEvents: (deliveryId: string) =>
    request<EmailDeliveryTimelineEvent[]>(`/dev/email-deliveries/${deliveryId}/events`),
  listBrevoWebhookEvents: (query = '') =>
    request<BrevoWebhookEventPage>(`/dev/brevo-webhook-events${query}`),
  getBrevoWebhookEvent: (webhookEventId: string) =>
    request<BrevoWebhookEventView>(`/dev/brevo-webhook-events/${webhookEventId}`),

  // Configuration du webhook Brevo (DEV). `mode` = 'test' | 'prod'.
  getBrevoWebhookConfig: (mode: string) =>
    request<BrevoWebhookState>(`/dev/brevo-webhook-config/${mode}`),
  syncBrevoWebhook: (mode: string) =>
    request<BrevoWebhookActionResult>(`/dev/brevo-webhook-config/${mode}/sync`, { method: 'POST' }),
  diagnoseBrevoWebhook: (mode: string) =>
    request<BrevoWebhookActionResult>(`/dev/brevo-webhook-config/${mode}/diagnose`, { method: 'POST' }),
  rotateBrevoWebhookSecret: (mode: string) =>
    request<BrevoWebhookActionResult>(`/dev/brevo-webhook-config/${mode}/rotate-secret`, { method: 'POST' }),
  disableBrevoWebhook: (mode: string) =>
    request<BrevoWebhookActionResult>(`/dev/brevo-webhook-config/${mode}/disable`, { method: 'POST' }),

  // Webhooks gérés — vue GÉNÉRIQUE multi-providers (DEV). Le Manager ne
  // connaît aucun fournisseur : il affiche ce que le registre décrit.
  getManagedWebhooks: (mode: ProviderMode) =>
    request<ManagedWebhooksPayload>(`/dev/managed-webhooks/${mode}`),
  syncProviderWebhooks: (provider: string, mode: ProviderMode) =>
    request<ProviderWebhooksActionReport>(`/dev/managed-webhooks/${provider}/${mode}/sync`, { method: 'POST' }),
  repairProviderWebhooks: (provider: string, mode: ProviderMode) =>
    request<ProviderWebhooksActionReport>(`/dev/managed-webhooks/${provider}/${mode}/repair`, { method: 'POST' }),
  probeProviderWebhooks: (provider: string, mode: ProviderMode) =>
    request<ProviderWebhooksActionReport>(`/dev/managed-webhooks/${provider}/${mode}/health`, { method: 'POST' }),
  testProviderWebhooks: (provider: string, mode: ProviderMode) =>
    request<ProviderWebhooksActionReport>(`/dev/managed-webhooks/${provider}/${mode}/test`, { method: 'POST' }),

  /** Diagnostic e-mail complet (DEV) — un clic. `live` envoie un vrai test. */

  // Demandes de contact (ADMIN + DEV)
  //
  // Ni création ni suppression : une demande est un fait déposé par un visiteur.
  /** Destinataires des notifications de nouvelle demande (champ métier, ADMIN). */
  getContactNotificationRecipients: () =>
    request<{ recipients: string[] }>('/company/contact-notification-recipients'),
  updateContactNotificationRecipients: (recipients: string[]) =>
    request<{ recipients: string[] }>('/company/contact-notification-recipients', {
      method: 'PUT',
      body: { recipients },
    }),

  listContactSubmissions: (query = '') => request<ContactSubmissionPage>(`/admin/contact-submissions${query}`),
  /** Marque la PREMIÈRE lecture côté serveur (écriture conditionnelle, idempotente). */
  getContactSubmission: (submissionId: string) =>
    request<ContactSubmissionDetail>(`/admin/contact-submissions/${submissionId}`),
  /** Cycle de vie SIMPLE — actions serveur dédiées, idempotentes. */
  markContactRead: (submissionId: string) =>
    request<ContactSubmissionSummary>(`/admin/contact-submissions/${submissionId}/read`, { method: 'PATCH' }),
  resolveContact: (submissionId: string) =>
    request<ContactSubmissionSummary>(`/admin/contact-submissions/${submissionId}/resolve`, { method: 'PATCH' }),
  reopenContact: (submissionId: string) =>
    request<ContactSubmissionSummary>(`/admin/contact-submissions/${submissionId}/reopen`, { method: 'PATCH' }),
  /** Badge sidebar — léger, ne charge pas la liste. */
  getContactUnreadCount: () =>
    request<{ count: number }>('/admin/contact-submissions/unread-count'),

  /** Diagnostics DEV : décisions récentes (ACCEPTED/DUPLICATE/REJECTED_AS_SPAM). */
  getContactDiagnostics: () => request<ContactDiagnostics>('/dev/contact-diagnostics'),

  /* ------------------------- Connexion au Panel (DEV) ----------------------- */
  // Surface existante `/api/panel-connection` : rien n'est ajouté côté serveur.
  // `publicBackendUrl` n'est volontairement PAS transmis — le backend le tient
  // de sa propre configuration, et l'opérateur n'a pas à le connaître.
  getPanelConnection: () => request<PanelConnectionStatus>('/panel-connection/status'),
  /**
   * L'ENTREPRISE DU PANEL SEULE — lisible par tout compte connecté.
   *
   * `/status` est réservée aux comptes DEV : elle expose l'URL du Panel,
   * l'appairage et l'inventaire des API. La page « Aide » n'a besoin d'aucune
   * de ces choses — seulement des coordonnées de l'agence. Elle les demandait
   * pourtant à `/status`, et un client y récoltait un 403 présenté comme
   * « aucun Panel ».
   */
  getPanelCompany: () =>
    request<{ company: PanelCompanyConfiguration | null; paired: boolean }>('/panel-connection/company'),

  /**
   * MON ENTREPRISE — l'identité JURIDIQUE de ce client, en LECTURE SEULE.
   *
   * Il n'existe volontairement AUCUN verbe d'écriture en face : ce que cette
   * route rend figure sur les factures et les contrats du client, et son
   * autorité est la fiche « Clients » du Panel.
   */
  getMyCompany: () => request<MyCompanyView>('/my-company'),

  pairWithPanel: (body: { panelUrl: string; pairingCode: string }) =>
    request<PanelPairResult>('/panel-connection/pair', { method: 'POST', body }),

  unpairFromPanel: () =>
    request<{ unpaired: boolean }>('/panel-connection/unpair', { method: 'POST' }),

  syncPanelNow: () =>
    request<{ heartbeat: unknown; sync: unknown }>('/panel-connection/sync-now', { method: 'POST' }),
};

export type Api = typeof api;
