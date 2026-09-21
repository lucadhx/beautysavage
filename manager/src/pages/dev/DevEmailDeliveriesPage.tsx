import * as React from 'react';
import { Mail, RefreshCw, X, Info } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button, Card, CardContent, Badge, EmptyState, Input } from '@/components/ui/primitives';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { Modal } from '@/components/ui/dialog';
import { useResource, useAction } from '@/hooks/useResource';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import type { EmailDeliveryView, EmailDeliveryPage, EmailDeliveryDetail } from '@/types';
import {
  deliveryStatusMeta,
  eventTypeLabel,
  engagementSummary,
  ENGAGEMENT_DISCLAIMER,
  DELIVERY_STATUS_META,
  hasActiveDeliveryFilters,
  buildDeliveryQuery,
  orderTimeline,
  shortMessageId,
  modeLabel,
  UNKNOWN_DIAGNOSTIC_MESSAGE,
  UNKNOWN_DELIVERY_ERROR_MESSAGE,
  type DeliveryFilters,
} from '@/lib/emailDeliveries';

const PAGE_SIZE = 40;

/**
 * Livraisons e-mail — DEV uniquement, LECTURE SEULE.
 *
 * Rend observable ce que devient chaque envoi : en attente de confirmation,
 * livré, différé, échoué — plus l'engagement (détecté, jamais « lu »). Aucun
 * renvoi : relancer un envoi se fait depuis les événements système, pas ici.
 */
