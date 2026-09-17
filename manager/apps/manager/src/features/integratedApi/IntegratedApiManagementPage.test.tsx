// LOT5 — Test de rendu de la page de gestion IntegratedAPI (clients API mockés, aucun réseau).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const listIntegrations = vi.fn();
const updateIntegrationCredentials = vi.fn();
const testIntegration = vi.fn();
const setIntegrationMode = vi.fn();
const deleteIntegrationRuntime = vi.fn();

vi.mock('@bs/api-client', async (orig) => ({
  ...(await (orig() as Promise<Record<string, unknown>>)),
  listIntegrations: () => listIntegrations(),
  updateIntegrationCredentials: (...a: unknown[]) => updateIntegrationCredentials(...a),
  testIntegration: (...a: unknown[]) => testIntegration(...a),
  setIntegrationMode: (...a: unknown[]) => setIntegrationMode(...a),
  deleteIntegrationRuntime: (...a: unknown[]) => deleteIntegrationRuntime(...a),
}));

import { IntegratedApiManagementPage } from './IntegratedApiManagementPage';

function cred(role: string, configured: boolean, masked: string | null, prefix: string | null = null) {
  return { role, type: role, required: role === 'secret_key' || role === 'api_key', configured, maskedValue: masked, isActive: configured, updatedAt: null, expectedPrefix: prefix };
}
function stripeInstitut() {
  return {
    slug: 'stripe-institut', name: 'Stripe Institut', provider: 'stripe', accountPurpose: 'customer_payments',
    runtimeModel: 'dual_environment', mode: 'test', modeUpdatedAt: null, confirmVerb: 'ACTIVER STRIPE INSTITUT PROD',
    runtimes: [
      { runtime: 'test', isActiveMode: true, configured: true, verified: true,
        credentials: [cred('secret_key', true, '••••••••••••abcd', 'sk_test_'), cred('webhook_secret', true, '••••••••••••wxyz', 'whsec_')],
        lastTest: { status: 'success', message: 'Clé Stripe valide.', testedAt: '2026-07-22T10:00:00Z', details: null, verifiedAt: '2026-07-22T10:00:00Z', stale: false } },
      { runtime: 'prod', isActiveMode: false, configured: false, verified: false,
        credentials: [cred('secret_key', false, null, 'sk_live_'), cred('webhook_secret', false, null, 'whsec_')], lastTest: null },
    ],
  };
}
function brevo() {
  return {
    slug: 'brevo', name: 'Brevo', provider: 'brevo', accountPurpose: 'messaging',
    runtimeModel: 'single', mode: 'test', modeUpdatedAt: null, confirmVerb: 'ACTIVER BREVO PROD',
    runtimes: [{ runtime: null, isActiveMode: true, configured: false, verified: false, credentials: [cred('api_key', false, null, 'xkeysib-')], lastTest: null }],
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <IntegratedApiManagementPage />
    </QueryClientProvider>,
  );
}

