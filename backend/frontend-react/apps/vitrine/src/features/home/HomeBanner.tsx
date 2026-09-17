import { useQuery } from '@tanstack/react-query';
import { getHomeSettings, resolveMediaUrl } from '@bs/api-client';

// Bannière d'accueil pilotée par le CMS (home-settings). Simple visuel large en tête de page ;
// ne rend rien si aucune bannière n'est configurée. Le slogan reste géré ailleurs (pas de hero).
export function HomeBanner() {
  const settings = useQuery({ queryKey: ['home', 'settings'], queryFn: ({ signal }) => getHomeSettings(signal), staleTime: 300_000 });
  const banner = resolveMediaUrl(settings.data?.bannerUrl);

  if (!banner) return null;

  return (
    <section className="home-banner" aria-label="Bannière">
      <img className="home-banner__img" src={banner} alt="" />
    </section>
  );
}
