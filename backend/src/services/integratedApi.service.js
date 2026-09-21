import crypto from 'node:crypto';
import { IntegratedApi } from '../models/IntegratedApi.model.js';
import { config } from '../config/env.js';
import { resolveProviderEnvironment, observeRouting } from './integratedApiEnvironment.js';
import { decryptSecret, isUnfilledSentinel } from '../utils/integratedApiCrypto.js';
import {
  isPanelAuthority,
  INTEGRATED_API_CATALOG,
  MODE_VALUES,
  requiredFieldKeys,
  fieldKeys,
  isKnownProvider,
  isValidMode,
  defaultBaseUrl,
} from '../utils/integratedApiCatalog.js';

/**
 * Couche de CONSOMMATION des credentials IntegratedAPI.
 *
 * ── RÈGLE FONDAMENTALE — RÉÉCRITE AU LOT L2 ─────────────────────────────────
 *
 * Le choix des credentials se fait via l'ENVIRONNEMENT DU RUNTIME :
 *
 *     ENV=TEST  →  identifiants TEST
 *     ENV=PROD  →  identifiants PROD
 *
 * `activeMode` ne décide plus de rien. Il reste en base, lisible, à titre de
 * DIAGNOSTIC et d'historique — mais aucun service métier ne le consulte pour
 * sélectionner un jeu d'identifiants, et un test structurel le vérifie.
 *
 * ── CE QUI A CHANGÉ, ET POURQUOI ────────────────────────────────────────────
 *
 * L'ancienne doctrine laissait un DEV choisir le monde fournisseur depuis le
 * Manager, indépendamment de `config.env`. Les quatre combinaisons étaient
 * possibles, dont « application TEST × Stripe PROD » — de vraies opérations
 * déclenchées depuis une recette.
 *
 * Ce que ce croisement permettait légitimement — valider une instance de
 * production sans débiter personne — est désormais porté par l'OUVERTURE
 * COMMERCIALE, qui refuse l'action au lieu de changer de compte.
 *
 * ── AUCUN REPLI, JAMAIS ─────────────────────────────────────────────────────
 *
 * Si le monde courant n'est pas configuré, on échoue. On n'essaie pas l'autre :
 * c'est exactement l'accident qu'on rend impossible.
 *
 * « Fail loud » : erreur typée si absent / non configuré / sentinelle.
 * Ne journalise jamais le secret (seulement provider + field + mode).
 */

export class IntegratedApiCredentialError extends Error {
  constructor(code, message, meta = {}) {
    super(message);
    this.name = 'IntegratedApiCredentialError';
    this.code = code;
    this.meta = meta;
  }
}

const CODES = Object.freeze({
  UNKNOWN_PROVIDER: 'UNKNOWN_PROVIDER',
  NOT_FOUND: 'NOT_FOUND',
  DISABLED: 'DISABLED',
  UNFILLED: 'UNFILLED',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  NOT_VERIFIED: 'NOT_VERIFIED',
  INVALID_MODE: 'INVALID_MODE',
  DECRYPT_FAILED: 'DECRYPT_FAILED',
});
export { CODES as INTEGRATED_API_CODES };

/**
 * Environnement APPLICATIF (ENV / base MongoDB).
 *
 * Depuis L2, c'est aussi l'environnement FOURNISSEUR : les deux notions ont
 * fusionné, et cette fonction n'est plus une simple information d'affichage.
 * `resolveProviderEnvironment()` reste le point d'entrée canonique — il connaît
 * en plus la portée de chaque fournisseur.
 */
export function applicationEnvironment() {
  return config.env; // 'TEST' | 'PROD'
}

export async function getIntegratedApi(provider) {
  if (!isKnownProvider(provider)) {
    throw new IntegratedApiCredentialError(
      CODES.UNKNOWN_PROVIDER,
      `Fournisseur inconnu : ${provider}`,
      { provider }
    );
  }
  return IntegratedApi.findOne({ provider });
}

/**
 * `activeMode` STOCKÉ d'un fournisseur — DIAGNOSTIC UNIQUEMENT (déprécié L2).
 *
 * ── NE L'UTILISEZ PAS POUR CHOISIR UN JEU D'IDENTIFIANTS ────────────────────
 *
 * Il ne route plus rien. Il subsiste parce que des fiches en production le
 * portent et qu'il documente ce qu'une instance faisait AVANT la révocation de
 * la doctrine — le supprimer effacerait la seule trace de ce qu'on a corrigé.
 *
 * Pour savoir quel monde utiliser : `resolveProviderEnvironment(provider)`.
 *
 * @deprecated Diagnostic et historique. Voir `integratedApiEnvironment.js`.
 */
