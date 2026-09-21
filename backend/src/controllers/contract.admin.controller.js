import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { getSingleton } from '../utils/singleton.js';
import { SystemConfiguration } from '../models/SystemConfiguration.model.js';
import * as svc from '../services/contract.service.js';
import * as paymentSvc from '../services/payment.service.js';
import * as subscriptionSvc from '../services/subscription.service.js';
import { reconcileSiteStatus } from '../services/siteEnforcement.service.js';
import { logContractAudit } from '../models/ContractAuditLog.model.js';
import { CONTRACT_AUDIT_ACTION } from '../utils/contractConstants.js';
import {
  billingReadiness,
  describeClientCompany,
  signingReadiness,
} from '../services/panelConfiguration/clientCompany.service.js';

/**
 * Contrat — parcours ADMIN (client). L'ADMIN n'accède qu'à SON contrat (le
 * contrat vivant/activable), jamais à un contrat arbitraire. L'activation finale
 * est la SEULE activation ADMIN autorisée, et revérifiée côté backend.
 */

async function adminContractOr404() {
  const contract = await svc.findAdminContract();
  if (!contract) throw ApiError.notFound('Aucun contrat disponible.');
  return contract;
}

/**
 * ── NO CLIENT COMPANY → NO PAYMENT, NO SIGNATURE ─────────────────────────
 *
 * ══ POURQUOI CETTE GARDE EXISTE ICI, ALORS QUE LE PANEL REFUSE DÉJÀ ══════
 *
 * Le Panel est l’AUTORITÉ : il refuse d’ouvrir une session Stripe sans
 * identité de facturation, et d’ouvrir une signature sans signataire. Son
 * refus tombe avant tout contact fournisseur, et rien ne le contourne.
 *
 * Cette garde-ci ne protège donc pas — elle EXPLIQUE, et elle explique AVANT.
 *
 * Sans elle, un client sans entreprise cliquerait « Payer », attendrait
 * l’ouverture de Stripe, et recevrait une erreur venue du plan de contrôle,
 * formulée dans le vocabulaire du plan de contrôle. Avec elle, il lit ce qui
 * manque et QUI doit agir — et il ne clique pas dans le vide.
 *
 * ══ LE MESSAGE NE DIT JAMAIS « CONFIGUREZ ICI » ══════════════════════════
 *
 * Parce qu’aucun écran de ce Manager ne porte ces champs, et qu’il ne doit
 * jamais en porter. L’identité juridique du client est ce qui figure sur ses
 * factures : la lui laisser modifier reviendrait à lui laisser choisir sur
 * quelle entité il est facturé.
 */
/**
 * ── 409, ET NON 400 ────────────────────────────────────────────────────────
 *
 * La requête est parfaitement formée : rien à corriger dedans. C’est l’ÉTAT du
 * dossier client qui interdit l’action. Un 400 dirait au client « votre requête
 * est mauvaise », ce qui est faux et le laisserait chercher dans ses données ;
 * un 409 dit « la situation ne le permet pas », ce qui est exact et désigne le
 * bon interlocuteur.
 */
async function assertClientCompanyBillable() {
  const verdict = await billingReadiness();
  if (verdict.ready) return;
  throw ApiError.conflict(
    verdict.linked
      ? "Les informations légales de votre entreprise doivent être complétées par "
        + "L.Y Solution avant de pouvoir effectuer un paiement."
      : "Aucune information sur votre entreprise n’est actuellement rattachée à ce projet : "
        + "le paiement est indisponible tant que L.Y Solution n’a pas complété votre dossier.",
    { code: 'CLIENT_COMPANY_NOT_READY', state: verdict.state, missing: verdict.missing },
  );
}

async function assertClientCompanySignable() {
  const verdict = await signingReadiness();
  if (verdict.ready) return;
  throw ApiError.conflict(
    verdict.linked
      ? "La signature du contrat est indisponible tant que le signataire contractuel de votre "
        + "entreprise n’a pas été configuré par L.Y Solution."
      : "La signature du contrat est indisponible tant que votre entreprise et son signataire "
        + "contractuel ne sont pas configurés par L.Y Solution.",
    { code: 'CLIENT_COMPANY_NOT_READY', state: verdict.state, missing: verdict.missing },
  );
}

