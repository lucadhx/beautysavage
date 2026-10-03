import * as React from 'react';
import { useLocation } from 'react-router-dom';
import { API_ROOT } from '@/lib/api';

/**
 * L'EN-TÊTE DE PAGE, À CHAQUE NAVIGATION.
 *
 * Au premier chargement, le backend a déjà servi le HTML avec le bon titre, la
 * bonne description, la canonique, les balises de partage et les données
 * structurées de l'adresse demandée (`<head data-seo-path="…">`). Ensuite,
 * l'application navigue sans recharger : chaque changement d'adresse demande
 * au backend la MÊME résolution (`/api/public/seo`) et l'applique.
 *
 * Une seule source, donc : ce que voit un robot sans JavaScript et ce que voit
 * Google après exécution sont identiques, et suivent les données du Manager.
 */

interface SeoPayload {
  pathname: string;
  title: string;
  description: string;
  canonical: string;
  robots: string;
  ogType: string;
  image: string;
  imageAlt: string;
  siteName: string;
  jsonLd: unknown[];
}

const PUBLIC = API_ROOT ? `${API_ROOT}/api/public` : '/api/public';

function meta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!content) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = content;
}

function canonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!href) { el?.remove(); return; }
  if (!el) {
    el = document.createElement('link');
    el.rel = 'canonical';
    document.head.appendChild(el);
  }
  el.href = href;
}

export function applySeo(seo: SeoPayload) {
  document.title = seo.title;
  meta('name', 'description', seo.description);
  meta('name', 'robots', seo.robots);
  canonical(seo.canonical);
  meta('property', 'og:site_name', seo.siteName);
  meta('property', 'og:type', seo.ogType);
  meta('property', 'og:title', seo.title);
  meta('property', 'og:description', seo.description);
  meta('property', 'og:url', seo.canonical);
  meta('property', 'og:image', seo.image);
  meta('property', 'og:image:alt', seo.image ? seo.imageAlt : '');
  meta('name', 'twitter:card', seo.image ? 'summary_large_image' : 'summary');
  meta('name', 'twitter:title', seo.title);
  meta('name', 'twitter:description', seo.description);
  meta('name', 'twitter:image', seo.image);
  document.head.querySelectorAll('script[data-seo]').forEach((el) => el.remove());
  for (const json of seo.jsonLd || []) {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.dataset.seo = '1';
    script.textContent = JSON.stringify(json);
    document.head.appendChild(script);
  }
  document.head.dataset.seoPath = seo.pathname;
}

export function SeoHead() {
  const { pathname } = useLocation();
  React.useEffect(() => {
    // Déjà juste : c'est l'adresse que le serveur vient de rendre (ou d'appliquer).
    if (document.head.dataset.seoPath === pathname) return;
    const controller = new AbortController();
    fetch(`${PUBLIC}/seo?path=${encodeURIComponent(pathname)}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => { if (body?.data) applySeo(body.data as SeoPayload); })
      .catch(() => { /* navigation interrompue ou API absente : l'en-tête précédent reste */ });
    return () => controller.abort();
  }, [pathname]);
  return null;
}
