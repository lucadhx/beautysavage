import { Link } from 'react-router-dom';
import { useAuth } from '@bs/auth';

const SECTIONS: { to: string; icon: string; label: string; desc: string; dev?: boolean }[] = [
  { to: '/planning', icon: 'bi-calendar3', label: 'Planning', desc: "Agenda global de l'institut." },
  { to: '/clients', icon: 'bi-people', label: 'Clients', desc: 'Recherche et fiches Customer 360.' },
  { to: '/catalogue', icon: 'bi-collection', label: 'Catalogue', desc: 'Prestations, formations, cartes cadeaux.' },
  { to: '/finance', icon: 'bi-graph-up', label: 'Finance', desc: 'Tableau de bord, timeline, commissions.' },
  { to: '/avis', icon: 'bi-chat-quote', label: 'Avis', desc: 'Modération des avis clients.' },
  { to: '/communication', icon: 'bi-envelope', label: 'Communication', desc: 'Identités et e-mails.' },
  { to: '/dev', icon: 'bi-code-slash', label: 'Développeur', desc: 'Studios, système, journaux.', dev: true },
];

export function ManagerHome() {
  const { user } = useAuth();
  const isDev = user?.role === 'dev';
  const sections = SECTIONS.filter((section) => !section.dev || isDev);

  return (
    <section>
      <h1>Tableau de bord</h1>
      <p style={{ color: 'var(--bs-color-muted)' }}>Bienvenue dans l’espace de gestion Beauty Savage.</p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 'var(--bs-space-2)',
          marginTop: 'var(--bs-space-3)',
        }}
      >
        {sections.map((section) => (
          <Link
            key={section.to}
            to={section.to}
            className="bs-card"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              textDecoration: 'none',
              color: 'inherit',
              minHeight: 96,
            }}
          >
            <i className={`bi ${section.icon}`} aria-hidden="true" style={{ fontSize: '1.5rem', color: 'var(--bs-color-primary)' }} />
            <strong>{section.label}</strong>
            <span style={{ fontSize: '0.84rem', color: 'var(--bs-color-muted)' }}>{section.desc}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
