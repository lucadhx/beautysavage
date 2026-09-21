/**
 * Écran de SUCCÈS premium : illustration, confettis légers, informations utiles.
 * Vitrine ET Manager. Accès au rapport technique conservé.
 */
import { ExternalLink, ShieldCheck, GitCommitHorizontal, CalendarClock, Timer, ArrowLeft, RefreshCw, Globe, MonitorSmartphone, FileText } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { formatDateTime } from '@/lib/utils';
import { Panel, Reveal, StatTile } from './ui';
import { SuccessArt } from './illustrations';
import { Confetti } from './Confetti';
import { formatDuration } from './friendly';

export function SuccessScreen({
  siteUrl,
  managerUrl,
  version,
  durationMs,
  runId,
  onBack,
  onRedeploy,
  onViewReport,
}: {
  siteUrl: string;
  managerUrl: string;
  version: string;
  durationMs: number | null;
  runId: string | null;
  onBack: () => void;
  onRedeploy: () => void;
  onViewReport: (runId: string) => void;
}) {
  return (
    <div className="relative">
      <Confetti />
      <Reveal>
        <Panel className="mx-auto max-w-xl text-center">
          <div className="mx-auto text-emerald-500">
            <SuccessArt className="h-24 w-24" />
          </div>
          <h2 className="mt-2 text-2xl font-bold tracking-tight">Votre site est en ligne</h2>
          <p className="mt-1 text-sm text-muted-foreground">La publication s’est terminée avec succès.</p>

          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <a href={siteUrl} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background">
              <Globe className="h-4 w-4" /> Ouvrir le site <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <a href={managerUrl} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background">
              <MonitorSmartphone className="h-4 w-4" /> Ouvrir le Manager <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <StatTile label="Sécurité" value={<span className="text-emerald-600">HTTPS actif</span>} icon={ShieldCheck} />
            <StatTile label="Version" value={<span className="font-mono">{version}</span>} icon={GitCommitHorizontal} />
            <StatTile label="Date" value={formatDateTime(new Date().toISOString())} icon={CalendarClock} />
            <StatTile label="Durée" value={formatDuration(durationMs)} icon={Timer} />
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <Button variant="ghost" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" /> Retour
            </Button>
            {runId && (
              <Button variant="outline" onClick={() => onViewReport(runId)}>
                <FileText className="h-4 w-4" /> Voir le rapport
              </Button>
            )}
            <Button onClick={onRedeploy}>
              <RefreshCw className="h-4 w-4" /> Déployer une nouvelle version
            </Button>
          </div>
        </Panel>
      </Reveal>
    </div>
  );
}

export default SuccessScreen;
