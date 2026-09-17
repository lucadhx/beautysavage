// M4 — Composants présentationnels du Communication Center (mobile-first, cards).
import { NavLink } from 'react-router-dom';
import { Card } from '@bs/ui';
import type {
  CommunicationIdentitySummary,
  CommunicationIdentityStatus,
  CommunicationIdentityRole,
  DnsRecord,
  MailDeliverySummary,
  MailDeliveryStats,
  SendLogSummary,
  SendLogStats,
} from '@bs/api-client';

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ─── Badges ───────────────────────────────────────────────────────────────────

const IDENTITY_STATUS_LABEL: Record<CommunicationIdentityStatus, { label: string; variant: string }> = {
  verified: { label: 'Vérifiée', variant: 'success' },
  verification_pending: { label: 'Vérification en cours', variant: 'warning' },
  unverified: { label: 'Non vérifiée', variant: 'muted' },
  disabled: { label: 'Désactivée', variant: 'danger' },
};

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const key = String(status || '') as CommunicationIdentityStatus;
  const known = IDENTITY_STATUS_LABEL[key];
  if (known) return <span className={`cc-badge cc-badge--${known.variant}`}>{known.label}</span>;
  // Statuts de livraison / sendlog génériques.
  const variant =
    status === 'sent' || status === 'delivered' || status === 'opened'
      ? 'success'
      : status === 'failed' || status === 'bounced' || status === 'identity_missing' || status === 'client_missing'
        ? 'danger'
        : status?.startsWith('skipped') || status === 'shadow' || status === 'queued'
          ? 'muted'
          : 'info';
  return <span className={`cc-badge cc-badge--${variant}`}>{status || '—'}</span>;
}

export function RoleBadge({ role }: { role: CommunicationIdentityRole | string | null | undefined }) {
  const map: Record<string, string> = { commerciale: 'Commerciale', support: 'Support', client: 'Client' };
  const variant = role === 'support' ? 'info' : role === 'client' ? 'muted' : 'info';
  return <span className={`cc-badge cc-badge--${variant}`}>{map[String(role || '')] || role || '—'}</span>;
}

// ─── DNS ────────────────────────────────────────────────────────────────────

export function DnsStatusPanel({ identity }: { identity: CommunicationIdentitySummary }) {
  const records: DnsRecord[] = identity.dnsRecords || [];
  return (
    <div className="cc-dns">
      <div className="cc-item__top">
        <span className="cc-item__title">Authentification du domaine</span>
        {identity.domainAuthenticated ? (
          <span className="cc-badge cc-badge--success">Authentifié</span>
        ) : (
          <span className="cc-badge cc-badge--warning">Non authentifié</span>
        )}
      </div>
      <p className="cc-inline-note">
        Domaine : <strong>{identity.domain || '—'}</strong>
        {identity.domainStatus ? ` · ${identity.domainStatus}` : ''}
      </p>
      {records.length === 0 ? (
        <p className="cc-inline-note">Aucun enregistrement DNS à configurer pour le moment.</p>
      ) : (
        records.map((r, i) => (
          <div className="cc-dns__record" key={`${r.type}-${r.host}-${i}`}>
            <div className="cc-item__top">
              <span><strong>{r.type || 'DNS'}</strong> · {r.host}</span>
              {r.status ? <StatusBadge status={r.status} /> : null}
            </div>
            <code className="cc-dns__value">{r.value}</code>
          </div>
        ))
      )}
    </div>
  );
}

// ─── Identité ─────────────────────────────────────────────────────────────────

export function IdentityStatusCard({ identity }: { identity: CommunicationIdentitySummary }) {
  return (
    <Card className="cc-item">
      <div className="cc-item__top">
        <span className="cc-item__title">{identity.displayName}</span>
        <span className="cc-actions">
          <RoleBadge role={identity.role} />
          <StatusBadge status={identity.status} />
          {identity.active ? <span className="cc-badge cc-badge--success">Active</span> : <span className="cc-badge cc-badge--muted">Inactive</span>}
        </span>
      </div>
      <div className="cc-item__meta">
        <span className="cc-kv"><span className="cc-kv__k">E-mail :</span><span className="cc-kv__v">{identity.email}</span></span>
        <span className="cc-kv"><span className="cc-kv__k">Domaine :</span><span className="cc-kv__v">{identity.domainAuthenticated ? 'authentifié' : 'à authentifier'}</span></span>
      </div>
      {identity.verification?.lastErrorMessageSafe ? (
        <p className="cc-inline-error">{identity.verification.lastErrorMessageSafe}</p>
      ) : null}
    </Card>
  );
}

