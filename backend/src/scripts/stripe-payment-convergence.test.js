/* CONVERGENCE DES PAIEMENTS STRIPE — la redirection n'est jamais une preuve.
 *
 * ══ CE QUE CETTE SUITE PROUVE, ET QU'AUCUNE AUTRE NE PROUVAIT ══════════════
 *
 * Trois défauts réels, observés le 21 août 2026 sur la recette TEST, ont laissé
 * un contrat PAYÉ bloqué sur un écran « Paiement à confirmer » :
 *
 *  1. `reconcileAndDescribe` levait une `ReferenceError` sur un argument
 *     résiduel — le bouton « Vérifier le paiement » rendait 500, à tous les
 *     coups, donc la seule réparation manuelle du produit était morte ;
 *
 *  2. `customer.subscription.created`, livré APRÈS `invoice.paid` mais porteur
 *     d'un instantané ANTÉRIEUR, faisait régresser l'abonnement de ACTIVE vers
 *     INCOMPLETE — un encaissement défait par un webhook plus vieux que lui ;
 *
 *  3. aucun événement métier n'était émis sur un règlement d'abonnement : le
 *     client ne recevait jamais de confirmation, ni pour son premier
 *     prélèvement ni pour aucun des suivants.
 *
 * Chacun est ici reproduit dans les conditions qui l'ont produit, puis vérifié
 * corrigé. Les trois sont indépendants du navigateur : aucune assertion de
 * cette suite ne charge une URL de retour, ne lit un `session_id`, ni ne
 * suppose qu'un onglet est resté ouvert.
 *
 * Aucun réseau, aucun Stripe, aucun Panel réel. Runner autonome. */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.ENV = 'TEST';
process.env.MONGODB_URI = mongod.getUri();
process.env.DB_TEST = 'test_base';
process.env.DB_PROD = 'prod_base';
process.env.JWT_SECRET = 'test-secret-jwt';
process.env.PORT = '4171';
process.env.CORS_ORIGINS = 'http://localhost:6061';
process.env.INTEGRATED_API_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function section(n) { console.log(`\n${n}`); }

const { connectDatabase, disconnectDatabase } = await import('../config/db.js');
await connectDatabase();

const { Contract } = await import('../models/Contract.model.js');
const { Payment } = await import('../models/Payment.model.js');
const { DomainEvent } = await import('../models/DomainEvent.model.js');
const {
  CONTRACT_STATUS, PAYMENT_TYPE, PAYMENT_STATUS, SUBSCRIPTION_STATUS,
} = await import('../utils/contractConstants.js');
const subscriptionSvc = await import('../services/subscription.service.js');

/* ──────────────────────────────────────────────────────────────────────────
   UN CONTRAT PAYÉ, TEL QUE LE PARCOURS RÉEL LE LAISSE.
   ────────────────────────────────────────────────────────────────────────── */

let n = 0;
async function contratAbonne({ statut = SUBSCRIPTION_STATUS.CHECKOUT_CREATED } = {}) {
  n += 1;
  return Contract.create({
    reference: `CTR-2026-9${String(n).padStart(3, '0')}`,
    name: 'Contrat de convergence',
    status: CONTRACT_STATUS.ACTIVATION_IN_PROGRESS,
    environment: 'TEST',
    signatureRequirement: 'NOT_REQUIRED',
    pricing: {
      launchFee: { enabled: false },
      subscription: {
        enabled: true, amountExcludingTax: 7999, taxAmount: 1600, amountIncludingTax: 9599, currency: 'EUR',
      },
    },
    stripe: {
      customerId: 'cus_convergence',
      subscription: { status: statut, subscriptionId: `sub_conv_${n}` },
    },
  });
}

/** La facture telle que le webhook `invoice.paid` la remet. */
const factureStripe = (id, subId) => ({
  id,
  subscription: subId,
  amount_paid: 9599,
  total: 9599,
  currency: 'eur',
  status: 'paid',
  number: 'CONV-0001',
  period_end: Math.floor(Date.parse('2026-09-21T10:00:00Z') / 1000),
});

/** L'abonnement tel qu'un événement le transporte — un INSTANTANÉ, pas un état. */
const instantane = (id, statut, invoiceId) => ({
  id,
  status: statut,
  cancel_at_period_end: false,
  latest_invoice: invoiceId,
  customer: 'cus_convergence',
  current_period_start: Math.floor(Date.parse('2026-08-21T10:00:00Z') / 1000),
  current_period_end: Math.floor(Date.parse('2026-09-21T10:00:00Z') / 1000),
});

