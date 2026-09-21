/**
 * UN PANEL QUI SERT `billing.checkout.create` — pour les suites de facturation.
 *
 * ══ POURQUOI CE DOUBLE EXISTE ═══════════════════════════════════════════════
 *
 * Depuis L6.2B, ouvrir un paiement de frais de lancement passe par le Panel :
 * il n'y a plus de chemin local, et il n'y a pas de repli. Les suites qui
 * éprouvent la SUITE de ce parcours — journal `Payment`, webhooks, factures —
 * ont donc besoin d'un Panel qui réponde, sinon elles s'arrêtent à la première
 * ligne sans rien prouver de ce qu'elles étaient censées prouver.
 *
 * ══ CE QU'IL NE PROUVE PAS, ET C'EST VOULU ══════════════════════════════════
 *
 * Il ne prouve RIEN du plan de contrôle : ni l'autorité du montant, ni le choix
 * du monde, ni la clé d'idempotence Stripe, ni le lien d'appartenance. Ces
 * preuves-là exigent un vrai Panel et vivent dans
 * `Panel/tests/stripe-checkout-cutover-e2e.test.js`.
 *
 * Il prouve UNE chose, et elle compte : ce que le projet DEMANDE. L'identité de
 * l'acte, la référence de contrat, les URL de retour et la corrélation sont
 * relevées telles qu'elles franchissent le pont — c'est exactement ce que le
 * projet contrôle encore, et donc exactement ce qu'une suite projet doit
 * vérifier.
 *
 * Le stub de Panel « officiel » refuse délibérément toute capacité (L3) : la
 * preuve appartient à l'E2E. Ce double ne le contredit pas — il ne remplace pas
 * le stub, il l'habille pour un seul verbe et pour des suites qui testent
 * l'aval.
 */
import { CONTRACT_VERSION } from '../../services/panelBridge/bridgeContract.js';
import { createPanelStub } from '../../services/panelBridge/panelStub.js';
import {
  configureBridgeRuntime,
  pairWithPanel,
  resetBridgeRuntimeForTests,
} from '../../services/panelBridge/bridgeRuntime.js';

const IDENTITY = {
  projectKey: 'sb-auto-06',
  projectName: 'SB Auto 06',
  environment: 'TEST',
  softwareVersion: 'abc1234',
  contractVersion: CONTRACT_VERSION,
};

const MANIFEST = {
  manifestVersion: '1.0.0',
  project: {
    key: IDENTITY.projectKey,
    name: IDENTITY.projectName,
    environment: IDENTITY.environment,
    softwareVersion: IDENTITY.softwareVersion,
  },
  bridge: { contractVersion: CONTRACT_VERSION, projectBridgeBasePath: '/api/project-bridge/v1' },
  contracts: { panelBridge: CONTRACT_VERSION, projectBridge: CONTRACT_VERSION },
  sync: { supportedEntityTypes: [], operations: [] },
  modules: [{ id: 'panel-bridge', title: 'Pont Panel', status: 'ACTIVE' }],
  features: [],
};

/**
 * Appaire le projet à un Panel simulé qui SERT l'ouverture de paiement.
 *
 * @param {object} [opts]
 * @param {string} [opts.baseUrl] préfixe des URL de session rendues.
 * @returns {Promise<{invocations: Array, unpair: Function, sessions: Map}>}
 *   `invocations` : ce que le projet a demandé, dans l'ordre.
 */
