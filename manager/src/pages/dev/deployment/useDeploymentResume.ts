import * as React from 'react';

import { api, ApiError, isOffline } from '@/lib/api';
import { estIndisponibiliteTransitoire, malgreUnRedemarrage, RECULS_MS } from '@/lib/backendAvailability';
import type { DeploymentRunSnapshot } from '@/types';

/**
 * ══ REPRENDRE LE SUIVI D'UN DÉPLOIEMENT QUI NE NOUS APPARTIENT PAS ═════════
 *
 * ── LE DÉFAUT QUE CE MODULE FERME ──────────────────────────────────────────
 *
 * Le suivi vivait dans la page : les étapes s'accumulaient dans un `useState`
 * alimenté par le flux, et l'identifiant du run n'était connu qu'après
 * réception d'un premier évènement. Quitter l'écran coupait le flux
 * (`AbortController`) et jetait l'état.
 *
 * Le déploiement, lui, continuait — le moteur écrit chaque transition d'étape
 * en base au moment où elle arrive. Rien n'était perdu ; RIEN N'ÉTAIT DEMANDÉ.
 * L'utilisateur retrouvait un écran vide et un bouton « Déployer » réarmé
 * devant un travail bien vivant.
 *
 * ── L'INVARIANT ────────────────────────────────────────────────────────────
 *
 *     RUN BACKEND PERSISTANT
 *             ↑
 *     UI = observateur reconnectable
 *
 * Ce hook ne CONSERVE rien : à chaque instant, son état EST le dernier
 * instantané reçu du backend. Il n'y a donc aucun état accumulé qu'un
 * démontage pourrait perdre, ni aucune divergence possible avec l'autorité.
 */
/**
 * Le backend n'est pas revenu dans la fenêtre bornée. Ce code est le
 * vocabulaire partagé avec la recette : il nomme un cas précis — coupure
 * ANNONCÉE dont le service ne se relève pas — et pas « une erreur ».
 */
export const BACKEND_NOT_BACK = 'BACKEND_NOT_BACK';

/** Durée totale de patience, dérivée des reculs eux-mêmes (~10 s). */
export const FENETRE_REDEMARRAGE_S = Math.round(
  RECULS_MS.reduce((total, ms) => total + ms, 0) / 1000,
);

export interface EtatReprise {
  /** L'instantané courant — `null` tant qu'on n'a rien reçu. */
  snapshot: DeploymentRunSnapshot | null;
  /** La découverte initiale est-elle encore en cours ? */
  chargement: boolean;
  /**
   * Le LIVE est-il coupé alors que le run tourne toujours ?
   *
   * Ce n'est PAS un échec de déploiement (§15) : le travail continue côté
   * serveur. L'écran doit dire « reconnexion au suivi… », jamais « échec ».
   */
  liveperdu: boolean;
  /**
   * LE BACKEND REDEMARRE-T-IL, DE FAÇON ANNONCÉE ?
   *
   * Distinct de `liveperdu` : ici la coupure est ATTENDUE — le moteur l'a
   * annoncée par `backend_restarting` avant de couper. L'écran doit dire
   * « Redémarrage du serveur… », pas « reconnexion » et surtout pas « échec ».
   */
  redemarrage: string | null;
  /**
   * Le backend n'est jamais revenu dans la fenêtre bornée. On le DIT plutôt que
   * de tourner indéfiniment sur un spinner honnête mais muet.
   */
  backendAbsent: boolean;
}

/**
 * REPREND LE SUIVI DEPUIS LE RUN PERSISTÉ, sans rien relancer.
 *
 * Le run vit en base : après un redémarrage annoncé, il suffit de le
 * redemander. Aucun `streamDeploy` ici — ce serait lancer un SECOND
 * déploiement par-dessus celui qui vient tout juste de survivre au
 * redémarrage.
 */
async function reprendreDepuisLeRun(runId: string) {
  const etat = await malgreUnRedemarrage(() => api.deployment.activeRun());
  return etat.run?.id === runId ? etat.run
    : (etat.latest?.id === runId ? etat.latest : null);
}

/**
 * OBSERVE un run — instantané puis progression, avec reconnexion bornée.
 *
 * @param runId le run à suivre. `null` n'observe rien.
 */
