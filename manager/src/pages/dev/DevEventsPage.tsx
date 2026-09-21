import * as React from 'react';
import { Activity, RefreshCw, RotateCcw, X } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button, Card, CardContent, Badge, EmptyState } from '@/components/ui/primitives';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { Modal } from '@/components/ui/dialog';
import { useResource, useAction } from '@/hooks/useResource';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import type { DomainEventView, DomainEventPage, EventExecutionView } from '@/types';
import {
  dispatchStatusMeta,
  executionStatusMeta,
  eventTypeLabel,
  actorLabel,
  actionsSummary,
  canRetryEvent,
  nextAttemptAt,
  attemptsLabel,
  payloadRows,
  buildEventQuery,
  hasActiveFilters,
  EVENT_TYPE_LABELS,
  DISPATCH_STATUS_META,
  type EventFilters,
} from '@/lib/domainEvents';

/**
 * Événements système — DEV uniquement, LECTURE SEULE.
 *
 * Rend le journal observable : ce qui s'est passé, ce qui en a découlé, ce qui a
 * échoué et pourquoi. Aucune création, aucune édition — un fait ne se fabrique pas
 * depuis une interface. La seule action est un retry, et seulement sur un échec.
 */
export default function DevEventsPage() {
  const [filters, setFilters] = React.useState<EventFilters>({});
  const [selected, setSelected] = React.useState<string | null>(null);

  const query = buildEventQuery(filters, null, 50);
  const { data, loading, reload } = useResource<DomainEventPage>(() => api.listDomainEvents(query), [query]);
  const refresh = useAction();

  const events = data?.events ?? [];

  return (
    <div>
      <PageHeader
        title="Événements système"
        description="Journal des événements métier et des actions qu'ils déclenchent. Lecture seule."
        action={
          <Button
            variant="outline"
            size="sm"
            loading={refresh.pending}
            onClick={() => refresh.run(async () => reload())}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Rafraîchir
          </Button>
        }
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center gap-2 py-3">
          <select
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            value={filters.type || ''}
            onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value || undefined }))}
            aria-label="Filtrer par type"
          >
            <option value="">Tous les types</option>
            {Object.entries(EVENT_TYPE_LABELS).map(([type, label]) => (
              <option key={type} value={type}>{label}</option>
            ))}
          </select>
          <select
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            value={filters.dispatchStatus || ''}
            onChange={(e) => setFilters((f) => ({ ...f, dispatchStatus: e.target.value || undefined }))}
            aria-label="Filtrer par statut"
          >
            <option value="">Tous les statuts</option>
            {Object.entries(DISPATCH_STATUS_META).map(([status, meta]) => (
              <option key={status} value={status}>{meta.label}</option>
            ))}
          </select>
          {hasActiveFilters(filters) && (
            <Button variant="ghost" size="sm" onClick={() => setFilters({})}>
              <X className="h-3.5 w-3.5" /> Effacer les filtres
            </Button>
          )}
        </CardContent>
      </Card>

      {loading ? (
        <BrandLoader />
      ) : events.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="Aucun événement"
          description={
            hasActiveFilters(filters)
              ? 'Aucun événement ne correspond à ces filtres.'
              : "Les événements apparaîtront ici dès qu'une action métier en émettra."
          }
        />
      ) : (
        <Card>
          <CardContent className="py-0">
            {events.map((e) => (
              <EventRow key={e.eventId} event={e} onOpen={() => setSelected(e.eventId)} />
            ))}
          </CardContent>
        </Card>
      )}

      {data?.nextCursor && (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Seuls les 50 événements les plus récents sont affichés.
        </p>
      )}

      {selected && <EventDetailModal eventId={selected} onClose={() => setSelected(null)} onChanged={reload} />}
    </div>
  );
}