// ═══════════════════════════════════════════════════════════════════════════
section('1 · « VÉRIFIER LE PAIEMENT » RÉPOND — il ne lève plus une ReferenceError');
{
  /**
   * LE DÉFAUT, TEL QU'IL SE MANIFESTAIT.
   *
   * `reconcileAndDescribe` appelait `reconcileSubscription(contract, {actor},
   * provider)` — un troisième argument résiduel d'un refactor, dont plus aucune
   * liaison n'existait dans le module. En ESM, donc en mode strict, lire un
   * identifiant non déclaré lève : la fonction échouait à sa PREMIÈRE ligne,
   * avant toute lecture, pour tous les contrats et toutes les situations.
   *
   * Le symptôme côté client était un toast « erreur serveur » sur le seul
   * bouton capable de réparer un abonnement bloqué.
   *
   * On appelle donc la fonction sans aucun décor : ce qu'on éprouve n'est pas
   * la réconciliation — elle sort tôt, faute d'identifiant lisible — mais le
   * fait qu'elle RÉPONDE au lieu de lever.
   */
  const contrat = await contratAbonne();
  let leve = null;
  let etat = null;
  try { etat = await subscriptionSvc.reconcileAndDescribe(contrat, {}); } catch (e) { leve = e; }

  check('la vérification ne lève plus', leve === null);
  check('…et surtout plus une ReferenceError', !(leve instanceof ReferenceError));
  check('elle rend un état métier, pas un statut brut', typeof etat?.outcome === 'string');
  check('elle est idempotente : rien n’a changé', etat?.changed === false);
  check('l’état rendu est celui du contrat', etat?.status === SUBSCRIPTION_STATUS.CHECKOUT_CREATED);
}

// ═══════════════════════════════════════════════════════════════════════════
section('2 · UN INSTANTANÉ PÉRIMÉ NE DÉFAIT PAS UN ENCAISSEMENT');
{
  /**
   * L'ORDRE EXACT DU 21 AOÛT, À LA MILLISECONDE PRÈS.
   *
   *   10:32:03.370  invoice.paid                   → ACTIVE
   *   10:32:03.504  customer.subscription.updated
   *   10:32:03.563  customer.subscription.created  → « incomplete »
   *
   * Le dernier arrivé est le plus ANCIEN : `customer.subscription.created`
   * décrit l'abonnement à sa naissance, c'est-à-dire avant le règlement de sa
   * première facture. Sans garde, il écrasait ACTIVE — et le parcours client se
   * bloquait sur « Paiement à confirmer » sans qu'aucun webhook ultérieur ne
   * vienne le défaire.
   */
  const contrat = await contratAbonne();
  const invoiceId = 'in_conv_ordre';

  await subscriptionSvc.markInvoicePaid(contrat, factureStripe(invoiceId, contrat.stripe.subscription.subscriptionId), {
    observedAt: new Date('2026-08-21T10:32:03.370Z'),
  });
  check('la facture payée active l’abonnement',
    contrat.stripe.subscription.status === SUBSCRIPTION_STATUS.ACTIVE);
  check('…et date l’observation qui l’a posé',
    Boolean(contrat.stripe.subscription.statusObservedAt));

  const r = await subscriptionSvc.settleFromSubscription(
    contrat,
    instantane(contrat.stripe.subscription.subscriptionId, 'incomplete', invoiceId),
    { observedAt: new Date('2026-08-21T10:32:03.563Z') },
  );

  check('l’instantané périmé est REFUSÉ, explicitement', r.staleIgnored === true);
  check('l’abonnement reste ACTIF',
    contrat.stripe.subscription.status === SUBSCRIPTION_STATUS.ACTIVE);

  const relu = await Contract.findById(contrat._id).lean();
  check('…et le refus a survécu à l’écriture',
    relu.stripe.subscription.status === SUBSCRIPTION_STATUS.ACTIVE);
  check('l’instantané a tout de même livré ses IDENTITÉS',
    relu.stripe.subscription.latestInvoiceId === invoiceId);
}

