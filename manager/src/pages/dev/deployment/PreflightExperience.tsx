/**
 * PRÉFLIGHT = opération de PREMIÈRE CLASSE (PRECHECK).
 *
 * Il produit EXACTEMENT les mêmes artefacts qu'un déploiement : checklist live,
 * logs, rapport persisté, historique. Il s'arrête simplement avant l'upload.
 * En cas d'échec (ex. SSH), le rapport est disponible IMMÉDIATEMENT
 * (« Voir le rapport » / « Copier le rapport » / « Relancer »).
 */
import * as React from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { ShieldCheck, Rocket, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { DeployStreamEvent, LiveStepStatus } from '@/types';
import { Button } from '@/components/ui/primitives';
import { Panel, Reveal, DynIcon, StatusDot, type StepState } from './ui';
import { checklistFor, useDeploymentStepContract } from './deploymentChecklist';
import { ErrorPanel } from './ErrorPanel';

interface Terminal {
  ok: boolean;
  runId: string | null;
  code?: string;
  message?: string;
}

/**
 * Silence maximal toléré entre deux évènements du flux, en millisecondes.
 *
 * La connexion SSH du moteur est bornée à 30 s ; on laisse une marge au-delà
 * pour ne jamais couper un préflight qui allait aboutir, tout en gardant un
 * plafond très inférieur aux 8 min 36 s d'attente observées.
 */
const SILENCE_MAX_MS = 45_000;

export function PreflightExperience({
  targetId,
  targetHost,
  sessionId,
  onReady,
  onBack,
  onViewReport,
}: {
  targetId: string;
  targetHost: string;
  sessionId: string;
  onReady: () => void;
  onBack: () => void;
  onViewReport: (runId: string) => void;
}) {
  const reduce = useReducedMotion();
  const [steps, setSteps] = React.useState<Record<string, LiveStepStatus>>({});
  const [current, setCurrent] = React.useState<string | null>(null);
  const [terminal, setTerminal] = React.useState<Terminal | null>(null);
  const runIdRef = React.useRef<string | null>(null);
  const failRef = React.useRef<{ code?: string; message?: string }>({});
  const gotReportRef = React.useRef(false);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    // Démarrage DIFFÉRÉ (macrotask) : neutralise le double-montage de
    // React.StrictMode (dev) — le cleanup transitoire annule le premier
    // démarrage, un seul flux part réellement, interrompu au vrai démontage.
    let cancelled = false;
    const controller = new AbortController();
    /**
     * CHIEN DE GARDE DU SILENCE.
     *
     * Un flux coupé net ne se signale pas toujours : si le backend disparaît
     * derrière un intermédiaire — le proxy de développement, par exemple — la
     * socket du navigateur peut rester ouverte indéfiniment. `reader.read()`
     * n'aboutit jamais, la boucle ne se termine pas, et l'étape en cours tourne
     * pour toujours. C'est exactement ce qu'a produit le préflight du 06/08 à
     * 23:02 : plus aucun évènement après `ssh.connect`, et aucune fin de flux.
     *
     * On ne cherche donc pas à deviner pourquoi le silence dure : on décide
     * qu'un silence prolongé EST une panne, et on rend la main à l'opérateur
     * avec un message et un bouton. Le délai est remis à zéro par le moindre
     * évènement reçu — un préflight lent reste un préflight qui parle.
     */
    let veille: ReturnType<typeof setTimeout> | undefined;
    const relancerVeille = () => {
      if (veille) clearTimeout(veille);
      veille = setTimeout(() => {
        if (cancelled || gotReportRef.current) return;
        setTerminal({ ok: false, runId: runIdRef.current, code: 'STREAM_SILENT' });
        controller.abort();
      }, SILENCE_MAX_MS);
    };
    setSteps({});
    setCurrent(null);
    setTerminal(null);
    runIdRef.current = null;
    failRef.current = {};
    gotReportRef.current = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      run();
    }, 0);

    const run = () =>
      (async () => {
      try {
        relancerVeille();
        for await (const evt of api.deployment.streamPreflight({ targetId, sessionId }, controller.signal)) {
          const e = evt as DeployStreamEvent;
          relancerVeille();
          if (e.deploymentRunId) runIdRef.current = e.deploymentRunId;
          switch (e.type) {
            case 'step.started':
              setCurrent(e.stepId);
              setSteps((p) => ({ ...p, [e.stepId]: 'running' }));
              break;
            case 'step.succeeded':
            case 'step.failed':
            case 'step.warning':
            case 'step.skipped':
              setSteps((p) => ({ ...p, [e.stepId]: e.status }));
              break;
            case 'deployment.failed':
              failRef.current = { code: (e as { errorCode?: string }).errorCode, message: (e as { message?: string }).message };
              break;
            case 'deployment.report_ready':
              gotReportRef.current = true;
              setTerminal({ ok: e.ok, runId: e.deploymentRunId, ...failRef.current });
              break;
            default:
              break;
          }
        }
        // Fin de flux sans rapport ET sans interruption volontaire -> offline réel.
        if (veille) clearTimeout(veille);
        if (!gotReportRef.current && !controller.signal.aborted && !cancelled) setTerminal({ ok: false, runId: runIdRef.current, code: 'OFFLINE' });
      } catch {
        if (veille) clearTimeout(veille);
        // Interruption volontaire (démontage/StrictMode) : ce n'est PAS une panne.
        if (!gotReportRef.current && !controller.signal.aborted && !cancelled) setTerminal({ ok: false, runId: runIdRef.current, code: 'OFFLINE' });
      }
      })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (veille) clearTimeout(veille);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // Échec -> rapport disponible immédiatement.
  const { contract, unavailable: contratIndisponible } = useDeploymentStepContract();
  const lignes = checklistFor(contract, 'PRECHECK');

  if (terminal && !terminal.ok) {
    return (
      <ErrorPanel
        code={terminal.code}
        message={terminal.message}
        onRetry={() => setAttempt((a) => a + 1)}
        onBack={onBack}
        onViewReport={terminal.runId ? () => onViewReport(terminal.runId as string) : undefined}
      />
    );
  }

  return (
    <Reveal>
      <Panel className="mx-auto max-w-xl">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Vérifications avant publication</h2>
            <p className="text-sm text-muted-foreground">Nous vérifions que tout est prêt pour {targetHost}.</p>
          </div>
        </div>

        {contratIndisponible && (
          <p className="mt-4 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Le détail des vérifications est momentanément indisponible. Le contrôle se poursuit.
          </p>
        )}
        <div className="mt-5 space-y-0.5" role="status" aria-live="polite">
          {lignes.map((s) => {
            const st = (steps[s.id] as StepState) || 'pending';
            return (
              <div key={s.id} className={`flex items-center gap-3 rounded-lg px-3 py-1.5 ${st === 'running' ? 'bg-primary/[0.04]' : st === 'error' ? 'bg-red-500/[0.04]' : ''}`}>
                <StatusDot state={st} />
                <span className={`flex items-center gap-2 text-sm ${st === 'pending' ? 'text-muted-foreground' : ''}`}>
                  <DynIcon name={s.icon} className="h-4 w-4 text-muted-foreground" />
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>

        <AnimatePresence>
          {terminal?.ok ? (
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-5 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-emerald-50 px-4 py-3"
            >
              <span className="flex items-center gap-2 text-sm font-medium text-emerald-700">
                <CheckCircle2 className="h-4 w-4" /> Toutes les vérifications sont OK.
              </span>
              <div className="flex gap-2">
                {terminal.runId && (
                  <Button variant="ghost" size="sm" onClick={() => onViewReport(terminal.runId as string)}>
                    Voir le rapport
                  </Button>
                )}
                <Button size="sm" onClick={onReady}>
                  <Rocket className="h-4 w-4" /> Publier le site
                </Button>
              </div>
            </motion.div>
          ) : (
            <p className="mt-4 text-center text-xs text-muted-foreground">
              {current ? 'Vérification en cours…' : 'Connexion au serveur…'} Un rapport sera conservé dans tous les cas.
            </p>
          )}
        </AnimatePresence>
      </Panel>
    </Reveal>
  );
}

export default PreflightExperience;
