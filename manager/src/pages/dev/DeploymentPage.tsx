/**
 * Module de déploiement — ORCHESTRATEUR d'expérience.
 *
 * Gère la navigation entre les vues (accueil, duplication, déploiement, sites,
 * historique) et la session serveur (en mémoire vive uniquement : le mot de
 * passe n'est jamais enregistré). Aucune logique métier ici — tout est délégué
 * au moteur via l'API.
 */
import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { toast } from 'sonner';
import { LogOut, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { describeServerFailure } from '@/lib/serverErrors';
import { estIndisponibiliteTransitoire, malgreUnRedemarrage } from '@/lib/backendAvailability';
import type { DeploymentTarget } from '@/types';
import { Spinner } from '@/components/ui/primitives';
import { Landing, type LandingDestination } from './deployment/Landing';
import { DuplicateAssistant } from './deployment/DuplicateAssistant';
import { DeployAssistant, type VpsSessionInfo } from './deployment/DeployAssistant';
import { TargetsGrid } from './deployment/TargetsGrid';
import { HistoryTimeline } from './deployment/HistoryTimeline';
import { ReportModal } from './deployment/ReportModal';
import { DeploymentFollowUp } from './deployment/DeploymentFollowUp';
import { useActiveDeployment } from './deployment/useDeploymentResume';
import { messageUtilisateur } from '@/lib/erreurs';

type View = 'landing' | 'duplicate' | 'deploy' | 'targets' | 'history';

export default function DeploymentPage() {
  const [view, setView] = React.useState<View>('landing');
  const [targets, setTargets] = React.useState<DeploymentTarget[]>([]);
  const [version, setVersion] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [session, setSession] = React.useState<VpsSessionInfo | null>(null);
  const [connecting, setConnecting] = React.useState(false);
  const [deployTargetId, setDeployTargetId] = React.useState<string | null>(null);
  const [reportRunId, setReportRunId] = React.useState<string | null>(null);

  /**
   * ══ Y A-T-IL DÉJÀ UN DÉPLOIEMENT EN COURS ? (§5, §11, §18) ═══════════════
   *
   * Question posée au BACKEND à chaque montage de l'écran — donc à chaque
   * retour de navigation, et à chaque `F5`.
   *
   * C'est le correctif central du lot. Le suivi vivait dans `DeployRunning` :
   * quitter l'écran coupait le flux et jetait les étapes accumulées, alors que
   * le run continuait et s'écrivait en base. L'utilisateur revenait sur un
   * écran vide, avec un bouton « Déployer » réarmé — et pouvait en lancer un
   * second par-dessus le premier.
   *
   * Aucun `localStorage` ici (§37) : un cache navigateur survivrait à la fin du
   * run, ignorerait un déploiement lancé depuis un autre onglet, et ne dirait
   * rien après un vidage du stockage. Le backend sait ; il est le seul à savoir.
   */
  const { actif: runActif, dernier: dernierRun, relire: relireRun } = useActiveDeployment();
  /**
   * L'écran de reprise prime sur la vue courante TANT QUE le run tourne, mais
   * il reste refermable une fois terminé : `vuReprise` retient ce que
   * l'utilisateur a déjà acquitté, pour ne pas le renvoyer indéfiniment sur un
   * résultat qu'il a lu (§26).
   */
  /**
   * L'utilisateur a-t-il refermé le suivi ? Tant qu'il ne l'a pas fait, un
   * résultat récent reste à l'écran — voir `resultatRecent`.
   */
  /**
   * ══ L'ACQUITTEMENT PORTE SUR UN RUN, PAS SUR « L'ÉCRAN » ═══════════════════
   *
   * ── LE DÉFAUT CORRIGÉ ─────────────────────────────────────────────────────
   *
   * C'était un booléen : « l'utilisateur a refermé le suivi ». Il ne disait pas
   * QUEL run avait été acquitté, et il se remettait à `false` à chaque montage
   * de l'écran. Conséquence observée en exploitation : après un déploiement
   * réussi, cliquer sur « Déployer » réaffichait AUSSITÔT l'écran de réussite à
   * 100 % du run PRÉCÉDENT — parce que `resultatRecent` reste servi pendant dix
   * minutes et que `reprise` prime sur toute la vue. Le nouveau déploiement
   * partait bien en arrière-plan ; l'opérateur, lui, lisait le résultat de
   * l'ancien et croyait que rien ne s'était lancé.
   *
   * En mémorisant l'IDENTIFIANT acquitté, un run DIFFÉRENT reprend la main de
   * lui-même : c'est exactement le comportement attendu quand on en lance un
   * nouveau, et l'acquittement ne peut plus « éteindre » ce qui arrive après.
   */
  const [runAcquitte, acquitterRun] = React.useReducer(
    (_precedent: string | null, id: string | null) => id,
    null as string | null,
  );

  /**
   * ══ UN RÉSULTAT NE DISPARAÎT PAS À LA SECONDE OÙ IL ARRIVE (§15, §26) ═════
   *
   * Première version : `runActif && !acquitté`. Elle démontait le suivi à
   * l'instant précis où le run cessait d'être ACTIF — c'est-à-dire au moment où
   * il produisait enfin son résultat. L'écran repassait sur l'assistant, et le
   * succès comme l'échec n'étaient jamais lus.
   *
   * Deux cas distincts, et il faut les deux :
   *
   *   ACTIF    on reprend le suivi. Évident.
   *   TERMINÉ  on montre le RÉSULTAT — y compris si le run s'est achevé
   *            pendant l'absence de l'utilisateur, cas où `active` est déjà
   *            `false` au retour et où il n'y aurait donc rien à « reprendre ».
   *
   * ── POURQUOI UNE FENÊTRE DE FRAÎCHEUR ────────────────────────────────────
   *
   * `latest` existe toujours, y compris pour un échec d'il y a trois jours. Le
   * présenter à chaque ouverture ferait de l'écran un mémorial. On ne montre
   * donc un run terminé que s'il vient de se terminer — le temps qu'un
   * utilisateur parti se faire un café revienne le lire.
   */
  const FRAICHEUR_RESULTAT_MS = 10 * 60 * 1000;
  const resultatRecent = React.useMemo(() => {
    if (!dernierRun || dernierRun.active) return null;
    const fin = dernierRun.finishedAt ? new Date(dernierRun.finishedAt).getTime() : 0;
    if (!fin || Date.now() - fin >= FRAICHEUR_RESULTAT_MS) return null;
    /**
     * ══ UN RÉSULTAT N'APPARTIENT QU'À SA DESTINATION ═════════════════════════
     *
     * `latest` est le dernier run du PROJET, toutes destinations confondues :
     * le backend ne filtre que si on lui passe `targetId`, et cet écran ne le
     * lui passait pas. Le résultat d'une destination pouvait donc s'afficher
     * au-dessus d'une autre — deux domaines, deux serveurs, un seul écran, et
     * rien qui distingue lequel on regarde.
     *
     * Tant qu'aucune destination n'est choisie (page d'accueil du module), il
     * n'y a rien à confondre : on montre le résultat récent tel quel.
     */
    if (deployTargetId && dernierRun.targetId !== deployTargetId) return null;
    return dernierRun;
  }, [dernierRun, deployTargetId]);

  /**
   * UN RUN ACTIF PRIME TOUJOURS (§24) ; un run TERMINÉ ne prime que tant qu'il
   * n'a pas été acquitté. Comparer les identifiants — et non un booléen — est
   * ce qui permet au run SUIVANT de reprendre la main sans rien réarmer.
   */
  const candidatReprise = runActif ?? resultatRecent;
  const reprise = candidatReprise && candidatReprise.id !== runAcquitte ? candidatReprise : null;
  const reduce = useReducedMotion();

  const load = React.useCallback(async () => {
    try {
      const [ts, v] = await Promise.all([api.deployment.listTargets(), api.deployment.getVersion()]);
      setTargets(ts);
      setVersion(v.version);
    } catch (e) {
      toast.error(messageUtilisateur(e, 'Chargement impossible'));
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => {
    load();
  }, [load]);

  // Ferme la session serveur (efface la mémoire) à la fermeture du module.
  const sessionRef = React.useRef<VpsSessionInfo | null>(null);
  sessionRef.current = session;
  React.useEffect(() => {
    return () => {
      if (sessionRef.current) api.deployment.closeVpsSession(sessionRef.current.sessionId).catch(() => {});
    };
  }, []);

  const connect = React.useCallback(
    async (creds: { host: string; username: string; password: string }) => {
      setConnecting(true);
      let attenteAnnoncee = false;
      try {
        /**
         * ══ UN REDÉMARRAGE DU BACKEND N'EST PAS UN ÉCHEC DE CONNEXION ═══════
         *
         * Le backend local est lancé sous surveillance (`node --watch`) : toute
         * modification d'une source qu'il importe le relance. Si cela survient
         * pendant l'ouverture de la session, la socket meurt en `ECONNRESET` —
         * et cet écran affichait aussitôt un bandeau rouge, alors que le
         * service revenait deux secondes plus tard.
         *
         * On distingue donc « je n'ai pas pu demander » de « c'est refusé » :
         * le premier attend et redemande, dans une fenêtre bornée ; le second
         * s'affiche immédiatement, sans jamais faire patienter l'opérateur
         * devant un mot de passe faux.
         *
         * Le mot de passe ne vit que dans cette fermeture, le temps des
         * tentatives. Il n'est écrit NULLE PART — ni stockage, ni journal.
         */
        const s = await malgreUnRedemarrage(
          () => api.deployment.openVpsSession(creds.host, creds.username, creds.password),
          {
            onAttente: () => {
              if (attenteAnnoncee) return;
              attenteAnnoncee = true;
              // INFO, jamais ERROR : rien n'a échoué tant que la fenêtre dure.
              toast.info('Le serveur redémarre — reconnexion en cours…');
            },
            onRetabli: () => toast.success('Serveur de nouveau disponible.'),
          },
        );
        /**
         * LE TOAST NE PARLE QU'APRÈS LA PREUVE.
         *
         * Il s'affichait dès que le backend avait rangé les identifiants en
         * mémoire — sans qu'aucune connexion n'ait été tentée. « Connecté au
         * serveur » restait donc vrai avec un mot de passe faux ou un hôte
         * éteint, et l'erreur ne surgissait que plusieurs écrans plus loin.
         *
         * Le backend authentifie désormais AVANT de rendre une session : si
         * cette ligne est atteinte, la connexion a réellement eu lieu.
         */
        setSession({ sessionId: s.sessionId, host: creds.host, username: creds.username });
        toast.success('Connecté au serveur.');
        return true;
      } catch (e) {
        /**
         * ON NOMME LA MACHINE ET L'ISSUE.
         *
         * Un mot de passe refusé, une négociation trop lente et un backend
         * éteint produisaient la même phrase. L'opérateur vérifiait donc des
         * identifiants qui étaient bons, réessayait, et finissait par réussir
         * — sans jamais savoir ce qui avait changé.
         */
        /**
         * ICI, LA FENÊTRE DE REPRISE EST ÉPUISÉE — ou l'erreur était définitive
         * dès le premier essai. Dans les deux cas, le rouge est mérité, et le
         * message doit être ACTIONNABLE plutôt que générique.
         */
        if (estIndisponibiliteTransitoire(e)) {
          toast.error('Le serveur ne répond toujours pas. Vérifiez qu’il est démarré, puis réessayez.');
          return false;
        }
        const verdict = describeServerFailure(
          e instanceof ApiError ? e.code : undefined,
          e instanceof ApiError ? e.message : undefined,
        );
        toast.error(verdict.title);
        return false;
      } finally {
        setConnecting(false);
      }
    },
    []
  );

  const disconnect = React.useCallback(async () => {
    if (session) await api.deployment.closeVpsSession(session.sessionId).catch(() => {});
    setSession(null);
    toast.success('Déconnecté du serveur.');
  }, [session]);

  const goHome = () => {
    setDeployTargetId(null);
    setView('landing');
  };

  const startDeploy = (targetId?: string) => {
    /**
     * UNE ACTION EXPLICITE N'EST JAMAIS MASQUÉE PAR UN RÉSULTAT PASSÉ.
     *
     * L'opérateur demande à déployer : lui répondre par l'écran de réussite du
     * run précédent est la panne exacte qu'on corrige ici. On acquitte donc ce
     * résultat — et LUI SEUL. Un run encore ACTIF n'est jamais acquitté : s'il
     * y en a un, il doit continuer de prendre l'écran, puisque c'est ce qui
     * empêche d'en lancer un second par-dessus (§24).
     */
    if (resultatRecent) acquitterRun(resultatRecent.id);
    setDeployTargetId(targetId ?? null);
    setView('deploy');
  };

  if (loading) {
    return (
      <div className="flex min-h-[calc(var(--m-viewport-h)*0.6)] items-center justify-center">
        <Spinner className="h-7 w-7" />
      </div>
    );
  }

  return (
    <div className="pb-16">
      {/* Barre serveur globale (visible dès qu'une session est ouverte) */}
      <AnimatePresence>
        {session && (
          <motion.div
            initial={reduce ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -8 }}
            className="mx-auto mb-6 flex max-w-4xl items-center justify-between rounded-xl border border-emerald-300/70 bg-emerald-50/60 px-4 py-2.5"
          >
            <span className="flex items-center gap-2 text-sm text-emerald-800">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              Serveur connecté&nbsp;<span className="font-mono">{session.username}@{session.host}</span>
            </span>
            <button
              onClick={disconnect}
              className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 transition-colors hover:text-emerald-900"
            >
              <LogOut className="h-3.5 w-3.5" /> Déconnecter
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/*
        LE DÉPLOIEMENT EN COURS PASSE DEVANT TOUT LE RESTE.

        Tant qu'un run est actif, l'écran ne propose PAS de « Déployer » (§24) :
        il montre celui qui tourne. La vraie protection reste côté backend, qui
        refuse un second lancement avec `DEPLOYMENT_ALREADY_RUNNING` — mais
        présenter un bouton qui va échouer serait proposer une erreur.
      */}
      {reprise ? (
        <DeploymentFollowUp
          runId={reprise.id}
          instantaneInitial={reprise}
          onTermine={() => {
            /**
             * LE RUN VIENT DE SE TERMINER — ON NE FERME RIEN.
             *
             * On relit le backend pour que `latest` porte désormais le résultat
             * (c'est lui qui maintiendra le suivi affiché au prochain montage),
             * et l'on LAISSE la vue en place : elle montre maintenant le succès
             * ou l'échec. L'acquittement appartient à l'utilisateur, pas à
             * l'horloge — un écran qui se referme tout seul sur un résultat
             * qu'on n'a pas lu ne vaut pas mieux qu'un écran vide.
             */
            relireRun();
          }}
          onFermer={() => acquitterRun(reprise.id)}
          onRapport={setReportRunId}
        />
      ) : (
      <AnimatePresence mode="wait">
        <motion.div
          key={view}
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0, y: -8 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        >
          {view === 'landing' && (
            <Landing
              version={version}
              targetCount={targets.length}
              onGo={(d: LandingDestination) => (d === 'deploy' ? startDeploy() : setView(d))}
            />
          )}

          {view === 'duplicate' && <DuplicateAssistant onExit={goHome} />}

          {view === 'deploy' && (
            <DeployAssistant
              targets={targets}
              reload={load}
              version={version}
              session={session}
              connect={connect}
              connecting={connecting}
              initialTargetId={deployTargetId}
              onExit={goHome}
              onViewReport={setReportRunId}
            />
          )}

          {view === 'targets' && (
            <TargetsGrid
              targets={targets}
              reload={load}
              onDeploy={(id) => startDeploy(id)}
              onBack={goHome}
              /* Le retrait lit l'état réel du serveur puis l'exécute : il a
                 besoin de la même session que le déploiement. */
              sessionId={session?.sessionId ?? null}
              /* La MÊME capacité que l'assistant : un seul chemin
                 d'authentification, un seul endroit où le mot de passe passe. */
              onConnect={connect}
              connecting={connecting}
            />
          )}

          {view === 'history' && <HistoryTimeline onBack={goHome} onViewReport={setReportRunId} />}
        </motion.div>
      </AnimatePresence>
      )}

      <AnimatePresence>
        {reportRunId && <ReportModal key={reportRunId} runId={reportRunId} onClose={() => setReportRunId(null)} />}
      </AnimatePresence>
    </div>
  );
}
