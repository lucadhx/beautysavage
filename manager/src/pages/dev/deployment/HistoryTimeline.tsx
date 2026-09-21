/**
 * Historique des déploiements (persisté) sous forme de TIMELINE. Chaque
 * tentative — succès, échec, annulation, interruption — avec « Voir le rapport ».
 */
import * as React from 'react';
import { toast } from 'sonner';
import { ArrowLeft, CheckCircle2, XCircle, AlertTriangle, GitCommitHorizontal, History as HistoryIcon, FileText, RotateCw } from 'lucide-react';
import { api } from '@/lib/api';
import type { DeploymentRunSummary } from '@/types';
import { formatDateTime } from '@/lib/utils';
import { Button, Spinner } from '@/components/ui/primitives';
import { Reveal, Panel } from './ui';
import { formatDuration } from './friendly';
import { messageUtilisateur } from '@/lib/erreurs';

const OP: Record<string, { label: string; cls: string }> = {
  PRECHECK: { label: 'Préflight', cls: 'bg-indigo-100 text-indigo-700' },
  DEPLOYMENT: { label: 'Déploiement', cls: 'bg-primary/10 text-primary' },
  ROLLBACK: { label: 'Restauration', cls: 'bg-amber-100 text-amber-700' },
  HEALTHCHECK: { label: 'Contrôle', cls: 'bg-slate-100 text-slate-600' },
  BACKUP: { label: 'Sauvegarde', cls: 'bg-slate-100 text-slate-600' },
};

const STATUS: Record<string, { icon: typeof CheckCircle2; cls: string; ring: string; label: string }> = {
  ok: { icon: CheckCircle2, cls: 'text-emerald-600', ring: 'bg-emerald-100 text-emerald-600', label: 'Publié' },
  error: { icon: XCircle, cls: 'text-red-600', ring: 'bg-red-100 text-red-600', label: 'Échec' },
  warning: { icon: AlertTriangle, cls: 'text-amber-600', ring: 'bg-amber-100 text-amber-600', label: 'Avertissement' },
  interrupted: { icon: AlertTriangle, cls: 'text-amber-600', ring: 'bg-amber-100 text-amber-600', label: 'Interrompu' },
  cancelled: { icon: XCircle, cls: 'text-slate-500', ring: 'bg-slate-100 text-slate-500', label: 'Annulé' },
  running: { icon: RotateCw, cls: 'text-blue-600', ring: 'bg-blue-100 text-blue-600', label: 'En cours' },
};

export function HistoryTimeline({ onBack, onViewReport }: { onBack: () => void; onViewReport: (runId: string) => void }) {
  const [runs, setRuns] = React.useState<DeploymentRunSummary[]>([]);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    try {
      setRuns(await api.deployment.listRuns());
    } catch (e) {
      toast.error(messageUtilisateur(e, 'Historique indisponible'));
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-5 flex items-center justify-between">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Accueil
        </button>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">Historique des publications</h2>
          <Button variant="ghost" size="sm" onClick={load}>
            <RotateCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner className="h-6 w-6" />
        </div>
      ) : runs.length === 0 ? (
        <Reveal>
          <Panel className="text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-foreground/60">
              <HistoryIcon className="h-6 w-6" />
            </div>
            <h3 className="mt-3 font-semibold">Aucune publication</h3>
            <p className="mt-1 text-sm text-muted-foreground">Vos mises en ligne apparaîtront ici, avec leur rapport.</p>
          </Panel>
        </Reveal>
      ) : (
        <ol className="relative space-y-3 before:absolute before:left-[19px] before:top-2 before:bottom-2 before:w-px before:bg-border">
          {runs.map((run, i) => {
            const s = STATUS[run.status] || STATUS.error;
            const Icon = s.icon;
            return (
              <Reveal key={run.id} delay={i * 0.03}>
                <li className="relative flex gap-4">
                  <span className={`z-10 mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-4 border-background ${s.ring}`}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <Panel className="flex-1 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${(OP[run.operationType] || OP.DEPLOYMENT).cls}`}>
                          {(OP[run.operationType] || OP.DEPLOYMENT).label}
                        </span>
                        <span className="font-semibold">{run.targetName}</span>
                        <span className="font-mono text-xs text-muted-foreground">{run.siteHost}</span>
                      </div>
                      <span className={`text-xs font-medium ${s.cls}`}>{s.label}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {run.version && (
                        <span className="inline-flex items-center gap-1">
                          <GitCommitHorizontal className="h-3.5 w-3.5" /> <span className="font-mono">{run.version}</span>
                        </span>
                      )}
                      <span>{formatDateTime(run.startedAt)}</span>
                      <span>{formatDuration(run.durationMs)}</span>
                      {run.finalStepId && <span>· {run.finalStepId}</span>}
                      {run.user && <span>· {run.user}</span>}
                    </div>
                    {run.summary && <p className="mt-1.5 text-xs text-muted-foreground">{run.summary}</p>}
                    <div className="mt-3">
                      <Button variant="outline" size="sm" onClick={() => onViewReport(run.id)}>
                        <FileText className="h-3.5 w-3.5" /> Voir le rapport
                      </Button>
                    </div>
                  </Panel>
                </li>
              </Reveal>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export default HistoryTimeline;
