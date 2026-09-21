import * as React from 'react';
import { useLocation } from 'react-router-dom';
import { useSiteData } from '@/context/SiteDataContext';

function upsertMeta(name: string, content: string) {
  let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.name = name;
    document.head.appendChild(el);
  }
  el.content = content;
}

function upsertCanonical(href: string) {
  let el = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.rel = 'canonical';
    document.head.appendChild(el);
  }
  el.href = href;
}

/**
 * Métadonnées SEO par page (SPA) : titre, description, URL canonique propre à
 * la route (et non plus une canonique globale pointant vers l'accueil), et
 * `robots noindex` optionnel (page 404). Le nom d'entreprise et l'URL du site
 * proviennent du bootstrap public.
 */
export function useSeo({
  title,
  description,
  noindex = false,
}: {
  title?: string;
  description?: string;
  noindex?: boolean;
}) {
  const { data } = useSiteData();
  const { pathname } = useLocation();
  const companyName = data?.company?.name;
  const websiteUrl = data?.network?.websiteUrl;

  React.useEffect(() => {
    // Point médian, comme le titre de démarrage (`SiteDataContext`) : les deux
    // écrivent `document.title`, et deux séparateurs différents feraient
    // clignoter l'onglet au premier rendu d'une page.
    const suffix = companyName ? ` · ${companyName}` : '';
    if (title) document.title = `${title}${suffix}`;
    if (description) upsertMeta('description', description);
    upsertMeta('robots', noindex ? 'noindex, follow' : 'index, follow');
    if (websiteUrl) {
      upsertCanonical(`${websiteUrl.replace(/\/$/, '')}${pathname}`);
    }
  }, [title, description, noindex, companyName, websiteUrl, pathname]);
}

export default useSeo;