export default function DevEmailDeliveriesPage() {
  const [filters, setFilters] = React.useState<DeliveryFilters>({});
  const [searchDraft, setSearchDraft] = React.useState('');
  const [selected, setSelected] = React.useState<string | null>(null);

  // Recherche débattue : on ne requête pas à chaque frappe.
  React.useEffect(() => {
    const t = setTimeout(() => setFilters((f) => ({ ...f, search: searchDraft || undefined })), 350);
    return () => clearTimeout(t);
  }, [searchDraft]);

  const query = buildDeliveryQuery(filters, null, PAGE_SIZE);
  const { data, loading, reload } = useResource<EmailDeliveryPage>(
    () => api.listEmailDeliveriesAll(query),
    [query]
  );
  const refresh = useAction();

  const rows = data?.deliveries ?? [];

  return (
    <div>
      <PageHeader
        title="Livraisons e-mail"
        description="Ce que devient chaque email envoyé par le site. « En attente de confirmation » n'est pas « Livré » : seule la messagerie du destinataire peut confirmer la remise."
        action={
          <Button variant="outline" size="sm" loading={refresh.pending} onClick={() => refresh.run(async () => reload())}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Rafraîchir
          </Button>
        }
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center gap-2 py-3">
          <select
            className="h-9 w-full min-w-0 max-w-full rounded-md border border-border bg-background px-2 text-sm sm:w-auto"
            value={filters.providerMode || ''}
            onChange={(e) => setFilters((f) => ({ ...f, providerMode: (e.target.value || undefined) as DeliveryFilters['providerMode'] }))}
            aria-label="Filtrer par mode"
          >
            <option value="">Tous les modes</option>
            <option value="TEST">{modeLabel('TEST')}</option>
            <option value="PROD">{modeLabel('PROD')}</option>
          </select>
          <select
            /*
              LA LARGEUR D'UN `<select>` SUIT SON OPTION LA PLUS LONGUE.

              « Préparation… — en attente d'envoi » imposait 419 px à ce filtre,
              qui poussait la page hors de l'écran jusqu'à 390 px de large. Un
              `max-w-full` seul ne suffit pas : il faut aussi autoriser la
              réduction (`min-w-0`), sans quoi la largeur intrinsèque gagne.
            */
            className="h-9 w-full min-w-0 max-w-full rounded-md border border-border bg-background px-2 text-sm sm:w-auto"
            value={filters.status || ''}
            onChange={(e) => setFilters((f) => ({ ...f, status: (e.target.value || undefined) as DeliveryFilters['status'] }))}
            aria-label="Filtrer par statut"
          >
            <option value="">Tous les statuts</option>
            {/* `filterLabel`, pas `label` : plusieurs statuts partagent le même
                état, seul le filtre a besoin de les distinguer. */}
            {Object.entries(DELIVERY_STATUS_META).map(([status, meta]) => (
              <option key={status} value={status}>{meta.filterLabel}</option>
            ))}
          </select>
          <Input
            className="h-9 w-full sm:w-56"
            placeholder="Rechercher : destinataire ou identifiant de message"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            aria-label="Rechercher une livraison par destinataire ou identifiant de message"
          />
          {(hasActiveDeliveryFilters(filters) || searchDraft) && (
            <Button variant="ghost" size="sm" onClick={() => { setFilters({}); setSearchDraft(''); }}>
              <X className="h-3.5 w-3.5" aria-hidden="true" /> Effacer
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Filtrer et chercher ne modifient RIEN de visible pour un lecteur
          d'écran : la liste se recompose en silence. Cette annonce restitue
          l'information que le voyant lit d'un coup d'œil. */}
      <p className="sr-only" role="status">
        {loading
          ? 'Chargement des livraisons…'
          : rows.length === 0
            ? 'Aucune livraison ne correspond.'
            : `${rows.length} livraison${rows.length > 1 ? 's' : ''} affichée${rows.length > 1 ? 's' : ''}.`}
      </p>

      {loading ? (
        <BrandLoader />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Mail}
          title="Aucune livraison"
          description={
            hasActiveDeliveryFilters(filters)
              ? 'Aucune livraison ne correspond à ces filtres.'
              : "Les livraisons apparaîtront ici dès qu'un e-mail sera envoyé par le site."
          }
        />
      ) : (
        <Card>
          <CardContent className="py-0">
            {rows.map((d) => (
              <DeliveryRow key={d.deliveryId} delivery={d} onOpen={() => setSelected(d.deliveryId)} />
            ))}
          </CardContent>
        </Card>
      )}

      {data?.nextCursor && (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Seules les {PAGE_SIZE} livraisons les plus récentes sont affichées. Affinez les filtres pour voir au-delà.
        </p>
      )}

      {selected && <DeliveryDetailModal deliveryId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function DeliveryRow({ delivery, onOpen }: { delivery: EmailDeliveryView; onOpen: () => void }) {
  const meta = deliveryStatusMeta(delivery.status);
  const eng = engagementSummary(delivery.engagement);
  return (
    <button
      onClick={onOpen}
      // La ligne ouvre une modale, pas une page : l'annoncer évite au lecteur
      // d'écran de promettre une navigation qui n'aura pas lieu.
      aria-haspopup="dialog"
      className="flex w-full flex-wrap items-center justify-between gap-2 border-b border-border py-3 text-left last:border-0 hover:bg-muted/40"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {delivery.templateId} <span className="text-xs font-normal text-muted-foreground">v{delivery.templateVersion}</span>
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {formatDateTime(delivery.createdAt)} · {delivery.recipientEmailMasked || '—'} · {modeLabel(delivery.providerMode)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {eng.hasAny && (
          <span className="text-xs text-muted-foreground">
            {[eng.opens, eng.clicks].filter(Boolean).join(' · ')}
          </span>
        )}
        <Badge className={meta.cls}>{meta.label}</Badge>
      </div>
    </button>
  );
}

function DeliveryDetailModal({ deliveryId, onClose }: { deliveryId: string; onClose: () => void }) {
  const { data, loading } = useResource<EmailDeliveryDetail>(() => api.getEmailDelivery(deliveryId), [deliveryId]);
  const d = data;

  return (
    <Modal open onClose={onClose} title="Détail de la livraison" className="max-w-3xl">
      {loading || !d ? (
        <div className="py-8"><BrandLoader /></div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium">{d.templateId} <span className="text-xs text-muted-foreground">v{d.templateVersion}</span></p>
              <p className="font-mono text-xs text-muted-foreground">{shortMessageId(d.providerMessageId)}</p>
            </div>
            <Badge className={deliveryStatusMeta(d.status).cls}>{deliveryStatusMeta(d.status).label}</Badge>
          </div>

          <div className="grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
            <Row label="Mode" value={modeLabel(d.providerMode)} />
            <Row label="Créée le" value={formatDateTime(d.createdAt)} />
            <Row label="Expéditeur" value={d.sender.emailMasked || d.sender.name || '—'} />
            <Row label="Destinataire" value={d.recipientEmailMasked || '—'} />
            <Row label="Envoi accepté le" value={d.sentAt ? formatDateTime(d.sentAt) : '—'} />
            <Row label="Livré le" value={d.deliveredAt ? formatDateTime(d.deliveredAt) : '—'} />
            {d.eventId && <Row label="Événement" value={d.eventId} />}
            {d.actionExecutionId && <Row label="Exécution" value={d.actionExecutionId} />}
          </div>

          {/* Engagement — avec l'avertissement de fiabilité, jamais « a lu ». */}
          {(() => {
            const eng = engagementSummary(d.engagement);
            if (!eng.hasAny) return null;
            return (
              <div className="rounded-md bg-muted/40 p-2 text-xs">
                <p className="font-medium">{[eng.opens, eng.clicks].filter(Boolean).join(' · ')}</p>
                <p className="mt-1 flex items-start gap-1 text-muted-foreground">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" /> {ENGAGEMENT_DISCLAIMER}
                </p>
              </div>
            );
          })()}

          <div>
            <p className="mb-1 text-xs font-medium">Historique</p>
            {d.timeline.length === 0 ? (
              <p className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
                Aucune étape n'a encore été rapportée pour cet envoi. Un envoi accepté ne prouve pas qu'il a été reçu.
              </p>
            ) : (
              <ol className="space-y-1.5">
                {orderTimeline(d.timeline).map((e) => (
                  <li key={e.webhookEventId} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 p-2 text-xs">
                    <span className="font-medium">{eventTypeLabel(e.type)}</span>
                    <span className="text-muted-foreground">{formatDateTime(e.occurredAt || e.receivedAt || d.createdAt)}</span>
                    {/* Le MESSAGE seul : le code qui l'accompagne est du
                        vocabulaire interne, il n'ajoute rien à une phrase déjà
                        rédigée côté serveur. */}
                    {(e.diagnosticSafe.message || e.diagnosticSafe.code) && (
                      <span className="w-full break-words text-muted-foreground">
                        {e.diagnosticSafe.message || UNKNOWN_DIAGNOSTIC_MESSAGE}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* Le titre nomme le PROBLÈME, pas sa référence interne : un code en
              gras rouge se lit comme un message d'erreur système. */}
          {(d.lastErrorSafe.code || d.lastErrorSafe.message) && (
            <div className="rounded-md bg-red-50 p-2 text-xs text-red-800">
              <p className="font-medium">Dernière erreur signalée</p>
              <p className="opacity-90">{d.lastErrorSafe.message || UNKNOWN_DELIVERY_ERROR_MESSAGE}</p>
            </div>
          )}
        </div>
      )}

      <div className="mt-6 flex justify-end">
        <Button variant="outline" onClick={onClose}>Fermer</Button>
      </div>
    </Modal>
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
