// M7 — Client API catégories de notification (dev-only). Endpoints /api/gestion/dev/notification-categories.
import { apiGet, apiPost, apiFetch } from '../apiFetch';

export interface NotificationCategory {
  id: string;
  name: string;
  slug: string;
  icon: string;
  color: string;
  description: string;
  sortOrder: number;
  active: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface NotificationCategoryInput {
  name?: string;
  icon?: string;
  color?: string;
  description?: string;
  sortOrder?: number;
  active?: boolean;
}

const BASE = '/api/gestion/dev/notification-categories';

export async function listNotificationCategories(): Promise<NotificationCategory[]> {
  const res = await apiGet<{ ok: boolean; categories: NotificationCategory[] }>(BASE);
  return res.categories ?? [];
}

export async function createNotificationCategory(input: NotificationCategoryInput): Promise<NotificationCategory> {
  const res = await apiPost<{ ok: boolean; category: NotificationCategory }>(BASE, input);
  return res.category;
}

export async function updateNotificationCategory(id: string, patch: NotificationCategoryInput): Promise<NotificationCategory> {
  const res = await apiFetch<{ ok: boolean; category: NotificationCategory }>(`${BASE}/${encodeURIComponent(id)}`, { method: 'PUT', body: patch });
  return res.category;
}

export async function deleteNotificationCategory(id: string): Promise<{ id: string }> {
  const res = await apiFetch<{ ok: boolean; id: string }>(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return { id: res.id };
}
