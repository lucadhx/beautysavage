import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getSiteIdentity, getHomeSettings, resolveMediaUrl } from '@bs/api-client';

// RX3 S4 — Hero d'accueil premium, piloté par le CMS (site-identity + home-settings). Pas de carrousel
// automatique : 1 visuel + 3 CTA clairs (réserver / formations / carte cadeau). Dégrade proprement.

export function HomeHero() {
  const identity = useQuery({ queryKey: ['home', 'identity'], queryFn: ({ signal }) => getSiteIdentity(signal), staleTime: 300_000 });
  const settings = useQuery({ queryKey: ['home', 'settings'], queryFn: ({ signal }) => getHomeSettings(signal), staleTime: 300_000 });

  const siteName = identity.data?.siteName || 'Beauty Savage';
  const slogan = settings.data?.slogan || 'Prestations, formations & cartes cadeaux — la beauté, sans compromis.';
  const banner = resolveMediaUrl(settings.data?.bannerUrl);

  return (
    <section className={`home-hero${banner ? ' home-hero--image' : ''}`} style={banner ? { backgroundImage: `url(${banner})` } : undefined}>
      <div className="home-hero__inner">
        <h1 className="home-hero__title">{siteName}</h1>
        <p className="home-hero__slogan">{slogan}</p>
        <div className="home-hero__cta">
          <Link className="bs-btn" to="/prestations">Réserver une prestation</Link>
          <Link className="bs-btn bs-btn--secondary" to="/formations">Découvrir les formations</Link>
          <Link className="bs-btn bs-btn--secondary" to="/cartes-cadeaux">Offrir une carte cadeau</Link>
        </div>
      </div>
    </section>
  );
}
