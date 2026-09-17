// Gestion DEV des intégrations chiffrées (Stripe institut/dev, Brevo).
// Endpoints: /api/gestion/dev/integrated-api/*. Aucun secret n'est jamais reçu (valeurs masquées).
import { apiGet, apiPost, apiPut, apiDelete } from '../apiFetch';

const BASE = '/api/gestion/dev/integrated-api';

export type IntegrationRuntime = 'test' | 'prod' | null;

export interface IntegrationCredentialView {
  role: string;
  type: string;
  required: boolean;
  configured: boolean;
  maskedValue: string | null; // ••••••••••••XXXX (jamais la valeur)
  isActive: boolean;
  updatedAt: string | null;
  expectedPrefix: string | null;
}

export interface IntegrationLastTest {
  status: 'success' | 'failed' | null;
  message: string;
  testedAt: string | null;
  details: Record<string, unknown> | null;
  verifiedAt: string | null;
  stale: boolean;
}

export interface IntegrationRuntimeView {
  runtime: IntegrationRuntime;
  isActiveMode: boolean;
  configured: boolean;
  verified: boolean;
  credentials: IntegrationCredentialView[];
  lastTest: IntegrationLastTest | null;
}

export interface IntegratedApiView {
  slug: string;
  name: string;
  provider: string;
  accountPurpose: string | null;
  runtimeModel: 'single' | 'dual_environment';
  mode: 'test' | 'prod';
  modeUpdatedAt: string | null;
  confirmVerb: string | null;
  runtimes: IntegrationRuntimeView[];
}

export interface IntegrationTestResult {
  status: 'success' | 'failed';
  message: string;
  details: Record<string, unknown> | null;
  slug: string;
  runtime: IntegrationRuntime;
  testedAt: string;
}

export async function listIntegrations(): Promise<IntegratedApiView[]> {
  const res = await apiGet<{ ok: boolean; integrations: IntegratedApiView[] }>(BASE);
  return res.integrations ?? [];
}

export async function getIntegration(slug: string): Promise<IntegratedApiView> {
  const res = await apiGet<{ ok: boolean; integration: IntegratedApiView }>(`${BASE}/${encodeURIComponent(slug)}`);
  return res.integration;
}

/** Configure/remplace/supprime des credentials pour un runtime. `null` = suppression du champ. */
export async function updateIntegrationCredentials(
  slug: string,
  runtime: IntegrationRuntime,
  credentials: Record<string, string | null>,
): Promise<IntegratedApiView> {
  const res = await apiPut<{ ok: boolean; integration: IntegratedApiView }>(
    `${BASE}/${encodeURIComponent(slug)}/credentials`,
    { runtime, credentials },
  );
  return res.integration;
}

/** Supprime tous les credentials d'un runtime. */
export async function deleteIntegrationRuntime(slug: string, runtime: IntegrationRuntime): Promise<IntegratedApiView> {
  const rt = runtime ?? '';
  const res = await apiDelete<{ ok: boolean; integration: IntegratedApiView }>(
    `${BASE}/${encodeURIComponent(slug)}/credentials${rt ? `?runtime=${rt}` : ''}`,
  );
  return res.integration;
}

/** Test de connexion lecture-seule ; renvoie le résultat + l'intégration rafraîchie. */
export async function testIntegration(
  slug: string,
  runtime: IntegrationRuntime,
): Promise<{ result: IntegrationTestResult; integration: IntegratedApiView }> {
  const res = await apiPost<{ ok: boolean; result: IntegrationTestResult; integration: IntegratedApiView }>(
    `${BASE}/${encodeURIComponent(slug)}/test`,
    { runtime },
  );
  return { result: res.result, integration: res.integration };
}

/** Active un mode (test|prod). PROD exige verified + la phrase de confirmation exacte. */
export async function setIntegrationMode(
  slug: string,
  mode: 'test' | 'prod',
  confirmation?: string,
): Promise<IntegratedApiView> {
  const res = await apiPost<{ ok: boolean; integration: IntegratedApiView }>(
    `${BASE}/${encodeURIComponent(slug)}/mode`,
    { mode, confirmation },
  );
  return res.integration;
}
