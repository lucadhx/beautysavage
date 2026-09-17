// FORMATION-EVALUATION — Fiche résultat institut : score, bonnes réponses, décision (commentaire requis).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const accept = vi.fn(async (_id: string, _comment: string) => ({ certificate: { id: 'c1', certificateNumber: 'BS-DIP-X' } }));
vi.mock('@bs/api-client', async (orig) => ({
  ...(await (orig() as Promise<Record<string, unknown>>)),
  getEvaluationResult: vi.fn(async () => ({
    id: 'a1', client: 'Camille', clientEmail: 'c@d.fr', formation: 'Formation X', status: 'submitted', attemptNumber: 1, submittedAt: null,
    score: { total: 2, correct: 1, wrong: 1, percent: 50 },
    sections: [{ id: 's1', title: 'Section', questions: [
      { id: 'q1', type: 'true_false', prompt: 'Q1', required: true, correct: true, correctBoolean: true, clientAnswer: { booleanValue: true, selectedAnswerIds: [] } }
    ] }],
    deliverables: [], decisions: [], certificate: null,
  })),
  acceptEvaluationResult: (id: string, c: string) => accept(id, c),
  refuseEvaluationResult: vi.fn(async () => ({ newAttempt: { id: 'a2', attemptNumber: 2 } })),
  managerCertificateUrl: (id: string) => `/dl/${id}`,
}));

import { ResultDetailPage } from './pages';

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/resultats/a1']}>
        <Routes><Route path="/resultats/:attemptId" element={<ResultDetailPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ResultDetailPage', () => {
  it('affiche le score + les bonnes réponses (côté institut)', async () => {
    wrap();
    await waitFor(() => expect(screen.getByText(/Score 1\/2/)).toBeInTheDocument());
    expect(screen.getByText(/Bonne réponse : Vrai/)).toBeInTheDocument();
  });

  it('la validation exige un commentaire', async () => {
    wrap();
    await waitFor(() => screen.getByText('Valider le diplôme'));
    fireEvent.click(screen.getByText('Valider le diplôme'));
    expect(screen.getByText('Un commentaire est obligatoire.')).toBeInTheDocument();
    expect(accept).not.toHaveBeenCalled();
    // avec commentaire → appel
    fireEvent.change(screen.getByPlaceholderText(/Commentaire/), { target: { value: 'Bravo' } });
    fireEvent.click(screen.getByText('Valider le diplôme'));
    await waitFor(() => expect(accept).toHaveBeenCalledWith('a1', 'Bravo'));
  });
});
