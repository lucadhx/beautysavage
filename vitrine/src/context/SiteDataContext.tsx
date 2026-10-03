import * as React from 'react';
import { API_ROOT, api } from '@/lib/api';
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
   * L'EN-TÊTE DE PAGE (titre, description, canonique, partage, JSON-LD) N'EST
   * PLUS ÉCRIT ICI. Il vient du backend, qui le compose à partir des données :
   * servi dans le HTML au premier chargement, puis appliqué à chaque
   * navigation par <SeoHead /> (voir lib/seoHead.ts). Deux auteurs pour les
   * mêmes balises se marchaient dessus : l'Organization posée ici écrasait la
   * fiche d'établissement complète, et la canonique pointait l'accueil sur
   * toutes les pages.
   */
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
}


export function SiteDataProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = React.useState<BootstrapData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(() => api
    .bootstrap()
    .then((d) => {
      setData(d);
      if (d.theme) applyTheme(d.theme);
      applyBranding(d);
      // Mémorise la palette pour que le PROCHAIN démarrage soit peint aux
      // bonnes couleurs dès la première image, loader compris.
      rememberTheme(d.theme);
    }), []);

  React.useEffect(() => {
    load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [load]);

  /*
    EN TEMPS RÉEL — l'institut enregistre « Informations », l'accueil ou le
    thème dans le Manager : le serveur prévient (`/api/public/live`) et la
    vitrine relit son amorçage, sans rechargement. Si le flux est coupé,
    EventSource se reconnecte seul ; au retour sur l'onglet, une relecture
    rattrape ce qui aurait pu être manqué.
  */
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return undefined;
    let timer = 0;
    const refresh = () => { window.clearTimeout(timer); timer = window.setTimeout(() => { load().catch(() => {}); }, 250); };
    const source = new EventSource(`${API_ROOT}/api/public/live`);
    source.addEventListener('change', refresh);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { source.close(); window.clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);

  return (
    <SiteDataContext.Provider value={{ data, loading, error }}>{children}</SiteDataContext.Provider>
  );
}

export function useSiteData() {
  const ctx = React.useContext(SiteDataContext);
  if (!ctx) throw new Error('useSiteData must be used within SiteDataProvider');
  return ctx;
}
