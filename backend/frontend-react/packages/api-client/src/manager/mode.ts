// RX-BLOCKER — Entrée en mode gestion (idempotent). Le manager React l'appelle au boot : sans cela un
// admin/dev garde currentMode='vitrine' et les routes /api/gestion/* gardées par requireMode('gestion')
// redirigent (302) → pages « indisponible ». Réservé admin/dev (client → 403).
import { apiPost } from '../apiFetch';

export async function enterGestionMode(): Promise<{ currentMode: string }> {
  const res = await apiPost<{ ok: boolean; currentMode: string }>('/api/mode/enter-gestion');
  return { currentMode: res.currentMode ?? 'gestion' };
}