describe('IntegratedApiManagementPage (LOT5)', () => {
  beforeEach(() => {
    listIntegrations.mockReset().mockResolvedValue([stripeInstitut(), brevo()]);
    updateIntegrationCredentials.mockReset();
    testIntegration.mockReset();
    setIntegrationMode.mockReset();
    deleteIntegrationRuntime.mockReset();
  });

  it('affiche les fournisseurs, blocs TEST/PROD (Stripe) et bloc unique (Brevo), sans secret', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'API intégrée' })).toBeInTheDocument());
    expect(screen.getByText('Stripe Institut')).toBeInTheDocument();
    expect(screen.getByText('Brevo')).toBeInTheDocument();
    // Blocs runtime
    expect(screen.getByRole('region', { name: 'TEST' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'PROD' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Clé unique' })).toBeInTheDocument();
    // Valeur masquée présente, aucune valeur secrète en clair
    expect(screen.getByText('••••••••••••abcd')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/sk_(test|live)_[A-Za-z0-9]{6,}/);
  });

  it('badges d\'état : Configuré + Testé (TEST) ; Non configuré (PROD)', async () => {
    renderPage();
    const testBlock = await screen.findByRole('region', { name: 'TEST' });
    expect(within(testBlock).getByText('Configuré')).toBeInTheDocument();
    expect(within(testBlock).getByText('Testé')).toBeInTheDocument();
    const prodBlock = screen.getByRole('region', { name: 'PROD' });
    expect(within(prodBlock).getByText('Non configuré')).toBeInTheDocument();
  });

  it('Configurer : ouvre le drawer, champ vide conserve, enregistre les champs saisis', async () => {
    updateIntegrationCredentials.mockResolvedValue(stripeInstitut());
    renderPage();
    const testBlock = await screen.findByRole('region', { name: 'TEST' });
    fireEvent.click(within(testBlock).getByRole('button', { name: 'Configurer' }));
    await waitFor(() => expect(screen.getByText(/champ laissé vide conserve/i)).toBeInTheDocument());
    const input = screen.getAllByPlaceholderText(/défini|Non configuré/i)[0] as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'sk_test_NEWVALUE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => expect(updateIntegrationCredentials).toHaveBeenCalledWith('stripe-institut', 'test', { secret_key: 'sk_test_NEWVALUE' }));
  });

  it('Tester : appelle testIntegration et affiche un message sûr sans secret', async () => {
    testIntegration.mockResolvedValue({ result: { status: 'success', message: 'Clé Stripe valide.', details: null, slug: 'stripe-institut', runtime: 'test', testedAt: 'now' }, integration: stripeInstitut() });
    renderPage();
    const testBlock = await screen.findByRole('region', { name: 'TEST' });
    fireEvent.click(within(testBlock).getByRole('button', { name: 'Tester' }));
    await waitFor(() => expect(testIntegration).toHaveBeenCalledWith('stripe-institut', 'test'));
    // Message de feedback affiché dans la zone role=status (sans secret).
    await waitFor(() => expect(within(screen.getByRole('status')).getByText(/Clé Stripe valide/)).toBeInTheDocument());
  });

  it('Activation PROD gardée : bouton désactivé tant que non configuré+vérifié', async () => {
    renderPage();
    const prodBlock = await screen.findByRole('region', { name: 'PROD' });
    const activateBtn = within(prodBlock).getByRole('button', { name: /Activer la production/i });
    expect(activateBtn).toBeDisabled(); // prod non configuré/non vérifié
  });

  it('Activation PROD : ouvre le drawer de confirmation quand éligible et exige la phrase exacte', async () => {
    const withProd = stripeInstitut();
    withProd.runtimes[1] = { ...withProd.runtimes[1], configured: true, verified: true, credentials: [cred('secret_key', true, '••••••••••••live', 'sk_live_'), cred('webhook_secret', true, '••••••••••••hk', 'whsec_')] };
    listIntegrations.mockResolvedValue([withProd, brevo()]);
    setIntegrationMode.mockResolvedValue(withProd);
    renderPage();
    const prodBlock = await screen.findByRole('region', { name: 'PROD' });
    fireEvent.click(within(prodBlock).getByRole('button', { name: /Activer la production/i }));
    await waitFor(() => expect(screen.getByText(/saisissez exactement/i)).toBeInTheDocument());
    const dialog = screen.getByRole('dialog');
    const confirmInput = within(dialog).getByLabelText('Phrase de confirmation') as HTMLInputElement;
    const confirmBtn = within(dialog).getByRole('button', { name: 'Activer la production' });
    expect(confirmBtn).toBeDisabled();
    fireEvent.change(confirmInput, { target: { value: 'ACTIVER STRIPE INSTITUT PROD' } });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(setIntegrationMode).toHaveBeenCalledWith('stripe-institut', 'prod', 'ACTIVER STRIPE INSTITUT PROD'));
  });
});
