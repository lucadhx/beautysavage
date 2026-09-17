// M1 — Adapter Brevo Sender/Domain API. MOCKABLE (les tests vi.mock ce module ou mockent
// getCredential + fetch). N'expose JAMAIS la clé API ; les erreurs sont normalisées en messages sûrs.
// Best-effort : si la clé Brevo est absente, renvoie un statut neutre plutôt que de throw (M1 ne doit
// pas bloquer le système). Brevo envoie lui-même l'e-mail de vérification du sender (OTP) — on ne
// génère JAMAIS d'OTP maison ici.
import { getCredential } from './integratedApiCredentialService.js';

const BREVO_BASE = 'https://api.brevo.com/v3';

export class BrevoSenderAdapterError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'BrevoSenderAdapterError';
    this.code = code;
  }
}

async function resolveApiKey() {
  try {
    const key = await getCredential('brevo', { role: 'api_key' });
    return String(key || '').trim() || null;
  } catch {
    return null;
  }
}

async function brevoFetch(path, { method = 'GET', body } = {}) {
  const apiKey = await resolveApiKey();
  if (!apiKey) throw new BrevoSenderAdapterError('provider_not_connected', 'Brevo non configuré.');
  let res;
  try {
    res = await fetch(`${BREVO_BASE}${path}`, {
      method,
      headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new BrevoSenderAdapterError('provider_unreachable', 'Brevo injoignable.');
  }
  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (!res.ok) {
    // On ne renvoie qu'un message sûr (pas de payload provider potentiellement sensible).
    throw new BrevoSenderAdapterError('provider_error', `Brevo a renvoyé le statut ${res.status}.`);
  }
  return json || {};
}

/** Crée/enregistre un sender → Brevo envoie son e-mail de validation. Renvoie {senderId, status}. */
export async function requestSenderVerification({ email, name }) {
  const data = await brevoFetch('/senders', { method: 'POST', body: { name, email } });
  return { senderId: String(data?.id ?? ''), status: 'verification_pending' };
}

/** Valide un sender avec l'OTP reçu de Brevo. Renvoie {status}. */
export async function confirmSenderVerification({ senderId, otp }) {
  await brevoFetch(`/senders/${encodeURIComponent(senderId)}/validate`, { method: 'PUT', body: { otp } });
  return { status: 'verified' };
}

/** Statut d'un sender (source de vérité = active:true). Renvoie {active, senderId}. */
export async function getSenderStatus({ email }) {
  const data = await brevoFetch('/senders');
  const senders = Array.isArray(data?.senders) ? data.senders : [];
  const match = senders.find((s) => String(s?.email || '').toLowerCase() === String(email || '').toLowerCase());
  return { active: Boolean(match?.active), senderId: match ? String(match.id ?? '') : '' };
}

/** Statut d'authentification d'un domaine. Best-effort. Renvoie {authenticated, status, dnsRecords[]}. */
export async function getDomainStatus({ domain }) {
  try {
    const data = await brevoFetch(`/senders/domains/${encodeURIComponent(domain)}`);
    const records = Array.isArray(data?.dns_records)
      ? data.dns_records.map((r) => ({
          type: String(r?.type || ''),
          host: String(r?.host || r?.host_name || ''),
          value: String(r?.value || ''),
          status: r?.status ? String(r.status) : ''
        }))
      : [];
    return {
      authenticated: Boolean(data?.authenticated ?? data?.dkim ?? false),
      status: String(data?.status || (data?.authenticated ? 'authenticated' : 'unknown')),
      dnsRecords: records
    };
  } catch {
    // Domaine inconnu de Brevo / API indisponible → statut neutre (non bloquant en M1).
    return { authenticated: false, status: 'unknown', dnsRecords: [] };
  }
}
