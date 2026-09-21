// L'ENVIRONNEMENT FOURNISSEUR — décidé par le runtime, et par lui seul.
//
// Lot L2 de la roadmap IntegratedAPI (docs/INTEGRATED_API.md §0).
//
// ── LA DOCTRINE, ET CE QU'ELLE REMPLACE ─────────────────────────────────────
//
//   ENV=TEST  →  monde fournisseur TEST
//   ENV=PROD  →  monde fournisseur PROD
//
// Sans exception, sans repli, sans sélecteur.
//
// Jusqu'ici, chaque fournisseur portait un `activeMode` choisi à la main depuis
// le Manager, INDÉPENDANT de `config.env`. Les quatre combinaisons étaient
// possibles, dont « application TEST × Stripe PROD » — de vraies opérations
// depuis une recette — signalée par une bannière et confirmée par un verbe.
//
// L'inventaire du parc a montré que ce croisement avait réellement servi : un
// paiement PAID du 2026-07-16 porte `environment: PROD` et `providerMode: TEST`.
// Ce qu'il permettait — valider une production sans débiter personne — est
// désormais porté par l'OUVERTURE COMMERCIALE, qui refuse l'action au lieu de
// changer de compte.
//
// ── CE QUI NE DÉCIDE JAMAIS DU MONDE ────────────────────────────────────────
//
//   · `activeMode`        — conservé en base, DIAGNOSTIC uniquement
//   · `providerMode`      — trace historique d'une opération passée
//   · `commercialState`   — répond à « l'action est-elle autorisée ? »
//   · le domaine, l'hôte, un en-tête, un paramètre du Manager
//
// Un test structurel vérifie qu'aucun service métier ne consulte `activeMode`
// pour choisir un jeu d'identifiants.
import { config } from '../config/env.js';
import logger from '../utils/logger.js';
import { INTEGRATED_API_PROVIDERS, MODE_VALUES } from '../utils/integratedApiCatalog.js';

/**
 * PORTÉE d'un fournisseur — reprise du registre du Panel (lot L1).
 *
 * `ENVIRONMENT` : deux jeux d'identifiants, un par monde.
 * `PANEL_GLOBAL` : un seul compte, sans monde. Lui imposer TEST/PROD
 * dédoublerait un compte unique — Hostinger n'a ni sandbox, ni second
 * portefeuille de domaines.
 */
export const PROVIDER_SCOPE = Object.freeze({
  ENVIRONMENT: 'ENVIRONMENT',
  PANEL_GLOBAL: 'PANEL_GLOBAL',
});

export const PROVIDER_SCOPES = Object.freeze({
  [INTEGRATED_API_PROVIDERS.STRIPE]: PROVIDER_SCOPE.ENVIRONMENT,
  [INTEGRATED_API_PROVIDERS.BREVO]: PROVIDER_SCOPE.ENVIRONMENT,
  [INTEGRATED_API_PROVIDERS.SIGNATURE]: PROVIDER_SCOPE.ENVIRONMENT,
  [INTEGRATED_API_PROVIDERS.HOSTINGER]: PROVIDER_SCOPE.PANEL_GLOBAL,
});

/** Code d'erreur CANONIQUE — le même des deux côtés du pont. */
export const INTEGRATED_API_ENVIRONMENT_MISMATCH = 'INTEGRATED_API_ENVIRONMENT_MISMATCH';
/** Le bon monde n'est pas configuré. JAMAIS suivi d'un repli sur l'autre. */
export const INTEGRATED_API_CREDENTIALS_MISSING = 'INTEGRATED_API_CREDENTIALS_MISSING';

/** L'environnement que CETTE instance sert. Le seul fait qui compte. */
export function runtimeEnvironment() {
  return config.env; // 'TEST' | 'PROD', validé fail-closed au démarrage
}

export function providerScope(provider) {
  return PROVIDER_SCOPES[String(provider).toUpperCase()] ?? PROVIDER_SCOPE.ENVIRONMENT;
}

/**
 * LE MONDE FOURNISSEUR à utiliser, ici et maintenant.
 *
 * ── POURQUOI HOSTINGER REND QUAND MÊME UN MODE ──────────────────────────────
 *
 * Sa portée est globale : il n'a qu'un compte. Mais son coffre LOCAL range
 * encore ses identifiants sous `modes.TEST`, comme les autres — c'est la forme
 * du modèle, pas une distinction métier. On rend donc `TEST`, invariablement,
 * pour lire la seule case qui existe. Ce n'est pas « Hostinger en test » :
 * c'est « Hostinger, sans monde ». Le jour où son credential rejoindra le
 * Panel (lot L9), cette case disparaîtra avec le reste.
 *
 * @param {string} provider
 * @returns {'TEST'|'PROD'}
 */