// ═══════════════════════════════════════════════════════════════════════════
section('3 · L’HORLOGE DE L’ÉVÉNEMENT DÉPARTAGE AUSSI, QUAND ELLE LE PEUT');
{
  /**
   * La garde métier du §2 ne couvre qu'un cas : « incomplete » contre une
   * facture encaissée. Elle est décisive, et elle est étroite.
   *
   * La garde d'HORLOGE, elle, est générale : une observation strictement plus
   * ancienne que celle déjà appliquée n'écrit ni statut, ni période, ni
   * résiliation. C'est elle qui protège des permutations qu'on n'a pas encore
   * rencontrées — une résiliation annoncée deux fois, un `past_due` tardif
   * derrière une régularisation.
   */
  const contrat = await contratAbonne();
  const subId = contrat.stripe.subscription.subscriptionId;

  /**
   * LES INSTANTS SONT RELATIFS À MAINTENANT, ET C'EST FIDÈLE AU RÉEL.
   *
   * `evt.created` est toujours DANS LE PASSÉ quand nous le traitons — un
   * fournisseur n'annonce pas l'avenir. Des dates figées dans le futur
   * feraient donc échouer la dernière assertion pour une raison qui n'existe
   * pas en exploitation : une lecture directe, horodatée « maintenant »,
   * serait plus vieille que les événements de la fixture.
   */
  const heure = (h) => new Date(Date.now() - h * 3_600_000);

  await subscriptionSvc.settleFromSubscription(contrat, instantane(subId, 'active', 'in_h1'), {
    observedAt: heure(3),
  });
  check('l’état récent s’applique', contrat.stripe.subscription.status === SUBSCRIPTION_STATUS.ACTIVE);

  await subscriptionSvc.settleFromSubscription(contrat, instantane(subId, 'past_due', 'in_h1'), {
    observedAt: heure(4),
  });
  check('une observation plus ANCIENNE n’écrit pas le statut',
    contrat.stripe.subscription.status === SUBSCRIPTION_STATUS.ACTIVE);

  await subscriptionSvc.settleFromSubscription(contrat, instantane(subId, 'past_due', 'in_h1'), {
    observedAt: heure(2),
  });
  check('une observation plus RÉCENTE l’écrit',
    contrat.stripe.subscription.status === SUBSCRIPTION_STATUS.PAST_DUE);

  /**
   * LA LECTURE DIRECTE PRIME TOUJOURS. C'est ce qui rend la réparation
   * possible : sans cette règle, un contrat abîmé par un instantané daté du
   * futur ne se réparerait jamais.
   */
  await subscriptionSvc.settleFromSubscription(contrat, instantane(subId, 'active', 'in_h1'), {
    observedAt: new Date(),
  });
  check('une lecture « maintenant » répare',
    contrat.stripe.subscription.status === SUBSCRIPTION_STATUS.ACTIVE);
}

// ═══════════════════════════════════════════════════════════════════════════
section('4 · UN RÈGLEMENT D’ABONNEMENT PRODUIT UN FAIT MÉTIER — une seule fois');
{
  const contrat = await contratAbonne();
  const subId = contrat.stripe.subscription.subscriptionId;
  const invoiceId = 'in_conv_fait';
  await DomainEvent.deleteMany({ type: 'subscription.paid' });

  await subscriptionSvc.markInvoicePaid(contrat, factureStripe(invoiceId, subId), {
    observedAt: new Date('2026-08-21T10:32:03.370Z'),
  });

  const faits = await DomainEvent.find({ type: 'subscription.paid' }).lean();
  check('un fait « subscription.paid » est émis', faits.length === 1);
  check('il désigne le contrat', String(faits[0]?.entityId) === String(contrat._id));
  check('il porte la facture et le montant réellement débité',
    faits[0]?.payloadSafe?.invoiceId === invoiceId
    && faits[0]?.payloadSafe?.amountIncludingTax === 9599);
  check('il ne porte AUCUN identifiant client du fournisseur',
    !JSON.stringify(faits[0]?.payloadSafe ?? {}).match(/cus_/));

  /**
   * LE REJEU — quatre annonces Stripe du même règlement, plus la
   * réconciliation, plus un redémarrage. Le paiement local existe déjà : rien
   * de neuf n'est encaissé, donc rien de neuf n'est annoncé.
   */
  await subscriptionSvc.markInvoicePaid(contrat, factureStripe(invoiceId, subId), {
    observedAt: new Date('2026-08-21T10:32:04.000Z'),
  });
  await subscriptionSvc.markInvoicePaid(contrat, factureStripe(invoiceId, subId), {});

  check('un rejeu ne produit PAS un second fait',
    (await DomainEvent.countDocuments({ type: 'subscription.paid' })) === 1);
  check('…ni un second règlement au journal',
    (await Payment.countDocuments({
      contractId: contrat._id, type: PAYMENT_TYPE.SUBSCRIPTION, externalInvoiceId: invoiceId,
    })) === 1);

  /**
   * UN CYCLE SUIVANT, LUI, EST UN FAIT NEUF. C'est toute la raison d'être d'un
   * événement PAR RÈGLEMENT plutôt que par activation : un abonnement encaisse
   * tous les mois, et le client doit être confirmé tous les mois.
   */
  await subscriptionSvc.markInvoicePaid(contrat, factureStripe('in_conv_cycle2', subId), {
    observedAt: new Date('2026-09-21T10:00:00Z'),
  });
  check('le cycle SUIVANT produit bien un nouveau fait',
    (await DomainEvent.countDocuments({ type: 'subscription.paid' })) === 2);
}

