// C1 — Catalogue Studio : layout + dashboard + listes + pages éditeurs. Mobile-first, cards
// (zéro table), états vides/squelettes, actions dupliquer/archiver.
import { Link, Outlet, useParams } from 'react-router-dom';
import { Badge, ErrorState } from '@bs/ui';
import type { CatalogueService, CatalogueTraining } from '@bs/api-client';
import { useServicesList, useServiceMutations, useTrainingsList, useTrainingMutations } from './useCatalogue';
import { validateService, validateTraining } from './validation';
import { CatalogueEmptyState, CatalogueSkeleton } from './components';
import { ServiceEditor } from './ServiceEditor';
import { TrainingEditor } from './TrainingEditor';
import { GiftCardCatalogueEditor } from './GiftCardCatalogueEditor';
import './catalogue.css';

const fmtEur = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(n) || 0);

// ── Layout ──────────────────────────────────────────────────────────────────
export function CatalogueLayout() {
  return (
    <section className="cat-page">
      <Outlet />
    </section>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────────────────
export function CatalogueDashboard() {
  const services = useServicesList();
  const trainings = useTrainingsList();

  const cards = [
    { to: '/catalogue/prestations', icon: 'bi-scissors', label: 'Prestations', count: services.data?.length ?? 0, desc: 'Soins réservables en institut.' },
    { to: '/catalogue/formations', icon: 'bi-mortarboard', label: 'Formations', count: trainings.data?.length ?? 0, desc: 'Présentielles & distancielles.' },
    { to: '/catalogue/cartes-cadeaux', icon: 'bi-gift', label: 'Cartes cadeaux', count: null, desc: 'Montants, template & vitrine.' },
    { to: '/catalogue/produits', icon: 'bi-box-seam', label: 'Produits', count: null, desc: 'Indisponible pour le moment.', disabled: true },
  ];

  return (
    <div className="cat-page">
      <div className="cat-head">
        <h1 className="cat-head__title">Catalogue Studio</h1>
        <p className="cat-head__subtitle">Gérez prestations, formations et cartes cadeaux.</p>
      </div>
      <div className="cat-dash">
        {cards.map((c) =>
          c.disabled ? (
            <div key={c.to} className="cat-dashcard cat-dashcard--disabled" aria-disabled="true">
              <i className={`bi ${c.icon} cat-dashcard__icon`} aria-hidden="true" />
              <span className="cat-dashcard__label">{c.label}</span>
              <span className="cat-dashcard__desc">{c.desc}</span>
              <Badge tone="muted">Bientôt</Badge>
            </div>
          ) : (
            <Link key={c.to} to={c.to} className="cat-dashcard">
              <i className={`bi ${c.icon} cat-dashcard__icon`} aria-hidden="true" />
              <span className="cat-dashcard__label">{c.label}</span>
              <span className="cat-dashcard__desc">{c.desc}</span>
              {c.count !== null ? <span className="cat-dashcard__count">{c.count}</span> : null}
            </Link>
          ),
        )}
      </div>
    </div>
  );
}

// ── Cartes de liste ───────────────────────────────────────────────────────────
function StatusChip({ publishable, active }: { publishable: boolean; active: boolean }) {
  if (active && publishable) return <Badge tone="success">Publié</Badge>;
  if (active && !publishable) return <Badge tone="danger">À corriger</Badge>;
  if (!publishable) return <Badge tone="warning">À compléter</Badge>;
  return <Badge tone="muted">Brouillon</Badge>;
}

function ServiceRow({ service }: { service: CatalogueService }) {
  const { duplicate, archive } = useServiceMutations();
  const v = validateService(service);
  return (
    <article className="cat-row" data-testid="cat-service-row">
      <Link to={`/catalogue/prestations/${service.id}`} className="cat-row__main">
        <span className="cat-row__title">{service.name}</span>
        <span className="cat-row__meta">{service.duration} min · {fmtEur(service.price)}</span>
      </Link>
      <div className="cat-row__side">
        <StatusChip publishable={v.publishable} active={service.isActive} />
        <button type="button" className="cat-iconbtn" aria-label="Dupliquer" onClick={() => duplicate.mutate(service.id)}>
          <i className="bi bi-files" aria-hidden="true" />
        </button>
        <button type="button" className="cat-iconbtn" aria-label="Archiver" onClick={() => archive.mutate(service.id)} disabled={!service.isActive}>
          <i className="bi bi-archive" aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}

function TrainingRow({ training }: { training: CatalogueTraining }) {
  const { duplicate } = useTrainingMutations();
  const v = validateTraining(training);
  return (
    <article className="cat-row" data-testid="cat-training-row">
      <Link to={`/catalogue/formations/${training.id}`} className="cat-row__main">
        <span className="cat-row__title">{training.name}</span>
        <span className="cat-row__meta">
          {training.type === 'presentiel' ? 'Présentiel' : 'Distanciel'} · {fmtEur(training.price)}
        </span>
      </Link>
      <div className="cat-row__side">
        <StatusChip publishable={v.publishable} active={training.status === 'published'} />
        <button type="button" className="cat-iconbtn" aria-label="Dupliquer" onClick={() => duplicate.mutate(training.id)}>
          <i className="bi bi-files" aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}

// ── Listes ──────────────────────────────────────────────────────────────────────
export function ServicesListPage() {
  const services = useServicesList();
  return (
    <div className="cat-page">
      <div className="cat-head cat-head--list">
        <div>
          <Link to="/catalogue" className="cat-back">← Catalogue</Link>
          <h1 className="cat-head__title">Prestations</h1>
        </div>
        <Link to="/catalogue/prestations/new" className="cat-btn cat-btn--primary"><i className="bi bi-plus-lg" aria-hidden="true" /> Nouvelle</Link>
      </div>
      {services.status === 'pending' ? (
        <CatalogueSkeleton rows={4} />
      ) : services.status === 'error' ? (
        <ErrorState title="Impossible de charger les prestations." detail="Réessayez plus tard." />
      ) : services.data && services.data.length > 0 ? (
        <div className="cat-list">{services.data.map((s) => <ServiceRow key={s.id} service={s} />)}</div>
      ) : (
        <CatalogueEmptyState icon="bi-scissors" title="Aucune prestation" description="Créez votre première prestation." action={<Link to="/catalogue/prestations/new" className="cat-btn cat-btn--primary">Nouvelle prestation</Link>} />
      )}
    </div>
  );
}

export function TrainingsListPage() {
  const trainings = useTrainingsList();
  return (
    <div className="cat-page">
      <div className="cat-head cat-head--list">
        <div>
          <Link to="/catalogue" className="cat-back">← Catalogue</Link>
          <h1 className="cat-head__title">Formations</h1>
        </div>
        <Link to="/catalogue/formations/new" className="cat-btn cat-btn--primary"><i className="bi bi-plus-lg" aria-hidden="true" /> Nouvelle</Link>
      </div>
      {trainings.status === 'pending' ? (
        <CatalogueSkeleton rows={4} />
      ) : trainings.status === 'error' ? (
        <ErrorState title="Impossible de charger les formations." detail="Réessayez plus tard." />
      ) : trainings.data && trainings.data.length > 0 ? (
        <div className="cat-list">{trainings.data.map((t) => <TrainingRow key={t.id} training={t} />)}</div>
      ) : (
        <CatalogueEmptyState icon="bi-mortarboard" title="Aucune formation" description="Créez votre première formation." action={<Link to="/catalogue/formations/new" className="cat-btn cat-btn--primary">Nouvelle formation</Link>} />
      )}
    </div>
  );
}

// ── Pages éditeurs ────────────────────────────────────────────────────────────────
export function ServiceEditorPage() {
  const { id } = useParams();
  return (
    <div className="cat-page">
      <Link to="/catalogue/prestations" className="cat-back">← Prestations</Link>
      <ServiceEditor id={id} />
    </div>
  );
}

export function TrainingEditorPage() {
  const { id } = useParams();
  return (
    <div className="cat-page">
      <Link to="/catalogue/formations" className="cat-back">← Formations</Link>
      <TrainingEditor id={id} />
    </div>
  );
}

export function GiftCardCataloguePage() {
  return (
    <div className="cat-page">
      <Link to="/catalogue" className="cat-back">← Catalogue</Link>
      <GiftCardCatalogueEditor />
    </div>
  );
}

export function ProductsUnavailablePage() {
  return (
    <div className="cat-page">
      <Link to="/catalogue" className="cat-back">← Catalogue</Link>
      <CatalogueEmptyState
        icon="bi-box-seam"
        title="Produits — indisponible"
        description="La gestion des produits n'est pas développée dans cette version du catalogue."
      />
    </div>
  );
}
