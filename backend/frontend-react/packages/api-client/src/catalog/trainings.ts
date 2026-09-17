// Formations publiques. Liste dérivée de /api/vitrine/shop ; détail /api/vitrine/formations/:id.
import { apiFetch } from '../apiFetch';
import { getPublicShop } from './shop';
import { mapTraining } from './mappers';
import type { PublicTraining } from './types';

export async function getPublicTrainings(signal?: AbortSignal): Promise<PublicTraining[]> {
  const { formations } = await getPublicShop(signal);
  return formations;
}

export async function getPublicTrainingById(trainingId: string, signal?: AbortSignal): Promise<PublicTraining> {
  const res = await apiFetch<{ ok: boolean; formation?: unknown }>(
    `/api/vitrine/formations/${encodeURIComponent(trainingId)}`,
    { signal },
  );
  return mapTraining(res.formation);
}
