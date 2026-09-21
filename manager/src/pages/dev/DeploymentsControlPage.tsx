/**
 * Système → Déploiements (P2.10) — page MINIMALE de consultation du plan de
 * contrôle. Liste les destinations durables (indépendantes de l'ENV local),
 * avec statut, santé, release active, commit, et actions sûres (ouvrir les URLs,
 * relancer le healthcheck). Le rollback/update piloté arrive en P3.
 */
import * as React from 'react';
import { motion } from 'framer-motion';
import { Server, ExternalLink, Activity, RefreshCw, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { ControlTarget, VersionInfo } from '@/types';
import { Button } from '@/components/ui/primitives';
import { messageUtilisateur } from '@/lib/erreurs';

const HEALTH_COLORS: Record<string, string> = {
  HEALTHY: 'bg-emerald-500/15 text-emerald-600',
  DEGRADED: 'bg-amber-500/15 text-amber-600',
  UNREACHABLE: 'bg-red-500/15 text-red-600',
  UNKNOWN: 'bg-muted text-muted-foreground',
};

export default function DeploymentsControlPage() {
  const [targets, setTargets] = React.useState<ControlTarget[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [checking, setChecking] = React.useState<string | null>(null);
  const [version, setVersion] = React.useState<VersionInfo | null>(null);

  React.useEffect(() => {
    api.getVersion().then(setVersion).catch(() => setVersion(null));
  }, []);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      setTargets(await api.controlPlane.listTargets());
    } catch (e) {
      setError(messageUtilisateur(e, 'Erreur de chargement.'));
      setTargets([]);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const recheck = async (id: string) => {
    setChecking(id);
    try {
      await api.controlPlane.checkHealth(id);
      await load();
    } catch {
      /* ignore : la liste reste affichée */
    } finally {
      setChecking(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <header className="flex items-center gap-3">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Server className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Déploiements — destinations</h1>
          <p className="text-sm text-muted-foreground">
            Plan de contrôle durable, indépendant de l'environnement local du moteur.
          </p>
        </div>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" /> Rafraîchir
        </Button>
      </header>

      {version && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Version locale</span>
          <span>Branche : <b className="font-mono text-foreground">{version.branch || '—'}</b></span>
          <span>Commit : <b className="font-mono text-foreground">{version.shortCommit || '—'}</b>{version.isDirty && <span className="ml-1 text-amber-600">(dirty)</span>}</span>
          {version.builtAt && <span>Build : <b className="text-foreground">{new Date(version.builtAt).toLocaleString()}</b></span>}
          <span className="opacity-60">({version.source})</span>
        </div>
      )}

      {error && <p className="rounded-lg bg-red-500/[0.06] px-4 py-3 text-sm text-red-600">{error}</p>}

      {targets === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
        </div>
      ) : targets.length === 0 && !error ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Aucune destination enregistrée pour l'instant.
        </p>
      ) : (
        <div className="space-y-3">
          {targets.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border bg-card p-4"
            >
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-semibold">
                    {t.name}
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium uppercase">{t.targetEnvironment}</span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{t.siteHostname}</p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${HEALTH_COLORS[t.healthStatus] || HEALTH_COLORS.UNKNOWN}`}>
                    {t.healthStatus}
                  </span>
                  <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium">{t.status}</span>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground md:grid-cols-4">
                <span>Version : <b className="text-foreground">{t.currentVersion || '—'}</b></span>
                <span>Commit : <b className="font-mono text-foreground">{t.currentCommit || '—'}</b></span>
                <span>Port : <b className="text-foreground">{t.backendPort}</b></span>
                <span>Dernier déploiement : <b className="text-foreground">{t.lastSuccessfulDeploymentAt ? new Date(t.lastSuccessfulDeploymentAt).toLocaleString() : '—'}</b></span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <a href={t.siteUrl} target="_blank" rel="noreferrer"><Button variant="outline" size="sm"><ExternalLink className="h-3.5 w-3.5" /> Vitrine</Button></a>
                <a href={t.managerUrl} target="_blank" rel="noreferrer"><Button variant="outline" size="sm"><ExternalLink className="h-3.5 w-3.5" /> Manager</Button></a>
                <a href={`${t.apiUrl}/health`} target="_blank" rel="noreferrer"><Button variant="outline" size="sm"><ExternalLink className="h-3.5 w-3.5" /> API</Button></a>
                <Button variant="ghost" size="sm" onClick={() => void recheck(t.id)} disabled={checking === t.id}>
                  {checking === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />} Healthcheck
                </Button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
