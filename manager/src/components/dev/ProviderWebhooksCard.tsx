import * as React from 'react';
import { Webhook, RefreshCw, Wrench, Activity, ClipboardCopy, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Spinner } from '@/components/ui/primitives';
import { useResource, useAction } from '@/hooks/useResource';
import { api } from '@/lib/api';
import type { ManagedWebhookDescriptor, ProviderMode, ProviderWebhooksEntry, WebhookRunReport } from '@/types';

/**
 * Webhooks des intégrations — vue GÉNÉRIQUE multi-providers.
 *
 * Ce composant ne connaît AUCUN fournisseur : il rend ce que le registre des
 * drivers décrit (0, 1 ou plusieurs webhooks par provider). Un provider ajouté
 * côté backend apparaît ici sans modifier une ligne de ce fichier.
 *
 * Les URLs sont RÉSOLUES automatiquement (ngrok en dev, domaine déployé en
 * PROD) et affichées en lecture seule : personne ne saisit une URL de webhook.
 */

const MODES: ProviderMode[] = ['TEST', 'PROD'];

const UNSUPPORTED_HINT =
  "L'API de ce fournisseur ne permet pas cette action — configuration au dashboard du fournisseur.";

/** Libellé + couleur d'un statut distant, sans vocabulaire de fournisseur. */
function statusBadge(w: ManagedWebhookDescriptor): { label: string; className: string } {
  // Vocabulaire UNIFORME, identique pour tous les providers (LOT états).
  if (!w.supportsRemoteSync) return { label: 'Géré au dashboard', className: 'bg-slate-100 text-slate-600' };
  switch (w.remoteStatus) {
    case 'CONFIGURED':
      return { label: 'Synchronisé', className: 'bg-emerald-100 text-emerald-700' };
    case 'OUT_OF_SYNC':
      return { label: 'Synchronisation nécessaire', className: 'bg-amber-100 text-amber-700' };
    case 'ERROR':
      return { label: 'Erreur', className: 'bg-red-100 text-red-700' };
    default:
      return { label: 'Webhook absent', className: 'bg-slate-100 text-slate-600' };
  }
}

/** Résumé lisible d'un rapport d'action — jamais de secret, jamais de JSON brut. */
function reportSummary(report: { skipped?: boolean; reason?: string; results: Array<Record<string, unknown>> }): string {
  if (report.skipped) return `Non applicable (${report.reason}).`;
  const parts: string[] = [];
  for (const r of report.results) {
    if (r.skipped) { parts.push(`ignoré (${r.reason})`); continue; }
    if (r.ok === false && r.error) { parts.push(`échec (${(r.error as { code?: string }).code})`); continue; }
    const bits: string[] = [];
    if (r.created) bits.push('webhook créé');
    if (r.updated) bits.push('mis à jour');
    if (typeof r.deletedDuplicates === 'number' && r.deletedDuplicates > 0) bits.push(`${r.deletedDuplicates} doublon(s) supprimé(s)`);
    if (r.secretCaptured) bits.push('secret enregistré');
    if (typeof r.reachable === 'boolean') bits.push(r.reachable ? 'joignable' : 'injoignable');
    if (typeof r.remoteOk === 'boolean') bits.push(r.remoteOk ? 'conforme' : 'non conforme');
    parts.push(bits.length ? bits.join(', ') : 'déjà conforme');
  }
  return parts.join(' · ') || 'Aucun webhook.';
}

const ACTION_LABELS: Record<WebhookRunReport['action'], string> = {
  sync: 'Synchroniser',
  repair: 'Réparer',
  test: 'Tester',
};

const RUN_STATUS_BADGE: Record<WebhookRunReport['status'], { label: string; className: string }> = {
  SUCCESS: { label: 'Réussite', className: 'bg-emerald-100 text-emerald-700' },
  FAILED: { label: 'Échec', className: 'bg-red-100 text-red-700' },
  SKIPPED: { label: 'Non applicable', className: 'bg-slate-100 text-slate-600' },
};

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

