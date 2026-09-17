// M4 — Vues de supervision mail réutilisées par admin et dev (scope diffère).
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LoadingState, ErrorState } from '@bs/ui';
import {
  listMailDeliveries,
  getMailDeliveryStats,
  listSendLogs,
  getSendLogStats,
  type MailSupervisionFilters,
  type MailSupervisionScope,
} from '@bs/api-client';
import { MailStatsCards, MailDeliveryList, SendLogList, SendLogStatsCards } from './components';
import { MailFilterBar, MobileFilterDrawer } from './MailFilters';

export function MailDeliveriesView({ scope }: { scope: MailSupervisionScope }) {
  const [filters, setFilters] = useState<MailSupervisionFilters>({ limit: 50 });
  const reset = () => setFilters({ limit: 50 });

  const statsQuery = useQuery({
    queryKey: ['mail-stats', scope],
    queryFn: () => getMailDeliveryStats({}, scope),
    retry: false,
  });
  const listQuery = useQuery({
    queryKey: ['mail-deliveries', scope, filters],
    queryFn: () => listMailDeliveries(filters, scope),
    retry: false,
  });

  return (
    <div className="cc-page">
      {statsQuery.data ? <MailStatsCards stats={statsQuery.data} /> : null}
      <MobileFilterDrawer value={filters} onChange={setFilters} onReset={reset} showRoles />
      <MailFilterBar value={filters} onChange={setFilters} showRoles />
      {listQuery.status === 'pending' ? (
        <LoadingState label="Chargement des livraisons…" />
      ) : listQuery.status === 'error' ? (
        <ErrorState title="Impossible de charger les livraisons." />
      ) : (
        <MailDeliveryList items={listQuery.data} />
      )}
    </div>
  );
}

export function SendLogsView({ scope }: { scope: MailSupervisionScope }) {
  const [filters, setFilters] = useState<MailSupervisionFilters>({ limit: 50 });
  const reset = () => setFilters({ limit: 50 });

  const statsQuery = useQuery({
    queryKey: ['sendlog-stats', scope],
    queryFn: () => getSendLogStats({}, scope),
    retry: false,
  });
  const listQuery = useQuery({
    queryKey: ['send-logs', scope, filters],
    queryFn: () => listSendLogs(filters, scope),
    retry: false,
  });

  return (
    <div className="cc-page">
      {statsQuery.data ? <SendLogStatsCards stats={statsQuery.data} /> : null}
      <MobileFilterDrawer value={filters} onChange={setFilters} onReset={reset} showRoles={false} />
      <MailFilterBar value={filters} onChange={setFilters} showRoles={false} />
      {listQuery.status === 'pending' ? (
        <LoadingState label="Chargement des envois…" />
      ) : listQuery.status === 'error' ? (
        <ErrorState title="Impossible de charger les envois." />
      ) : (
        <SendLogList items={listQuery.data} />
      )}
    </div>
  );
}
