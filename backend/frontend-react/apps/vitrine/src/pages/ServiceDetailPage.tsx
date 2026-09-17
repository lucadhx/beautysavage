import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Gallery, Badge, StickyBar, Button, LoadingState, ErrorState } from '@bs/ui';
import { resolveMediaUrl, formatPrice, formatDuration, type SelectedServiceOption } from '@bs/api-client';
import { usePublicService } from '../features/catalog/hooks/usePublicServices';
import { ServiceOptions } from '../features/serviceDetail/ServiceOptions';
import { ServiceProcess } from '../features/serviceDetail/ServiceProcess';
import { ServiceFaq } from '../features/serviceDetail/ServiceFaq';
import { ServiceReviews } from '../features/serviceDetail/ServiceReviews';
import { SimilarServices } from '../features/serviceDetail/SimilarServices';
import { ServicePurchaseCard } from '../features/serviceDetail/ServicePurchaseCard';
import { ServiceBookingDrawer } from '../features/serviceDetail/ServiceBookingDrawer';
import '../features/serviceDetail/serviceDetail.css';

export function ServiceDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data, isPending, isError } = usePublicService(slug);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bookingOpen, setBookingOpen] = useState(false);

  const options = useMemo(() => data?.options ?? [], [data]);
  const selectedOptions = useMemo<SelectedServiceOption[]>(
    () =>
      options
        .filter((o) => selectedIds.has(o.id))
        .map((o) => ({ optionId: o.id, name: o.name, price: o.price })),
    [options, selectedIds],
  );
  const optionsTotal = selectedOptions.reduce((sum, o) => sum + (o.price ?? 0), 0);
  const base = data ? data.effectivePrice ?? data.price : 0;
  const total = base + optionsTotal;

  if (isPending) return <LoadingState label="Chargement de la prestation…" />;
  if (isError || !data) return <ErrorState title="Prestation introuvable." />;

  const bookable = data.isBookable !== false;
  const galleryImages = (data.photos ?? [])
    .map((p) => resolveMediaUrl(p))
    .filter((src): src is string => Boolean(src))
    .map((src) => ({ src, alt: data.name }));

  const toggleOption = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <article className="sd">
      <p className="sd-breadcrumb">
        <Link to="/prestations" className="bs-backlink">
          <i className="bi bi-arrow-left" aria-hidden="true" /> Retour aux prestations
        </Link>
      </p>

      <header className="sd-head">
        <h1 className="sd-head__title">{data.name}</h1>
        <div className="sd-head__meta">
          {data.duration ? <Badge tone="neutral">{formatDuration(data.duration)}</Badge> : null}
          {data.paymentType === 'deposit' ? <Badge tone="info">Acompte</Badge> : null}
          {data.paymentType === 'free' ? <Badge tone="success">Gratuit</Badge> : null}
        </div>
      </header>

      <div className="sd-layout">
        <div className="sd-main">
          <Gallery images={galleryImages} ratio="16 / 9" fallbackAlt={data.name} />

          {data.shortDescription || data.description ? (
            <section className="sd-section" aria-label="À propos">
              <h2 className="sd-section__title">À propos</h2>
              {data.shortDescription ? <p className="sd-lead">{data.shortDescription}</p> : null}
              {data.description ? <p className="sd-desc">{data.description}</p> : null}
            </section>
          ) : null}

          <ServiceOptions options={options} selectedIds={selectedIds} onToggle={toggleOption} />
          <ServiceProcess duration={data.duration} />
          <ServiceFaq service={data} />
        </div>

        <aside className="sd-aside">
          <ServicePurchaseCard
            service={data}
            total={total}
            optionsTotal={optionsTotal}
            onReserve={() => setBookingOpen(true)}
          />
        </aside>
      </div>

      <SimilarServices currentId={data.id} />
      <ServiceReviews serviceId={data.id} />

      {/* CTA sticky mobile (dupliqué du panneau desktop) */}
      <StickyBar className="sd-stickybar" desktopInline={false}>
        <span className="sd-stickybar__price">{formatPrice(total)}</span>
        <Button type="button" onClick={() => setBookingOpen(true)} disabled={!bookable} className="sd-stickybar__cta">
          {bookable ? 'Réserver' : 'Indisponible'}
        </Button>
      </StickyBar>

      <ServiceBookingDrawer
        service={data}
        open={bookingOpen}
        onClose={() => setBookingOpen(false)}
        selectedOptions={selectedOptions}
        indicativePrice={total}
      />
    </article>
  );
}
