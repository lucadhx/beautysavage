// M7 — Studio des catégories de notification (dev-only) : liste, création, édition, suppression,
// activation, ordre. Aperçu immédiat (badge catégorie).
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Button, LoadingState, ErrorState } from '@bs/ui';
import {
  ApiError,
  listNotificationCategories,
  createNotificationCategory,
  updateNotificationCategory,
  deleteNotificationCategory,
  type NotificationCategory,
} from '@bs/api-client';
import { NotificationCategoryBadge } from './components';
import { toHexValue } from './colorUtil';

function messageFromError(err: unknown): string {
  if (err instanceof ApiError) return err.status === 403 ? 'Accès réservé.' : err.message || 'Erreur.';
  return 'Une erreur est survenue.';
}

function CategoryRow({ cat, onSave, onDelete, busy }: {
  cat: NotificationCategory;
  onSave: (id: string, patch: Partial<NotificationCategory>) => void;
  onDelete: (id: string) => void;
  busy: boolean;
}) {
  const [icon, setIcon] = useState(cat.icon);
  const [color, setColor] = useState(cat.color);
  const [sortOrder, setSortOrder] = useState(String(cat.sortOrder));
  const [active, setActive] = useState(cat.active);
  return (
    <Card className="ns-item">
      <div className="ns-item__top">
        <NotificationCategoryBadge category={{ ...cat, icon, color }} />
        <span className="ns-note">slug: {cat.slug}</span>
      </div>
      <div className="ns-fields ns-fields--2">
        <div className="ns-field">
          <label className="ns-label">Icône (classe bootstrap-icons)</label>
          <input className="ns-input" type="text" value={icon} onChange={(e) => setIcon(e.target.value)} />
        </div>
        <div className="ns-field">
          <label className="ns-label">Couleur</label>
          <div className="ns-actions">
            <input type="color" aria-label="Couleur" value={toHexValue(color)} onChange={(e) => setColor(e.target.value)} style={{ width: 44, height: 44, minWidth: 44 }} />
            <input className="ns-input" type="text" value={color} onChange={(e) => setColor(e.target.value)} placeholder="#rrggbb" />
          </div>
        </div>
        <div className="ns-field">
          <label className="ns-label">Ordre</label>
          <input className="ns-input" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </div>
        <div className="ns-field">
          <span className="ns-label">Active</span>
          <label className="ns-toggle"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /><span className="ns-note">Visible</span></label>
        </div>
      </div>
      <div className="ns-item__actions">
        <Button type="button" disabled={busy} onClick={() => onSave(cat.id, { icon, color, sortOrder: Number(sortOrder) || 0, active })}>Enregistrer</Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => onDelete(cat.id)}>Supprimer</Button>
      </div>
    </Card>
  );
}

export function NotificationCategoriesPage() {
  const qc = useQueryClient();
  const { data, status } = useQuery({ queryKey: ['notif-categories'], queryFn: listNotificationCategories, retry: false });
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['notif-categories'] });

  const createMut = useMutation({ mutationFn: (n: string) => createNotificationCategory({ name: n }), onSuccess: () => { setError(null); setName(''); invalidate(); }, onError: (e) => setError(messageFromError(e)) });
  const updateMut = useMutation({ mutationFn: (v: { id: string; patch: Partial<NotificationCategory> }) => updateNotificationCategory(v.id, v.patch), onSuccess: () => { setError(null); invalidate(); }, onError: (e) => setError(messageFromError(e)) });
  const deleteMut = useMutation({ mutationFn: (id: string) => deleteNotificationCategory(id), onSuccess: () => { setError(null); invalidate(); }, onError: (e) => setError(messageFromError(e)) });
  const busy = updateMut.isPending || deleteMut.isPending;

  const onCreate = (e: FormEvent) => { e.preventDefault(); if (name.trim()) createMut.mutate(name.trim()); };

  if (status === 'pending') return <LoadingState label="Chargement des catégories…" />;
  if (status === 'error') return <ErrorState title="Impossible de charger les catégories." />;

  const cats = [...(data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  return (
    <div className="ns-page">
      <Card>
        <form className="ns-page" onSubmit={onCreate} aria-label="Créer une catégorie">
          <div className="ns-field">
            <label className="ns-label" htmlFor="ns-cat-name">Nouvelle catégorie</label>
            <input id="ns-cat-name" className="ns-input" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="ex. Paiement" />
          </div>
          <div className="ns-actions"><Button type="submit" disabled={createMut.isPending || !name.trim()}>{createMut.isPending ? 'Création…' : 'Créer'}</Button></div>
          {error ? <p className="ns-error">{error}</p> : null}
        </form>
      </Card>

      {cats.length === 0 ? <div className="ns-empty">Aucune catégorie.</div> : (
        <div className="ns-list">
          {cats.map((c) => (
            <CategoryRow key={c.id} cat={c} busy={busy} onSave={(id, patch) => updateMut.mutate({ id, patch })} onDelete={(id) => deleteMut.mutate(id)} />
          ))}
        </div>
      )}
    </div>
  );
}