function EventRow({ event, onOpen }: { event: DomainEventView; onOpen: () => void }) {
  const meta = dispatchStatusMeta(event.dispatchStatus);
  return (
    <button
      onClick={onOpen}
      className="flex w-full flex-wrap items-center justify-between gap-2 border-b border-border py-3 text-left last:border-0 hover:bg-muted/40"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{eventTypeLabel(event.type)}</p>
        <p className="truncate text-xs text-muted-foreground">
          {formatDateTime(event.occurredAt)} · {event.entityType} · {actorLabel(event.actor)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-xs text-muted-foreground">{actionsSummary(event.actions)}</span>
        <Badge className={meta.cls}>{meta.label}</Badge>
      </div>
    </button>
  );
}

function EventDetailModal({
  eventId, onClose, onChanged,
}: {
  eventId: string; onClose: () => void; onChanged: () => void;
}) {
  const { data: event, loading, reload } = useResource<DomainEventView>(() => api.getDomainEvent(eventId), [eventId]);
  const retry = useAction();
  const [now, setNow] = React.useState(() => Date.now());

  // Le compteur de « prochaine tentative » doit rester juste tant que le détail
  // est ouvert, sans pour autant recharger l'événement en boucle.
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const onRetry = async () => {
    try {
      await retry.run(() => api.retryDomainEvent(eventId), { success: 'Relance demandée' });
      reload();
      onChanged();
    } catch { /* toast */ }
  };

  return (
    <Modal open onClose={onClose} title="Détail de l'événement" className="max-w-3xl">
      {loading || !event ? (
        <div className="py-8"><BrandLoader /></div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium">{eventTypeLabel(event.type)}</p>
              <p className="font-mono text-xs text-muted-foreground">{event.type}</p>
            </div>
            <Badge className={dispatchStatusMeta(event.dispatchStatus).cls}>
              {dispatchStatusMeta(event.dispatchStatus).label}
            </Badge>
          </div>

          <div className="grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
            <Row label="Date" value={formatDateTime(event.occurredAt)} />
            <Row label="Entité" value={`${event.entityType}${event.entityId ? ` · ${event.entityId}` : ''}`} />
            <Row label="Acteur" value={actorLabel(event.actor)} />
            <Row label="Rétention" value={event.retentionClass} />
          </div>

          {/* Payload — sûr par construction ; `payloadRows` écarte en plus toute
              clé interdite qui aurait franchi la garde backend. */}
          {payloadRows(event.payloadSafe).length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium">Données de l'événement</p>
              <div className="grid gap-x-4 gap-y-0.5 rounded-md bg-muted/40 p-2 text-xs sm:grid-cols-2">
                {payloadRows(event.payloadSafe).map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-2">
                    <span className="text-muted-foreground">{key}</span>
                    <span className="truncate font-mono" title={value}>{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="mb-1 text-xs font-medium">Actions</p>
            {(event.executions ?? []).length === 0 ? (
              <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
                Aucune action n'est associée à ce type d'événement. C'est normal : il sert de trace.
              </p>
            ) : (
              <div className="space-y-2">
                {(event.executions ?? []).map((x) => (
                  <ExecutionRow key={x.id} execution={x} now={now} />
                ))}
              </div>
            )}
          </div>

          {event.lastErrorSafe.code && (
            <div className="rounded-md bg-red-50 p-2 text-xs text-red-800">
              <p className="font-medium">{event.lastErrorSafe.code}</p>
              <p className="opacity-90">{event.lastErrorSafe.message}</p>
            </div>
          )}
        </div>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Fermer</Button>
        {/* Jamais proposé sur un succès : le rejouer enverrait deux fois. */}
        {canRetryEvent(event) && (
          <Button onClick={onRetry} loading={retry.pending}>
            <RotateCcw className="h-4 w-4" /> Relancer les actions en échec
          </Button>
        )}
      </div>
    </Modal>
  );
}

function ExecutionRow({ execution, now }: { execution: EventExecutionView; now: number }) {
  const meta = executionStatusMeta(execution.status);
  const next = nextAttemptAt(execution, now);
  return (
    <div className="rounded-md bg-muted/40 p-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono">{execution.actionId}</span>
        <Badge className={meta.cls}>{meta.label}</Badge>
      </div>
      <div className="mt-1 grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
        <Row label="Type" value={execution.actionType} />
        <Row label="Tentatives" value={attemptsLabel(execution)} />
        {execution.templateId && <Row label="Template" value={execution.templateId} />}
        {execution.recipientResolver && <Row label="Destinataires" value={execution.recipientResolver} />}
        {execution.providerMessageId && <Row label="Message fournisseur" value={execution.providerMessageId} />}
        {next && <Row label="Prochaine tentative" value={formatDateTime(next)} />}
        {execution.processedAt && <Row label="Traitée le" value={formatDateTime(execution.processedAt)} />}
      </div>
      {execution.lastErrorSafe.code && (
        <p className="mt-1 break-words">
          <span className="font-medium">{execution.lastErrorSafe.code}</span>
          {execution.lastErrorSafe.message && <span className="opacity-80"> — {execution.lastErrorSafe.message}</span>}
        </p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-mono" title={value}>{value}</span>
    </div>
  );
}