export function resolveProviderEnvironment(provider) {
  if (providerScope(provider) === PROVIDER_SCOPE.PANEL_GLOBAL) {
    return MODE_VALUES[0]; // 'TEST' — la case unique, jamais un monde
  }
  return runtimeEnvironment();
}

/**
 * FAIL CLOSED — un environnement explicitement demandé est-il celui qu'on sert ?
 *
 * Utilisé par les rares chemins qui acceptent encore un mode explicite (tests
 * de connexion, diagnostics, outillage). Aucun repli : demander l'autre monde
 * est refusé, jamais silencieusement corrigé.
 */
export function assertEnvironmentServed(provider, requested) {
  if (requested === null || requested === undefined) return resolveProviderEnvironment(provider);
  const expected = resolveProviderEnvironment(provider);
  if (requested !== expected) {
    const error = new Error(
      `Refusé : cette instance sert ${expected} pour ${provider}, `
      + `le monde demandé est ${requested}.`,
    );
    error.code = INTEGRATED_API_ENVIRONMENT_MISMATCH;
    error.meta = { provider, requested, expected, runtimeEnvironment: runtimeEnvironment() };
    throw error;
  }
  return expected;
}

/**
 * ROUTAGE OBSERVABLE — ce qu'un journal doit pouvoir dire d'un appel.
 *
 * ── POURQUOI `resolvedProviderEnvironment` VAUT `null` POUR UN GLOBAL ───────
 *
 * `resolveProviderEnvironment()` rend `TEST` pour Hostinger : c'est la CASE de
 * son coffre local, la seule qui existe. Recopier cette case dans un journal
 * ferait lire « Hostinger en environnement TEST » — un environnement métier
 * qu'il n'a pas, et qu'on inventerait à chaque ligne.
 *
 * Le journal dit donc `null`, et nomme la case séparément (`credentialSlot`).
 * L'un décrit le monde, l'autre décrit le rangement.
 *
 * ── L'INVARIANT QUE CE JOURNAL REND VÉRIFIABLE ─────────────────────────────
 *
 * Pour une portée `ENVIRONMENT`, `runtimeEnvironment` et
 * `resolvedProviderEnvironment` sont TOUJOURS identiques. Une divergence est
 * impossible par construction ; si elle apparaissait dans un journal, elle
 * signalerait que quelqu'un a remis un sélecteur quelque part.
 */
export function describeRouting(provider) {
  const code = String(provider).toUpperCase();
  const scope = providerScope(code);
  const slot = resolveProviderEnvironment(code);
  return {
    provider: code,
    scope,
    runtimeEnvironment: runtimeEnvironment(),
    // `null` pour un fournisseur sans monde — on n'en invente pas un.
    resolvedProviderEnvironment: scope === PROVIDER_SCOPE.PANEL_GLOBAL ? null : slot,
    // La case du coffre réellement lue. Utile au diagnostic, jamais un monde.
    credentialSlot: slot,
  };
}

/**
 * JOURNALISE le routage — UNE FOIS par tuple, et par processus.
 *
 * ── POURQUOI DÉDUPLIQUER ────────────────────────────────────────────────────
 *
 * Un seul paiement lit deux credentials, une synchronisation de webhooks en lit
 * quatre. Journaliser chaque lecture noierait le signal utile — « cette
 * instance utilise Stripe en TEST » — sous des centaines de lignes identiques,
 * et la première chose qu'on ferait serait de couper le journal.
 *
 * Une ligne par tuple suffit : le tuple ne peut plus changer en cours de vie du
 * processus, puisqu'il découle de `config.env`. S'il changeait, ce serait
 * précisément l'anomalie à voir — et une SECONDE ligne apparaîtrait.
 *
 * Ne contient AUCUN secret : un nom de fournisseur, deux environnements, une
 * portée.
 */
const dejaJournalise = new Set();

export function observeRouting(provider) {
  const routage = describeRouting(provider);
  const cle = `${routage.provider}|${routage.runtimeEnvironment}|${routage.resolvedProviderEnvironment}|${routage.scope}`;
  if (dejaJournalise.has(cle)) return routage;
  dejaJournalise.add(cle);
  logger.info(`[integrated-api] routage ${JSON.stringify(routage)}`);
  return routage;
}

/** Remise à zéro du déduplicateur — réservée aux tests. */
export function _resetRoutingObservations() {
  dejaJournalise.clear();
}

export default {
  PROVIDER_SCOPE,
  PROVIDER_SCOPES,
  INTEGRATED_API_ENVIRONMENT_MISMATCH,
  INTEGRATED_API_CREDENTIALS_MISSING,
  runtimeEnvironment,
  providerScope,
  resolveProviderEnvironment,
  assertEnvironmentServed,
  describeRouting,
  observeRouting,
};