export async function getActiveMode(provider) {
  const doc = await getIntegratedApi(provider);
  return doc?.activeMode ?? null;
}

/**
 * LE MONDE FOURNISSEUR EFFECTIF — l'unique autorité de routage.
 * Réexporté ici pour que les appelants n'aient qu'une porte à connaître.
 */
export { resolveProviderEnvironment };

/**
 * Base URL du fournisseur pour le mode donné (actif par défaut). Utilise la
 * valeur STOCKÉE (éditable) ; repli sur le défaut du catalogue si vide. Le driver
 * ne code JAMAIS l'URL en dur.
 */
export async function getProviderBaseUrl(provider, { mode } = {}) {
  const doc = await getIntegratedApi(provider);
  const resolvedMode = mode ?? resolveProviderEnvironment(provider);
  const stored = doc?.modes?.[resolvedMode]?.baseUrl;
  return (stored && stored.trim()) || defaultBaseUrl(provider, resolvedMode);
}

function credentialsMap(doc, mode) {
  return doc.modes?.[mode]?.credentials;
}

/**
 * Récupère et déchiffre un credential. Mode = `opts.mode` s'il est fourni
 * (test explicite), sinon le `activeMode` du fournisseur. JAMAIS config.env.
 *
 * @param {string} provider  ex. 'STRIPE'
 * @param {string} field     ex. 'secretKey'
 * @param {{mode?: string}} [opts]  mode explicite (test) — sinon activeMode
 * @returns {Promise<string>} secret en clair
 */
export async function getCredential(provider, field, { mode } = {}) {
  const doc = await getIntegratedApi(provider);
  if (!doc) {
    throw new IntegratedApiCredentialError(
      CODES.NOT_FOUND,
      `Intégration ${provider} absente du registre.`,
      { provider }
    );
  }
  if (!doc.enabled) {
    throw new IntegratedApiCredentialError(CODES.DISABLED, `Intégration ${provider} désactivée.`, {
      provider,
    });
  }
  const resolvedMode = mode ?? resolveProviderEnvironment(provider);
  if (!isValidMode(resolvedMode)) {
    throw new IntegratedApiCredentialError(CODES.INVALID_MODE, `Mode invalide : ${resolvedMode}`, {
      provider,
      mode: resolvedMode,
    });
  }

  /**
   * OBSERVABILITÉ DU ROUTAGE — posée ICI, et nulle part ailleurs.
   *
   * Tout accès à un identifiant passe par cette fonction. La poser chez chaque
   * appelant se dégraderait au premier qui l'oublierait — et l'oubli serait
   * silencieux, ce qui est exactement le genre de trou qu'on cherche à fermer.
   *
   * Uniquement quand le mode est DÉDUIT (`mode === undefined`) : un mode
   * explicite vient d'un outil de diagnostic, pas d'un appel métier, et le
   * journaliser comme un routage mentirait sur ce qui s'est passé.
   *
   * Déduplicée par tuple, sans secret.
   */
  if (mode === undefined) observeRouting(provider);

  const creds = credentialsMap(doc, resolvedMode);
  const entry = creds && creds.get ? creds.get(field) : undefined;
  if (!entry || !entry.encryptedValue) {
    throw new IntegratedApiCredentialError(
      CODES.UNFILLED,
      `Credential ${provider}.${field} non configuré (mode ${resolvedMode}).`,
      { provider, field, mode: resolvedMode }
    );
  }

  let clear;
  try {
    clear = decryptSecret(entry.encryptedValue);
  } catch (err) {
    throw new IntegratedApiCredentialError(
      CODES.DECRYPT_FAILED,
      `Déchiffrement impossible pour ${provider}.${field} (mode ${resolvedMode}).`,
      { provider, field, mode: resolvedMode, cause: err.message }
    );
  }
  if (isUnfilledSentinel(clear)) {
    throw new IntegratedApiCredentialError(
      CODES.UNFILLED,
      `Credential ${provider}.${field} non renseigné (mode ${resolvedMode}).`,
      { provider, field, mode: resolvedMode }
    );
  }
  return clear;
}

export async function tryGetCredential(provider, field, opts) {
  try {
    return await getCredential(provider, field, opts);
  } catch (err) {
    if (err instanceof IntegratedApiCredentialError) return null;
    throw err;
  }
}

/**
 * Resolver normalisé : charge le fournisseur, résout le mode (actif ou demandé),
 * déchiffre les credentials présents. Point d'entrée unique pour les drivers qui
 * ont besoin de plusieurs credentials à la fois. Déchiffrement CÔTÉ SERVEUR
 * uniquement — les secrets ne quittent jamais cette couche vers le frontend.
 *
 * @returns {Promise<{provider, mode, activeMode, values: Record<string,string>}>}
 */
