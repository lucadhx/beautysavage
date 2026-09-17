// M4 — Orchestrateur de gestion d'identité (commerciale=admin / support=dev). react-query.
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoadingState, ErrorState } from '@bs/ui';
import {
  ApiError,
  listCommunicationIdentities,
  createCommercialeIdentity,
  createSupportIdentity,
  requestIdentityVerification,
  confirmIdentityVerification,
  setActiveCommunicationIdentity,
  refreshCommunicationIdentity,
  type CommunicationIdentitySummary,
  type CommunicationScopeView,
} from '@bs/api-client';
import { IdentityForm } from './IdentityForm';
import { VerificationPanel } from './VerificationPanel';

export interface IdentityManagerProps {
  scope: CommunicationScopeView; // 'admin' → commerciale ; 'dev' → support
  role: 'commerciale' | 'support';
  roleLabel: string;
}

function messageFromError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return 'Accès réservé.';
    return err.message || 'Une erreur est survenue.';
  }
  return 'Une erreur est survenue.';
}

export function IdentityManager({ scope, role, roleLabel }: IdentityManagerProps) {
  const qc = useQueryClient();
  const queryKey = ['communication-identities', scope];
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, status, error } = useQuery({
    queryKey,
    queryFn: () => listCommunicationIdentities(scope),
    retry: false,
  });

  const identities = useMemo(
    () => (data ?? []).filter((i) => i.role === role),
    [data, role],
  );

  const invalidate = () => qc.invalidateQueries({ queryKey });
  const onError = (err: unknown) => setActionError(messageFromError(err));
  const onOk = () => { setActionError(null); void invalidate(); };

  const createMut = useMutation({
    mutationFn: (input: { email: string; displayName: string }) =>
      scope === 'dev' ? createSupportIdentity(input) : createCommercialeIdentity(input),
    onSuccess: onOk,
    onError,
  });
  const requestMut = useMutation({ mutationFn: (id: string) => requestIdentityVerification(id, scope), onSuccess: onOk, onError });
  const confirmMut = useMutation({
    mutationFn: (v: { id: string; code: string }) => confirmIdentityVerification(v.id, v.code, scope),
    onSuccess: onOk,
    onError,
  });
  const activateMut = useMutation({ mutationFn: (id: string) => setActiveCommunicationIdentity(id, scope), onSuccess: onOk, onError });
  const refreshMut = useMutation({ mutationFn: (id: string) => refreshCommunicationIdentity(id, scope), onSuccess: onOk, onError });

  const busy =
    requestMut.isPending || confirmMut.isPending || activateMut.isPending || refreshMut.isPending;

  if (status === 'pending') return <LoadingState label="Chargement des identités…" />;
  if (status === 'error') {
    const denied = error instanceof ApiError && error.status === 403;
    return <ErrorState title={denied ? 'Accès réservé.' : 'Impossible de charger les identités.'} />;
  }

  return (
    <div className="cc-page">
      {identities.length === 0 ? (
        <div className="cc-empty">
          Aucune identité {roleLabel.toLowerCase()} configurée. Créez-en une pour activer l'envoi d'e-mails.
        </div>
      ) : (
        identities.map((identity: CommunicationIdentitySummary) => (
          <VerificationPanel
            key={identity.id}
            identity={identity}
            busy={busy}
            errorMessage={actionError}
            onRequest={(id) => requestMut.mutate(id)}
            onConfirm={(id, code) => confirmMut.mutate({ id, code })}
            onActivate={(id) => activateMut.mutate(id)}
            onRefresh={(id) => refreshMut.mutate(id)}
          />
        ))
      )}

      <IdentityForm
        roleLabel={roleLabel}
        pending={createMut.isPending}
        errorMessage={createMut.isError ? messageFromError(createMut.error) : null}
        onSubmit={(input) => createMut.mutate(input)}
      />
    </div>
  );
}
