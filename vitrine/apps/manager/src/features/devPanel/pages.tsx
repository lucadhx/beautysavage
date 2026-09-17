import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, ErrorState, LoadingState } from '@bs/ui';
import { ApiError } from '@bs/api-client';
import {
  getDevContractCurrent,
  getDevContractPaymentStatus,
  getDevStripeConfig,
  listDevEventLogs,
  listDevUnifiedCheckouts,
  listDevWebhookFailures,
  type DevContractCurrent,
  type DevContractPaymentStatus,
  type DevEventLog,
  type DevUnifiedCheckout,
  type DevWebhookFailure,
} from '@bs/api-client';
import './devPanel.css';

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('fr-FR', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return '—';
  }
}

function money(value: number | null | undefined): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(value || 0));
}

function QueryBlock({
  pending,
  error,
  children,
  empty,
}: {
  pending: boolean;
  error: boolean;
  children: ReactNode;
  empty?: ReactNode;
}) {
  if (pending) return <LoadingState label="Chargement…" />;
  if (error) return <ErrorState title="Chargement impossible." detail="Réessayez plus tard." />;
  return <>{children || empty}</>;
}

function ContractStatusCard({ contract, steps }: { contract: DevContractCurrent; steps: DevContractPaymentStatus['steps'] }) {
  return (
    <Card>
      <div className="devp-card__head">
        <div>
          <h2 className="devp-card__title">Contrat plateforme</h2>
          <p className="devp-card__subtitle">État réel du contrat institut ↔ plateforme.</p>
        </div>
        <Badge tone={contract.status === 'active' ? 'success' : 'warning'}>{contract.status}</Badge>
      </div>
      <div className="devp-grid">
        <div className="devp-kpi">
          <span>Activation</span>
          <strong>{fmtDateTime(contract.startDate)}</strong>
        </div>
        <div className="devp-kpi">
          <span>Frais de lancement</span>
          <strong>{money(contract.launchFee?.amount)}</strong>
        </div>
        <div className="devp-kpi">
          <span>Abonnement mensuel</span>
          <strong>{money(contract.monthlyFee?.amount)}</strong>
        </div>
        <div className="devp-kpi">
          <span>Commissions</span>
          <strong>
            {contract.commissions?.type === 'percentage'
              ? `${Number(contract.commissions.value || 0)} %`
              : money(contract.commissions?.value)}
          </strong>
        </div>
      </div>
      <div className="devp-checklist">
        <span className={`devp-check ${steps.fileDownloaded ? 'devp-check--ok' : ''}`}>Contrat consulté</span>
        <span className={`devp-check ${steps.launchFeePaid ? 'devp-check--ok' : ''}`}>Launch fee réglé</span>
        <span className={`devp-check ${steps.monthlyActive ? 'devp-check--ok' : ''}`}>Abonnement actif</span>
        <span className={`devp-check ${steps.contractActive ? 'devp-check--ok' : ''}`}>Contrat actif</span>
      </div>
    </Card>
  );
}

