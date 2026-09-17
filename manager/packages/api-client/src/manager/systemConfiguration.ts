// S1 — Client API Paramètres Système (dev-only).
// GET/PUT /api/gestion/dev/system-configuration. Aucun secret exposé.
import { apiFetch } from '../apiFetch';

export interface SystemAddress {
  line1: string;
  line2: string;
  city: string;
  postalCode: string;
  country: string;
}

export interface SystemConfiguration {
  domains: { panelUrl: string; vitrineUrl: string };
  institute: {
    name: string;
    email: string;
    phone: string;
    siret: string;
    address: SystemAddress;
  };
  localization: { timezone: string; language: string; currency: string };
  tax: { defaultVatRate: number; vatMention: string };
  system: { platformName: string };
  maintenance: { enabled: boolean; message: string };
  resolved: { vitrineBaseUrl: string; panelBaseUrl: string };
  updatedAt: string | null;
}

export interface SystemConfigurationPatch {
  domains?: Partial<{ panelUrl: string; vitrineUrl: string }>;
  institute?: Partial<{
    name: string;
    email: string;
    phone: string;
    siret: string;
    address: Partial<SystemAddress>;
  }>;
  localization?: Partial<{ timezone: string; language: string; currency: string }>;
  tax?: Partial<{ defaultVatRate: number; vatMention: string }>;
  system?: Partial<{ platformName: string }>;
  maintenance?: Partial<{ enabled: boolean; message: string }>;
}

const BASE = '/api/gestion/dev/system-configuration';

export async function getSystemConfiguration(): Promise<SystemConfiguration> {
  const res = await apiFetch<{ ok: boolean; config: SystemConfiguration }>(BASE);
  return res.config;
}

export async function updateSystemConfiguration(
  patch: SystemConfigurationPatch,
): Promise<SystemConfiguration> {
  const res = await apiFetch<{ ok: boolean; config: SystemConfiguration }>(BASE, {
    method: 'PUT',
    body: patch,
  });
  return res.config;
}

// ── Validation live des URLs de domaine (miroir léger du backend systemUrlValidation) ──
const LOCAL_HOST_RE = /^(localhost|127(?:\.\d+){3}|0\.0\.0\.0|\[?::1\]?)$/i;

function isLocalOrDevHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return false;
  if (LOCAL_HOST_RE.test(host)) return true;
  if (host.endsWith('.local') || host.endsWith('.localhost')) return true;
  if (host.includes('ngrok')) return true;
  return false;
}

export interface UrlValidationResult {
  ok: boolean;
  value?: string;
  error?: string;
}

/** Valide/normalise une URL de domaine côté UI (feedback immédiat, même règles que le backend). */
export function validateDomainUrl(raw: string, label = 'URL'): UrlValidationResult {
  const candidate = String(raw ?? '').trim();
  if (!candidate) return { ok: false, error: `${label} requise.` };
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, error: `${label} invalide (ex. https://exemple.fr).` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: `${label} doit utiliser http(s).` };
  }
  if (url.search || url.hash) {
    return { ok: false, error: `${label} sans paramètre (?) ni ancre (#).` };
  }
  if (!url.hostname) return { ok: false, error: `${label} doit comporter un domaine.` };
  if (url.protocol === 'http:' && !isLocalOrDevHost(url.hostname)) {
    return { ok: false, error: `${label} doit être en HTTPS (hors localhost/dev).` };
  }
  const path = url.pathname.replace(/\/+$/, '');
  return { ok: true, value: `${url.protocol}//${url.host}${path}` };
}
