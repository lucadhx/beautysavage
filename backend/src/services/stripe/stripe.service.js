import crypto from 'node:crypto';
import { config } from '../../config/env.js';
import { tryGetCredential } from '../integratedApi.service.js';
import { resolveProviderEnvironment } from '../integratedApiEnvironment.js';
import {
  PAYMENT_TYPE,
  SUBSCRIPTION_STATUS,
  CURRENCY,
} from '../../utils/contractConstants.js';

/**
 * Orchestration Stripe : Checkout (frais uniques + abonnement), vérification de
 * webhook (schéma Stripe), mapping des statuts. Aucune logique dans les
 * contrôleurs — tout passe ici. Montants en CENTIMES (TTC comme unit_amount ;
 * la TVA est calculée et affichée par l'application).
 */

/**
 * ── L6.3C — IL N'Y A PLUS DE PILOTE STRIPE DANS CE PROJET ──────────────────
 *
 * `getStripeProvider()` vivait ici depuis l'origine. Elle rendait, selon
 * l'environnement, le vrai client Stripe ou son double de test — et c'est par
 * elle que passaient les treize verbes que les lots L6.2B→L6.3B ont migrés un
 * par un.
 *
 * Le dernier, `retrievePaymentIntent`, est parti avec ce lot. Le pilote et son
 * double ont donc été SUPPRIMÉS, et avec eux :
 *
 *   · le seul `import Stripe from 'stripe'` du projet ;
 *   · le seul `new Stripe(...)` ;
 *   · la seule lecture métier de la clé secrète.
 *
 * Ce fichier ne garde que ce qui ne parle PAS à Stripe : la vérification
 * cryptographique des webhooks entrants (avec un `whsec_`, qui ne permet aucun
 * appel), la traduction des statuts, et les metadata d'audit.
 *
 * La distinction est le cœur du lot : un secret de VÉRIFICATION reste
 * légitimement local tant que Stripe écrit directement au projet ; une clé
 * d'APPEL n'a plus aucune raison d'y être.
 */

/**
 * Métadonnées rattachant un objet Stripe à un contrat + traçabilité d'audit :
 *  - `providerMode` : mode Stripe ACTIF ayant servi à créer l'objet (source des clés) ;
 *  - `applicationEnvironment` : ENV applicatif (informatif) — indépendant du mode.
 * Ces métadonnées servent l'audit/réconciliation, PAS la vérification (qui reste
 * cryptographique).
 */
async function metadataFor(contract, paymentType, extra = {}) {
  return {
    contractId: String(contract._id),
    paymentType,
    providerMode: resolveProviderEnvironment('STRIPE'),
    applicationEnvironment: config.env,
    ...extra,
  };
}

/**
 * ── LES FRAIS DE LANCEMENT NE PASSENT PLUS PAR ICI (L6.2B) ──────────────────
 *
 * `createLaunchFeeCheckout()` construisait les paramètres de la session, puis
 * appelait `provider.createCheckoutSession()` avec la clé Stripe du PROJET.
 * Elle décidait donc du montant, du compte et du monde — trois décisions que
 * rien ne pouvait confronter en dehors de ce fichier.
 *
 * Le chemin est désormais `billing.checkout.create` : le Panel lit le montant
 * dans sa propre projection de contrat, choisit le monde depuis le runtime de
 * l'instance, ouvre la session avec SA clé, et lie la session au projet avant
 * de la rendre. Voir `checkoutCapability.js`.
 *
 * La fonction est SUPPRIMÉE, pas désactivée. Un constructeur de paramètres
 * laissé en place « au cas où » est un repli qui attend son incident : il
 * suffirait d'un appel oublié pour que de l'argent reparte par l'ancienne
 * porte, sans que rien ne le signale — même raison qu'au retrait du pilote
 * Brevo local (L8.2) et du repli DNS (L9.2).
 *
 * `createSubscriptionCheckout` ci-dessous RESTE locale, et ce n'est pas un
 * oubli : une session d'abonnement référence un Customer et un Price Stripe
 * créés avant elle, et ces trois créations sont hors du périmètre de L6.2B.
 * Les migrer à moitié produirait une session qui référence les objets d'un
 * autre compte.
 */

/**
 * ── L'ABONNEMENT NE PASSE PLUS PAR ICI NON PLUS (L6.2E) ─────────────────────
 *
 * `createSubscriptionCheckout()` construisait les paramètres de la session
 * d'abonnement — `mode: subscription`, le client, le tarif — et appelait
 * `provider.createCheckoutSession()` avec la clé Stripe du PROJET.
 *
 * Elle ne pouvait pas être migrée avant ce lot : sa session référence un client
 * et un tarif créés AVANT elle, et le Panel n'en possédait aucun. L6.2D lui a
 * donné le client, L6.2E le tarif ; la session peut donc être composée
 * entièrement de son côté.
 *
 * Supprimée, pas désactivée — voir `subscription.service.js` pour la raison.
 *
 * `createCheckoutSession` reste sur le provider : plus aucun parcours ne
 * l'appelle, mais le pilote sert encore d'autres verbes (portail, résiliations,
 * lectures d'abonnement et de facture). On ne retire pas un pilote encore requis.
 */

