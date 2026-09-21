/**
 * TRANSPORT du PanelBridge — l'interface que TOUT client de Panel doit
 * honorer, et son implémentation HTTP réelle.
 *
 * Même patron que le reste du projet (les pilotes fournisseur et leurs
 * SshTransport/FakeTransport) : la façade PanelBridge ne connaît que cette
 * interface ; on lui injecte soit `HttpPanelClient` (vrai réseau, spec
 * docs/panelXvitrine/spec/PanelBridge.openapi.yaml), soit le stub en mémoire
 * (`panelStub.js`) pour les tests.
 *
 * SEUL fichier du projet autorisé à parler HTTP au Panel — le test de
 * conformité `bridge-conformity.test.js` verrouille cette exclusivité.
 */
import {
  CONTRACT_VERSION,
  CONTRACT_VERSION_HEADER,
  PANEL_API_ROUTES,
} from './bridgeContract.js';
import {
  bridgeError,
  BridgeError,
  BRIDGE_ERROR_CODES,
  BRIDGE_LOCAL_ERROR_CODES,
} from './bridgeErrors.js';

/**
 * L'INTERFACE PanelClient. Toute implémentation (HTTP réelle, stub, futur
 * transport) doit exposer exactement ces méthodes asynchrones :
 *
 *   ping()                    -> { status, service, time }
 *   bootstrap(request)        -> { projectId, bridgeToken, panel }
 *   unpair()                  -> { unpaired: true }            (idempotent)
 *   heartbeat(heartbeat)      -> { acknowledged, panelTime }
 *   pushChanges({ changes })  -> { results: SyncAck[] }        (idempotent)
 *   pullChanges({ cursor, limit }) -> { changes, cursor, hasMore }
 *
 * Les DTO sont ceux de bridgeContract.js. Une implémentation ne fait AUCUNE
 * logique de pont (états, outbox, anti-écho) : uniquement le transport.
 */
export const PANEL_CLIENT_METHODS = Object.freeze([
  'ping',
  'bootstrap',
  'unpair',
  'heartbeat',
  'pushChanges',
  'pullChanges',
  // Contrat 1.5.0 — le projet DEMANDE une intention métier, il n'appelle
  // aucun fournisseur et ne détient aucune clé.
  'invokeCapability',
  // L6.3A — le secret de VÉRIFICATION du projet, par un canal qui ne
  // transporte que cela. Il ne permet aucun appel sortant.
  'fetchWebhookVerificationSecret',
  // L12.B — « ce développeur a-t-il ENCORE le droit d'être chez moi ? ».
  // Une lecture, et la seule façon de révoquer une session fédérée sans
  // toucher à la base du projet.
  'introspectFederatedPrincipal',
  // 1.11.0 — LA PROJECTION DES MODÈLES, en lecture seule. Elle remplace la
  // base locale de modèles : le Manager consulte désormais ce que le Panel
  // servirait à l'envoi, au lieu d'éditer une copie que rien n'expédiait.
  'listEmailTemplates',
  'getEmailTemplate',
  'previewEmailTemplate',
  'emailTemplateReadiness',
  'sendEmailTemplateTest',
]);

/**
 * Préfixe des refus de la PASSERELLE DE CAPACITÉS.
 *
 * Ils ne font pas partie du catalogue BRIDGE_* : ils décrivent une décision
 * prise sur une invocation (droit, ouverture commerciale, entrée, fournisseur)
 * et non un état du pont. Le client les préserve tels quels — les aplatir en
 * `BRIDGE_INTERNAL` ferait perdre la seule information exploitable : POURQUOI
 * l'appel a été refusé, et s'il est sûr de le rejouer.
 */
export const CAPABILITY_ERROR_PREFIX = 'CAPABILITY_';

/** Garde structurelle : l'objet honore-t-il l'interface PanelClient ? */
export function isPanelClient(candidate) {
  return (
    candidate != null &&
    PANEL_CLIENT_METHODS.every((m) => typeof candidate[m] === 'function')
  );
}

