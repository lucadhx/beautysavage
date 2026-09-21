import crypto from 'crypto';

import { config } from '../config/env.js';
import { IntegratedApi } from '../models/IntegratedApi.model.js';
import { decryptSecret, isUnfilledSentinel } from '../utils/integratedApiCrypto.js';
import { defaultBaseUrl } from '../utils/integratedApiCatalog.js';

/**
 * Test de connexion LECTURE SEULE d'un fournisseur, avec la baseUrl STOCKÉE du
 * mode (jamais d'URL codée en dur). Ne crée aucune ressource, ne déclenche
 * aucun paiement/signature, ne renvoie jamais de secret.
 *
 * ── DEUX AUTORITÉS, ET LE RÉSULTAT DIT LAQUELLE ─────────────────────────────
 *
 * `authority: 'PROJECT'` — la clé testée est celle du projet, ici, en base.
 *   C'est encore le cas de Yousign.
 *
 * `authority: 'PANEL'`   — la clé appartient à la plateforme, et c'est ELLE
 *   qui a parlé au fournisseur. Brevo depuis L8.2, Hostinger depuis L9.2,
 *   STRIPE depuis L6.3 FINAL.
 *
 * Ce champ n'est pas décoratif : l'appelant s'en sert pour décider s'il a le
 * droit d'estampiller le credential LOCAL comme « vérifié ». Estampiller une
 * clé qu'on n'a pas testée est un mensonge durable, et c'est exactement ce
 * qu'un test délégué produirait sans cette distinction.
 *
 * @returns {Promise<{status:'SUCCESS'|'FAILED', authority?:'PANEL'|'PROJECT', message:string, details:object}>}
 */

const FETCH_TIMEOUT_MS = 10_000;