export async function getProviderConfiguration(provider, { mode } = {}) {
  const doc = await getIntegratedApi(provider);
  if (!doc) {
    throw new IntegratedApiCredentialError(CODES.NOT_FOUND, `Intégration ${provider} absente.`, {
      provider,
    });
  }
  if (!doc.enabled) {
    throw new IntegratedApiCredentialError(CODES.DISABLED, `Intégration ${provider} désactivée.`, {
      provider,
    });
  }
  const resolvedMode = mode ?? resolveProviderEnvironment(provider);
  if (!isValidMode(resolvedMode)) {
    throw new IntegratedApiCredentialError(CODES.INVALID_MODE, `Mode invalide : ${resolvedMode}`, {
      provider,
      mode: resolvedMode,
    });
  }
  const values = {};
  for (const key of fieldKeys(provider)) {
    const v = await tryGetCredential(provider, key, { mode: resolvedMode });
    if (v !== null) values[key] = v;
  }
  // `activeMode` est rendu pour le diagnostic — il ne décrit plus ce qui a été
  // utilisé. `mode` seul dit le monde réellement servi.
  return { provider, mode: resolvedMode, activeMode: doc.activeMode, values };
}

/** Un mode est-il « configuré » (tous les champs requis présents) ? */
export async function isProviderConfigured(provider, { mode } = {}) {
  const doc = await getIntegratedApi(provider);
  if (!doc || !doc.enabled) return false;
  const resolvedMode = mode ?? resolveProviderEnvironment(provider);
  const creds = credentialsMap(doc, resolvedMode);
  if (!creds || !creds.get) return false;
  return requiredFieldKeys(provider).every((k) => Boolean(creds.get(k)));
}

/**
 * Empreinte NON réversible des credentials REQUIS d'un mode. Sert à prouver qu'une
 * vérification concerne la clé actuellement configurée, sans jamais stocker cette
 * clé. Les valeurs en clair ne servent qu'à alimenter le hash, ne sont ni
 * journalisées ni renvoyées. Renvoie '' si un credential requis manque.
 */
