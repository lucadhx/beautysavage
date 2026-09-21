import { STRIPE_HANDLED_EVENTS } from '../../utils/stripeEventRegistry.js';
import { PROJECT_ID } from '../../deployment-engine/config/project.profile.js';
import { resolvePublicBackendUrl } from '../networkConfig.service.js';

/**
 * REGISTRE des webhooks GÉRÉS — le contrat générique `provider + category + mode`.
 *
 * Un webhook géré est un webhook que l'application installe et réconcilie
 * ELLE-MÊME chez le fournisseur. Le registre est code-first : il décrit, pour
 * chaque couple provider/category, la route locale, les événements attendus et
 * la référence du secret — jamais les secrets eux-mêmes, jamais les clés API.
 *
 * R11 — IL N'EN RESTE QU'UN : STRIPE. Les événements viennent d'un registre
 * code-first (`stripeEventRegistry`) : ceux réellement traités par le backend,
 * ni plus ni moins.
 *
 * ── CONSTRUCTION D'URL — UN SEUL ENDROIT ────────────────────────────────────
 * `buildWebhookUrl()` est l'unique fabricant d'URL de webhook du projet :
 * `<publicBackendUrl>/api/webhooks/<segments>`. La configuration ne stocke
 * JAMAIS une route complète — seulement la racine publique ; les routes sont
 * calculées, donc toujours alignées sur le code réellement déployé.
 */

export const MANAGED_WEBHOOKS = Object.freeze({
  STRIPE: Object.freeze({
    payment: Object.freeze({
      provider: 'STRIPE',
      category: 'payment',
      // Route RÉELLE : /api/webhooks/stripe — SANS mode. TEST et PROD partagent
      // la même URL ; l'aiguillage est cryptographique (verify*AnyMode) et
      // l'identification distante passe par la DESCRIPTION, jamais par l'URL.
      routeSegments: () => ['stripe'],
      expectedEvents: STRIPE_HANDLED_EVENTS,
      secretReference: 'webhookSecret',
      authentication: 'HMAC',
      remoteSync: true, // /v1/webhook_endpoints : CRUD complet, secret renvoyé à la création
    }),
  }),
  /**
   * R11 — BREVO A QUITTÉ CE REGISTRE, POUR LA MÊME RAISON QUE YOUSIGN.
   *
   * Les e-mails partent du compte Brevo DU PANEL : les événements de livraison
   * suivent le compte, donc arrivent au Panel, qui les reprojette par le pont.
   * L'entrée décrivait une route locale `/brevo/transactional/:mode` que Brevo
   * n'appelait plus, et un `webhookSecret` que ce projet n'a plus à détenir.
   *
   * Le premier écran de diagnostic qui l'aurait lue aurait envoyé un opérateur
   * réparer un point de terminaison mort.
   */

  /**
   * R10.5C — YOUSIGN A QUITTÉ CE REGISTRE.
   *
   * La signature est administrée par la plateforme : le webhook arrive au
   * Panel, pas ici. Laisser l entrée aurait été pire qu inutile — elle
   * déclarait une route locale « /yousign » qui n existe plus et un
   * « webhookSecret » que ce projet ne détient plus. Le premier écran de
   * diagnostic qui l aurait lue aurait envoyé un opérateur provisionner un
   * point de terminaison mort.
   */
});

/** Entrée du registre, ou erreur explicite (jamais un undefined silencieux). */
export function managedWebhookSpec(provider, category) {
  const spec = MANAGED_WEBHOOKS[String(provider).toUpperCase()]?.[category];
  if (!spec) throw new Error(`Webhook géré inconnu : ${provider}/${category}.`);
  return spec;
}

/**
 * Construit l'URL COMPLÈTE d'un webhook géré à partir de la racine publique.
 * Centralisé : toute autre construction d'URL de webhook est une régression.
 *
 * @param {{provider: string, category: string, mode: 'TEST'|'PROD', publicBackendUrl: string}} args
 * @returns {string} URL absolue, ou '' si la racine est absente.
 */