/**
 * COMBIEN DE TEMPS ON LAISSE AU PANEL POUR EXÉCUTER UNE CAPACITÉ.
 *
 * ══ LE DÉFAUT QUE CETTE CONSTANTE FERME ═════════════════════════════════════
 *
 * Toutes les requêtes du pont partageaient le même budget de 10 s. C'est le
 * bon ordre de grandeur pour un aller-retour de pont — un battement, une
 * synchronisation, un ping : le Panel répond de sa propre base.
 *
 * Une CAPACITÉ n'est pas cela. Le Panel y appelle un tiers pour nous, et
 * attend SA réponse avant de nous répondre : `dns.zone.resolve` interroge
 * l'API d'un registrar, `email.sender.verify` celle d'un routeur d'e-mails.
 * Le budget couvrait donc deux aller-retours réseau et un appel tiers avec le
 * temps d'UN aller-retour.
 *
 * Constaté en préflight : l'étape `dns.zone` échouait à 10,007 s — le budget
 * à la milliseconde près — sur un Panel qui répondait au ping en 37 ms. Le
 * déploiement était bloqué par une horloge, pas par une panne.
 *
 * ══ POURQUOI ATTENDRE EST PLUS SÛR QU'ABANDONNER ════════════════════════════
 *
 * Couper une invocation en vol ne l'annule pas : le Panel poursuit, et peut
 * écrire. L'issue devient INDÉTERMINÉE — c'est exactement le cas que
 * `capabilityDnsProvider` refuse de rejouer. Un budget trop court ne protège
 * donc de rien : il fabrique l'état qu'on redoute.
 */
export const CAPABILITY_TIMEOUT_MS = 45_000;

/**
 * Client HTTP réel — minimal et sans état, conforme à la spec. C'est le
 * client PAR DÉFAUT de l'application (bridgeRuntime.js) — le stub ne sert
 * qu'aux tests. Il fige le transport (headers, enveloppes,
 * mapping d'erreurs) pour la Phase 2.
 */
export class HttpPanelClient {
  /**
   * @param {object} opts
   * @param {string}   opts.baseUrl       URL du Panel (connue du SEUL pont).
   * @param {Function} opts.tokenProvider () => bridgeToken courant (ou null avant appairage).
   * @param {number}   [opts.timeoutMs]   Timeout par requête (jamais bloquant au boot).
   * @param {number}   [opts.capabilityTimeoutMs] Budget des invocations de capacité.
   * @param {Function} [opts.fetchImpl]   Injectable pour les tests.
   */
  constructor({
    baseUrl,
    tokenProvider,
    timeoutMs = 10_000,
    capabilityTimeoutMs = CAPABILITY_TIMEOUT_MS,
    fetchImpl = fetch,
  }) {
    if (!baseUrl) throw new Error('HttpPanelClient : baseUrl requis.');
    this.baseUrl = String(baseUrl).replace(/\/$/, '');
    this.tokenProvider = tokenProvider || (() => null);
    this.timeoutMs = timeoutMs;
    this.capabilityTimeoutMs = capabilityTimeoutMs;
    this.fetchImpl = fetchImpl;
    /**
     * LA VERSION QUE LE PANEL ANNONCE — apprise, jamais supposée (1.9.0).
     *
     * `null` tant qu'aucune réponse n'a été reçue. Cette valeur ne sert QU'À
     * décider si un champ additif peut être émis sans risque de refus ; elle
     * ne gouverne aucune logique métier et n'est jamais persistée.
     */
    this.panelContractVersion = null;
  }

  async ping() {
    return this.#request('GET', PANEL_API_ROUTES.ping, { auth: false });
  }

  async bootstrap(request) {
    return this.#request('POST', PANEL_API_ROUTES.bootstrap, { body: request, auth: false });
  }

  async unpair() {
    return this.#request('DELETE', PANEL_API_ROUTES.unpair, {});
  }

  async heartbeat(heartbeat) {
    return this.#request('POST', PANEL_API_ROUTES.heartbeat, { body: heartbeat });
  }

  async pushChanges({ changes }) {
    return this.#request('POST', PANEL_API_ROUTES.syncPush, { body: { changes } });
  }

  async pullChanges({ cursor, limit } = {}) {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    if (limit) params.set('limit', String(limit));
    const qs = params.toString();
    return this.#request('GET', `${PANEL_API_ROUTES.syncPull}${qs ? `?${qs}` : ''}`, {});
  }