export async function computeCredentialFingerprint(provider, mode) {
  const keys = requiredFieldKeys(provider);
  if (!keys.length) return '';
  const parts = [];
  for (const k of keys.slice().sort()) {
    const v = await tryGetCredential(provider, k, { mode });
    if (!v) return ''; // configuration incomplète : pas d'empreinte
    parts.push(`${k}:${v}`);
  }
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

/**
 * Un mode a-t-il été vérifié — POUR LA CLÉ ACTUELLE ?
 *
 * Le drapeau `verified` seul ne suffit pas : il pourrait dater d'une clé
 * remplacée depuis. L'empreinte tranche.
 * - Empreinte VIDE : vérification antérieure à ce champ. On fait confiance au
 *   drapeau (la remise à zéro sur changement de credential le protège déjà) —
 *   rétrocompatibilité, aucune régression sur les intégrations déjà vérifiées.
 * - Empreinte PRÉSENTE : elle DOIT correspondre à la clé actuellement configurée,
 *   sinon la vérification est périmée et le mode redevient « non vérifié ».
 */
export async function isProviderVerified(provider, { mode } = {}) {
  const doc = await getIntegratedApi(provider);
  if (!doc || !doc.enabled) return false;
  const resolvedMode = mode ?? resolveProviderEnvironment(provider);
  const modeState = doc.modes?.[resolvedMode];
  if (!modeState?.verified) return false;
  const stamped = modeState.verifiedFingerprint;
  if (!stamped) return true; // rétrocompat
  const current = await computeCredentialFingerprint(provider, resolvedMode);
  return Boolean(current) && current === stamped;
}

/**
 * SEUL point d'écriture de `verified = true`. Utilisé par TOUS les parcours qui
 * prouvent qu'une clé fonctionne : test de connexion explicite ET envoi de test
 * accepté par le fournisseur (un `POST /smtp/email` accepté prouve l'authentification
 * aussi sûrement qu'un `GET /account`). Estampille l'empreinte de la clé courante.
 */
export async function markProviderVerified(provider, mode, { message = '', details = null } = {}) {
  const doc = await getIntegratedApi(provider);
  if (!doc || !doc.modes?.[mode]) return null;
  const now = new Date();
  const fingerprint = await computeCredentialFingerprint(provider, mode);
  doc.modes[mode].verified = true;
  doc.modes[mode].verifiedAt = now;
  doc.modes[mode].verifiedFingerprint = fingerprint;
  doc.modes[mode].lastTestedAt = now;
  doc.modes[mode].lastTestStatus = 'SUCCESS';
  if (message) doc.modes[mode].lastTestMessage = message;
  if (details !== null) doc.modes[mode].lastTestDetails = details;
  await doc.save();
  return doc;
}

/** Contrepartie : un test a ÉCHOUÉ — le mode redevient non vérifié, empreinte effacée. */
export async function markProviderUnverified(provider, mode, { status = 'FAILED', message = '', details = null } = {}) {
  const doc = await getIntegratedApi(provider);
  if (!doc || !doc.modes?.[mode]) return null;
  doc.modes[mode].verified = false;
  doc.modes[mode].verifiedAt = null;
  doc.modes[mode].verifiedFingerprint = '';
  doc.modes[mode].lastTestedAt = new Date();
  doc.modes[mode].lastTestStatus = status;
  doc.modes[mode].lastTestMessage = message;
  doc.modes[mode].lastTestDetails = details;
  await doc.save();
  return doc;
}

/**
 * Statut de préparation d'un fournisseur pour LE MONDE DE CETTE INSTANCE.
 *
 * Le mode évalué est celui du runtime, plus celui d'un réglage : une instance
 * de production dont seules les clés TEST sont renseignées n'est PAS prête, et
 * doit le dire — c'était précisément ce que l'ancien `activeMode` masquait.
 *
 * `activeMode` reste dans la réponse à titre de DIAGNOSTIC, pour qu'un écran
 * puisse signaler une configuration héritée divergente.
 *
 * @returns {Promise<{provider, environment, activeMode, legacyModeMismatch, configured, verified, ok, reason}>}
 *   reason ∈ NOT_FOUND | DISABLED | NOT_CONFIGURED | NOT_VERIFIED | null
 */
export async function getProviderReadiness(provider) {
  const environment = resolveProviderEnvironment(provider);

  /**
   * ── L6.3 FINAL — POUR UN FOURNISSEUR ADMINISTRÉ PAR LA PLATEFORME, LA
   *    PRÉSENCE D'UNE CLÉ LOCALE NE PROUVE RIEN ─────────────────────────────
   *
   * Cette fonction répondait « prêt » quand une clé était enregistrée ici et
   * qu'un opérateur avait cliqué « Tester » un jour. Les deux faits sont
   * devenus sans autorité pour Stripe et Hostinger :
   *
   *   · une clé locale peut exister sans qu'aucun appel ne l'emprunte ;
   *   · un « vérifié » posé il y a six mois ne dit rien de maintenant ;
   *   · et surtout, un projet SANS clé locale mais dont la plateforme est
   *     parfaitement configurée s'entendait répondre « non prêt » — ce qui
   *     envoyait un opérateur coller une clé qui ne servirait jamais.
   *
   * La disponibilité vient donc du Control Plane, et de lui seul. On ne
   * regarde même pas le document local : le consulter d'abord, ne serait-ce
   * que pour « compléter », rouvrirait la porte au premier refactor.
   */
  if (isPanelAuthority(provider)) {
    const { providerReadinessViaControlPlane } = await import('./panelAuthorityReadiness.js');
    return providerReadinessViaControlPlane(provider, environment);
  }

  const doc = await getIntegratedApi(provider);
  if (!doc) {
    return {
      provider, environment, activeMode: null, legacyModeMismatch: false,
      configured: false, verified: false, ok: false, reason: CODES.NOT_FOUND,
    };
  }
  const activeMode = doc.activeMode ?? null;
  // Constat, jamais une décision : l'ancien réglage désignait un autre monde.
  const legacyModeMismatch = Boolean(activeMode) && activeMode !== environment;
  if (!doc.enabled) {
    return {
      provider, environment, activeMode, legacyModeMismatch,
      configured: false, verified: false, ok: false, reason: CODES.DISABLED,
    };
  }
  const configured = await isProviderConfigured(provider, { mode: environment });
  const verified = await isProviderVerified(provider, { mode: environment });
  const ok = configured && verified;
  const reason = ok ? null : !configured ? CODES.NOT_CONFIGURED : CODES.NOT_VERIFIED;
  return { provider, environment, activeMode, legacyModeMismatch, configured, verified, ok, reason };
}

/**
 * Prérequis contrat : parmi `providers`, statut de chacun DANS LE MONDE DE
 * CETTE INSTANCE.
 * @returns {Promise<{ready: boolean, providers: Array}>}
 */
export async function getContractReadiness(providers) {
  const statuses = await Promise.all(providers.map((p) => getProviderReadiness(p)));
  return { ready: statuses.every((s) => s.ok), providers: statuses };
}

export { INTEGRATED_API_CATALOG, MODE_VALUES };
