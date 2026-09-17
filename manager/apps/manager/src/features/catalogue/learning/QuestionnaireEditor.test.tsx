// FORMATION-EVALUATION — Éditeur questionnaire (manager) : ajout section + question inline.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@bs/api-client', async (orig) => ({
  ...(await (orig() as Promise<Record<string, unknown>>)),
  getEvaluationDefinition: vi.fn(async () => ({ formationId: 'f1', active: false, version: 0, sections: [], deliverables: [] })),
  saveEvaluationDefinition: vi.fn(async (_id: string, input: unknown) => ({ formationId: 'f1', version: 1, ...(input as object) })),
}));

import { EvaluationEditor } from './EvaluationEditor';

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('EvaluationEditor — questionnaire', () => {
  it('ajoute une section puis une question Vrai/Faux', async () => {
    wrap(<EvaluationEditor formationId="f1" part="questionnaire" />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Ajouter une section/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Ajouter une section/i }));
    expect(screen.getByDisplayValue('Nouvelle section')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une question Vrai/Faux' }));
    // La question est ajoutée (son énoncé apparaît).
    expect(screen.getByPlaceholderText('Énoncé de la question')).toBeInTheDocument();
    // Le bouton Enregistrer devient actif (état modifié)
    expect(screen.getByRole('button', { name: 'Enregistrer' })).not.toBeDisabled();
  });

  it('affiche la case « active »', async () => {
    wrap(<EvaluationEditor formationId="f1" part="questionnaire" />);
    await waitFor(() => expect(screen.getByText(/Évaluation active/)).toBeInTheDocument());
  });
});
