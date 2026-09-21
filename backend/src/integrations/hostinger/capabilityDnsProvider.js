/**
 * DnsProvider SANS AUCUN CREDENTIAL LOCAL — le DNS passe par le Panel (L9).
 *
 * ══ CE QUI CHANGE, ET CE QUI NE CHANGE PAS ══════════════════════════════════
 *
 *   AVANT   moteur → HostingerDnsProvider → clé locale → API Hostinger
 *   APRÈS   moteur → CapabilityDnsProvider → Panel → clé du Panel → Hostinger
 *
 * Le MOTEUR ne change pas d'une ligne. Il dépend de l'interface `DnsProvider`,
 * et c'est précisément la couture prévue pour cela : `docs/DEPLOYMENT_ENGINE.md`
 * dit depuis le début que le pipeline ne connaît jamais Hostinger directement.
 * L9 se contente de fournir une AUTRE implémentation de la même interface.
 *
 * ══ LA FRONTIÈRE, ET POURQUOI ELLE TIENT ════════════════════════════════════
 *
 *   MOTEUR DE DÉPLOIEMENT   décide QUOI écrire, dans quel ordre, et si un
 *                           conflit doit interrompre. Il reste l'autorité.
 *   CE PROVIDER             exécute des PRIMITIVES. Il ne planifie rien, ne
 *                           compare rien, ne décide de rien.
 *
 * Si ce fichier se mettait à planifier, il y aurait deux chemins de déploiement
 * avec deux idées de ce qu'est un conflit — et celui qui gagnerait dépendrait
 * de la configuration du jour.
 *
 * ══ CE QUE CE PROVIDER NE PEUT PAS FAIRE ════════════════════════════════════
 *
 * Lister le portefeuille de domaines. C'est délibéré : le compte Hostinger du
 * Panel héberge TOUS les clients, et le rendre à un projet lui livrerait
 * l'inventaire des autres. `listZones()` lève donc, au lieu de rendre une liste
 * vide qui ferait croire à un compte sans domaine.
 */
import { DnsProvider } from '../../deployment-engine/dns/DnsProvider.js';
import { checkDomainPointsToVps } from '../../deployment-engine/dns.js';
import { HostingerError } from './hostinger.errors.js';

/** Codes de refus de la passerelle qu'il faut savoir traduire. */
const CAPABILITY_TIMEOUT = 'CAPABILITY_TIMEOUT';
/**
 * LE REFUS D'APPARTENANCE — « ce nom d'hôte ne relève pas de ce projet ».
 *
 * Le Panel rendait ici `CAPABILITY_NOT_GRANTED`, ce qui mélangeait deux causes :
 * « la case DNS n'est pas cochée pour ce projet » et « ce domaine appartient à
 * quelqu'un d'autre ». Les octrois ayant été supprimés côté Panel, seule la
 * seconde subsiste — et elle porte désormais son vrai nom.
 *
 * L'ancien code est conservé dans la table de traduction : un Panel plus ancien
 * du parc peut encore l'émettre, et il désignait déjà le même refus pour le DNS.
 */
const CAPABILITY_RESOURCE_NOT_OWNED = 'CAPABILITY_RESOURCE_NOT_OWNED';
const CAPABILITY_NOT_GRANTED = 'CAPABILITY_NOT_GRANTED';
const CAPABILITY_CREDENTIALS_MISSING = 'CAPABILITY_CREDENTIALS_MISSING';

/**
 * Traduit un refus de la passerelle en `HostingerError` — le vocabulaire que
 * le moteur et le rapport de déploiement connaissent déjà.
 *
 * ── LE DÉLAI DÉPASSÉ NE DEVIENT PAS UNE PANNE ───────────────────────────────
 *
 * `CAPABILITY_TIMEOUT` signifie que l'issue est INDÉTERMINÉE : l'enregistrement
 * a peut-être été écrit. Le traduire en « API indisponible » inviterait le
 * moteur à réessayer, donc à écraser une correction survenue entre-temps. On le
 * marque non-retryable et on le dit dans le message.
 */
