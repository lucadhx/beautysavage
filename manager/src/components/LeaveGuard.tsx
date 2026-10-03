import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Loader2, LogOut, Save } from 'lucide-react';
import { Modal } from '@/components/ui/dialog';
import { Button } from '@/components/ui/primitives';

/**
 * « QUITTER SANS ENREGISTRER ? » — pour TOUTE navigation interne.
 *
 * `useFloatingSave` posait déjà le garde-fou du navigateur (fermer l'onglet,
 * recharger). Il ne couvrait pas un clic dans le menu, un bouton « Retour »,
 * ni le bouton précédent du navigateur : l'application n'utilise pas de
 * routeur de données, donc pas de `useBlocker`. Ce module comble ce trou sans
 * refondre la navigation :
 *
 *   - un REGISTRE : chaque écran qui édite déclare « j'ai du travail » (et
 *     comment l'enregistrer) via `useFloatingSave` — aucun écran n'a donc à
 *     s'en souvenir ;
 *   - un composant `<LeaveGuard/>` monté une fois, qui intercepte les liens
 *     internes (phase de capture), le bouton précédent, et les navigations
 *     programmées demandées via `useGuardedNavigate`.
 */

type Entry = { dirty: boolean; save: () => Promise<boolean> };
const entries = new Map<symbol, Entry>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function registerLeaveGuard(id: symbol, entry: Entry | null) {
  if (entry) entries.set(id, entry);
  else entries.delete(id);
  emit();
}

function pending() {
  return [...entries.values()].filter((entry) => entry.dirty);
}

/** Demande de sortie en attente de réponse : où aller, une fois libre. */
let requestLeave: ((go: () => void) => void) | null = null;

/**
 * LE BOUTON PRÉCÉDENT — écouté AVANT le routeur.
 *
 * React Router reçoit `popstate` et re-rend la nouvelle page aussitôt (dans
 * la microtâche qui suit son écouteur) : un écouteur posé après lui arrive
 * quand l'écran d'édition est déjà démonté, brouillon perdu. Cet écouteur est
 * donc posé AU CHARGEMENT DU MODULE, avant que le routeur ne pose le sien, et
 * `stopImmediatePropagation` l'empêche d'entendre un départ non confirmé.
 *
 * Le routeur range un index dans `history.state.idx` : il dit de combien de
 * pas on a bougé (précédent ou suivant), donc comment revenir, puis repartir.
 */
let historyIdx: number | null = null;
let ignorePops = 0;
let popGuard: ((delta: number) => boolean) | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', (event) => {
    if (ignorePops > 0) {
      ignorePops -= 1;
      event.stopImmediatePropagation();
      return;
    }
    const nextIdx = typeof event.state?.idx === 'number' ? event.state.idx : null;
    const delta = historyIdx !== null && nextIdx !== null ? nextIdx - historyIdx : -1;
    if (popGuard && popGuard(delta)) {
      event.stopImmediatePropagation();
      ignorePops += 1;
      window.history.go(-delta);
      return;
    }
    historyIdx = nextIdx;
  });
}

/**
 * `navigate` qui passe par la garde : à utiliser pour les boutons « Retour »,
 * « Annuler »… de tout écran d'édition.
 */
export function useGuardedNavigate() {
  const navigate = useNavigate();
  return React.useCallback((to: string) => {
    const go = () => navigate(to);
    if (pending().length && requestLeave) requestLeave(go);
    else go();
  }, [navigate]);
}

export function LeaveGuard() {
  const navigate = useNavigate();
  const location = useLocation();
  const [action, setAction] = React.useState<null | (() => void)>(null);
  const [saving, setSaving] = React.useState(false);
  const bypass = React.useRef(false);
  const lastPath = React.useRef(location.pathname + location.search);

  React.useEffect(() => {
    requestLeave = (go) => setAction(() => go);
    return () => { requestLeave = null; };
  }, []);

  // Liens internes : interceptés AVANT que le routeur ne les suive.
  React.useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (bypass.current || !pending().length) return;
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const target = url.pathname + url.search + url.hash;
      if (target === window.location.pathname + window.location.search + window.location.hash) return;
      event.preventDefault();
      event.stopPropagation();
      setAction(() => () => navigate(target));
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [navigate]);

  React.useEffect(() => {
    lastPath.current = location.pathname + location.search;
    const idx = window.history.state?.idx;
    historyIdx = typeof idx === 'number' ? idx : historyIdx;
  }, [location]);

  // Précédent / suivant : voir l'écouteur de module ci-dessus.
  React.useEffect(() => {
    popGuard = (delta) => {
      if (bypass.current || !pending().length || delta === 0) return false;
      setAction(() => () => window.history.go(delta));
      return true;
    };
    return () => { popGuard = null; };
  }, []);

  const leave = (go: () => void) => {
    bypass.current = true;
    entries.forEach((entry) => { entry.dirty = false; });
    setAction(null);
    go();
    window.setTimeout(() => { bypass.current = false; }, 600);
  };

  async function saveThenLeave() {
    if (!action) return;
    setSaving(true);
    try {
      for (const entry of pending()) {
        // Échec : l'erreur est déjà affichée par l'écran, on reste sur la page.
        if (!(await entry.save())) return;
        entry.dirty = false;
      }
      leave(action);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={Boolean(action)}
      onClose={() => !saving && setAction(null)}
      title="Quitter sans enregistrer ?"
      description="Vous avez des modifications qui ne sont pas encore enregistrees."
      className="max-w-lg"
      busy={saving}
    >
      <div className="grid gap-4" data-testid="leave-guard">
        <p className="text-sm text-muted-foreground">Si vous quittez maintenant, elles seront perdues.</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => setAction(null)} disabled={saving}>Rester sur la page</Button>
          <Button variant="destructive" onClick={() => action && leave(action)} disabled={saving}><LogOut className="h-4 w-4" /> Quitter sans enregistrer</Button>
          <Button onClick={saveThenLeave} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Enregistrer et quitter</Button>
        </div>
      </div>
    </Modal>
  );
}