// ═══════════════════════════════════════════════════════════════════════════
section('5 · LA CONVERGENCE NE DÉPEND D’AUCUNE REDIRECTION');
{
  /**
   * LA GARDE D'ARCHITECTURE DU LOT, et elle se lit dans le CODE.
   *
   * Le parcours peut être réparé par n'importe quel chemin serveur ; il ne doit
   * l'être par AUCUN paramètre d'URL. On vérifie donc qu'aucun applicateur de
   * paiement ne lit `session_id`, `status`, ni `paiement` — les trois que la
   * page de retour transporte.
   *
   * Un test de comportement ne suffirait pas ici : il resterait vert le jour où
   * quelqu'un ajoute une branche « si session_id présent, marquer payé » sans
   * l'exercer. C'est le genre de raccourci qu'on écrit un vendredi.
   */
  const { readFile } = await import('node:fs/promises');
  const fichiers = [
    '../services/subscription.service.js',
    '../services/payment.service.js',
    '../services/contractWebhook.service.js',
  ];
  const suspects = /req\.query|searchParams|session_id\s*=|from\s+redirect/i;
  let coupable = null;
  for (const f of fichiers) {
    const url = new URL(f, import.meta.url);
    // eslint-disable-next-line no-await-in-loop
    const texte = await readFile(url, 'utf8');
    // On ignore les COMMENTAIRES : ils parlent justement de ne pas le faire.
    const code = texte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    if (suspects.test(code)) coupable = f;
  }
  check('aucun applicateur de paiement ne lit un paramètre d’URL', coupable === null);

  /**
   * ET LA PREUVE POSITIVE : la vérité s'applique sans qu'aucun navigateur ne
   * soit revenu. C'est exactement le scénario « je ferme l'onglet Stripe ».
   */
  const contrat = await contratAbonne();
  await subscriptionSvc.markInvoicePaid(
    contrat,
    factureStripe('in_conv_sans_retour', contrat.stripe.subscription.subscriptionId),
    { observedAt: new Date() },
  );
  const relu = await Contract.findById(contrat._id).lean();
  check('un encaissement seul suffit à débloquer le contrat',
    relu.stripe.subscription.status === SUBSCRIPTION_STATUS.ACTIVE);
  check('…et le règlement est au journal',
    (await Payment.countDocuments({
      contractId: contrat._id, status: PAYMENT_STATUS.PAID, type: PAYMENT_TYPE.SUBSCRIPTION,
    })) === 1);
}

// ═══════════════════════════════════════════════════════════════════════════
section('6 · UNE FACTURE TARDIVE NE RESSUSCITE PAS UN ABONNEMENT CLOS');
{
  /**
   * La garde du §2 protège un encaissement contre un instantané périmé. Elle ne
   * doit pas, ce faisant, rendre un abonnement IMMORTEL : un contrat terminé
   * reste terminé, quelle que soit la facture qui arrive après.
   */
  const contrat = await contratAbonne({ statut: SUBSCRIPTION_STATUS.ENDED });
  await subscriptionSvc.markInvoicePaid(
    contrat,
    factureStripe('in_conv_tardive', contrat.stripe.subscription.subscriptionId),
    { observedAt: new Date() },
  );
  check('un statut TERMINAL n’est pas promu par une facture tardive',
    contrat.stripe.subscription.status === SUBSCRIPTION_STATUS.ENDED);
}

// ---------------------------------------------------------------------------
await disconnectDatabase();
await mongod.stop();

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
