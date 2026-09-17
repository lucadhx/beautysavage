// RX-BLOCKER-2 — Gestion des comptes manager (dev-only). Cards (zéro table), mobile-first. Création par
// invitation (aucun mot de passe saisi ici) ; actions renvoyer invitation / activer / désactiver.
import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Drawer, EmptyState, ErrorState, FormField, LoadingState, Select, Skeleton, TextInput } from '@bs/ui';
import {
  listManagerUsers, createManagerUser, resendManagerInvitation, disableManagerUser, enableManagerUser,
  ApiError, type ManagerUser, type ManagerUserStatus,
} from '@bs/api-client';
import './managerUsers.css';

const STATUS: Record<ManagerUserStatus, { label: string; tone: 'success' | 'info' | 'muted' }> = {
  invited: { label: 'Invitation envoyée', tone: 'info' },
  active: { label: 'Actif', tone: 'success' },
  disabled: { label: 'Désactivé', tone: 'muted' },
};

function UserCard({ u }: { u: ManagerUser }) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['manager-users'] });
  const resend = useMutation({ mutationFn: () => resendManagerInvitation(u.id), onSuccess: invalidate });
  const disable = useMutation({ mutationFn: () => disableManagerUser(u.id), onSuccess: invalidate });
  const enable = useMutation({ mutationFn: () => enableManagerUser(u.id), onSuccess: invalidate });
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;
  const st = STATUS[u.status];
  return (
    <Card className="mu-card">
      <div className="mu-card__head">
        <span className="mu-card__name">{name}</span>
        <Badge tone={u.role === 'dev' ? 'accent' : 'neutral'}>{u.role === 'dev' ? 'Développeur' : 'Administrateur'}</Badge>
      </div>
      <span className="mu-card__email">{u.email}</span>
      <div className="mu-card__foot">
        <Badge tone={st.tone}>{st.label}</Badge>
        <div className="mu-card__actions">
          {u.status !== 'active' ? (
            <Button variant="secondary" onClick={() => resend.mutate()} disabled={resend.isPending}>Renvoyer l’invitation</Button>
          ) : null}
          {u.status === 'disabled' ? (
            <Button variant="secondary" onClick={() => enable.mutate()} disabled={enable.isPending}>Activer</Button>
          ) : (
            <button type="button" className="bs-btn bs-btn--secondary mu-danger" onClick={() => disable.mutate()} disabled={disable.isPending}>Désactiver</button>
          )}
        </div>
      </div>
    </Card>
  );
}

function CreateDrawer({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const fnId = useId(); const lnId = useId(); const emId = useId(); const roId = useId();
  const [firstName, setFirstName] = useState(''); const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState(''); const [role, setRole] = useState<'admin' | 'dev'>('admin');
  const create = useMutation({
    mutationFn: () => createManagerUser({ firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim(), role }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['manager-users'] }); onClose(); },
  });
  const err = create.error instanceof ApiError ? create.error.message : create.isError ? 'Création impossible.' : '';
  function onSubmit(e: FormEvent) { e.preventDefault(); if (email.trim()) create.mutate(); }
  return (
    <Drawer open title="Créer un utilisateur" onClose={onClose} footer={
      <div className="mu-actions">
        <Button variant="secondary" onClick={onClose} disabled={create.isPending}>Annuler</Button>
        <Button onClick={onSubmit} disabled={!email.trim() || create.isPending}>{create.isPending ? 'Envoi…' : 'Inviter'}</Button>
      </div>
    }>
      <form className="mu-form" onSubmit={onSubmit}>
        <p className="mu-hint">L’utilisateur recevra un e-mail pour définir son mot de passe. Aucun mot de passe n’est saisi ici.</p>
        <FormField label="Prénom" htmlFor={fnId}><TextInput id={fnId} value={firstName} maxLength={64} onChange={(e) => setFirstName(e.target.value)} /></FormField>
        <FormField label="Nom" htmlFor={lnId}><TextInput id={lnId} value={lastName} maxLength={64} onChange={(e) => setLastName(e.target.value)} /></FormField>
        <FormField label="E-mail" htmlFor={emId} required><TextInput id={emId} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} /></FormField>
        <FormField label="Rôle" htmlFor={roId}>
          <Select id={roId} value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'dev')}>
            <option value="admin">Administrateur</option>
            <option value="dev">Développeur</option>
          </Select>
        </FormField>
        {err ? <ErrorState title={err} /> : null}
      </form>
    </Drawer>
  );
}

export function ManagerUsersPage() {
  const [creating, setCreating] = useState(false);
  const query = useQuery({ queryKey: ['manager-users'], queryFn: ({ signal }) => listManagerUsers(signal), retry: false });
  return (
    <section className="mu">
      <div className="mu__head">
        <h1 className="mu__title">Utilisateurs</h1>
        <Button onClick={() => setCreating(true)}>Créer un utilisateur</Button>
      </div>
      {query.isPending ? (
        <Skeleton variant="block" height="96px" count={3} />
      ) : query.isError ? (
        <ErrorState title="Impossible de charger les utilisateurs." />
      ) : (query.data ?? []).length === 0 ? (
        <EmptyState label="Aucun utilisateur manager pour le moment." />
      ) : (
        <div className="mu__grid">{(query.data ?? []).map((u) => <UserCard key={u.id} u={u} />)}</div>
      )}
      {creating ? <CreateDrawer onClose={() => setCreating(false)} /> : null}
      {query.isFetching && !query.isPending ? <span className="bs-visually-hidden"><LoadingState label="Mise à jour…" /></span> : null}
    </section>
  );
}
