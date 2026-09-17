import crypto from 'node:crypto';

import PanelBridgeState from '../models/PanelBridgeState.js';
import { decryptCredential, encryptCredential } from '../utils/credentialVault.js';

export const BRIDGE_CONTRACT_VERSION = '1.15.0';
export const MANIFEST_VERSION = '1.0.0';
const PROJECT_BRIDGE_BASE_PATH = '/api/project-bridge/v1';

function trimUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function environment() {
  return String(process.env.PLATFORM_ENVIRONMENT || 'TEST').trim().toUpperCase() === 'PROD'
    ? 'PROD'
    : 'TEST';
}

function publicBaseUrl() {
  return trimUrl(process.env.PUBLIC_SITE_URL) || `http://localhost:${Number(process.env.PORT || 3012)}`;
}

export function projectKey() {
  return String(process.env.PANEL_PROJECT_KEY || 'beautysavage').trim() || 'beautysavage';
}

export async function getBridgeState({ withSecret = false } = {}) {
  const query = PanelBridgeState.findOneAndUpdate(
    { singleton: 'beautysavage' },
    { $setOnInsert: { singleton: 'beautysavage', projectKey: projectKey() } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  if (withSecret) query.select('+bridgeTokenEncrypted');
  return query;
}

function summary(state) {
  return {
    paired: state.status === 'PAIRED',
    status: state.status,
    projectId: state.projectId,
    projectKey: state.projectKey,
    panelBaseUrl: state.panelBaseUrl,
    pairedAt: state.pairedAt,
    lastHeartbeatAt: state.lastHeartbeatAt,
    lastPanelSyncAt: state.lastPanelSyncAt
  };
}

export async function bridgeStatus() {
  return summary(await getBridgeState());
}

export function webhookEndpoints() {
  const base = publicBaseUrl();
  return [
    {
      provider: 'stripe-institut',
      owner: 'INSTITUTE',
      url: `${base}/api/stripe/webhook`,
      events: ['checkout.session.completed', 'payment_intent.succeeded', 'charge.refund.updated']
    },
    {
      provider: 'stripe-dev',
      owner: 'PLATFORM',
      url: `${base}/api/stripe/dev-webhook`,
      events: ['checkout.session.completed', 'invoice.payment_succeeded', 'invoice.payment_failed']
    },
    {
      provider: 'brevo',
      owner: 'INSTITUTE',
      url: `${base}/api/webhooks/brevo`,
      events: ['delivered', 'soft_bounce', 'hard_bounce']
    }
  ];
}

export function buildManifest() {
  const base = publicBaseUrl();
  return {
    manifestVersion: MANIFEST_VERSION,
    project: {
      key: projectKey(),
      name: 'BeautySavage',
      environment: environment(),
      softwareVersion: '1.0.0'
    },
    bridge: { contractVersion: BRIDGE_CONTRACT_VERSION, projectBridgeBasePath: PROJECT_BRIDGE_BASE_PATH },
    contracts: { panelBridge: BRIDGE_CONTRACT_VERSION, projectBridge: BRIDGE_CONTRACT_VERSION },
    sync: {
      supportedEntityTypes: ['DIAGNOSTIC', 'INTEGRATED_API_CONFIG', 'LEGAL_DOCUMENT'],
      operations: []
    },
    modules: [
      { id: 'vitrine', title: 'Vitrine e-commerce', status: 'ACTIVE' },
      { id: 'client-space', title: 'Espace client et formations', status: 'ACTIVE' },
      { id: 'manager', title: 'Manager institut', status: 'ACTIVE' },
      { id: 'commerce-learning', title: 'Commerce, réservations et formations', status: 'ACTIVE' },
      { id: 'panel-bridge', title: 'Connecteur panel L.Y Solution', status: 'ACTIVE' }
    ],
    features: [
      { id: 'sync.diagnostic', status: 'AVAILABLE' },
      { id: 'sync.integrated-api-config', status: 'AVAILABLE' },
      { id: 'sync.legal-documents', status: 'AVAILABLE' },
      { id: 'operations.catalog', status: 'AVAILABLE' }
    ],
    network: {
      primaryDomain: 'beautysavage.ly-solution.com',
      urls: {
        website: base,
        manager: `${base}/manager/`,
        backend: base
      }
    },
    presentation: {
      companyName: 'BeautySavage',
      tagline: 'Institut, soins et formations beauté',
      contacts: { website: base }
    },
    descriptor: {
      name: 'BeautySavage',
      type: 'ecommerce-learning',
      description: 'Vitrine transactionnelle, espace client, formations et manager institut.',
      layout: 'vitrine:web + manager:web + backend:server'
    }
  };
}

function requestHeaders(token = null) {
  const headers = {
    'content-type': 'application/json',
    'x-bridge-contract-version': BRIDGE_CONTRACT_VERSION
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

async function jsonRequest(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message || body?.message || body?.error || `HTTP ${response.status}`;
    throw new Error(`Panel bridge: ${message}`);
  }
  return body?.data ?? body;
}

export async function pairWithPanel({ panelBaseUrl, pairingCode }) {
  const baseUrl = trimUrl(panelBaseUrl || process.env.PANEL_BASE_URL);
  const code = String(pairingCode || process.env.PANEL_PAIRING_CODE || '').trim();
  if (!baseUrl || !code) {
    throw new Error('PANEL_BASE_URL et PANEL_PAIRING_CODE sont requis pour l’appairage.');
  }
  const payload = {
    contractVersion: BRIDGE_CONTRACT_VERSION,
    projectKey: projectKey(),
    projectName: 'BeautySavage',
    environment: environment(),
    softwareVersion: '1.0.0',
    publicBackendUrl: publicBaseUrl(),
    pairingCode: code,
    manifest: buildManifest()
  };
  const data = await jsonRequest(`${baseUrl}/bridge/v1/pairings`, {
    method: 'POST',
    headers: requestHeaders(),
    body: JSON.stringify(payload)
  });
  if (!data?.bridgeToken || !data?.projectId) {
    throw new Error('Réponse d’appairage du panel incomplète.');
  }
  const state = await getBridgeState({ withSecret: true });
  state.projectId = data.projectId;
  state.projectKey = projectKey();
  state.panelBaseUrl = baseUrl;
  state.bridgeTokenEncrypted = encryptCredential(data.bridgeToken);
  state.pairedAt = new Date();
  state.status = 'PAIRED';
  state.syncCursor = data.syncCursor ?? null;
  await state.save();
  return summary(state);
}

export async function assertBridgeToken(rawToken) {
  const state = await getBridgeState({ withSecret: true });
  if (state.status !== 'PAIRED' || !state.bridgeTokenEncrypted) return false;
  const expected = decryptCredential(state.bridgeTokenEncrypted);
  const left = Buffer.from(expected);
  const right = Buffer.from(String(rawToken || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export async function sendHeartbeat() {
  const state = await getBridgeState({ withSecret: true });
  if (state.status !== 'PAIRED' || !state.panelBaseUrl || !state.bridgeTokenEncrypted) {
    throw new Error('BeautySavage n’est pas appairé au panel.');
  }
  const token = decryptCredential(state.bridgeTokenEncrypted);
  const data = await jsonRequest(`${state.panelBaseUrl}/bridge/v1/heartbeats`, {
    method: 'POST',
    headers: requestHeaders(token),
    body: JSON.stringify({
      sentAt: new Date().toISOString(),
      softwareVersion: '1.0.0',
      environment: environment(),
      health: { status: 'OK', details: null },
      bridgeStats: { outboxSize: 0, lastSyncAt: state.lastPanelSyncAt?.toISOString?.() ?? null }
    })
  });
  state.lastHeartbeatAt = new Date();
  await state.save();
  return data;
}

export async function recordPanelChanges(changes) {
  const state = await getBridgeState();
  state.lastPanelSyncAt = new Date();
  await state.save();
  // Les secrets fournisseur ne transitent jamais dans les événements de sync :
  // ils sont configurés par le coffre IntegratedAPI dédié ou une capacité panel.
  return (changes || []).map((change) => ({
    writeId: change?.writeId,
    status: 'REJECTED',
    code: 'PANEL_CAPABILITY_REQUIRED',
    message: 'Utilisez la capacité panel dédiée pour appliquer une configuration.'
  }));
}