async function fetchTimed(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return { res, responseTimeMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

/** Déchiffre un credential stocké d'un mode donné (ou null). */
function readStoredCredential(doc, mode, field) {
  const creds = doc.modes?.[mode]?.credentials;
  const entry = creds && creds.get ? creds.get(field) : undefined;
  if (!entry || !entry.encryptedValue) return null;
  const clear = decryptSecret(entry.encryptedValue);
  return isUnfilledSentinel(clear) ? null : clear;
}

/** Base URL configurée du mode (repli défaut catalogue si vide). */
function modeBaseUrl(doc, provider, mode) {
  const stored = doc.modes?.[mode]?.baseUrl;
  return (stored && stored.trim()) || defaultBaseUrl(provider, mode);
}

/**
 * Test Stripe — IL N'Y A PLUS DE CLÉ LOCALE À ÉPROUVER (L6.3 FINAL).
 *
 * ── CE QUI A DISPARU ────────────────────────────────────────────────────────
 *
 * L'appel `GET /v1/account` avec la clé du projet. C'était le dernier usage de
 * ce credential, et il était devenu franchement trompeur : il éprouvait une clé
 * dont plus aucun paiement ne dépendait. Un opérateur lisait « Connexion Stripe
 * réussie » et en concluait que les paiements fonctionnaient — alors que la
 * seule chose prouvée était qu'une clé oubliée en base répondait encore.
 *
 * ── CE QU'IL ÉPROUVE DÉSORMAIS ──────────────────────────────────────────────
 *
 * La chaîne RÉELLE : pont → passerelle → octroi → coffre du Panel →
 * fournisseur. C'est celle qu'emprunte un vrai paiement, et la seule dont
 * l'état renseigne sur ce qui va se passer.
 *
 * Le résultat porte `authority: 'PANEL'` MÊME EN ÉCHEC : c'est ce champ qui
 * empêche le contrôleur d'estampiller « vérifié » sur le credential local.
 * Estampiller une clé qu'on n'a pas testée est un mensonge durable.
 */
async function testStripe(_doc, mode) {
  const { invokeCapability, capabilitiesAvailable } = await import('./panelBridge/capabilityClient.js');
  const { diagnoseStripeAvailability, STRIPE_DIAGNOSTIC } = await import(
    '../integrations/stripe/stripeControlPlaneDiagnostic.js'
  );

  const startedAt = Date.now();
  const verdict = await diagnoseStripeAvailability({
    invoke: capabilitiesAvailable() ? invokeCapability : null,
  });

  return {
    status: verdict.code === STRIPE_DIAGNOSTIC.OK ? 'SUCCESS' : 'FAILED',
    authority: 'PANEL',
    message: verdict.message,
    details: {
      authority: 'PANEL',
      /** Le monde DEMANDÉ par l'écran ; celui qui compte est celui du Panel. */
      requestedMode: mode,
      capability: 'billing.checkout.retrieve',
      diagnostic: verdict.code,
      capabilityErrorCode: verdict.capabilityErrorCode ?? null,
      responseTimeMs: Date.now() - startedAt,
    },
  };
}

/*
 * `testYousign` A ETE RETIRE.
 *
 * Il lisait une cle locale (`readStoredCredential(doc, mode, 'apiKey')`) et
 * appelait `GET /users` chez le fournisseur. Ni l'un ni l'autre n'existe plus :
 * ce projet ne detient aucune credential de signature, et le catalogue ne
 * declare plus de fournisseur nomme mais un DOMAINE sous autorite du Panel.
 *
 * Le garder aurait laisse un testeur sans appelant, capable de repondre
 * « cle absente » -- c'est-a-dire d'inviter quelqu'un a en coller une, et de
 * reconstruire la dependance que la centralisation a defaite.
 *
 * La disponibilite de la signature se demande a la plateforme, par
 * `signatureControlPlaneDiagnostic`.
 */

/**
 * Test Hostinger — IL N'Y A PLUS QU'UN CHEMIN À ÉPROUVER (L9.2).
 *
 * ── CE QUI A DISPARU ────────────────────────────────────────────────────────
 *
 * La branche locale. Elle existait pour une instance non appairée, dont la clé
 * était alors le chemin réel. Depuis L9.2, une instance non appairée n'a plus
 * AUCUN chemin DNS : le dire est la seule réponse honnête, et lui faire tester
 * une clé qui ne servira jamais lui apprendrait le contraire.
 *
 * ── UNE SEULE SOURCE POUR TROIS ÉCRANS ──────────────────────────────────────
 *
 * Le même diagnostic sert le bouton « Tester », le garde-fou d'avant
 * publication et le rapport de déploiement. Trois implémentations auraient
 * dérivé, et c'est celle qui rassure qui aurait survécu.
 */
async function testHostinger(_doc, mode) {
  const { invokeCapability, capabilitiesAvailable } = await import('./panelBridge/capabilityClient.js');
  const { diagnoseDnsAutomation, DNS_DIAGNOSTIC } = await import(
    '../integrations/hostinger/dnsControlPlaneDiagnostic.js'
  );

  const startedAt = Date.now();
  const verdict = await diagnoseDnsAutomation({
    hostname: publicHostname(),
    invoke: capabilitiesAvailable() ? invokeCapability : null,
  });

  return {
    status: verdict.code === DNS_DIAGNOSTIC.OK ? 'SUCCESS' : 'FAILED',
    /**
     * L'AUTORITÉ EST TOUJOURS LA PLATEFORME — même en échec.
     *
     * C'est ce champ qui empêche le contrôleur d'estampiller « vérifié » sur le
     * credential LOCAL. Un test qui n'a pas éprouvé cette clé ne doit rien
     * écrire sur elle : ce serait un mensonge daté, et un opérateur garderait
     * la clé sur cette foi.
     */
    authority: 'PANEL',
    message: verdict.message,
    details: {
      authority: 'PANEL',
      /** Le monde DEMANDÉ par l'écran. Hostinger n'en a aucun — il est global. */
      requestedMode: mode,
      capability: 'dns.zone.resolve',
      diagnostic: verdict.code,
      capabilityErrorCode: verdict.capabilityErrorCode ?? null,
      hostname: verdict.hostname ?? publicHostname(),
      zone: verdict.zone,
      zoneSource: verdict.zoneSource,
      wildcard: verdict.wildcard,
      responseTimeMs: Date.now() - startedAt,
      change: 'aucun (lecture seule)',
    },
  };
}

/**
 * L'hôte public de cette instance — la seule ressource dont elle peut prouver
 * l'appartenance.
 *
 * On le lit dans `PUBLIC_URL`, qui est la même valeur que celle annoncée au
 * Panel. Une valeur locale (`localhost`) n'est pas un nom administrable : on
 * préfère le dire que d'envoyer au Panel un nom qu'il refusera pour une raison
 * qui ressemblerait à un défaut de droits.
 */
function publicHostname() {
  try {
    const host = new URL(config.publicUrl).hostname.toLowerCase();
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) && !host.endsWith('.localhost') ? host : null;
  } catch {
    return null;
  }
}

async function testBrevo(_doc, mode) {
  /**
   * On passe par `capabilityClient`, et JAMAIS par le runtime du pont.
   *
   * `bridge-conformity` interdit au métier d'importer le mécanisme du pont —
   * appairage, file, ordonnanceur, transport — et la règle est bonne : un
   * service qui atteint le runtime finit par le piloter. `capabilityClient`
   * est la façade prévue pour exactement ce besoin : demander un verbe, sans
   * rien pouvoir toucher d'autre.
   */
  const { invokeCapability } = await import('./panelBridge/capabilityClient.js');

  // Clé d'idempotence : ce test est une LECTURE, la rejouer est sans effet.
  // Elle sert au rapprochement des journaux, pas à la déduplication.
  const operationId = `verify-${crypto.randomUUID()}`;

  const details = {
    authority: 'PANEL',
    /** Le monde DEMANDÉ par l'écran — le Panel imposera le sien. */
    requestedMode: mode,
    capability: 'email.sender.verify',
    operationId,
  };

  let outcome;
  const startedAt = Date.now();
  try {
    outcome = await invokeCapability('email.sender.verify', { operationId });
  } catch (err) {
    details.responseTimeMs = Date.now() - startedAt;
    details.capabilityErrorCode = err?.code ?? null;
    return {
      status: 'FAILED',
      authority: 'PANEL',
      message: describeCapabilityRefusal(err),
      details,
    };
  }

  details.responseTimeMs = Date.now() - startedAt;
  // Le Panel rend le monde qu'il a RÉELLEMENT servi. C'est un constat, et il
  // peut différer de `requestedMode` — auquel cas l'écran doit montrer le vrai.
  details.environment = outcome?.environment ?? null;
  details.mode = outcome?.environment ?? mode;
  details.account = outcome?.result?.accountLabel ?? null;
  details.checkedAt = outcome?.result?.checkedAt ?? null;
  details.durationMs = outcome?.durationMs ?? null;

  const reachable = outcome?.result?.reachable === true;
  return {
    status: reachable ? 'SUCCESS' : 'FAILED',
    authority: 'PANEL',
    message: reachable
      ? `Connexion plateforme Brevo réussie${details.account ? ` (compte ${details.account})` : ''}.`
      : 'La plateforme n’a pas pu joindre Brevo avec sa clé.',
    details,
  };
}

/**
 * Traduit un refus de capacité en phrase exploitable.
 *
 * Les codes `CAPABILITY_*` traversent le pont tels quels (contrat 1.5.0) : on
 * peut donc distinguer « le Panel ne répond pas » de « ce projet n'a pas le
 * droit » — deux problèmes qui ne se réparent pas au même endroit, et qu'un
 * message générique enverrait chercher au mauvais.
 */
function describeCapabilityRefusal(err) {
  const code = err?.code ?? '';
  if (code === 'BRIDGE_NOT_PAIRED') {
    return 'Aucun Panel appairé : la clé Brevo est détenue par la plateforme, ce test ne peut pas être fait localement.';
  }
  if (code === 'CAPABILITY_NOT_GRANTED') {
    return 'La plateforme n’a pas accordé la vérification Brevo à ce projet.';
  }
  if (code === 'CAPABILITY_NOT_AVAILABLE') {
    return 'La vérification Brevo n’est pas encore servie par la plateforme.';
  }
  if (code === 'CAPABILITY_CREDENTIALS_MISSING') {
    return 'La plateforme n’a pas de clé Brevo renseignée pour cet environnement.';
  }
  if (code === 'CAPABILITY_TIMEOUT') {
    return 'La plateforme n’a pas répondu à temps : l’état de la connexion Brevo est indéterminé.';
  }
  return 'La plateforme n’a pas pu vérifier la connexion Brevo.';
}

/**
 * LES TESTEURS LOCAUX — il n'y en a plus pour la signature.
 *
 * `YOUSIGN` a disparu de cette table avec l'entree du catalogue : un testeur
 * local suppose une credential locale, et ce projet n'en detient aucune pour
 * signer. La disponibilite de la signature se demande a la plateforme
 * (`signatureControlPlaneDiagnostic`), qui sait qui l'execute.
 */
const TESTERS = { STRIPE: testStripe, HOSTINGER: testHostinger, BREVO: testBrevo };

export async function testProviderConnection(provider, mode) {
  const doc = await IntegratedApi.findOne({ provider });
  if (!doc) return { status: 'FAILED', message: `Intégration ${provider} absente.`, details: {} };
  const tester = TESTERS[provider];
  if (!tester) return { status: 'FAILED', message: `Test non supporté pour ${provider}.`, details: {} };
  try {
    return await tester(doc, mode);
  } catch (err) {
    const reason = err.name === 'AbortError' ? 'délai dépassé' : 'erreur réseau';
    return { status: 'FAILED', message: `Échec du test (${reason}).`, details: { error: reason } };
  }
}

export default { testProviderConnection };