export function useDeploymentObserver(runId: string | null): EtatReprise {
  const [snapshot, setSnapshot] = React.useState<DeploymentRunSnapshot | null>(null);
  const [chargement, setChargement] = React.useState<boolean>(Boolean(runId));
  const [liveperdu, setLivePerdu] = React.useState(false);
  const [redemarrage, setRedemarrage] = React.useState<string | null>(null);
  const [backendAbsent, setBackendAbsent] = React.useState(false);

  React.useEffect(() => {
    if (!runId) { setSnapshot(null); setChargement(false); return undefined; }

    setRedemarrage(null);
    setBackendAbsent(false);


    let annule = false;
    let tentatives = 0;
    let minuteur: ReturnType<typeof setTimeout>;
    /**
     * UN SEUL OBSERVATEUR À LA FOIS (§16).
     *
     * L'`AbortController` est recréé à chaque tentative et annulé au démontage.
     * Sans lui, une reconnexion pendant une navigation rapide laisserait deux
     * flux ouverts sur le même run — et l'écran recevrait deux instantanés
     * concurrents dont l'ordre d'arrivée n'est pas garanti.
     */
    let controleur: AbortController | null = null;

    const observer = async () => {
      controleur = new AbortController();
      try {
        for await (const evt of api.deployment.observeRun(runId, controleur.signal)) {
          if (annule) return;
          tentatives = 0;          // un évènement reçu = le lien est sain
          setLivePerdu(false);
          if (evt.type === 'run.snapshot') {
            setSnapshot(evt.snapshot);
            setChargement(false);
            /* Un instantané reçu = le service est bien là. */
            setRedemarrage(null);
            setBackendAbsent(false);
          }
          else if (evt.type === 'run.closed') {
            if (evt.snapshot) setSnapshot(evt.snapshot);
            setChargement(false);
            return;                // le backend a dit « terminé » : on ne rouvre pas
          }
        }
        if (annule) return;
        /**
         * FLUX FERMÉ SANS « run.closed » — le lien a lâché, pas le déploiement.
         * On redemande l'état au backend, qui seul sait où en est le travail.
         */
        throw new Error('flux interrompu');
      } catch (err) {
        if (annule || controleur?.signal.aborted) return;
        /**
         * ══ UNE COUPURE DE SUIVI N'EST PAS UN ÉCHEC DE DÉPLOIEMENT (§15) ═══
         *
         * `fetch` qui s'interrompt ne dit RIEN du travail en cours. Afficher
         * « déploiement échoué » ici serait inventer un verdict que le backend
         * n'a pas rendu — et l'utilisateur relancerait un déploiement pour
         * rien, par-dessus celui qui tourne encore.
         */
        /**
         * ══ REPRENDRE DEPUIS LE RUN PERSISTÉ APRÈS UN REDÉMARRAGE ANNONCÉ ══
         *
         * On ne RELANCE rien : on redemande l'état du run que le backend a
         * conservé, avec le recul borné de `RECULS_MS` (~10 s au total). Le
         * déploiement, lui, n'a jamais cessé — c'est l'API qui s'est absentée.
         *
         * Si elle ne revient pas dans la fenêtre, on le DIT. Un spinner
         * éternel laisserait croire à un travail en cours alors que plus
         * personne ne répond.
         */
        /**
         * ══ RECONNAÎTRE UN REDÉMARRAGE DU BACKEND ══════════════════════════
         *
         * Le moteur annonce `backend_restarting` sur le flux du POST de
         * lancement — que le lanceur referme dès le `run.created`, puisque le
         * suivi appartient désormais à l'observateur. Cette annonce n'arrive
         * donc plus jusqu'ici, et l'écouter serait attendre un message que
         * personne n'envoie plus.
         *
         * Ce qu'on observe à la place est plus sûr, et couvre AUSSI le
         * redémarrage non annoncé : le flux meurt, et l'API est
         * transitoirement injoignable. Déployer ce projet sur la machine qui
         * héberge l'API coupe l'API — donc notre flux. Ce n'est pas une panne
         * de déploiement, et l'écran ne doit pas l'annoncer comme telle.
         */
        if (estIndisponibiliteTransitoire(err) || isOffline(err)) {
          setRedemarrage('Redémarrage du serveur…');
          try {
            const frais = await reprendreDepuisLeRun(runId);
            if (annule) return;
            if (frais) { setSnapshot(frais); setChargement(false); }
            setRedemarrage(null);
            if (frais && !frais.active) return;   // terminé pendant la coupure
            tentatives = 0;
            void observer();
            return;
          } catch {
            if (annule) return;
            /* BACKEND_NOT_BACK — la fenêtre bornée est épuisée. */
            setRedemarrage(null);
            setBackendAbsent(true);
            setChargement(false);
            return;
          }
        }

        setLivePerdu(true);
        tentatives += 1;
        if (tentatives > 6) { setChargement(false); return; }

        /* Reconnexion BORNÉE : on redemande l'état, puis on rebranche. */
        const delai = Math.min(1000 * tentatives, 5000);
        minuteur = setTimeout(async () => {
          if (annule) return;
          try {
            const etat = await api.deployment.activeRun();
            if (annule) return;
            const frais = etat.run?.id === runId ? etat.run
              : (etat.latest?.id === runId ? etat.latest : null);
            if (frais) setSnapshot(frais);
            setChargement(false);
            /* Terminé : plus rien à observer, le résultat est déjà à l'écran. */
            if (frais && !frais.active) { setLivePerdu(false); return; }
          } catch (e) {
            if (!isOffline(e) && !(e instanceof ApiError)) return;
          }
          if (!annule) void observer();
        }, delai);
      }
    };

    void observer();
    return () => {
      annule = true;
      clearTimeout(minuteur);
      /**
       * ══ ANNULER L'OBSERVATION N'ANNULE PAS LE DÉPLOIEMENT (§17, §36) ═════
       *
       * On ferme NOTRE lecture, rien d'autre. La route observée est un `GET`
       * qui ne pilote pas le moteur : le backend note « observer disconnected
       * — job continues » et poursuit. Quitter la page, fermer l'onglet,
       * rafraîchir ou perdre le réseau ne sont pas des demandes d'annulation.
       */
      controleur?.abort();
    };
  }, [runId]);

  return { snapshot, chargement, liveperdu, redemarrage, backendAbsent };
}