/**
 * ── LES RÉSILIATIONS NE PASSENT PLUS PAR ICI (L6.2G) ────────────────────────
 *
 * `cancelSubscriptionAtPeriodEnd()` posait le drapeau de fin de période avec la
 * clé Stripe du PROJET. Sa jumelle immédiate, elle, était appelée directement
 * sur le pilote depuis trois endroits — et SANS aucune clé d'idempotence.
 * C'était le plus vieux défaut connu du parc, relevé en L6.1 et confirmé à
 * chaque lot depuis : un double clic produisait deux appels réels.
 *
 * Les deux passent désormais par le Control Plane, qui vérifie l'appartenance
 * de l'abonnement, dérive l'identité de l'acte, et RELIT SON ÉTAT avant de
 * muter — une résiliation laisse une trace non ambiguë, ce qui rend la reprise
 * après réponse perdue sûre sans jamais recouper.
 *
 * Supprimée, pas désactivée : un constructeur inutilisé est le repli du
 * prochain incident.
 *
 * Le PILOTE conserve ses deux verbes — plus aucun parcours ne les appelle, mais
 * on ne retire pas un pilote qui sert encore d'autres lectures.
 */


/**
 * Mapper CENTRALISÉ (et testé) statut Stripe → statut interne (projection). Le
 * contexte `cancelAtPeriodEnd` distingue un abonnement actif d'un abonnement actif
 * mais résilié en fin de période. Aucun mapping dispersé dans les contrôleurs.
 *
 *   trialing → TRIALING · active → ACTIVE (ou CANCEL_AT_PERIOD_END) · past_due →
 *   PAST_DUE · unpaid → UNPAID · paused → PAUSED · incomplete → INCOMPLETE ·
 *   incomplete_expired → FAILED · canceled → ENDED (fin effective).
 */
export function mapSubscriptionStatus(stripeStatus, { cancelAtPeriodEnd = false } = {}) {
  switch (stripeStatus) {
    case 'trialing':
      return SUBSCRIPTION_STATUS.TRIALING;
    case 'active':
      return cancelAtPeriodEnd ? SUBSCRIPTION_STATUS.CANCEL_AT_PERIOD_END : SUBSCRIPTION_STATUS.ACTIVE;
    case 'past_due':
      return SUBSCRIPTION_STATUS.PAST_DUE;
    case 'unpaid':
      return SUBSCRIPTION_STATUS.UNPAID;
    case 'paused':
      return SUBSCRIPTION_STATUS.PAUSED;
    case 'incomplete':
      return SUBSCRIPTION_STATUS.INCOMPLETE;
    case 'incomplete_expired':
      return SUBSCRIPTION_STATUS.FAILED;
    case 'canceled':
      return SUBSCRIPTION_STATUS.ENDED;
    default:
      return SUBSCRIPTION_STATUS.NONE;
  }
}

/**
 * Vérifie l'authenticité d'un webhook Stripe (schéma officiel).
 * Header `Stripe-Signature` = "t=<ts>,v1=<hmac>". HMAC-SHA256 sur `${t}.${rawBody}`.
 * rawBody DOIT être le corps brut. Comparaison à temps constant + tolérance.
 */
export function verifyWebhookSignature(rawBody, sigHeader, secret, { toleranceSec = 300, nowSec } = {}) {
  if (!sigHeader || !secret) return false;
  const parts = {};
  for (const kv of String(sigHeader).split(',')) {
    const idx = kv.indexOf('=');
    if (idx === -1) continue;
    const k = kv.slice(0, idx).trim();
    const v = kv.slice(idx + 1).trim();
    if (parts[k] === undefined) parts[k] = v;
  }
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  if (toleranceSec) {
    const now = nowSec ?? Math.floor(Date.now() / 1000);
    if (Math.abs(now - Number(t)) > toleranceSec) return false;
  }
  return true;
}

/**
 * Vérifie un webhook Stripe — DANS LE MONDE DE CETTE INSTANCE, et lui seul.
 *
 * ── CE QUI A ÉTÉ RETIRÉ AU LOT L2 ───────────────────────────────────────────
 *
 * Cette fonction essayait le secret du mode actif, PUIS celui de l'autre monde,
 * « pour reconnaître un événement retardé après un basculement ». Ce repli
 * n'avait de sens que tant qu'un basculement existait : `activeMode` a été
 * révoqué, il n'y a plus de bascule à rattraper, et essayer l'autre monde
 * reviendrait à accepter un événement de production sur une recette.
 *
 * Un seul secret est donc essayé : celui du monde du runtime. Le nom de la
 * fonction est conservé — ses appelants sont nombreux et son contrat de sortie
 * n'a pas changé — mais « AnyMode » est désormais un vestige : il n'y a qu'un
 * mode.
 *
 * `activeMode` reste dans la réponse pour le diagnostic, et vaut toujours le
 * mode résolu : les appelants qui comparaient `matchedMode === activeMode`
 * continuent de fonctionner, et leur comparaison devient tautologique — c'est
 * exactement ce qu'on veut.
 *
 * @returns {Promise<{verified:boolean, matchedMode:string|null, activeMode:string}>}
 */
export async function verifyStripeWebhookAnyMode(rawBody, sigHeader) {
  const mode = resolveProviderEnvironment('STRIPE');
  const secret = await tryGetCredential('STRIPE', 'webhookSecret', { mode });
  if (secret && verifyWebhookSignature(rawBody, sigHeader, secret)) {
    return { verified: true, matchedMode: mode, activeMode: mode };
  }
  // AUCUN repli sur l'autre monde : un événement qu'on ne sait pas vérifier
  // ici n'est pas à nous.
  return { verified: false, matchedMode: null, activeMode: mode };
}

/** Construit un header Stripe-Signature valide (tests/outillage). */
export function buildTestSignatureHeader(rawBody, secret, timestamp) {
  const t = timestamp;
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

export default {
  mapSubscriptionStatus,
  verifyWebhookSignature,
};
