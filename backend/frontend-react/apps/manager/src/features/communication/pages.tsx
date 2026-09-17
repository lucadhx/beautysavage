// M4 — Pages du Communication Center (admin + dev).
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, LoadingState } from '@bs/ui';
import {
  listCommunicationIdentities,
  listMailDeliveries,
  getMailDeliveryStats,
  type CommunicationScopeView,
  type CommunicationIdentitySummary,
} from '@bs/api-client';
import { IdentityManager } from './IdentityManager';
import { MailDeliveriesView, SendLogsView } from './views';
import { IdentityStatusCard, MailStatsCards, MailDeliveryList } from './components';

function useIdentities(scope: CommunicationScopeView, role: 'commerciale' | 'support') {
  return useQuery({
    queryKey: ['communication-identities', scope],
    queryFn: () => listCommunicationIdentities(scope),
    retry: false,
    select: (all: CommunicationIdentitySummary[]) => all.filter((i) => i.role === role),
  });
}

function IdentityHeadline({
  scope,
  role,
  configHref,
}: {
  scope: CommunicationScopeView;
  role: 'commerciale' | 'support';
  configHref: string;
}) {
  const { data, status } = useIdentities(scope, role);
  if (status === 'pending') return <LoadingState label="Statut de l'identité…" />;
  const list = data ?? [];
  const active = list.find((i) => i.active) ?? list[0];
  if (!active) {
    return (
      <Card>
        <p className="cc-inline-note">Aucune identité {role} configurée.</p>
        <div className="cc-actions">
          <Link className="cc-quick-link" to={configHref}>Configurer l'identité</Link>
        </div>
      </Card>
    );
  }
  return (
    <div className="cc-page">
      <IdentityStatusCard identity={active} />
      {active.status !== 'verified' || !active.active ? (
        <div className="cc-actions">
          <Link className="cc-quick-link" to={configHref}>Vérifier / activer l'identité</Link>
        </div>
      ) : null}
    </div>
  );
}

// ─── Admin ──────────────────────────────────────────────────────────────────

export function AdminCommunicationDashboard() {
  const stats = useQuery({ queryKey: ['mail-stats', 'admin'], queryFn: () => getMailDeliveryStats({}, 'admin'), retry: false });
  const recent = useQuery({ queryKey: ['mail-recent', 'admin'], queryFn: () => listMailDeliveries({ limit: 5 }, 'admin'), retry: false });

  return (
    <div className="cc-page">
      <IdentityHeadline scope="admin" role="commerciale" configHref="/communication/identite-commerciale" />
      {stats.data ? <MailStatsCards stats={stats.data} /> : null}
      <div className="cc-head"><strong>Derniers e-mails</strong></div>
      {recent.status === 'pending' ? <LoadingState /> : <MailDeliveryList items={recent.data ?? []} />}
      <div className="cc-quick-links">
        <Link className="cc-quick-link" to="/communication/identite-commerciale">Identité commerciale</Link>
        <Link className="cc-quick-link" to="/communication/mails">Voir le journal des mails</Link>
      </div>
    </div>
  );
}

export function CommercialeIdentityPage() {
  return <IdentityManager scope="admin" role="commerciale" roleLabel="Commerciale" />;
}

export function AdminMailsPage() {
  return <MailDeliveriesView scope="admin" />;
}

// ─── Dev ──────────────────────────────────────────────────────────────────────

export function DevCommunicationDashboard() {
  const stats = useQuery({ queryKey: ['mail-stats', 'dev'], queryFn: () => getMailDeliveryStats({}, 'dev'), retry: false });
  const recentFailures = useQuery({
    queryKey: ['mail-recent-failures', 'dev'],
    queryFn: () => listMailDeliveries({ status: 'failed', limit: 5 }, 'dev'),
    retry: false,
  });

  return (
    <div className="cc-page">
      <IdentityHeadline scope="dev" role="support" configHref="/dev/communication/identite-support" />
      {stats.data ? <MailStatsCards stats={stats.data} /> : null}
      <div className="cc-head"><strong>Échecs récents</strong></div>
      {recentFailures.status === 'pending' ? <LoadingState /> : <MailDeliveryList items={recentFailures.data ?? []} />}
      <div className="cc-quick-links">
        <Link className="cc-quick-link" to="/dev/communication/identite-support">Identité support</Link>
        <Link className="cc-quick-link" to="/dev/communication/mail-deliveries">Livraisons mail</Link>
        <Link className="cc-quick-link" to="/dev/communication/send-logs">Send logs</Link>
      </div>
    </div>
  );
}

export function SupportIdentityPage() {
  return <IdentityManager scope="dev" role="support" roleLabel="Support" />;
}

export function DevMailDeliveriesPage() {
  return <MailDeliveriesView scope="dev" />;
}

export function DevSendLogsPage() {
  return <SendLogsView scope="dev" />;
}
