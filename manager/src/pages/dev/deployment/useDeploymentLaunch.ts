import * as React from 'react';

import { api, ApiError } from '@/lib/api';

/**
 * ══ LANCER UN DÉPLOIEMENT — ET S'EFFACER AUSSITÔT ══════════════════════════
 *
 * ── CE QUE CE HOOK N'EST PAS ───────────────────────────────────────────────
 *
 * Ce n'est pas un lecteur de progression. Il ouvre le POST qui DÉMARRE le
 * travail, en retire la seule information que ce POST soit seul à pouvoir
 * donner — l'identité du run — puis se détache.
 *
 * ── POURQUOI IL SE DÉTACHE (§27) ───────────────────────────────────────────
 *
 * Garder le POST ouvert pendant tout le déploiement ferait vivre DEUX flux sur
 * le même run : celui du lancement et celui de l'observation. Deux sources,
 * deux cadences, deux ordres d'arrivée — et la certitude qu'un jour l'écran
 * affiche l'une pendant que l'autre dit le contraire.
 *
 * Le détachement est sûr, et c'est mesuré : côté serveur, la fermeture du
 * client positionne `clientGone` et le moteur POURSUIT. Fermer ce flux
 * n'annule rien (§36) — c'est la même propriété qui permet de quitter la page.
 *
 * ── POURQUOI `run.created` EXISTE ──────────────────────────────────────────
 *
 * `deploymentRunId` voyageait sur chaque évènement, mais le premier à partir
 * dépendait de la configuration de la destination. Attendre « un évènement,
 * n'importe lequel » pour apprendre l'identité du run rendait le basculement
 * vers le suivi persistant non déterministe. Le backend émet désormais
 * `run.created` immédiatement après la création, avant toute décision.
 */
export type EtatLancement =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'started'; runId: string }
  | { phase: 'refused'; runId: string | null; code?: string; message: string };

export function useDeploymentLaunch(
  corps: { targetId: string; sessionId: string; env?: 'TEST' | 'PROD' } | null,
): EtatLancement {
  const [etat, setEtat] = React.useState<EtatLancement>({ phase: 'idle' });
  /**
   * UN SEUL LANCEMENT PAR MONTAGE.
   *
   * React peut ré-exécuter un effet (mode strict, dépendance recalculée). Sans
   * ce garde-fou, un rendu de plus vaudrait un déploiement de plus — la panne
   * exacte que tout ce chantier combat. Le backend refuserait le second, mais
   * une protection qui repose sur le refus d'en face n'en est pas une.
   */
  const lance = React.useRef(false);
  /**
   * ══ LE CONTRÔLEUR VIT DANS UNE RÉF, ET N'EST FERMÉ QU'AU DÉMONTAGE ═══════
   *
   * ── LE DÉFAUT QUE CECI FERME (loader « Ouverture du déploiement… » infini) ─
   *
   * Le contrôleur était créé DANS l'effet, et le nettoyage de cet effet
   * l'annulait. Or un effet se nettoie à chaque changement de dépendance, pas
   * seulement au démontage : il suffisait que `corps` change une fois — une
   * session VPS renégociée, un identifiant recalculé — pour que le POST en vol
   * soit AVORTÉ avant l'arrivée de `run.created`.
   *
   * Et comme `lance.current` était déjà `true`, la nouvelle passe de l'effet
   * ressortait immédiatement : plus personne ne lançait, plus personne
   * n'écoutait. L'écran restait sur « Ouverture du déploiement… » pour
   * toujours, alors que le run existait bel et bien côté serveur — un simple
   * F5 le retrouvait, puisque la découverte, elle, interroge le backend.
   *
   * Le nettoyage de fermeture vit donc dans un effet à dépendances VIDES : lui
   * seul s'exécute au démontage, et jamais sur un changement de dépendance.
   */
  const controleurRef = React.useRef<AbortController | null>(null);
  const detacheRef = React.useRef(false);

  React.useEffect(() => () => {
    /* Démontage RÉEL : on referme notre lecture. Le run, lui, continue. */
    if (!detacheRef.current) controleurRef.current?.abort();
  }, []);

  React.useEffect(() => {
    if (!corps || lance.current) return undefined;
    lance.current = true;
    setEtat({ phase: 'starting' });

    const controleur = new AbortController();
    controleurRef.current = controleur;
    let detache = false;

    /**
     * LE FILET : demander au backend s'il a créé un run, malgré tout.
     *
     * C'est la même autorité que la découverte au montage — le run persisté.
     * S'il existe, on le suit ; sinon seulement, on annonce un refus. Un écran
     * qui attend un identifiant perdu ne se répare qu'au rechargement, et c'est
     * exactement le symptôme qu'on supprime ici.
     */
    const rattraperDepuisLeBackend = async () => {
      try {
        const etatRun = await api.deployment.activeRun();
        const trouve = etatRun.run ?? etatRun.latest ?? null;
        if (trouve?.id) {
          detache = true;
          detacheRef.current = true;
          setEtat({ phase: 'started', runId: trouve.id });
          return;
        }
      } catch { /* le backend ne répond pas : on tombera sur le refus ci-dessous */ }
      setEtat({
        phase: 'refused', runId: null,
        message: 'Le déploiement n’a émis aucun identifiant de run.',
      });
    };

    (async () => {
      try {
        for await (const evt of api.deployment.streamDeploy(corps, controleur.signal)) {
          const e = evt as { type?: string; runId?: string; deploymentRunId?: string };
          const id = e.runId ?? e.deploymentRunId ?? null;
          if (!id) continue;
          setEtat({ phase: 'started', runId: id });
          /**
           * L'IDENTITÉ EST ACQUISE : on referme. Le moteur continue, et le
           * suivi passe à `observe`, qui est reconnectable — ce que ce
           * POST-ci ne sera jamais.
           */
          detache = true;
          detacheRef.current = true;
          controleur.abort();
          return;
        }
        if (!detache) await rattraperDepuisLeBackend();
      } catch (err) {
        if (detache) return;
        /**
         * ══ UN FLUX COUPÉ NE PROUVE PAS QU'AUCUN RUN N'EXISTE ══════════════
         *
         * Le POST peut mourir APRÈS que le backend a créé le run : réseau,
         * redémarrage, avortement. Conclure « rien ne s'est passé » laisserait
         * l'écran attendre un identifiant que personne n'enverra plus, alors
         * que le run tourne.
         *
         * On demande donc au backend — la seule autorité — avant de conclure.
         */
        if (controleur.signal.aborted) { await rattraperDepuisLeBackend(); return; }
        /**
         * ══ « DÉJÀ EN COURS » N'EST PAS UNE ERREUR (§17) ══════════════════
         *
         * Deux onglets, un double clic : le backend refuse le second avec
         * `DEPLOYMENT_ALREADY_RUNNING` et NOMME le run qui occupe la place.
         * C'est une invitation à suivre, pas un échec — l'afficher en rouge
         * pousserait l'utilisateur à réessayer contre un travail qui tourne.
         */
        const api = err instanceof ApiError ? err : null;
        const details = (api?.details ?? {}) as { runId?: string };
        setEtat({
          phase: 'refused',
          runId: details.runId ?? null,
          code: api?.code,
          message: api?.message ?? 'Le déploiement n’a pas pu démarrer.',
        });
      }
    })();

    /*
     * PAS DE NETTOYAGE ICI : ce serait annuler le lancement au premier
     * changement de dépendance. La fermeture appartient à l'effet de démontage
     * déclaré plus haut.
     */
    return undefined;
  }, [corps]);

  return etat;
}

export default useDeploymentLaunch;