function translate(err, operation) {
  const code = err?.code ?? '';
  const traduite = (() => {
    if (code === CAPABILITY_TIMEOUT) {
      return new HostingerError(
        'HOSTINGER_TIMEOUT',
        `Le Panel n’a pas obtenu de réponse pour « ${operation} » : l’issue est indéterminée, aucune reprise automatique.`,
        { retryable: false },
      );
    }
    if (code === CAPABILITY_RESOURCE_NOT_OWNED || code === CAPABILITY_NOT_GRANTED) {
      return new HostingerError(
        'HOSTINGER_AUTH_FAILED',
        err?.message || 'Ce projet n’est pas autorisé à administrer ce nom de domaine.',
        { retryable: false },
      );
    }
    if (code === CAPABILITY_CREDENTIALS_MISSING) {
      return new HostingerError(
        'HOSTINGER_AUTH_FAILED',
        'Le Panel ne détient aucun identifiant Hostinger exploitable.',
        { retryable: false },
      );
    }
    return new HostingerError(
      'HOSTINGER_API_UNAVAILABLE',
      err?.message || `Le Panel n’a pas pu exécuter « ${operation} ».`,
      { retryable: false },
    );
  })();

  /**
   * LE CODE D'ORIGINE SURVIT À LA TRADUCTION (L9.1).
   *
   * La traduction sert le MOTEUR, qui ne connaît que le vocabulaire Hostinger.
   * Mais un autre lecteur en a besoin : la résolution de chemin, qui doit
   * distinguer « le Panel a dit non » de « ce Panel ne connaît pas encore ce
   * verbe » — le second est la seule fenêtre de repli qui subsiste.
   *
   * Sans ce champ, les deux se lisaient `HOSTINGER_AUTH_FAILED` ou
   * `HOSTINGER_API_UNAVAILABLE`, et l'arbitrage se faisait sur une information
   * qui avait été effacée un cran plus tôt.
   */
  traduite.capabilityCode = code || null;
  return traduite;
}

let sequence = 0;
/**
 * Clé d'idempotence d'une invocation.
 *
 * Le PROJET est seul à savoir que deux appels sont la même intention ; on la
 * dérive donc du déploiement en cours (`runId`) et de l'opération, pas d'un
 * aléa. Deux tentatives d'un même déploiement portent la même intention.
 */
function operationId(runId, operation) {
  sequence += 1;
  return `${String(runId ?? 'run').slice(0, 24)}-${operation}-${sequence}`.slice(0, 64);
}

export class CapabilityDnsProvider extends DnsProvider {
  /**
   * @param {object} args
   * @param {(code: string, input: object) => Promise<object>} args.invoke
   *   La façade du pont (`PanelBridge.invokeCapability`). Injectée : ce fichier
   *   ne connaît ni le transport, ni l'appairage, ni le Panel.
   * @param {string} args.siteHost  L'hôte DÉPLOYÉ — la ressource dont ce projet
   *   demande l'administration. Le Panel en déduit la zone ; le projet ne la
   *   nomme jamais, parce que c'est la zone qui porte le pouvoir.
   * @param {string} [args.runId]
   */
  constructor({ invoke, siteHost, runId = null }) {
    super();
    if (typeof invoke !== 'function') throw new Error('CapabilityDnsProvider : invoke requis.');
    if (!siteHost) throw new Error('CapabilityDnsProvider : siteHost requis.');
    this.invoke = invoke;
    this.siteHost = String(siteHost).trim().toLowerCase();
    this.runId = runId;
  }

  get name() {
    // Le rapport de déploiement nomme le CHEMIN, pas seulement le fournisseur :
    // un opérateur doit voir d'un coup d'œil si l'écriture est passée par le
    // Panel ou par une clé locale.
    return 'hostinger (via Panel)';
  }