export function buildWebhookUrl({ provider, category, mode, publicBackendUrl }) {
  const base = String(publicBackendUrl || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  const spec = managedWebhookSpec(provider, category);
  return `${base}/api/webhooks/${spec.routeSegments(mode).join('/')}`;
}

/**
 * URL ATTENDUE d'un webhook géré, résolue automatiquement (ngrok en dev TEST,
 * Config Système écrite par le déploiement en PROD).
 *
 * @returns {Promise<{url: string, publicBackendUrl: string, source: string, webhookReady: boolean, code?: string}>}
 */
export async function expectedWebhookUrl(provider, category, mode) {
  const resolved = await resolvePublicBackendUrl(mode);
  return {
    url: resolved.webhookReady
      ? buildWebhookUrl({ provider, category, mode, publicBackendUrl: resolved.url })
      : '',
    publicBackendUrl: resolved.url,
    source: resolved.source,
    webhookReady: resolved.webhookReady,
    ...(resolved.code ? { code: resolved.code } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/*  Description distante stable (identification chez le fournisseur)          */
/* -------------------------------------------------------------------------- */

/**
 * Convention de description CANONIQUE — identité du webhook chez le
 * fournisseur, indépendante du domaine (un domaine change, l'identité reste).
 * `installationId` (facultatif, env `WEBHOOK_INSTALLATION_ID`) distingue
 * plusieurs installations partageant un même compte fournisseur.
 */
export function managedWebhookDescription(provider, category, mode, { installationId } = {}) {
  /**
   * ══ L'IDENTITÉ NOMME LE PROJET, PAS LA FABRIQUE ═══════════════════════════
   *
   * Le préfixe valait `SB_AUTO_06_MANAGED_…` en dur. Sur un parc d'un seul
   * projet, cela ressemblait à une constante ; ce n'en est pas une. Deux
   * projets partageant un compte fournisseur auraient revendiqué la MÊME
   * description — et la réconciliation de l'un aurait adopté, réécrit ou
   * supprimé l'endpoint de l'autre, chez le fournisseur, sans rien casser
   * localement.
   *
   * Le slug du projet est déjà l'identité technique que la duplication
   * réécrit ; c'est lui qui doit porter cette revendication.
   */
  const prefixe = PROJECT_ID.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const base = `${prefixe}_MANAGED_${String(provider).toUpperCase()}_${String(category).toUpperCase()}_${String(mode).toUpperCase()}`;
  const install = installationId ?? process.env.WEBHOOK_INSTALLATION_ID ?? '';
  return install ? `${base}#${install}` : base;
}

/**
 * Descriptions LEGACY encore reconnues comme NÔTRES (adoption/migration) :
 * les webhooks créés avant la convention canonique portent l'ancienne phrase.
 * Reconnues en LECTURE (identification, dédoublonnage) ; toute écriture
 * (POST/PUT) repose la description canonique — la migration est automatique.
 */
export function legacyManagedWebhookDescriptions(provider, category, mode) {
  /**
   * ══ CETTE LISTE N'APPARTIENT QU'AU PROJET QUI A CRÉÉ CES WEBHOOKS ═════════
   *
   * Elle sert à ADOPTER un endpoint distant en le reconnaissant comme nôtre.
   * Rendue inconditionnellement, elle ferait adopter, par tout projet issu de
   * la fabrique, les webhooks historiques de `sbauto06` — c'est-à-dire ceux
   * d'un autre client, sur un compte fournisseur partagé. La reconnaissance
   * est donc bornée au projet qui les a réellement posés.
   */
  if (PROJECT_ID !== 'sbauto06') return [];
  if (String(provider).toUpperCase() === 'BREVO' && category === 'transactional') {
    return [`SBauto06 transactional delivery tracking - ${String(mode).toUpperCase()}`];
  }
  /**
   * ══ LA FORME QUE CE PROJET PORTAIT AVANT QUE LE PRÉFIXE SOIT DÉRIVÉ ═══════
   *
   * Le préfixe canonique valait `SB_AUTO_06_MANAGED_…`, écrit en dur. Il est
   * maintenant dérivé de `PROJECT_ID`, ce qui donne `SBAUTO06_MANAGED_…` pour
   * ce projet-ci : la même identité, écrite autrement.
   *
   * Sans cette ligne, la réconciliation cesserait de reconnaître l'endpoint
   * Stripe DÉJÀ ENREGISTRÉ chez le fournisseur — elle en créerait un second,
   * et le premier continuerait de livrer dans le vide. Le renommage d'une
   * identité doit toujours emporter la reconnaissance de l'ancienne, sans quoi
   * il ne renomme pas : il abandonne.
   *
   * Toute écriture repose la description canonique : la migration est faite au
   * premier passage, et cette ligne devient inerte d'elle-même.
   */
  const historique = `SB_AUTO_06_MANAGED_${String(provider).toUpperCase()}`
    + `_${String(category).toUpperCase()}_${String(mode).toUpperCase()}`;
  return [historique];
}

/** Une description distante nous appartient-elle avec CERTITUDE ? */
export function isManagedDescription(description, provider, category, mode) {
  const d = String(description || '');
  if (!d) return false;
  const canonical = managedWebhookDescription(provider, category, mode);
  // Même identité canonique, avec ou sans identifiant d'installation : le
  // préfixe complet (provider+category+mode) suffit à la certitude.
  const prefix = canonical.split('#')[0];
  if (d === canonical || d === prefix || d.startsWith(`${prefix}#`)) return true;
  return legacyManagedWebhookDescriptions(provider, category, mode).includes(d);
}