  /**
   * `POST /bridge/v1/capabilities/{code}/invoke` — demander une INTENTION.
   *
   * ── CE QUE CETTE MÉTHODE N'ENVOIE PAS ─────────────────────────────────────
   *
   * Ni fournisseur, ni environnement, ni clé, ni projectId : le Panel les
   * déduit du bridgeToken et de l'instance qui répond. Le projet n'a d'ailleurs
   * pas les moyens de les fournir — c'est tout l'objet du plan de contrôle.
   *
   * `input` est l'entrée MÉTIER de la capacité, validée en mode strict côté
   * Panel : une clé inconnue fait échouer l'appel plutôt que d'être ignorée.
   *
   * @param {string} code   par exemple `email.sender.verify`
   * @param {object} input  entrée métier, dont `operationId` (clé d'idempotence)
   */
  async invokeCapability(code, input = {}) {
    const path = PANEL_API_ROUTES.capabilityInvoke.replace('{code}', encodeURIComponent(String(code)));
    return this.#request('POST', path, {
      body: input,
      preserveCapabilityCodes: true,
      // Le Panel appelle un tiers pour nous : ce n'est pas un aller-retour de
      // pont, et cela ne se mesure pas avec la même horloge.
      timeoutMs: this.capabilityTimeoutMs,
    });
  }

  /**
   * Récupère le secret de VÉRIFICATION de ce projet (L6.3A).
   *
   * Il ne permet aucun appel sortant : il sert uniquement à constater qu'un
   * webhook reçu vient bien du fournisseur. C'est pour cette raison, et pour
   * elle seule, qu'il peut descendre jusqu'ici — une clé d'API ne le fera
   * jamais.
   *
   * La valeur n'est ni journalisée ni conservée par ce client : elle est rendue
   * à l'appelant, qui la range immédiatement dans le coffre chiffré.
   */
  async fetchWebhookVerificationSecret(provider) {
    const path = PANEL_API_ROUTES.webhookVerificationSecret
      .replace('{provider}', encodeURIComponent(String(provider)));
    return this.#request('GET', path, {});
  }

  /* ---------------------------------------------------- modèles d'e-mail --- */
  /*
   * QUATRE VERBES, TOUS EN LECTURE (1.11.0).
   *
   * Ils remplacent la base locale de modèles que ce projet tenait : elle
   * donnait au Manager de quoi éditer un contenu que le Panel n'expédiait pas.
   * Aucun d'eux n'écrit, et aucun n'accepte de contenu — c'est ce qui garantit
   * qu'aucun chemin ne peut recréer une seconde autorité.
   */

  async listEmailTemplates() {
    return this.#request('GET', PANEL_API_ROUTES.emailTemplates, {});
  }

  async getEmailTemplate(templateCode) {
    const path = PANEL_API_ROUTES.emailTemplate.replace('{code}', encodeURIComponent(String(templateCode)));
    return this.#request('GET', path, {});
  }

  async previewEmailTemplate(templateCode) {
    const path = PANEL_API_ROUTES.emailTemplatePreview
      .replace('{code}', encodeURIComponent(String(templateCode)));
    // Corps VIDE, et c'est le contrat : l'aperçu rend ce que le Panel a résolu,
    // avec SES variables d'exemple. Un corps rouvrirait une porte d'écriture.
    return this.#request('POST', path, { body: {} });
  }

  async emailTemplateReadiness(templateCode) {
    const path = PANEL_API_ROUTES.emailTemplateReadiness
      .replace('{code}', encodeURIComponent(String(templateCode)));
    return this.#request('GET', path, {});
  }

  async sendEmailTemplateTest(templateCode, recipientEmail) {
    const path = PANEL_API_ROUTES.emailTemplateTestSend
      .replace('{code}', encodeURIComponent(String(templateCode)));
    return this.#request('POST', path, { body: { recipientEmail } });
  }

  /**
   * `POST /bridge/v1/federation/introspect` — l'identité vaut-elle ENCORE ?
   *
   * En POST bien qu'il s'agisse d'une lecture : la requête porte un
   * identifiant d'utilisateur et une version de session, qui n'ont rien à
   * faire dans les journaux d'accès des intermédiaires.
   *
   * Aucun `projectId` n'est envoyé : le Panel le déduit du jeton de pont.
   */
  async introspectFederatedPrincipal({ panelUserId, tokenVersion = null } = {}) {
    return this.#request('POST', PANEL_API_ROUTES.federationIntrospect, {
      body: { panelUserId, ...(tokenVersion === null ? {} : { tokenVersion }) },
    });
  }

  /**
   * Requête + dépliage d'enveloppe. Erreur contractuelle (body.code BRIDGE_*)
   * -> BridgeError du catalogue ; panne réseau/timeout -> code LOCAL
   * PANEL_UNREACHABLE (jamais confondu avec un refus du Panel).
   */
  async #request(
    method,
    path,
    { body, auth = true, preserveCapabilityCodes = false, timeoutMs = this.timeoutMs } = {},
  ) {
    const headers = {
      [CONTRACT_VERSION_HEADER]: CONTRACT_VERSION,
      accept: 'application/json',
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (auth) {
      const token = this.tokenProvider();
      if (token) headers.authorization = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (cause) {
      /**
       * UN DÉLAI DÉPASSÉ N'EST PAS UNE INJOIGNABILITÉ — et le rapport le disait.
       *
       * Les deux arrivaient ici sous le même libellé. Un préflight coupé au
       * bout du budget annonçait donc « Panel injoignable », ce qui envoie
       * chercher un domaine mal configuré ou un réseau coupé — quand le Panel
       * répondait parfaitement, seulement plus lentement que l'horloge.
       *
       * Le CODE ne change pas : `PANEL_UNREACHABLE` est lu par les diagnostics
       * de DNS, de signature et de Stripe, et il décrit bien ce que le projet
       * constate — aucune réponse. Seule la phrase apprend à distinguer,
       * puisque c'est elle qu'un humain lit dans le rapport.
       */
      const delaiDepasse = cause?.name === 'AbortError' || cause?.name === 'TimeoutError';
      throw bridgeError(
        BRIDGE_LOCAL_ERROR_CODES.PANEL_UNREACHABLE,
        delaiDepasse
          ? `Le Panel n’a pas répondu dans le délai imparti de ${Math.round(timeoutMs / 1000)} s `
            + `(${method} ${path}).`
          : `Panel injoignable (${method} ${path}).`,
        { cause: cause?.message }
      );
    } finally {
      clearTimeout(timer);
    }

    /**
     * ══ CE QUE LE PANEL DIT PARLER — retenu, pas seulement reçu (1.9.0) ═════
     *
     * Le Panel pose sa version de contrat sur CHAQUE réponse. On la jetait.
     *
     * Elle est pourtant la seule information qui permette d'émettre un champ
     * ADDITIF sans risque : les schémas des deux côtés sont `.strict()`, et la
     * compatibilité n'est vérifiée que sur la MAJEURE. Un projet en 1.9 qui
     * enverrait `runtime.network` à un Panel en 1.8 passerait donc la garde de
     * version, puis verrait son battement REFUSÉ en bloc pour un champ inconnu
     * — un projet parfaitement sain rendu muet par une extension censée être
     * rétrocompatible.
     *
     * On la mémorise ici, au seul endroit que TOUTES les requêtes traversent.
     */
    const annoncee = res.headers?.get?.(CONTRACT_VERSION_HEADER);
    if (typeof annoncee === 'string' && /^\d+\.\d+\.\d+$/.test(annoncee.trim())) {
      this.panelContractVersion = annoncee.trim();
    }

    let parsed = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }

    if (!res.ok) {
      const received = typeof parsed?.code === 'string' ? parsed.code : '';
      const contractual = received.startsWith('BRIDGE_')
        || (preserveCapabilityCodes && received.startsWith(CAPABILITY_ERROR_PREFIX));
      const code = contractual ? received : BRIDGE_ERROR_CODES.INTERNAL;
      throw new BridgeError(code, parsed?.message || `Réponse ${res.status} du Panel.`, {
        httpStatus: res.status,
        // Le détail vient du Panel et ne porte JAMAIS de secret (contrat
        // 1.5.0) : chemins d'entrée fautifs, nature d'effet, motif. On le
        // transporte tel quel — c'est ce qui rend un refus diagnosticable
        // depuis le projet sans ouvrir le journal du Panel.
        ...(contractual && parsed?.details ? { panelDetails: parsed.details } : {}),
      });
    }
    if (!parsed || parsed.success !== true) {
      throw bridgeError(BRIDGE_ERROR_CODES.INVALID_PAYLOAD, 'Enveloppe de réponse invalide du Panel.');
    }
    return parsed.data;
  }
}
