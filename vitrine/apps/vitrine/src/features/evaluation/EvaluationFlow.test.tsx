// FORMATION-EVALUATION — Parcours client : états diplôme / transmis / à démarrer.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const state = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('@bs/api-client', async (orig) => ({
  ...(await (orig() as Promise<Record<string, unknown>>)),
  getClientEvaluation: vi.fn(async () => state.value),
  createEvaluationAttempt: vi.fn(async () => ({ id: 'a1', attemptNumber: 1, status: 'in_progress', answers: [], deliverables: [] })),
  clientCertificateUrl: (id: string) => `/dl/${id}`,
}));

import { EvaluationFlow } from './EvaluationFlow';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
const base = { hasEvaluation: true, completed: true, definition: { formationId: 'f1', active: true, version: 1, sections: [], deliverables: [] }, attempt: null, decisions: [], certificate: null };

describe('EvaluationFlow', () => {
  it('affiche le diplôme obtenu', async () => {
    state.value = { ...base, certificate: { id: 'c1', certificateNumber: 'BS-DIP-X', issuedAt: '' } };
    wrap(<EvaluationFlow formationId="f1" />);
    await waitFor(() => expect(screen.getByTestId('evaluation-diploma')).toBeInTheDocument());
    expect(screen.getByText(/Télécharger mon diplôme/)).toBeInTheDocument();
  });

  it('affiche « résultats transmis » quand soumis', async () => {
    state.value = { ...base, attempt: { id: 'a1', attemptNumber: 1, status: 'submitted', answers: [], deliverables: [] } };
    wrap(<EvaluationFlow formationId="f1" />);
    await waitFor(() => expect(screen.getByTestId('evaluation-sent')).toBeInTheDocument());
  });

  it('affiche le motif de refus + bouton recommencer', async () => {
    state.value = { ...base, attempt: null, decisions: [{ decision: 'refused', comment: 'À retravailler', attemptNumber: 1, createdAt: '' }] };
    wrap(<EvaluationFlow formationId="f1" />);
    await waitFor(() => expect(screen.getByTestId('evaluation-refused')).toBeInTheDocument());
    expect(screen.getByText(/À retravailler/)).toBeInTheDocument();
    expect(screen.getByText('Recommencer')).toBeInTheDocument();
  });

  it('propose de commencer si aucune tentative', async () => {
    state.value = { ...base };
    wrap(<EvaluationFlow formationId="f1" />);
    await waitFor(() => expect(screen.getByText('Commencer')).toBeInTheDocument());
  });
});
