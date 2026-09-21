import * as React from 'react';
import { api, hasSession } from '@/lib/api';
import { resolvePreviewMediaUrl } from '@/lib/media';
import { cleProjet } from '@/lib/projectIdentity';
import type { Company } from '@/types';

/**
 * Applique le favicon (et le titre) de l'entreprise au manager — le même que la
 * vitrine, pour que les deux onglets se reconnaissent d'un coup d'œil.
 * Le favicon vit sur le backend : l'URL doit être résolue comme les autres médias.
 */
function applyBranding(company: Company | null) {
  if (!company) return;
  if (company.name) document.title = `${company.name} — Manager`;

  const href = resolvePreviewMediaUrl(company.logos?.favicon);
  if (!href) return;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  if (link.href !== href) link.href = href;
}

interface Ctx {
  company: Company | null;
  set: (c: Company) => void;
  reload: () => Promise<void>;
}

const CompanyContext = React.createContext<Ctx | null>(null);

/**
 * Identité de l'entreprise (nom + logos) pour le chrome de l'application
 * (sidebar, en-tête mobile). Chargée via l'endpoint authentifié ; `reload()`
 * est appelé après connexion et après une sauvegarde de la fiche entreprise
 * afin que le logo reste synchronisé sans rechargement de page.
 */
/**
 * DERNIÈRE IDENTITÉ CONNUE — pour que le nom et le logo ne disparaissent pas.
 *
 * L'identité était chargée à chaque démarrage, et uniquement là : si l'appel
 * échouait — backend qui redémarre, passerelle muette — l'état restait `null`,
 * sans nouvelle tentative. L'application s'affichait alors sans nom ni logo,
 * comme si l'entreprise n'existait pas, alors qu'on la connaissait très bien
 * une seconde plus tôt.
 *
 * On garde donc la dernière valeur reçue, et on l'affiche pendant que la
 * suivante se charge. Elle est remplacée dès que le serveur répond ; elle
 * n'est effacée qu'à la déconnexion.
 */
/**
 * ── ET ELLE APPARTIENT À CE PROJET, PAS À L'ORIGINE ───────────────────────
 *
 * Cette clé valait `manager.company.cache` — la même dans les quatre projets du
 * parc, qui partagent l'origine `localhost:6071` en développement. Le manager
 * de FJ Services démarrait donc avec le nom, le logo et le favicon de KleenPro,
 * hydratés SYNCHRONEMENT au premier rendu ; et comme on ne vide jamais le cache
 * sur une panne d'API (voir juste au-dessus — c'est le bon comportement),
 * l'identité empruntée pouvait rester à l'écran indéfiniment.
 *
 * Le préfixe vient de `projectIdentity`, seule autorité, dérivée du build.
 */
const CACHE_KEY = cleProjet('manager.company.cache');

/** Oublie l'identité mémorisée — appelé à la déconnexion, jamais sur une panne. */
export function clearCompanyCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* rien à oublier */ }
}

function lireCache(): Company | null {
  try {
    const brut = localStorage.getItem(CACHE_KEY);
    return brut ? (JSON.parse(brut) as Company) : null;
  } catch {
    return null; // cache illisible : on repart de zéro, sans casser le démarrage
  }
}

function ecrireCache(company: Company | null) {
  try {
    if (company) localStorage.setItem(CACHE_KEY, JSON.stringify(company));
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    /* quota/mode privé : le cache est un confort, jamais une dépendance */
  }
}

export function CompanyProvider({ children }: { children: React.ReactNode }) {
  // Hydratation SYNCHRONE : le premier rendu porte déjà le nom et le logo.
  const [company, setCompany] = React.useState<Company | null>(() => (hasSession() ? lireCache() : null));

  const reload = React.useCallback(async () => {
    // Pas de session -> aucune requête authentifiée (401 garanti sur /login).
    if (!hasSession()) return;
    try {
      const fraiche = await api.getCompany();
      setCompany(fraiche);
      ecrireCache(fraiche);
    } catch {
      // On NE VIDE PAS : la dernière identité connue vaut mieux qu'un écran
      // anonyme. Un vrai changement d'entreprise arrivera au prochain succès.
    }
  }, []);

  React.useEffect(() => {
    reload();
  }, [reload]);

  // Le favicon suit l'entreprise, y compris après une modification du logo.
  React.useEffect(() => {
    applyBranding(company);
  }, [company]);

  const enregistrer = React.useCallback((c: Company) => {
    setCompany(c);
    ecrireCache(c);
  }, []);

  const value = React.useMemo(() => ({ company, set: enregistrer, reload }), [company, enregistrer, reload]);

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompany() {
  const ctx = React.useContext(CompanyContext);
  if (!ctx) throw new Error('useCompany must be used within CompanyProvider');
  return ctx;
}
