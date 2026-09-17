// C2 — Lecteur apprenant : rendu + complétion → progression (mobile-first, zéro table).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { FormationPlayer } from './Player';

const FORMATION = {
  ok: true,
  formation: { id: 'f1', name: 'Maquillage pro', coverImage: '', accessUrl: '' },
  chapters: [{ id: 'c1', title: 'Bases', description: '', order: 1 }],
  lessons: [
    { id: 'l1', chapterId: 'c1', title: 'Intro', description: 'desc', videoUrl: 'https://youtu.be/abc', resources: [], order: 1, isFree: false, estimatedMinutes: 5 },
    { id: 'l2', chapterId: 'c1', title: 'Teint', description: '', videoUrl: 'https://youtu.be/def', resources: [], order: 2, isFree: false, estimatedMinutes: 8 },
  ],
  progress: { completedLessonIds: [], lastLessonId: null, formationPct: 0, chapters: [], completedAt: null },
};

function installFetch() {
  let completed = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/complete')) {
      completed = true;
      return new Response(JSON.stringify({ ok: true, progress: { completedLessonIds: ['l1'], formationPct: 50, chapters: [], completedAt: null } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    void init;
    // Le refetch reflète la complétion (progress 50%).
    const payload = completed
      ? { ...FORMATION, progress: { ...FORMATION.progress, completedLessonIds: ['l1'], formationPct: 50 } }
      : FORMATION;
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
}
afterEach(() => vi.unstubAllGlobals());

function renderPlayer() {
  installFetch();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/mes-formations/f1']}>
        <FormationPlayer formationId="f1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('FormationPlayer', () => {
  it('affiche la formation, la vidéo embed et le bouton terminé', async () => {
    const { container } = renderPlayer();
    expect(await screen.findByText('Maquillage pro')).toBeInTheDocument();
    expect(screen.getByText("J'ai terminé")).toBeInTheDocument();
    // Embed YouTube rendu en iframe (pas d'upload)
    expect(container.querySelector('iframe')).toBeTruthy();
    // Aucun tableau
    expect(container.querySelector('table')).toBeNull();
  });

  it('marquer terminé avance la progression', async () => {
    renderPlayer();
    fireEvent.click(await screen.findByText("J'ai terminé"));
    await waitFor(() => expect(screen.getByText('50% terminé')).toBeInTheDocument());
  });

  it('affiche le bouton attestation quand la formation est terminée (C3)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ...FORMATION,
      progress: { ...FORMATION.progress, formationPct: 100, completedAt: '2026-06-30', completedLessonIds: ['l1', 'l2'] },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/mes-formations/f1']}>
          <FormationPlayer formationId="f1" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const link = await screen.findByText(/Télécharger l'attestation/i);
    expect(link.closest('a')?.getAttribute('href')).toContain('/api/client/learning/formations/f1/attestation');
  });
});
