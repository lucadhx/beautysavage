import * as React from 'react';
import { api } from '@/lib/api';
import { resolvePreviewMediaUrl } from '@/lib/media';
import { applyTheme, rememberTheme } from '@/lib/theme';
import type { BootstrapData } from '@/types';

interface Ctx {
  data: BootstrapData | null;
  loading: boolean;
  error: string | null;
}

const SiteDataContext = React.createContext<Ctx | null>(null);

function applyBranding(data: BootstrapData) {
  /**
   * LE TITRE D'ONGLET DIT CE QUE FAIT L'ENTREPRISE — et elle seule le sait.
   *
   * Il valait `« <nom> — Detailing automobile »`, un métier écrit en dur,
   * hérité du projet dont ce moteur est issu. Un circuit de karting annonçait
   * donc du lavage de voitures dans l'onglet, et dans les résultats de
   * recherche. Le slogan est saisi depuis le Manager : c'est lui qui suit
   * l'entreprise. Sans slogan, le nom seul — jamais un métier inventé.
   *
   * `useSeo` reprend la main dès qu'une page est montée ; ce titre-ci est
   * celui du tout premier instant, avant même que la route ne soit rendue.
   */
  const nom = data.company?.name?.trim();
  const slogan = data.company?.tagline?.trim();
  // Le séparateur est un point médian, plus un tiret cadratin : ce titre part
  // dans l'onglet ET dans les résultats de recherche, et le site n'utilise
  // plus le tiret nulle part.
  if (nom) document.title = slogan ? `${nom} · ${slogan}` : nom;

  /**
   * LE FAVICON SE RÉSOUT COMME TOUT AUTRE MÉDIA DE LA PAGE.
   *
   * ══ LE DÉFAUT CORRIGÉ ═════════════════════════════════════════════════════
   *
   * Il était le SEUL média résolu contre `network.backendUrl` — l'adresse
   * PUBLIQUE CANONIQUE que le projet déclare, et non celle du backend auquel
   * la page parle réellement. Les deux coïncident sur le site en ligne ; nulle
   * part ailleurs.
   *
   * Conséquence : en développement, et sur tout projet pas encore déployé, le
   * favicon partait chercher `https://api.<domaine>/uploads/…` — un hôte qui
   * n'existe pas encore. Le logo, la bannière et les photos, eux, s'affichaient
   * parfaitement : ils passent par le même résolveur SANS cette base, donc en
   * relatif, donc par le proxy de même origine. Seul l'onglet restait vide, ce
   * qui se voit peu et s'explique mal.
   *
   * On retire donc la base : `resolvePreviewMediaUrl` retombe sur l'origine de
   * la page, exactement comme pour les autres images.
   *
   * Le `<link>` est déjà dans `index.html`, en icône vide : sans lui, le
   * navigateur réclame `/favicon.ico` avant que React ne démarre, mémorise ce
   * qu'il reçoit, et n'écoute plus toujours l'ajout d'un lien tardif.
   */
  const favicon = resolvePreviewMediaUrl(data.company?.logos?.favicon);
  if (favicon) {
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = favicon;
  }
  // URL canonique (SEO) depuis la configuration réseau.
  const canonicalUrl = data.network?.websiteUrl;
  if (canonicalUrl) {
    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = canonicalUrl;
  }

  /**
   * L'IMAGE DE PARTAGE — le logo, en adresse ABSOLUE.
   *
   * ══ POURQUOI ELLE N'EST PAS DANS `index.html` ═══════════════════════════
   *
   * Parce qu'elle n'y serait pas connue. Le logo est un MÉDIA du projet : son
   * adresse est dérivée à la lecture d'un descripteur, contre la destination
   * active. L'écrire en dur dans le HTML la figerait — et la rendrait fausse
   * au premier changement de logo comme au premier changement de domaine.
   *
   * ══ POURQUOI ABSOLUE, ET POURQUOI DEPUIS `network.websiteUrl` ═══════════
   *
   * Un `og:image` relatif n'est suivi par aucun réseau social : ils ne
   * consultent pas la page, ils lisent la balise. L'hôte vient donc de la
   * configuration réseau du projet — la même source que l'URL canonique — et
   * jamais de `window.location`, qui vaudrait `localhost` en développement et
   * publierait une aperçu introuvable si quelqu'un partageait ce lien.
   */
  const site = String(data.network?.websiteUrl ?? '').replace(/\/+$/, '');
  const logo = data.company?.logos?.header;
  if (site && logo) {
    const absolue = /^https?:\/\//i.test(logo) ? logo : `${site}${logo.startsWith('/') ? '' : '/'}${logo}`;
    upsertMetaProperty('og:image', absolue);
    upsertMetaName('twitter:image', absolue);
  }
  if (site) upsertMetaProperty('og:url', `${site}${window.location.pathname}`);

  /**
   * LA FICHE ORGANISATION (JSON-LD) — ce que le site DIT DE LUI, pour un robot.
   *
   * Trois faits seulement, et tous vérifiables sur la page : le nom, l'adresse
   * du site, le logo. On n'y met ni téléphone inventé, ni adresse postale, ni
   * horaires — un balisage structuré qui affirme plus que la page n'affiche est
   * exactement ce que les moteurs sanctionnent.
   *
   * Le bloc est REMPLACÉ à chaque application, jamais ajouté : deux fiches
   * Organisation dans une même page se contredisent par construction.
   */
  if (site && data.company?.name) {
    const fiche: Record<string, unknown> = {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: data.company.name,
      url: site,
    };
    if (data.company.tagline) fiche.description = data.company.tagline;
    if (logo) fiche.logo = /^https?:\/\//i.test(logo) ? logo : `${site}${logo}`;
    const courriel = (data.company.media ?? []).find((m) => m.key === 'email' && m.enabled && m.value);
    if (courriel) fiche.email = courriel.value;

    let script = document.querySelector<HTMLScriptElement>('script[data-ly="organisation"]');
    if (!script) {
      script = document.createElement('script');
      script.type = 'application/ld+json';
      script.dataset.ly = 'organisation';
      document.head.appendChild(script);
    }
    script.textContent = JSON.stringify(fiche);
  }
}

/** `<meta property="…">` — la forme OpenGraph. Créée si absente, sinon mise à jour. */
function upsertMetaProperty(property: string, content: string) {
  let el = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('property', property);
    document.head.appendChild(el);
  }
  el.content = content;
}

/** `<meta name="…">` — la forme Twitter. Même règle. */
function upsertMetaName(name: string, content: string) {
  let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.name = name;
    document.head.appendChild(el);
  }
  el.content = content;
}

export function SiteDataProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = React.useState<BootstrapData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    api
      .bootstrap()
      .then((d) => {
        setData(d);
        if (d.theme) applyTheme(d.theme);
        applyBranding(d);
        // Mémorise la palette pour que le PROCHAIN démarrage soit peint aux
        // bonnes couleurs dès la première image, loader compris.
        rememberTheme(d.theme);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <SiteDataContext.Provider value={{ data, loading, error }}>{children}</SiteDataContext.Provider>
  );
}

export function useSiteData() {
  const ctx = React.useContext(SiteDataContext);
  if (!ctx) throw new Error('useSiteData must be used within SiteDataProvider');
  return ctx;
}