/**
 * DÉCOUVRE, au montage de l'écran, s'il y a un déploiement à reprendre.
 *
 * ── POURQUOI LE BACKEND EST INTERROGÉ À CHAQUE MONTAGE ─────────────────────
 *
 * Un cache navigateur (`localStorage`) accélérerait l'affichage et mentirait
 * une fois sur deux : il survit à la fin du run, ne connaît pas les
 * déploiements lancés depuis un autre onglet, et ne dit rien après un vidage du
 * stockage. Le backend, lui, sait — et il est le seul à savoir.
 */
export function useActiveDeployment(): {
  actif: DeploymentRunSnapshot | null;
  dernier: DeploymentRunSnapshot | null;
  chargement: boolean;
  relire: () => void;
} {
  const [actif, setActif] = React.useState<DeploymentRunSnapshot | null>(null);
  const [dernier, setDernier] = React.useState<DeploymentRunSnapshot | null>(null);
  const [chargement, setChargement] = React.useState(true);
  const [tic, setTic] = React.useState(0);

  React.useEffect(() => {
    let annule = false;
    setChargement(true);
    api.deployment.activeRun()
      .then((r) => {
        if (annule) return;
        setActif(r.active ? r.run : null);
        setDernier(r.latest);
      })
      .catch(() => {
        /**
         * UNE DÉCOUVERTE QUI ÉCHOUE NE DOIT PAS BLOQUER L'ÉCRAN.
         *
         * Le cas typique est un `401` le temps que la session se restaure. On
         * n'invente alors aucun état : pas de run repris, pas de run inventé —
         * l'écran retombe sur son parcours normal, et un `relire()` suffira.
         */
        if (!annule) { setActif(null); setDernier(null); }
      })
      .finally(() => { if (!annule) setChargement(false); });
    return () => { annule = true; };
  }, [tic]);

  return { actif, dernier, chargement, relire: () => setTic((t) => t + 1) };
}

export default useDeploymentObserver;