  async #call(code, input, operation) {
    try {
      const res = await this.invoke(code, { ...input, operationId: operationId(this.runId, operation) });
      return res?.result ?? res;
    } catch (err) {
      throw translate(err, operation);
    }
  }

  /**
   * Vérifie que la chaîne est utilisable — sans lister quoi que ce soit.
   *
   * On résout la zone de l'hôte déployé : si le Panel répond, c'est qu'il
   * détient un jeton valide ET que ce projet a le droit d'administrer ce nom.
   * C'est une preuve PLUS FORTE que l'ancienne, qui listait le portefeuille du
   * compte sans jamais vérifier que le domaine visé nous concernait.
   */
  async verifyCredentials() {
    const zone = await this.#call('dns.zone.resolve', { hostname: this.siteHost }, 'verify');
    return {
      ok: true,
      message: `Gestion DNS disponible via le Panel (zone ${zone.zone}).`,
      details: {
        zone: zone.zone,
        zoneSource: zone.source,
        via: 'PANEL_CAPABILITY',
        // Aucun credential ici, et c'est le fait le plus important du rapport.
        localCredential: false,
      },
    };
  }

  /**
   * VOLONTAIREMENT INDISPONIBLE.
   *
   * Le portefeuille du compte est l'inventaire de tous les clients. Rendre une
   * liste vide serait pire qu'une erreur : le moteur conclurait « aucun domaine
   * géré » et basculerait en DNS manuel, sans que personne comprenne pourquoi.
   */
  async listZones() {
    throw new HostingerError(
      'HOSTINGER_API_UNAVAILABLE',
      'Le portefeuille de domaines n’est pas exposé aux projets : demandez la résolution d’un hôte précis.',
      { retryable: false },
    );
  }

  /** Quelle zone gère cet hôte ? Le Panel tranche, et vérifie l'appartenance. */
  async findBestZone(hostname) {
    const zone = await this.#call('dns.zone.resolve', { hostname }, 'zone');
    return { zone: zone.zone, relativeName: zone.relativeName, source: zone.source };
  }

  /**
   * Les enregistrements de la zone — RÉDUITS à ceux de ce projet.
   *
   * Le moteur passe la ZONE (c'est sa signature) ; la capacité, elle, raisonne
   * en HÔTE. On lui transmet l'hôte déployé : le Panel retrouve la même zone et
   * ne rend que ce que ce projet a le droit de voir, plus la wildcard, dont le
   * moteur a besoin pour constater qu'un hôte est déjà couvert.
   *
   * Le `zone` reçu n'est donc pas ignoré par négligence : il est REDONDANT avec
   * ce que le Panel recalcule, et c'est le Panel qui fait autorité.
   */
  async listRecords(_zone) {
    const read = await this.#call('dns.records.read', { hostname: this.siteHost }, 'read');
    return read.records ?? [];
  }

  /**
   * Pose un enregistrement. PRIMITIVE : aucune décision, aucun plan.
   *
   * Le moteur fournit `zone` + `name` relatif ; la capacité attend un hôte
   * complet. La reconstruction est faite ici, une fois — et le Panel la
   * revérifie contre l'appartenance, parce qu'un nom relatif calculé de travers
   * écrirait à la racine d'un domaine qui n'est pas le nôtre.
   */
  async ensureRecord({ zone, name, type = 'A', ttl, content }) {
    const hostname = name === '@' || !name ? zone : `${name}.${zone}`;
    const res = await this.#call(
      'dns.record.ensure',
      { hostname, type, content, ...(ttl != null ? { ttl } : {}) },
      'ensure',
    );
    return {
      recordId: null,
      // Hostinger ne rend pas le TTL appliqué ; le moteur retombe sur le TTL
      // demandé. On ne relit PAS pour le savoir : une relecture après écriture
      // double le coût d'un déploiement pour une information d'affichage.
      ttlApplied: ttl ?? null,
      correlationId: res.correlationId ?? null,
      via: 'PANEL_CAPABILITY',
      written: res.written === true,
    };
  }

  /**
   * Résolution DNS PUBLIQUE — reste locale, et c'est normal.
   *
   * Interroger un résolveur public n'exige aucun credential et ne touche pas
   * Hostinger. La faire passer par le Panel ajouterait un aller-retour, un
   * point de panne, et une capacité qui n'administre rien.
   */
  async verifyResolution(hostname, expectedIp) {
    return checkDomainPointsToVps(hostname, expectedIp);
  }
}

export default CapabilityDnsProvider;