async function returnUrls() {
  const cfg = await getSingleton(SystemConfiguration);
  const managerUrl = (cfg.network?.managerUrl || '').replace(/\/$/, '');
  return {
    launch: {
      // Le backend construit lui-même les URLs (jamais fournies par le front).
      // Stripe substitue {CHECKOUT_SESSION_ID} ; la présence de session_id ne vaut
      // JAMAIS confirmation (la page interroge le backend / attend le webhook).
      successUrl: `${managerUrl}/contrat/retour-paiement?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${managerUrl}/contrat/retour-paiement?status=cancel`,
    },
    // Retour du portail : la page « mon contrat », qui relira l'état réel.
    // Le retour navigateur ne PROUVE rien — la vérité vient des webhooks.
    billingPortal: { returnUrl: `${managerUrl}/contrat` },
    subscription: {
      // Le backend construit les URLs (jamais fournies par le front). session_id
      // ne vaut jamais confirmation (la page interroge le backend / attend le webhook).
      successUrl: `${managerUrl}/contrat/retour-abonnement?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${managerUrl}/contrat/retour-abonnement?status=cancel`,
    },
  };
}

export const getMyContract = asyncHandler(async (req, res) => {
  const contract = await svc.findAdminContract();
  if (!contract) return ok(res, null);
  return ok(res, svc.serializeContract(contract, { role: 'ADMIN' }));
});

export const getActivation = asyncHandler(async (req, res) => {
  const contract = await adminContractOr404();
  /**
   * ── L’ÉTAT DE L’ENTREPRISE CLIENTE VOYAGE AVEC L’ACTIVATION ────────────
   *
   * L’écran d’activation décide quoi montrer : un bouton « Payer », un
   * bouton « Signer », ou un message expliquant ce qui manque. Sans cette
   * information, il ne pourrait que proposer des boutons que le backend
   * refuserait — une interface qui contredit sa propre garde.
   *
   * On rend le VERDICT publié par le Panel, jamais un recalcul local : deux
   * calculs pour une même question finissent par se contredire.
   */
  const client = await describeClientCompany();
  return ok(res, {
    contract: svc.serializeContract(contract, { role: 'ADMIN' }),
    activation: svc.activationView(contract),
    clientCompany: {
      linked: client.linked,
      legalName: client.company?.legalName ?? null,
      readiness: client.readiness,
    },
  });
});

/** GET /my-contract/timeline — timeline du contrat de l'ADMIN. */
export const timeline = asyncHandler(async (req, res) => {
  const contract = await adminContractOr404();
  return ok(res, await svc.getContractTimeline(contract._id));
});

export const startSignature = asyncHandler(async (req, res) => {
  const contract = await adminContractOr404();
  await assertClientCompanySignable();
  const signatureLink = await svc.getAdminSignatureLink(contract);
  return ok(res, { signatureLink });
});

/**
 * Crée (ou réutilise) la Checkout Session des frais de lancement. Toutes les
 * conditions sont revérifiées côté backend (assertLaunchFeePayable) — le frontend
 * n'est jamais la seule protection. Le montant vient du snapshot verrouillé.
 */
export const createLaunchCheckout = asyncHandler(async (req, res) => {
  const contract = await adminContractOr404();
  await assertClientCompanyBillable();
  paymentSvc.assertLaunchFeePayable(contract); // gate backend -> LAUNCH_FEE_NOT_PAYABLE
  await svc.assertProviderReady('STRIPE'); // Stripe requis AU POINT D'USAGE (paiement)
  await svc.beginActivation(contract);
  const urls = (await returnUrls()).launch;
  const result = await paymentSvc.createOrReuseLaunchCheckout(contract, urls, req.user);
  return ok(res, { url: result.url, reused: Boolean(result.reused), alreadyPaid: Boolean(result.alreadyPaid) });
});

/** GET /my-contract/launch-fee-status — statut public des frais (sans donnée Stripe sensible). */
export const launchFeeStatus = asyncHandler(async (req, res) => {
  const contract = await adminContractOr404();
  return ok(res, await paymentSvc.getLaunchFeeStatus(contract));
});

/**
 * Crée (ou réutilise) la Checkout Session d'abonnement. Conditions revérifiées
 * backend (assertSubscriptionPayable) — le frontend n'est jamais la seule
 * protection. Montant issu du snapshot verrouillé (Price Stripe immuable).
 */
