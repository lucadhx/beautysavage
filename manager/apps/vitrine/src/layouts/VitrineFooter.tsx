import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getSocialLinks } from '@bs/api-client';

// RX3 — Pied de page vitrine réel. Colonnes marque / navigation / légal / réseaux (hydratés depuis
// /api/vitrine/social-links, RX3 S4). Aucune adresse/téléphone/newsletter inventés (non exposés backend).

const NAV_LINKS = [
  { to: '/', label: 'Accueil' },
  { to: '/prestations', label: 'Prestations' },
  { to: '/formations', label: 'Formations' },
  { to: '/cartes-cadeaux', label: 'Cartes cadeaux' },
];

const LEGAL_LINKS = [
  { to: '/mentions-legales', label: 'Mentions légales' },
  { to: '/cgv', label: 'CGV' },
  { to: '/confidentialite', label: 'Confidentialité' },
];

const SOCIAL_ICON: Record<string, string> = {
  instagram: 'bi-instagram',
  facebook: 'bi-facebook',
  tiktok: 'bi-tiktok',
  youtube: 'bi-youtube',
  twitter: 'bi-twitter-x',
  linkedin: 'bi-linkedin',
  pinterest: 'bi-pinterest',
};

export function VitrineFooter() {
  const year = new Date().getFullYear();
  const social = useQuery({ queryKey: ['footer', 'social'], queryFn: ({ signal }) => getSocialLinks(signal), staleTime: 300_000 });
  const socialLinks = social.data ?? [];

  return (
    <div className="vf">
      <div className="vf__brand">
        <strong className="vf__name">Beauty Savage</strong>
        <p className="vf__tagline">Prestations, formations & cartes cadeaux.</p>
      </div>
      <nav className="vf__col" aria-label="Navigation pied de page">
        <span className="vf__col-title">Explorer</span>
        {NAV_LINKS.map((l) => (
          <Link key={l.to} to={l.to} className="vf__link">
            {l.label}
          </Link>
        ))}
      </nav>
      <nav className="vf__col" aria-label="Informations légales">
        <span className="vf__col-title">Légal</span>
        {LEGAL_LINKS.map((l) => (
          <Link key={l.to} to={l.to} className="vf__link">
            {l.label}
          </Link>
        ))}
      </nav>
      {socialLinks.length ? (
        <div className="vf__col vf__social" aria-label="Réseaux sociaux">
          <span className="vf__col-title">Nous suivre</span>
          <div className="vf__social-icons">
            {socialLinks.map((s) => (
              <a
                key={s.id}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="vf__social-link"
                aria-label={s.type || 'Réseau social'}
              >
                <i className={`bi ${SOCIAL_ICON[s.type.toLowerCase()] ?? 'bi-link-45deg'}`} aria-hidden="true" />
              </a>
            ))}
          </div>
        </div>
      ) : null}
      <p className="vf__copy">© {year} Beauty Savage. Tous droits réservés.</p>
    </div>
  );
}