/** Copie le rapport texte complet (secrets déjà masqués côté backend). */
async function copyReportText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* repli ci-dessous */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Dernier rapport d'exécution PERSISTÉ du provider : état, dates, durée,
 * dernière erreur — et « Copier le rapport » (texte complet exploitable).
 */
function LastRunReport({
  report,
  lastAttemptAt,
  lastSuccessAt,
}: {
  report: WebhookRunReport;
  lastAttemptAt?: string | null;
  lastSuccessAt?: string | null;
}) {
  const [copied, setCopied] = React.useState(false);
  const badge = RUN_STATUS_BADGE[report.status] ?? RUN_STATUS_BADGE.FAILED;

  const onCopy = async () => {
    const ok = await copyReportText(report.text || '');
    if (ok) {
      setCopied(true);
      toast.success('Rapport copié dans le presse-papiers');
      setTimeout(() => setCopied(false), 2500);
    } else {
      toast.error('Copie impossible — sélectionnez le texte manuellement');
    }
  };

  return (
    <div className="mt-2 rounded-md border border-border bg-muted/30 p-2.5 text-xs">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">Dernier rapport</span>
          <Badge className={badge.className}>{badge.label}</Badge>
          <span className="text-muted-foreground">
            {ACTION_LABELS[report.action] ?? report.action} · {report.mode} · {formatDateTime(report.finishedAt)} ·{' '}
            {report.durationMs} ms
          </span>
        </div>
        <Button size="sm" variant="outline" onClick={onCopy}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />} Copier le rapport
        </Button>
      </div>
      <div className="grid gap-x-4 gap-y-0.5 text-muted-foreground sm:grid-cols-2">
        <span>Dernière tentative : {formatDateTime(lastAttemptAt ?? report.finishedAt)}</span>
        <span>Dernière réussite : {formatDateTime(lastSuccessAt)}</span>
        {report.error && (
          <span className="sm:col-span-2 text-red-700">
            Dernière erreur : {report.error.code || 'ERREUR'}
            {report.error.message ? ` — ${report.error.message}` : ''}
          </span>
        )}
        {report.status !== 'SUCCESS' && report.diagnostic && (
          <span className="sm:col-span-2">Diagnostic : {report.diagnostic}</span>
        )}
        {report.status !== 'SUCCESS' && report.suggestedFix && (
          <span className="sm:col-span-2">Correction suggérée : {report.suggestedFix}</span>
        )}
      </div>
    </div>
  );
}

