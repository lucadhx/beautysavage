import * as React from 'react';
import { toast } from 'sonner';
import { messageUtilisateur } from '@/lib/erreurs';
import { onResourceChanged, type LiveResource } from '@/lib/liveInvalidation';

/**
 * Un même message d'erreur n'apparaît qu'UNE fois.
 *
 * Une page charge volontiers 5 à 7 ressources en parallèle. Quand le backend est
 * indisponible, elles échouent toutes ensemble et affichaient chacune leur toast :
 * un mur de messages identiques, illisible, qui donnait l'impression d'une avalanche
 * de pannes distinctes. Sonner déduplique par `id` : même cause → un seul toast.
 */
function toastOnce(message: string) {
  toast.error(message, { id: `err:${message}` });
}

/**
 * Load data on mount with loading/error state and a refetch helper.
 *
 * ── `live` : LA RESSOURCE SE REVALIDE QUAND LE BACKEND LE DIT ───────────────
 *
 * ══ CE QUI MANQUAIT ═══════════════════════════════════════════════════════
 *
 * Ce hook chargeait UNE fois, au montage. Une donnée arrivée du Panel — nom de
 * l'entreprise, état du site — était persistée par le backend en quelques
 * dizaines de millisecondes, et l'écran ouvert ne l'apprenait jamais :
 * l'utilisateur voyait l'ancienne valeur jusqu'au rechargement.
 *
 * ══ POURQUOI ICI, ET PAS DANS CHAQUE ÉCRAN ════════════════════════════════
 *
 * Un flux par page ouvrirait autant de connexions longues que de pages
 * visitées, et disperserait la logique de reconnexion. Le canal est unique et
 * vit dans `liveInvalidation` ; ce hook n'en connaît que le NOM de sa
 * ressource. Deux écrans qui lisent la même ressource se revalident ensemble,
 * sans se coordonner.
 *
 * ══ SILENCIEUX, TOUJOURS ══════════════════════════════════════════════════
 *
 * La revalidation passe par `refresh` : ni écran de chargement, ni toast. Une
 * mise à jour venue de l'extérieur ne doit pas faire clignoter la page de
 * quelqu'un qui est en train de lire.
 */
export function useResource<T>(
  loader: () => Promise<T>,
  deps: React.DependencyList = [],
  options: { live?: LiveResource } = {},
) {
  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Compteur de génération : seule la DERNIÈRE requête lancée a le droit
  // d'écrire. Un simple booléen `alive` ne suffisait pas — remis à `true` par
  // l'effet suivant (StrictMode monte deux fois), il laissait la requête
  // abandonnée écrire et toaster malgré tout, d'où les toasts en double.
  const generation = React.useRef(0);

  /**
   * @param silent Rafraîchissement d'ARRIÈRE-PLAN : ne touche ni `loading` ni
   *   les toasts.
   *
   *   `loading` fait retomber les pages sur leur écran de chargement
   *   (`if (loading) return <BrandLoader/>`) : acceptable au premier
   *   affichage, ruineux pour un sondage — la page clignotait toutes les
   *   5 secondes, perdait sa position de défilement et coupait la navigation.
   *   En silencieux, les données précédentes restent à l'écran pendant la
   *   requête et sont remplacées d'un coup, sans état intermédiaire.
   *
   *   Le silence vaut aussi pour l'erreur : un sondage qui échoue n'a rien à
   *   annoncer, le suivant réessaiera. Alerter toutes les 5 s serait pire que
   *   se taire.
   */
  const run = React.useCallback(async (silent: boolean) => {
    const mine = ++generation.current;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const result = await loader();
      if (mine !== generation.current) return; // réponse périmée : on l'ignore
      setData(result);
      setError(null);
    } catch (err) {
      if (mine !== generation.current) return;
      if (!silent) {
        /*
          LE MESSAGE DU SERVEUR RESTE PRIORITAIRE — mais seulement s'il a été
          écrit pour un humain. Voir `lib/erreurs.ts` : la phrase brute d'une
          bibliothèque ou d'une passerelle part au journal, pas à l'écran.
        */
        const msg = messageUtilisateur(err, 'Le chargement a échoué. Réessayez dans un instant.');
        setError(msg);
        toastOnce(msg); // ne pas échouer silencieusement
      }
    } finally {
      // Sans condition sur `silent` : un rafraîchissement silencieux qui double
      // un chargement initial encore en vol lui vole sa génération — c'est donc
      // à lui de clore `loading`, sinon il resterait vrai à jamais.
      if (mine === generation.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const reload = React.useCallback(() => run(false), [run]);
  /** Recharge sans écran de chargement ni toast — pour le sondage et l'après-action. */
  const refresh = React.useCallback(() => run(true), [run]);

  React.useEffect(() => {
    reload();
    // Le démontage invalide la requête en cours : plus aucune écriture d'état.
    return () => {
      generation.current += 1;
    };
  }, [reload]);

  /**
   * L'ABONNEMENT SUIT LA VIE DU COMPOSANT.
   *
   * Aucun écran monté qui n'écoute pas, aucun écouteur qui survit à son écran.
   * Le canal lui-même s'ouvre au premier abonné et se referme quand plus
   * personne n'écoute — une application dont aucune page ne consomme de
   * ressource live n'ouvre aucune connexion.
   */
  const live = options.live;
  React.useEffect(() => {
    if (!live) return undefined;
    return onResourceChanged(live, () => { void refresh(); });
  }, [live, refresh]);

  return { data, setData, loading, error, reload, refresh };
}

/** Run an async action with a pending flag and toast on error. */
export function useAction() {
  const [pending, setPending] = React.useState(false);
  const run = React.useCallback(
    async <R>(fn: () => Promise<R>, opts?: { success?: string; error?: string }) => {
      setPending(true);
      try {
        const result = await fn();
        if (opts?.success) toast.success(opts.success);
        return result;
      } catch (err) {
        const msg = messageUtilisateur(err, opts?.error ?? 'L’opération a échoué.');
        toastOnce(msg);
        throw err;
      } finally {
        setPending(false);
      }
    },
    []
  );
  return { pending, run };
}