export const createSubscriptionCheckout = asyncHandler(async (req, res) => {
  const contract = await adminContractOr404();
  await assertClientCompanyBillable();
  subscriptionSvc.assertSubscriptionPayable(contract); // gate -> SUBSCRIPTION_NOT_PAYABLE
  await svc.assertProviderReady('STRIPE'); // Stripe requis AU POINT D'USAGE (paiement)
  await svc.beginActivation(contract);
  const urls = (await returnUrls()).subscription;
  const result = await subscriptionSvc.createOrReuseSubscriptionCheckout(contract, urls, req.user);
  // Session déjà complète : rien à repayer. On rend l'état réconcilié plutôt
  // qu'une URL — renvoyer l'utilisateur chez Stripe lui afficherait « Vous avez
  // terminé » sur un parcours que l'application croit encore à faire.
  if (result.alreadyPaid) {
    return ok(res, {
      url: null,
      reused: false,
      alreadyPaid: true,
      subscription: subscriptionSvc.getSubscriptionStatus(contract),
    });
  }
  return ok(res, { url: result.url, reused: Boolean(result.reused) });
});

/**
 * POST /my-contract/billing-portal — session de portail client Stripe.
 *
 * L'ADMIN est déjà garanti par la route (`authorize(ADMIN)`), et le contrat est
 * résolu depuis la session — jamais par un identifiant venu du navigateur. La
 * réponse ne contient QUE l'URL : ni identifiant client, ni identifiant
 * d'abonnement n'ont de raison de sortir.
 */
export const createBillingPortal = asyncHandler(async (req, res) => {
  const contract = await adminContractOr404();
  await svc.assertProviderReady('STRIPE'); // Stripe requis AU POINT D'USAGE
  const { returnUrl } = (await returnUrls()).billingPortal;
  const result = await subscriptionSvc.openBillingPortal(contract, returnUrl);
  // Aucun secret n'est tracé : on note QUE l'ouverture, pas ce qui s'y passe.
  await logContractAudit({
    contractId: contract._id,
    action: CONTRACT_AUDIT_ACTION.BILLING_PORTAL_OPENED,
    actorType: 'ADMIN',
    actorId: req.user?._id ?? null,
    provider: 'STRIPE',
  });
  return ok(res, { url: result.url });
});

/** GET /my-contract/payment-method — ce que l'ADMIN peut voir, et rien de plus. */
export const paymentMethod = asyncHandler(async (req, res) => {
  const contract = await adminContractOr404();
  return ok(res, subscriptionSvc.getPaymentMethodView(contract));
});

/** GET /my-contract/subscription-status — statut public de l'abonnement (sans secret). */
export const subscriptionStatus = asyncHandler(async (req, res) => {
  const contract = await adminContractOr404();
  return ok(res, subscriptionSvc.getSubscriptionStatus(contract));
});

/**
 * POST /my-contract/subscription/reconcile — demande à Stripe où l'on en est.
 *
 * C'est la réparation du produit : jusqu'ici, seul un webhook pouvait faire
 * avancer un abonnement, et un webhook perdu bloquait le contrat pour toujours.
 *
 * Le contrat vient de la session, les identifiants Stripe du serveur : le
 * navigateur ne fournit RIEN. Idempotent — appelable à volonté, y compris par
 * la page de retour, sans jamais créer de souscription.
 */
export const reconcileSubscription = asyncHandler(async (req, res) => {
  const contract = await adminContractOr404();
  await svc.assertProviderReady('STRIPE');
  const etat = await subscriptionSvc.reconcileAndDescribe(contract, { actor: req.user });
  if (etat.changed) {
    // L'état a bougé : le reste du parcours doit en tenir compte tout de suite.
    await reconcileSiteStatus({ actor: req.user }).catch(() => {});
  }
  return ok(res, etat);
});

export const activate = asyncHandler(async (req, res) => {
  const contract = await adminContractOr404();
  await svc.activateContract(contract, req.user);
  await reconcileSiteStatus({ actor: req.user }); // bascule le site en actif
  return ok(res, svc.serializeContract(contract, { role: 'ADMIN' }));
});

export const cancel = asyncHandler(async (req, res) => {
  const contract = await adminContractOr404();
  await svc.requestCancellation(contract, req.user);
  return ok(res, svc.serializeContract(contract, { role: 'ADMIN' }));
});