function ProviderBlock({
  entry,
  mode,
  onAction,
  pending,
}: {
  entry: ProviderWebhooksEntry;
  mode: ProviderMode;
  onAction: (kind: 'sync' | 'repair' | 'test', provider: string) => void;
  pending: boolean;
}) {
  const caps = entry.capabilities;
  const canSync = entry.supportsWebhooks && (caps ? caps.createWebhook || caps.updateWebhook : true);
  const canRepair = entry.supportsWebhooks && (caps ? caps.repairWebhook : true);
  const canTest = entry.supportsWebhooks && (caps ? Boolean(caps.testWebhook) : true);
  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          {entry.provider}
          <span className="text-xs font-normal text-muted-foreground">
            {entry.webhooks.length} webhook{entry.webhooks.length > 1 ? 's' : ''}
          </span>
        </div>
        {/* MÊMES boutons pour TOUS les providers : une capacité absente
            désactive le bouton avec une explication — jamais une UI différente. */}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm" variant="outline"
            disabled={pending || !canSync}
            title={canSync ? undefined : UNSUPPORTED_HINT}
            onClick={() => onAction('sync', entry.provider)}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Synchroniser
          </Button>
          <Button
            size="sm" variant="outline"
            disabled={pending || !canRepair}
            title={canRepair ? undefined : UNSUPPORTED_HINT}
            onClick={() => onAction('repair', entry.provider)}
          >
            <Wrench className="h-3.5 w-3.5" /> Réparer
          </Button>
          <Button
            size="sm" variant="outline"
            disabled={pending || !canTest}
            title={canTest ? undefined : UNSUPPORTED_HINT}
            onClick={() => onAction('test', entry.provider)}
          >
            <Activity className="h-3.5 w-3.5" /> Tester
          </Button>
        </div>
      </div>

      {entry.lastRunReport && (
        <LastRunReport
          report={entry.lastRunReport}
          lastAttemptAt={entry.lastAttemptAt}
          lastSuccessAt={entry.lastSuccessAt}
        />
      )}

      {entry.error ? (
        <p className="text-xs text-red-600">Indisponible : {entry.error.message || entry.error.code}</p>
      ) : (
        <ul className="space-y-2">
          {entry.webhooks.map((w) => {
            const badge = statusBadge(w);
            return (
              <li key={`${w.provider}-${w.category}-${mode}`} className="rounded bg-muted/40 px-2.5 py-2 text-xs">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="font-medium">{w.category}</span>
                  <Badge className={badge.className}>{badge.label}</Badge>
                  {w.lastSyncAt && (
                    <span className="text-muted-foreground">
                      Dernier sync : {new Date(w.lastSyncAt).toLocaleString()}
                    </span>
                  )}
                </div>
                {w.expectedUrl ? (
                  <p className="break-all text-muted-foreground">
                    URL calculée : <span className="font-mono">{w.expectedUrl}</span>
                  </p>
                ) : (
                  <p className="text-amber-700">
                    URL publique indisponible — démarrez ngrok (TEST) ou déployez (PROD).
                  </p>
                )}
                <p className="text-muted-foreground">
                  {w.lastReceivedEventAt
                    ? `Dernier événement : ${w.lastReceivedEventType || 'reçu'} · ${new Date(w.lastReceivedEventAt).toLocaleString()}`
                    : 'Aucun événement reçu pour le moment.'}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function ProviderWebhooksCard() {
  const [mode, setMode] = React.useState<ProviderMode>('TEST');
  const { data, loading, reload } = useResource(() => api.getManagedWebhooks(mode), [mode]);
  const action = useAction();

  const [lastReport, setLastReport] = React.useState<string | null>(null);
  const onAction = async (kind: 'sync' | 'repair' | 'test', provider: string) => {
    const call =
      kind === 'sync'
        ? () => api.syncProviderWebhooks(provider, mode)
        : kind === 'repair'
          ? () => api.repairProviderWebhooks(provider, mode)
          : () => api.testProviderWebhooks(provider, mode);
    try {
      const report = await action.run(call, {
        success:
          kind === 'sync' ? 'Synchronisation effectuée' : kind === 'repair' ? 'Réparation effectuée' : 'Test effectué',
      });
      setLastReport(`${provider} (${mode}) — ${reportSummary(report)}`);
    } catch {
      /* toast déjà remonté */
    }
    reload();
  };

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Webhook className="h-4 w-4" /> Webhooks des intégrations
        </CardTitle>
        <div className="flex gap-1">
          {MODES.map((m) => (
            <Button key={m} size="sm" variant={mode === m ? 'default' : 'outline'} onClick={() => setMode(m)}>
              {m}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          Les URLs sont calculées automatiquement à partir du domaine public du backend — rien à saisir. Chaque
          fournisseur gère ses propres webhooks ; ceux marqués « Géré au dashboard » se configurent chez le
          fournisseur avec l'URL affichée.
        </p>
        {lastReport && (
          <p className="mb-3 rounded bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">{lastReport}</p>
        )}
        {loading ? (
          <Spinner className="h-4 w-4" />
        ) : (
          <div className="space-y-3">
            {(data?.providers ?? []).map((entry) => (
              <ProviderBlock key={entry.provider} entry={entry} mode={mode} onAction={onAction} pending={action.pending} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default ProviderWebhooksCard;
