import { MANAGED_WEBHOOKS, managedWebhookSpec } from './managedWebhookRegistry.js';
import { createRemoteWebhookManager, createWebhookPersistence } from './remoteWebhookSyncEngine.js';
import { createPanelBackedStripeWebhookManager } from './panelWebhookProvisioning.js';

/**
 * CONTRAT `IntegrationWebhookProvider` — l'interface UNIQUE entre le système
 * (bootstrap, déploiement, Manager) et les webhooks d'un fournisseur.
 *
 * Depuis le chantier « uniformisation », LES TROIS providers gèrent leurs
 * webhooks À DISTANCE (création automatique, mise à jour, dédoublonnage) :
 * l'utilisateur a la même expérience partout — Synchroniser / Réparer / Tester.
 *
 *   providerCode()            → 'BREVO' | 'STRIPE' | 'YOUSIGN' | …
 *   supportsWebhooks()        → gestion distante disponible ?
 *   capabilities()            → détail par capacité (create/update/delete/list/
 *                               repair/test) — l'UI s'appuie dessus, jamais sur
 *                               un `if provider === …`.
 *   listManagedWebhooks(mode) → ManagedWebhookDescriptor[] (0, 1 ou plusieurs)
 *   ensureWebhooks(mode)      → réconciliation idempotente (création auto incluse)
 *   repairWebhooks(mode)      → ensure + dédoublonnage + constat de joignabilité
 *   getWebhookHealth(mode)    → joignabilité seule
 *   testWebhooks(mode)        → MEILLEUR diagnostic possible (aucune des trois
 *                               APIs n'offre d'événement de test officiel) :
 *                               conformité distante + secret + joignabilité.
 *
 * Jamais de secret dans les descripteurs/rapports — seulement sa référence.
 */

/** Capacités communes — les trois APIs offrent le CRUD complet ; aucune n'offre
 *  d'événement de test officiel → `testWebhook: 'diagnostic'`. */
const FULL_CAPABILITIES = Object.freeze({
  createWebhook: true,
  updateWebhook: true,
  deleteWebhook: true,
  listWebhooks: true,
  repairWebhook: true,
  testWebhook: 'diagnostic',
});

function lastSyncStatusOf(state) {
  if (state?.lastErrorSafe?.code) return 'ERROR';
  if (state?.lastSyncedAt) return 'OK';
  return 'NEVER';
}

function descriptorFromState(state, spec) {
  return {
    provider: spec.provider,
    category: spec.category,
    mode: state.mode,
    expectedUrl: state.expectedUrl,
    expectedEvents: [...spec.expectedEvents],
    secretReference: spec.secretReference,
    remoteWebhookId: state.webhookId,
    remoteStatus: state.status,
    lastSyncStatus: lastSyncStatusOf(state),
    lastSyncError: state.lastErrorSafe?.code ? state.lastErrorSafe : null,
    lastSyncAt: state.lastSyncedAt,
    lastReceivedEventAt: state.lastReceivedAt,
    lastReceivedEventType: state.lastReceivedType || null,
    publicBackendUrl: state.publicBackendUrl,
    publicUrlSource: state.publicUrlSource,
    webhookReady: state.urlReady,
    supportsRemoteSync: true,
    secretConfigured: Boolean(state.secretConfigured),
  };
}

/* -------------------------------------------------------------------------- */
/*  Fabrique de driver sur le MOTEUR GÉNÉRIQUE (Stripe, Yousign, futurs)      */
/* -------------------------------------------------------------------------- */

function engineProvider(code, category, manager, requiredCredential) {
  const spec = managedWebhookSpec(code, category);
  return {
    providerCode: () => code,
    supportsWebhooks: () => true,
    capabilities: () => ({ ...FULL_CAPABILITIES }),
    /** Nom du credential requis pour les appels API (jamais sa valeur). */
    requiredCredentialName: () => requiredCredential,
    async listManagedWebhooks(mode) {
      const state = await manager.getState(mode);
      return [descriptorFromState(state, spec)];
    },
    async ensureWebhooks(mode) {
      return [{ category, ...(await manager.ensureWebhook(mode)) }];
    },
    async repairWebhooks(mode) {
      return [{ category, ...(await manager.repairWebhook(mode)) }];
    },
    async getWebhookHealth(mode) {
      return [{ category, ...(await manager.probeHealth(mode)) }];
    },
    async testWebhooks(mode) {
      return [{ category, ...(await manager.testWebhook(mode)) }];
    },
  };
}

/**
 * STRIPE — LE PANEL PROVISIONNE, LE PROJET REÇOIT (L6.3A).
 *
 * Ce gestionnaire ne parle plus à Stripe. Il DEMANDE au Panel de garantir
 * l'endpoint, puis rapatrie le secret de vérification par un canal qui ne
 * transporte que cela. L'endpoint pointe toujours ici, et c'est toujours ce
 * projet qui vérifie les signatures — seule la main qui l'enregistre a changé.
 *
 * Il expose la MÊME surface que le moteur générique : l'orchestrateur, le
 * bootstrap, la veille ngrok et l'écran de diagnostic l'appellent sans savoir
 * que quoi que ce soit a bougé.
 *
 * Le `requiredCredential` disparaît, et c'est le cœur du lot : ce driver n'a
 * plus besoin d'aucune clé locale pour faire son travail.
 */
const stripeManager = createPanelBackedStripeWebhookManager({
  spec: MANAGED_WEBHOOKS.STRIPE.payment,
  persistence: createWebhookPersistence({ provider: 'STRIPE', category: 'payment' }),
});

/*
 * YOUSIGN a quitte cette table en R10.5C.
 *
 * Le webhook Yousign est desormais provisionne ET recu par le PANEL, qui
 * detient la cle. Laisser un provisionneur local aurait suppose une cle
 * locale — exactement ce que le cutover supprime — et aurait fait courir
 * deux administrateurs sur le meme endpoint distant.
 */
//  : plus aucun credential local n'est requis pour provisionner (L6.3A).
const stripeProvider = engineProvider('STRIPE', 'payment', stripeManager, null);

/*
 * R11 — BREVO A QUITTE CETTE TABLE, pour la meme raison que Yousign.
 *
 * Son driver deleguait a `brevoWebhookConfig.service`, qui appelait
 * `api.brevo.com` avec une cle LOCALE pour declarer un endpoint local. Or les
 * e-mails partent du compte Brevo DU PANEL : les evenements de livraison
 * suivent le compte et arrivent au Panel, qui les reprojette par le pont.
 *
 * Le provisionneur local administrait donc un endpoint que Brevo n'appelait
 * plus, et il etait le DERNIER appelant de la cle Brevo de ce projet. Le
 * retirer est ce qui permet a la cle de disparaitre.
 */

/* -------------------------------------------------------------------------- */
/*  Registre des drivers                                                      */
/* -------------------------------------------------------------------------- */

const PROVIDERS = Object.freeze([stripeProvider]);

/** Tous les drivers, dans un ordre STABLE (celui des rapports). */
export function integrationWebhookProviders() {
  return PROVIDERS;
}

/** Driver d'un provider, ou erreur explicite. */
export function providerByCode(code) {
  const p = PROVIDERS.find((x) => x.providerCode() === String(code).toUpperCase());
  if (!p) throw new Error(`Provider de webhooks inconnu : ${code}.`);
  return p;
}
