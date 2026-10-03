import * as React from 'react';
import {
  defaultEquals,
  deriveSaveState,
  isDirty,
  SAVED_DECAY_MS,
  snapshot,
  type SavePhase,
  type SaveState,
} from '@/lib/saveState';
import { registerLeaveGuard } from '@/components/LeaveGuard';

export type { SaveState };

/**
 * Suit l'état d'édition d'une ressource et pilote un `FloatingSaveWidget`.
 *
 * Les pages du manager n'utilisent pas react-hook-form : la ressource chargée
 * par `useResource` EST le brouillon (`data` / `setData`). Il n'existe donc
 * aucune copie de référence — c'est précisément pour ça qu'aucune page ne
 * savait dire si elle était modifiée. Ce hook tient cette référence.
 *
 * La logique d'états vit dans `@/lib/saveState` (module pur, testé sous Node) :
 * ici on ne gère que le branchement React.
 *
 * @param value  Le brouillon courant (typiquement `data` de `useResource`).
 * @param onSave Effectue l'enregistrement. Renvoie la valeur à prendre comme
 *               nouvelle référence — c'est-à-dire celle qu'AFFICHE l'écran
 *               après coup — ou rien pour retenir `value`. DOIT propager ses
 *               erreurs : `useAction` affiche déjà le toast, on ne le double pas.
 * @param equals Comparateur facultatif, quand l'égalité structurelle par
 *               sérialisation ne convient pas (ex. `zonesEqual`).
 */
export function useFloatingSave<T>(
  value: T | null,
  onSave: () => Promise<T | void>,
  equals: (a: T, b: T) => boolean = defaultEquals
) {
  const [baseline, setBaseline] = React.useState<T | null>(value);
  const [phase, setPhase] = React.useState<SavePhase>('resting');

  // La première valeur non nulle (fin du chargement) devient la référence.
  // On ne resynchronise JAMAIS ensuite : `value` est le brouillon, s'y recaler
  // reviendrait à se comparer à soi-même et « propre » serait toujours vrai.
  // `b` inchangé => React court-circuite, pas de rendu supplémentaire.
  React.useEffect(() => {
    setBaseline((b) => (b == null && value != null ? value : b));
  }, [value]);

  const dirty = isDirty(baseline, value, equals);

  /**
   * ══ FERMER UN ONGLET NE DOIT PAS JETER UN TRAVAIL EN COURS ═════════════════
   *
   * ── LE DÉFAUT ─────────────────────────────────────────────────────────────
   *
   * Un seul écran du Manager posait ce garde-fou : l'éditeur de zones de
   * signature. Les huit autres surfaces d'édition — l'accueil, la fiche
   * entreprise, un chapitre, une page, le thème, les coordonnées… — laissaient
   * partir sans un mot. Recharger par réflexe, fermer l'onglet, revenir en
   * arrière : le brouillon disparaissait, et le widget « Enregistrer » qui
   * pulsait au coin de l'écran était le seul avertissement — c'est-à-dire
   * aucun, une fois la page quittée.
   *
   * ── POURQUOI ICI, ET NON DANS CHAQUE ÉCRAN ────────────────────────────────
   *
   * Parce que c'est ce hook qui SAIT s'il reste du travail. Le poser dans les
   * écrans obligerait à s'en souvenir à chaque nouvel écran d'édition — et
   * l'histoire dit que non : sept écrans sur huit l'avaient oublié. Ici, toute
   * surface qui adopte le widget d'enregistrement hérite du garde-fou sans rien
   * demander.
   *
   * ── CE QUE ÇA NE COUVRE PAS ───────────────────────────────────────────────
   *
   * La navigation INTERNE (un clic dans le menu). `beforeunload` ne se
   * déclenche que sur un vrai départ du document. Bloquer un changement de
   * route demanderait un routeur de données (`useBlocker`), que cette
   * application n'utilise pas ; l'imposer serait une refonte de la navigation
   * pour un gain que le widget d'état couvre déjà en partie — il reste visible,
   * en « Enregistrer », tant que le travail n'est pas parti.
   *
   * Le navigateur choisit lui-même sa phrase : aucun texte personnalisé n'est
   * possible depuis 2016, et prétendre le contraire serait un mensonge de plus.
   */
  React.useEffect(() => {
    if (!dirty) return undefined;
    const avertir = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', avertir);
    return () => window.removeEventListener('beforeunload', avertir);
  }, [dirty]);

  /**
   * NAVIGATION INTERNE : l'écran se déclare au registre de `<LeaveGuard/>`,
   * qui demande « Quitter sans enregistrer ? » avant un clic de menu, un
   * bouton Retour ou le bouton précédent. Voir `components/LeaveGuard.tsx`.
   */
  const guardId = React.useRef(Symbol('floating-save'));
  const saveRef = React.useRef<() => Promise<boolean>>(async () => true);
  React.useEffect(() => {
    registerLeaveGuard(guardId.current, { dirty, save: () => saveRef.current() });
  }, [dirty]);
  React.useEffect(() => {
    const id = guardId.current;
    return () => registerLeaveGuard(id, null);
  }, []);

  React.useEffect(() => {
    if (phase !== 'saved') return;
    const t = setTimeout(() => setPhase('resting'), SAVED_DECAY_MS);
    return () => clearTimeout(t);
  }, [phase]);

  /**
   * APRÈS UN ENREGISTREMENT, LA RÉFÉRENCE EST CE QUI EST PARTI — ou la réponse
   * du serveur si l'écran l'a adoptée.
   *
   * Les écrans ne font pas tous la même chose de la réponse : certains
   * l'affichent (`setData(maj)`), d'autres gardent leur brouillon. Se caler
   * d'office sur la réponse laissait ces derniers bloqués sur « Enregistrer »
   * (Accueil, Pages : un brouillon « hydraté » n'est jamais identique à
   * l'objet brut rendu par l'API). Règle unique désormais : la référence est
   * la valeur ENVOYÉE ; si, au rendu qui suit, l'écran montre exactement la
   * réponse du serveur, c'est elle qui devient la référence. Seule une frappe
   * faite PENDANT l'enregistrement laisse le bouton sur « Enregistrer ».
   */
  const adoptAfterSave = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (adoptAfterSave.current === null) return;
    if (snapshot(value) === adoptAfterSave.current) setBaseline(value);
    adoptAfterSave.current = null;
  }, [value]);

  const save = React.useCallback(async () => {
    const sent = value;
    setPhase('saving');
    try {
      const saved = await onSave();
      setBaseline(sent);
      adoptAfterSave.current = snapshot(saved ?? sent);
      setPhase('saved');
      return true;
    } catch {
      // Erreur déjà signalée (toast de `useAction`). Retour au repos : `dirty`
      // est toujours vrai, donc le widget redevient « Enregistrer ».
      setPhase('resting');
      return false;
    }
  }, [onSave, value]);

  saveRef.current = save;

  return { state: deriveSaveState(phase, dirty), dirty, save };
}