function UnifiedCheckoutList({ items }: { items: DevUnifiedCheckout[] }) {
  if (!items.length) {
    return <Card><p className="devp-empty">Aucun unified checkout récent.</p></Card>;
  }
  return (
    <div className="devp-list">
      {items.map((item) => (
        <Card key={item.checkoutId}>
          <div className="devp-card__head">
            <div>
              <h2 className="devp-card__title">{item.checkoutId}</h2>
              <p className="devp-card__subtitle">{item.kind || 'checkout'} · {item.source || 'origine inconnue'}</p>
            </div>
            <Badge tone={item.status === 'finalized' ? 'success' : 'info'}>{item.status || 'inconnu'}</Badge>
          </div>
          <div className="devp-grid">
            <div className="devp-kpi">
              <span>Montant à payer</span>
              <strong>{money(item.payment.amountToPay)}</strong>
            </div>
            <div className="devp-kpi">
              <span>Mode</span>
              <strong>{item.payment.mode || '—'}</strong>
            </div>
            <div className="devp-kpi">
              <span>Finalisation</span>
              <strong>{item.finalization.saleId || item.finalization.bookingId || '—'}</strong>
            </div>
            <div className="devp-kpi">
              <span>Créé le</span>
              <strong>{fmtDateTime(item.createdAt)}</strong>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function EventLogList({ items }: { items: DevEventLog[] }) {
  if (!items.length) {
    return <Card><p className="devp-empty">Aucun événement récent.</p></Card>;
  }
  return (
    <div className="devp-list">
      {items.map((item, index) => (
        <Card key={`${item.eventName}-${item.traceId || index}`}>
          <div className="devp-card__head">
            <div>
              <h2 className="devp-card__title">{item.eventName}</h2>
              <p className="devp-card__subtitle">{item.domain || 'domaine inconnu'} · {item.source || 'source inconnue'}</p>
            </div>
            <Badge tone="neutral">{item.actorType || 'system'}</Badge>
          </div>
          <div className="devp-grid">
            <div className="devp-kpi">
              <span>Contexte</span>
              <strong>{item.contextType || '—'} {item.contextId || ''}</strong>
            </div>
            <div className="devp-kpi">
              <span>Trace</span>
              <strong>{item.traceId || '—'}</strong>
            </div>
            <div className="devp-kpi">
              <span>Émis le</span>
              <strong>{fmtDateTime(item.emittedAt || item.createdAt)}</strong>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function WebhookFailureList({ items }: { items: DevWebhookFailure[] }) {
  if (!items.length) {
    return <Card><p className="devp-empty">Aucun webhook en échec récent.</p></Card>;
  }
  return (
    <div className="devp-list">
      {items.map((item, index) => (
        <Card key={`${item.stripeEventId || item.paymentIntentId || index}`}>
          <div className="devp-card__head">
            <div>
              <h2 className="devp-card__title">{item.eventType || 'Webhook'}</h2>
              <p className="devp-card__subtitle">{item.provider || 'provider inconnu'} · {item.failureStage || 'stage inconnu'}</p>
            </div>
            <Badge tone={item.status === 'resolved' ? 'success' : 'danger'}>{item.status}</Badge>
          </div>
          <p className="devp-message">{item.errorMessageSafe || 'Erreur non détaillée.'}</p>
          <div className="devp-grid">
            <div className="devp-kpi">
              <span>PaymentIntent</span>
              <strong>{item.paymentIntentId || '—'}</strong>
            </div>
            <div className="devp-kpi">
              <span>Stripe event</span>
              <strong>{item.stripeEventId || '—'}</strong>
            </div>
            <div className="devp-kpi">
              <span>Créé le</span>
              <strong>{fmtDateTime(item.createdAt)}</strong>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

export function DevDashboardPage() {
  const contractQuery = useQuery({
    queryKey: ['dev-panel', 'contract-current'],
    queryFn: getDevContractCurrent,
    retry: false,
  });
  const stepsQuery = useQuery({
    queryKey: ['dev-panel', 'contract-steps'],
    queryFn: getDevContractPaymentStatus,
    retry: false,
  });
  const checkoutsQuery = useQuery({
    queryKey: ['dev-panel', 'checkouts', 'dashboard'],
    queryFn: () => listDevUnifiedCheckouts(6),
    retry: false,
  });
  const eventQuery = useQuery({
    queryKey: ['dev-panel', 'events', 'dashboard'],
    queryFn: () => listDevEventLogs(6),
    retry: false,
  });
  const failuresQuery = useQuery({
    queryKey: ['dev-panel', 'webhook-failures', 'dashboard'],
    queryFn: () => listDevWebhookFailures(6),
    retry: false,
  });

  const hasContract =
    !(contractQuery.error instanceof ApiError && contractQuery.error.status === 404) && Boolean(contractQuery.data);

  return (
    <div className="devp-page">
      <div className="devp-hero">
        <div>
          <h1 className="devp-hero__title">Espace développeur</h1>
          <p className="devp-hero__subtitle">Observabilité, contrat plateforme, API intégrée et journaux techniques.</p>
        </div>
        <div className="devp-links">
          <Link className="devp-link" to="/dev/contrats">Contrat</Link>
          <Link className="devp-link" to="/dev/integrated-api">API intégrée</Link>
          <Link className="devp-link" to="/dev/event-logs">Event logs</Link>
          <Link className="devp-link" to="/dev/webhook-failures">Webhook failures</Link>
        </div>
      </div>

      <div className="devp-summary">
        <Card><div className="devp-summary__item"><span>Contrat actif</span><strong>{hasContract ? 'Oui' : 'Non'}</strong></div></Card>
        <Card><div className="devp-summary__item"><span>Unified checkouts</span><strong>{checkoutsQuery.data?.length ?? 0}</strong></div></Card>
        <Card><div className="devp-summary__item"><span>Événements récents</span><strong>{eventQuery.data?.length ?? 0}</strong></div></Card>
        <Card><div className="devp-summary__item"><span>Webhooks en échec</span><strong>{failuresQuery.data?.length ?? 0}</strong></div></Card>
      </div>

      {hasContract && contractQuery.data && stepsQuery.data ? (
        <ContractStatusCard contract={contractQuery.data} steps={stepsQuery.data.steps} />
      ) : (
        <Card>
          <h2 className="devp-card__title">Contrat plateforme</h2>
          <p className="devp-empty">Aucun contrat actif ou en attente. Le détail restera visible dès qu’un contrat existera.</p>
        </Card>
      )}

      <section className="devp-section">
        <div className="devp-section__head">
          <h2>Unified checkouts récents</h2>
          <Link to="/dev/integrated-api">Voir tout</Link>
        </div>
        <QueryBlock pending={checkoutsQuery.isPending} error={checkoutsQuery.isError}>
          <UnifiedCheckoutList items={checkoutsQuery.data ?? []} />
        </QueryBlock>
      </section>

      <section className="devp-section">
        <div className="devp-section__head">
          <h2>Derniers événements</h2>
          <Link to="/dev/event-logs">Voir tout</Link>
        </div>
        <QueryBlock pending={eventQuery.isPending} error={eventQuery.isError}>
          <EventLogList items={eventQuery.data ?? []} />
        </QueryBlock>
      </section>

      <section className="devp-section">
        <div className="devp-section__head">
          <h2>Webhook failures</h2>
          <Link to="/dev/webhook-failures">Voir tout</Link>
        </div>
        <QueryBlock pending={failuresQuery.isPending} error={failuresQuery.isError}>
          <WebhookFailureList items={failuresQuery.data ?? []} />
        </QueryBlock>
      </section>
    </div>
  );
}

export function DevContractsPage() {
  const contractQuery = useQuery({
    queryKey: ['dev-panel', 'contract-current', 'detail'],
    queryFn: getDevContractCurrent,
    retry: false,
  });
  const stepsQuery = useQuery({
    queryKey: ['dev-panel', 'contract-steps', 'detail'],
    queryFn: getDevContractPaymentStatus,
    retry: false,
  });

  if (contractQuery.isPending || stepsQuery.isPending) return <LoadingState label="Chargement du contrat…" />;
  if (contractQuery.error instanceof ApiError && contractQuery.error.status === 404) {
    return (
      <Card>
        <h1 className="devp-card__title">Contrats</h1>
        <p className="devp-empty">Aucun contrat actif ou en attente.</p>
      </Card>
    );
  }
  if (contractQuery.isError || stepsQuery.isError || !contractQuery.data || !stepsQuery.data) {
    return <ErrorState title="Impossible de charger le contrat." detail="Réessayez plus tard." />;
  }

  return (
    <div className="devp-page">
      <ContractStatusCard contract={contractQuery.data} steps={stepsQuery.data.steps} />
    </div>
  );
}

export function IntegratedApiDiagnosticsPage() {
  const stripeQuery = useQuery({
    queryKey: ['dev-panel', 'stripe-dev-config'],
    queryFn: getDevStripeConfig,
    retry: false,
  });
  const checkoutsQuery = useQuery({
    queryKey: ['dev-panel', 'checkouts', 'integrated-api'],
    queryFn: () => listDevUnifiedCheckouts(20),
    retry: false,
  });

  return (
    <div className="devp-page">
      <Card>
        <div className="devp-card__head">
          <div>
            <h1 className="devp-card__title">API intégrée</h1>
            <p className="devp-card__subtitle">Diagnostic utile plutôt qu’un écran vide: état Stripe Dev + derniers unified checkouts.</p>
          </div>
          {stripeQuery.data ? <Badge tone="success">Stripe Dev configuré</Badge> : <Badge tone="warning">Configuration à vérifier</Badge>}
        </div>
        <div className="devp-grid">
          <div className="devp-kpi">
            <span>Clé publique</span>
            <strong>{stripeQuery.data?.publishableKey ? `${stripeQuery.data.publishableKey.slice(0, 12)}…` : 'Indisponible'}</strong>
          </div>
          <div className="devp-kpi">
            <span>Checkouts suivis</span>
            <strong>{checkoutsQuery.data?.length ?? 0}</strong>
          </div>
        </div>
        {stripeQuery.isError ? (
          <p className="devp-message">La clé Stripe Dev n’est pas lisible depuis `/api/contract/stripe-dev-config`.</p>
        ) : null}
      </Card>

      <section className="devp-section">
        <div className="devp-section__head">
          <h2>Unified checkouts</h2>
        </div>
        <QueryBlock pending={checkoutsQuery.isPending} error={checkoutsQuery.isError}>
          <UnifiedCheckoutList items={checkoutsQuery.data ?? []} />
        </QueryBlock>
      </section>
    </div>
  );
}

export function EventLogsPage() {
  const query = useQuery({
    queryKey: ['dev-panel', 'events', 'full'],
    queryFn: () => listDevEventLogs(100),
    retry: false,
  });

  return (
    <div className="devp-page">
      <section className="devp-section">
        <div className="devp-section__head">
          <h1>Event logs</h1>
        </div>
        <QueryBlock pending={query.isPending} error={query.isError}>
          <EventLogList items={query.data ?? []} />
        </QueryBlock>
      </section>
    </div>
  );
}

export function WebhookFailuresPage() {
  const query = useQuery({
    queryKey: ['dev-panel', 'webhook-failures', 'full'],
    queryFn: () => listDevWebhookFailures(100),
    retry: false,
  });

  return (
    <div className="devp-page">
      <section className="devp-section">
        <div className="devp-section__head">
          <h1>Webhook failures</h1>
        </div>
        <QueryBlock pending={query.isPending} error={query.isError}>
          <WebhookFailureList items={query.data ?? []} />
        </QueryBlock>
      </section>
    </div>
  );
}