// ─── Stats mail ────────────────────────────────────────────────────────────────

function StatCard({ value, label, variant }: { value: number | string; label: string; variant?: string }) {
  return (
    <Card className={`cc-stat ${variant ? `cc-stat--${variant}` : ''}`.trim()}>
      <span className="cc-stat__value">{value}</span>
      <span className="cc-stat__label">{label}</span>
    </Card>
  );
}

export function MailStatsCards({ stats }: { stats: MailDeliveryStats | null }) {
  if (!stats) return null;
  return (
    <div className="cc-grid cc-grid--4">
      <StatCard value={stats.total} label="Livraisons (total)" />
      <StatCard value={stats.activeCount} label="Règles actives" variant="success" />
      <StatCard value={stats.shadowCount} label="En shadow" />
      <StatCard value={stats.failuresLast24h} label="Échecs (24 h)" variant={stats.failuresLast24h > 0 ? 'danger' : undefined} />
    </div>
  );
}

export function SendLogStatsCards({ stats }: { stats: SendLogStats | null }) {
  if (!stats) return null;
  return (
    <div className="cc-grid cc-grid--3">
      <StatCard value={stats.total} label="Envois (total)" />
      <StatCard value={stats.last24h} label="Sur 24 h" />
      <StatCard value={stats.failuresLast24h} label="Échecs (24 h)" variant={stats.failuresLast24h > 0 ? 'danger' : undefined} />
    </div>
  );
}

// ─── Listes mail ────────────────────────────────────────────────────────────────

export function MailDeliveryList({ items }: { items: MailDeliverySummary[] }) {
  if (!items.length) return <div className="cc-empty">Aucune livraison pour ces filtres.</div>;
  return (
    <div className="cc-list">
      {items.map((d) => (
        <Card className="cc-item" key={d.id}>
          <div className="cc-item__top">
            <span className="cc-item__title">{d.eventName || '—'}</span>
            <StatusBadge status={d.status} />
          </div>
          <div className="cc-item__meta">
            <span className="cc-kv"><span className="cc-kv__k">Template :</span><span className="cc-kv__v">{d.templateKey || '—'}</span></span>
            <span className="cc-kv"><span className="cc-kv__k">De :</span><span className="cc-kv__v">{d.fromRole || '—'}</span></span>
            <span className="cc-kv"><span className="cc-kv__k">Vers :</span><span className="cc-kv__v">{d.toRole || '—'}</span></span>
            <span className="cc-kv"><span className="cc-kv__k">Mode :</span><span className="cc-kv__v">{d.mode || '—'}</span></span>
            <span className="cc-kv"><span className="cc-kv__k">Le :</span><span className="cc-kv__v">{formatDate(d.createdAt)}</span></span>
          </div>
          {d.lastErrorMessageSafe ? <p className="cc-inline-note">{d.lastErrorMessageSafe}</p> : null}
        </Card>
      ))}
    </div>
  );
}

export function SendLogList({ items }: { items: SendLogSummary[] }) {
  if (!items.length) return <div className="cc-empty">Aucun envoi pour ces filtres.</div>;
  return (
    <div className="cc-list">
      {items.map((l) => (
        <Card className="cc-item" key={l.id}>
          <div className="cc-item__top">
            <span className="cc-item__title">{l.templateKey || '—'}</span>
            <StatusBadge status={l.status} />
          </div>
          <div className="cc-item__meta">
            <span className="cc-kv"><span className="cc-kv__k">De :</span><span className="cc-kv__v">{l.senderRole || '—'}</span></span>
            <span className="cc-kv"><span className="cc-kv__k">Vers :</span><span className="cc-kv__v">{l.recipientRole || '—'}</span></span>
            <span className="cc-kv"><span className="cc-kv__k">Destinataire (hash) :</span><span className="cc-kv__v">{l.recipientHash ? `${l.recipientHash.slice(0, 10)}…` : '—'}</span></span>
            <span className="cc-kv"><span className="cc-kv__k">Le :</span><span className="cc-kv__v">{formatDate(l.createdAt)}</span></span>
          </div>
          {l.lastErrorMessageSafe ? <p className="cc-inline-note">{l.lastErrorMessageSafe}</p> : null}
        </Card>
      ))}
    </div>
  );
}

// ─── Onglets ──────────────────────────────────────────────────────────────────

export interface TabItem {
  to: string;
  label: string;
  end?: boolean;
}
export function CommunicationTabs({ items }: { items: TabItem[] }) {
  return (
    <nav className="cc-tabs" aria-label="Sections communication">
      {items.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) => `cc-tab ${isActive ? 'cc-tab--active' : ''}`.trim()}
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