export async function pairWithCheckoutPanel({ baseUrl = 'https://checkout.stripe.stub/c' } = {}) {
  const stub = createPanelStub();
  const invocations = [];
  /** operationId → session. C'est la convergence, en trois lignes. */
  const sessions = new Map();
  /** contractRef → client. Un contrat, un client — la cardinalité réelle. */
  const customers = new Map();
  /** contractRef → tarif. Un contrat, un tarif tant que ses termes ne bougent pas. */
  const prices = new Map();
  /** subscriptionId → vue d'abonnement, pilotée par les suites. */
  const subscriptions = new Map();
  /** Les mutations RÉELLEMENT émises — c'est le compteur qui prouve le non-doublon. */
  const cancellations = [];
  /** contractRef → factures (L6.3B). La clé est le CONTRAT, jamais le client. */
  const invoices = new Map();
  /** Les ouvertures de portail demandées — une par clic, jamais dédoublonnées. */
  const portals = [];

  const client = {
    ...stub,
    async invokeCapability(code, input = {}) {
      invocations.push({ code, input });
      /**
       * LA LECTURE (L6.2C) — servie par identifiant de session.
       *
       * Le double ne rejoue PAS le contrôle d'appartenance : il n'a pas de
       * registre de liens, et prétendre le contraire produirait une preuve
       * creuse. L'appartenance est éprouvée là où elle est réellement
       * implémentée — `Panel/tests/stripe-checkout-read-webhook-e2e.test.js`.
       * Ici, on prouve seulement que le projet DEMANDE au lieu de lire.
       */
      if (code === 'billing.checkout.retrieve') {
        const connue = [...sessions.values()].find((s) => s.checkoutSessionId === input.checkoutSessionId);
        if (!connue) {
          const err = new Error('Ressource inconnue ou non autorisée pour ce projet.');
          err.code = 'CAPABILITY_RESOURCE_NOT_OWNED';
          throw err;
        }
        return {
          capability: code,
          outcome: 'SUCCEEDED',
          result: {
            checkoutSessionId: connue.checkoutSessionId,
            status: connue.status,
            paymentStatus: connue.paymentStatus,
            url: connue.url,
            expiresAt: null,
            paymentIntentId: connue.paymentIntentId ?? null,
            customerId: connue.customerId ?? null,
            subscriptionId: connue.subscriptionId ?? null,
          },
        };
      }

      /**
       * LE CLIENT D'UN CONTRAT (L6.2D) — convergent par contrat, comme le vrai.
       *
       * Le double ne rejoue pas l'autorité du Panel : il n'a ni projection de
       * contrat ni registre de liens. Il reproduit la SEULE propriété dont
       * l'aval dépend — un contrat donné rend toujours le même client — pour
       * que les suites de facturation puissent continuer au-delà.
       */
      if (code === 'billing.customer.ensure') {
        const connu = customers.get(input.contractRef);
        if (connu) {
          return { capability: code, outcome: 'SUCCEEDED', result: { customerId: connu, status: 'EXISTING' } };
        }
        const id = `cus_${customers.size + 1}_${String(input.contractRef).slice(-6)}`;
        customers.set(input.contractRef, id);
        return { capability: code, outcome: 'SUCCEEDED', result: { customerId: id, status: 'CREATED' } };
      }

      /**
       * LE TARIF D'UN CONTRAT (L6.2E) — convergent par contrat, comme le vrai.
       *
       * Le double ne rejoue pas la cardinalité réelle du Panel (termes du
       * contrat) : il n'a pas de projection. Il reproduit la seule propriété
       * dont l'aval dépend — un contrat rend toujours le même tarif.
       */
      if (code === 'billing.price.ensure') {
        const connu = prices.get(input.contractRef);
        if (connu) {
          return { capability: code, outcome: 'SUCCEEDED', result: { ...connu, status: 'EXISTING' } };
        }
        const n = prices.size + 1;
        const tarif = {
          priceId: `price_${n}_${String(input.contractRef).slice(-6)}`,
          productId: `prod_${n}_${String(input.contractRef).slice(-6)}`,
          status: 'CREATED',
          interval: 'month',
          // Les TERMES rendus par le Panel comprennent le nombre de pas depuis
          // le lot « récurrence » — le double les rend au complet.
          intervalCount: 1,
          amount: 11880,
          currency: 'eur',
        };
        prices.set(input.contractRef, tarif);
        return { capability: code, outcome: 'SUCCEEDED', result: tarif };
      }

      /**
       * LA LECTURE D'UN ABONNEMENT (L6.2F). Le double ne rejoue pas
       * l'appartenance — il n'a pas de registre de liens ; elle est éprouvée là
       * où elle est implémentée (`Panel/tests/stripe-subscription-ownership-e2e`).
       */
      if (code === 'billing.subscription.retrieve') {
        const connu = subscriptions.get(input.subscriptionId);
        if (!connu) {
          const err = new Error('Ressource inconnue ou non autorisée pour ce projet.');
          err.code = 'CAPABILITY_RESOURCE_NOT_OWNED';
          throw err;
        }
        return { capability: code, outcome: 'SUCCEEDED', result: connu };
      }

      /**
       * LES FACTURES ET LE PORTAIL (L6.3B).
       *
       * Le double ne rejoue pas l'appartenance — elle est éprouvée là où elle
       * est implémentée (`Panel/tests/stripe-local-surface-e2e`). Il reproduit
       * la seule propriété dont l'aval dépend : les factures sont rendues PAR
       * CONTRAT, jamais par un identifiant de client que le projet aurait
       * fourni. C'est ce changement de clé que les suites du projet exercent.
       */
      if (code === 'billing.invoice.list') {
        const liste = invoices.get(String(input.contractRef)) ?? [];
        return {
          capability: code,
          outcome: 'SUCCEEDED',
          result: { invoices: liste, hasMore: false },
        };
      }

      if (code === 'billing.invoice.retrieve') {
        const liste = invoices.get(String(input.contractRef)) ?? [];
        const trouvee = liste.find((f) => f.invoiceId === input.invoiceId);
        if (!trouvee) {
          const err = new Error('Ressource inconnue ou non autorisée pour ce projet.');
          err.code = 'CAPABILITY_RESOURCE_NOT_OWNED';
          throw err;
        }
        return { capability: code, outcome: 'SUCCEEDED', result: trouvee };
      }

      if (code === 'billing.portal.create') {
        portals.push({ contractRef: String(input.contractRef), returnUrl: input.returnUrl });
        return {
          capability: code,
          outcome: 'SUCCEEDED',
          result: {
            url: `https://billing.stripe.double/session/${portals.length}`,
            expiresAt: null,
          },
        };
      }

      /**
       * LES RÉSILIATIONS (L6.2G) — convergentes par l'ÉTAT, comme le vrai Panel.
       *
       * Le double ne rejoue pas l'appartenance (éprouvée dans
       * `Panel/tests/stripe-subscription-cancellation-e2e`), mais il reproduit
       * la seule propriété dont l'aval dépend : résilier deux fois ne coupe
       * qu'une, et le second passage rend `ALREADY_CANCELLED`.
       */
      if (code === 'billing.subscription.cancel_at_period_end' || code === 'billing.subscription.cancel_now') {
        const connu = subscriptions.get(input.subscriptionId);
        if (!connu) {
          const err = new Error('Ressource inconnue ou non autorisée pour ce projet.');
          err.code = 'CAPABILITY_RESOURCE_NOT_OWNED';
          throw err;
        }
        const immediat = code === 'billing.subscription.cancel_now';
        const dejaFait = immediat
          ? connu.status === 'canceled'
          : connu.status === 'canceled' || connu.cancelAtPeriodEnd === true;
        if (!dejaFait) {
          cancellations.push({ code, subscriptionId: input.subscriptionId });
          if (immediat) connu.status = 'canceled';
          else connu.cancelAtPeriodEnd = true;
        }
        return {
          capability: code,
          outcome: 'SUCCEEDED',
          result: { ...connu, outcome: dejaFait ? 'ALREADY_CANCELLED' : 'CANCELLED' },
        };
      }

      /**
       * LA SIGNATURE EST DÉLÉGUÉE AU STUB DE BASE (R10.5C).
       *
       * Ce double ne connaît que la facturation, mais les suites qui s'en
       * servent ont besoin d'un contrat SIGNÉ comme décor — et depuis le
       * cutover, signer passe par une capacité de la plateforme.
       *
       * On délègue plutôt que de réimplémenter : une seconde version des
       * verbes de signature aurait divergé de celle qui sert partout ailleurs,
       * et c'est la divergence qu'on ne verrait pas.
       */
      if (code.startsWith('signature.')) {
        return stub.invokeCapability(code, input);
      }

      if (code !== 'billing.checkout.create') {
        const err = new Error(`Capacité non servie par le double : ${code}.`);
        err.code = 'CAPABILITY_NOT_AVAILABLE';
        throw err;
      }
      /**
       * LA MÊME OPÉRATION REND LA MÊME SESSION — c'est le comportement que le
       * vrai Panel garantit, et celui dont l'aval dépend : un double clic ne
       * doit pas produire deux journaux de paiement.
       */
      const known = sessions.get(input.operationId);
      if (known) {
        return { capability: code, outcome: 'SUCCEEDED', result: { ...known, creation: 'REUSED' } };
      }
      /**
       * L'abonnement compose : le double garantit client et tarif comme le vrai
       * Panel, pour que la session rendue porte bien le client du CONTRAT.
       */
      let customerId = null;
      if (input.paymentType === 'SUBSCRIPTION') {
        if (!customers.has(input.contractRef)) {
          customers.set(input.contractRef, `cus_${customers.size + 1}_${String(input.contractRef).slice(-6)}`);
        }
        customerId = customers.get(input.contractRef);
      }
      const session = {
        checkoutSessionId: `cs_${sessions.size + 1}_${String(input.operationId).slice(-8)}`,
        url: `${baseUrl}/${sessions.size + 1}`,
        status: 'open',
        paymentStatus: 'unpaid',
        customerId,
        subscriptionId: null,
        creation: 'CREATED',
        operationId: input.operationId,
      };
      sessions.set(input.operationId, session);
      return { capability: code, outcome: 'SUCCEEDED', result: session };
    },
  };

  configureBridgeRuntime({
    identityProvider: async () => IDENTITY,
    manifestProvider: async () => MANIFEST,
    clientFactory: () => client,
  });
  await pairWithPanel({ panelUrl: 'https://panel.double.test', pairingCode: 'PAIR-OK' });

  return {
    invocations,
    sessions,
    customers,
    prices,
    subscriptions,
    cancellations,
    /**
     * Déclare un abonnement lisible — comme si le Panel l'avait adopté depuis
     * la session qui l'a produit. Les suites qui éprouvent la réconciliation en
     * ont besoin : sans lui, aucun abonnement ne serait jamais lisible.
     */
    /**
     * Déclare une session lisible sans passer par une création — comme une
     * session que le Panel possède déjà, d'un parcours antérieur.
     */
    setSession(checkoutSessionId, vue) {
      sessions.set(`declaree:${checkoutSessionId}`, {
        checkoutSessionId,
        url: null,
        status: 'complete',
        paymentStatus: 'paid',
        customerId: null,
        subscriptionId: null,
        creation: 'CREATED',
        operationId: `declaree:${checkoutSessionId}`,
        ...vue,
      });
    },
    /**
     * Déclare les factures d'un CONTRAT (L6.3B).
     *
     * La clé est volontairement le contrat et non le client : c'est le
     * changement que ce lot a introduit, et une aide de test qui accepterait
     * encore un `customerId` laisserait écrire des suites sur l'ancien monde.
     */
    setInvoices(contractRef, factures) {
      invoices.set(String(contractRef), factures.map((f) => ({
        invoiceId: f.invoiceId,
        number: f.number ?? null,
        status: f.status ?? 'paid',
        paid: f.paid ?? (f.status ?? 'paid') === 'paid',
        amountDue: f.amountDue ?? f.total ?? 0,
        amountPaid: f.amountPaid ?? f.total ?? 0,
        total: f.total ?? f.amountPaid ?? 0,
        tax: f.tax ?? 0,
        currency: f.currency ?? 'eur',
        createdAt: f.createdAt ?? null,
        dueAt: f.dueAt ?? null,
        paidAt: f.paidAt ?? null,
        billingReason: f.billingReason ?? null,
        hostedInvoiceUrl: f.hostedInvoiceUrl ?? null,
        invoicePdfUrl: f.invoicePdfUrl ?? null,
        customerId: f.customerId ?? null,
        subscriptionId: f.subscriptionId ?? null,
      })));
    },
    /** Les ouvertures de portail — pour compter les clics, pas les sessions. */
    portals,
    invoices,
    setSubscription(subscriptionId, vue) {
      subscriptions.set(subscriptionId, {
        subscriptionId,
        status: 'active',
        cancelAtPeriodEnd: false,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        latestInvoiceId: null,
        customerId: null,
        ...vue,
      });
    },
    /**
     * Fait évoluer l'état d'une session, comme Stripe le ferait après un
     * paiement. Les suites qui éprouvent la réconciliation en ont besoin :
     * sans cela, une session resterait éternellement `open` et le filet de
     * sécurité n'aurait jamais rien à rattraper.
     */
    setSessionState(checkoutSessionId, patch) {
      for (const s of sessions.values()) {
        if (s.checkoutSessionId === checkoutSessionId) Object.assign(s, patch);
      }
    },
    /** Le dernier appel reçu pour ce verbe — l'assertion la plus fréquente. */
    lastCheckout: () => invocations.filter((i) => i.code === 'billing.checkout.create').at(-1) ?? null,
    unpair: () => resetBridgeRuntimeForTests(),
  };
}

export default { pairWithCheckoutPanel };
