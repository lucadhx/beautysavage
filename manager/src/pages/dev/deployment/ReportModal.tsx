/**
 * Rapport de déploiement — vue dédiée (modale). Pas la surface premium
 * principale : technique mais propre. Deux niveaux : synthèse et rapport complet.
 * Bouton « Copier le rapport » (Markdown complet, avec repli presse-papiers).
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { X, Copy as CopyIcon, Check, ExternalLink, Globe, MonitorSmartphone, Clock, GitCommitHorizontal, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { DeploymentRunFull } from '@/types';
import { Button, Spinner } from '@/components/ui/primitives';
import { formatDateTime } from '@/lib/utils';
import { useScrollLock } from '@/lib/scrollLock';
import { StatusDot, type StepState } from './ui';
import { formatDuration } from './friendly';
import { RunDiagnostics } from './RunDiagnostics';
import { messageUtilisateur } from '@/lib/erreurs';

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  ok: { label: 'Réussi', cls: 'bg-emerald-100 text-emerald-700' },
  error: { label: 'Échec', cls: 'bg-red-100 text-red-700' },
  warning: { label: 'Avertissement', cls: 'bg-amber-100 text-amber-700' },
  cancelled: { label: 'Annulé', cls: 'bg-slate-100 text-slate-600' },
  interrupted: { label: 'Interrompu', cls: 'bg-amber-100 text-amber-700' },
  running: { label: 'En cours', cls: 'bg-blue-100 text-blue-700' },
};

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export function ReportModal({ runId, onClose }: { runId: string; onClose: () => void }) {
  const reduce = useReducedMotion();
  const [run, setRun] = React.useState<DeploymentRunFull | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [tab, setTab] = React.useState<'summary' | 'technical'>('summary');
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.deployment.getRun(runId);
        if (alive) setRun(r);
      } catch (e) {
        toast.error(messageUtilisateur(e, 'Rapport indisponible'));
        onClose();
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [runId, onClose]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Monté seulement quand la modale est ouverte : le verrou vit tant qu'elle vit.
  useScrollLock(true);

  const copy = async () => {
    if (!run?.markdownReport) return;
    const ok = await copyText(run.markdownReport);
    if (ok) {
      setCopied(true);
      toast.success('Rapport copié — collez-le dans Claude Code.');
      setTimeout(() => setCopied(false), 1600);
    } else {
      toast.error('Copie impossible. Sélectionnez le texte manuellement dans l’onglet « Rapport complet ».');
      setTab('technical');
    }
  };

  const st = run ? STATUS_LABEL[run.status] || STATUS_LABEL.error : null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Rapport de déploiement">
      <motion.div className="absolute inset-0 bg-black/40 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div
        className="relative flex max-h-[calc(var(--m-viewport-h)-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border/70 bg-card shadow-2xl"
        initial={reduce ? false : { opacity: 0, scale: 0.98, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={reduce ? undefined : { opacity: 0, scale: 0.98 }}
      >
        {/* En-tête */}
        <div className="flex items-start justify-between gap-3 border-b border-border/70 p-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">{run?.operationType === 'PRECHECK' ? 'Rapport de préflight' : 'Rapport de déploiement'}</h2>
              {st && <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>}
            </div>
            {run && (
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {run.targetName} · {run.siteHost} · {formatDateTime(run.startedAt)} · {formatDuration(run.durationMs)}
                {run.finalStepId ? ` · étape finale : ${run.finalStepId}` : ''}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={copy} disabled={!run?.markdownReport}>
              {copied ? <Check className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />} Copier le rapport
            </Button>
            <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted" aria-label="Fermer">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Onglets */}
        <div className="flex gap-1 border-b border-border/70 px-5 pt-3">
          {(['summary', 'technical'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-t-lg px-3 py-1.5 text-sm font-medium ${tab === t ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {t === 'summary' ? 'Synthèse' : 'Rapport complet'}
            </button>
          ))}
        </div>

        {/* Contenu */}
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-5">
          {loading ? (
            <div className="flex justify-center py-10">
              <Spinner className="h-6 w-6" />
            </div>
          ) : !run ? null : tab === 'summary' ? (
            <SummaryView run={run} />
          ) : (
            <pre className="whitespace-pre-wrap break-words rounded-xl border border-border/70 bg-muted/30 p-4 font-mono text-[11px] leading-relaxed">
              {run.markdownReport || '(rapport indisponible)'}
            </pre>
          )}
        </div>
      </motion.div>
    </div>,
    document.body
  );
}

function SummaryView({ run }: { run: DeploymentRunFull }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <a href={run.siteUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-xl border border-border/70 px-3 py-2 hover:bg-muted/40">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs">{run.siteUrl}</span>
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
        </a>
        <a href={run.managerUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-xl border border-border/70 px-3 py-2 hover:bg-muted/40">
          <MonitorSmartphone className="h-4 w-4 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs">{run.managerUrl}</span>
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
        </a>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {run.version && (
          <span className="inline-flex items-center gap-1">
            <GitCommitHorizontal className="h-3.5 w-3.5" /> <span className="font-mono">{run.version}</span>
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" /> {formatDuration(run.durationMs)}
        </span>
        <span>{run.sshUser}@{run.sshHost}</span>
      </div>

      {run.errorSummary?.message && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <div className="font-medium">Erreur principale</div>
          <p className="mt-0.5">{run.errorSummary.message}</p>
          {run.errorSummary.code && <p className="mt-0.5 font-mono text-xs">{run.errorSummary.code}{run.errorSummary.step ? ` · ${run.errorSummary.step}` : ''}</p>}
        </div>
      )}

      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Étapes</div>
        <div className="space-y-0.5">
          {(run.steps || []).map((s) => (
            <div key={s.id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm">
              {s.status === 'running' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <StatusDot state={s.status as StepState} />}
              <span className={s.status === 'error' ? 'text-red-700' : ''}>{s.label}</span>
              {s.durationMs != null && <span className="text-xs text-muted-foreground">· {formatDuration(s.durationMs)}</span>}
              {s.errorCode && <span className="font-mono text-xs text-red-600">· {s.errorCode}</span>}
            </div>
          ))}
        </div>
      </div>

      {/*
        DIAGNOSTIC TECHNIQUE — tout ce qui a été enregistré pendant l'opération.

        Placé APRÈS les étapes : on lit d'abord ce qui s'est passé, puis
        pourquoi. Un journal brut en tête de rapport noierait le résumé que la
        plupart des consultations cherchent.
      */}
      <RunDiagnostics run={run} />
    </div>
  );
}

export default ReportModal;
