/**
 * DIAGNOSTIC TECHNIQUE D'UN RUN — ce qui rend un incident lisible sans terminal.
 *
 * ══ CE QU'IL REMPLACE ═══════════════════════════════════════════════════════
 *
 * Diagnostiquer le déploiement du 06/08 a exigé un accès SSH, `pm2 logs`, une
 * lecture directe de Mongo et une reproduction locale. Trois questions n'ont
 * jamais pu être tranchées faute de trace. Ce bloc donne accès, depuis
 * l'interface, à tout ce qui a été enregistré pendant l'opération.
 *
 * ══ POURQUOI UN FILTRE PAR SOURCE ═══════════════════════════════════════════
 *
 * Un journal complet mélange la requête HTTP, la connexion SSH, le service
 * PM2, les sockets et la finalisation. Cherché sans filtre, il noie la ligne
 * qui compte. On lit rarement « tout » : on lit « ce que PM2 a fait », ou
 * « pourquoi la connexion a échoué ».
 */
import * as React from 'react';
import { AlertTriangle, ChevronDown, ClipboardCheck, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { DeploymentRunFull } from '@/types';

const SOURCES = ['Tous', 'HTTP', 'ENGINE', 'SSH', 'PM2', 'SOCKET', 'FINALIZATION', 'SYSTEM'] as const;
type Source = typeof SOURCES[number];

const ETIQUETTE: Record<string, string> = {
  Tous: 'Tous',
  HTTP: 'HTTP',
  ENGINE: 'Moteur',
  SSH: 'SSH',
  PM2: 'PM2',
  SOCKET: 'Socket',
  FINALIZATION: 'Finalisation',
  SYSTEM: 'Système',
};

const TON: Record<string, string> = {
  debug: 'text-muted-foreground',
  info: 'text-foreground',
  warning: 'text-amber-700',
  error: 'text-red-700',
};

const heure = (v: string) => {
  try {
    return new Date(v).toISOString().slice(11, 23);
  } catch {
    return String(v);
  }
};

export function RunDiagnostics({ run }: { run: DeploymentRunFull }) {
  const [source, setSource] = React.useState<Source>('Tous');
  const [ouverte, setOuverte] = React.useState<number | null>(null);
  const [copie, setCopie] = React.useState(false);

  const journal = run.journal ?? [];
  const lignes = source === 'Tous' ? journal : journal.filter((e) => e.source === source);

  /** Combien d'entrées par source — un filtre vide se voit avant d'être cliqué. */
  const compte = React.useMemo(() => {
    const c: Record<string, number> = { Tous: journal.length };
    for (const e of journal) c[e.source] = (c[e.source] ?? 0) + 1;
    return c;
  }, [journal]);

  /**
   * LE RAPPORT MARKDOWN.
   *
   * Construit à partir du run DÉJÀ nettoyé : les entrées ont traversé le
   * sanitizer au moment de leur écriture, côté serveur. Nettoyer une seconde
   * fois ici laisserait croire que la base contient des secrets — elle n'en
   * contient pas, et c'est là que la garantie doit être tenue, pas dans un
   * composant d'affichage qu'on peut oublier de mettre à jour.
   */
  const rapport = React.useCallback(() => {
    const f = run.finalization;
    const l: string[] = [
      `# Rapport de diagnostic — ${run.targetName ?? 'destination'}`,
      '',
      '## Contexte',
      `- run : ${run.id}`,
      `- opération : ${run.operationType}`,
      `- statut final : ${run.status}`,
      `- destination : ${run.siteHost ?? '—'}`,
      `- environnement : ${(run as { env?: string }).env ?? '—'}`,
      `- version : ${run.version ?? '—'}`,
      `- démarré : ${run.startedAt}`,
      `- terminé : ${run.finishedAt ?? 'jamais'}`,
      `- durée : ${run.durationMs ? `${Math.round(run.durationMs / 1000)} s` : '—'}`,
      `- étape finale : ${run.finalStepId ?? '—'}`,
      '',
      '## Étapes',
      ...(run.steps ?? []).map((s) => `- ${s.status.padEnd(11)} ${s.id}${s.durationMs ? ` (${s.durationMs} ms)` : ''}${s.errorCode ? ` — ${s.errorCode}` : ''}`),
      '',
      '## Finalisation',
      f
        ? `- vérifiée : ${f.succeeded ? 'OUI' : 'NON'}\n- état destination : ${f.targetState ?? '—'}${f.error ? `\n- manquant : ${f.error}` : ''}`
        : '- non vérifiée (préflight ou opération sans finalisation)',
      '',
      '## Journal',
      ...journal.map((e) => {
        const base = `- ${heure(e.at)} [${e.source}] ${e.eventCode}${e.stepId ? ` (${e.stepId})` : ''} : ${e.message ?? ''}`;
        const meta = [
          e.pid ? `pid=${e.pid}` : null,
          e.port ? `port=${e.port}` : null,
          e.processName ? `process=${e.processName}` : null,
          e.errorCode ? `code=${e.errorCode}` : null,
        ].filter(Boolean).join(' ');
        return meta ? `${base}\n    ${meta}` : base;
      }),
      '',
      '## Erreur finale',
      run.errorSummary ? `- ${run.errorSummary.code ?? '—'} : ${run.errorSummary.message ?? '—'}` : '- aucune',
    ];
    return l.join('\n');
  }, [run, journal]);

  const copier = async () => {
    try {
      await navigator.clipboard.writeText(rapport());
      setCopie(true);
      toast.success('Rapport copié.');
      setTimeout(() => setCopie(false), 2500);
    } catch {
      toast.error('Copie impossible — sélectionnez le texte manuellement.');
    }
  };

  if (journal.length === 0) {
    return (
      <div className="rounded-2xl border border-border/70 bg-card p-5">
        <h3 className="text-sm font-semibold">Diagnostic technique</h3>
        <p className="mt-2 text-xs text-muted-foreground">
          Aucune trace pour ce run. Les opérations antérieures à l’instrumentation
          n’en portent pas — les suivantes en auront.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border/70 bg-card p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Diagnostic technique</h3>
          <p className="text-xs text-muted-foreground">
            {journal.length} évènement(s) enregistré(s) pendant l’opération.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void copier()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-muted"
        >
          {copie ? <ClipboardCheck className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          Copier le rapport diagnostic
        </button>
      </div>

      {/* — EN-TÊTE TECHNIQUE — ce qu'on regarde avant de lire le journal. */}
      <dl className="mb-4 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
        {([
          ['Run', run.id],
          ['Destination', run.siteHost ?? '—'],
          ['Environnement', (run as { env?: string }).env ?? '—'],
          ['Version', run.version ?? '—'],
          ['Statut final', run.status],
          ['Étape finale', run.finalStepId ?? '—'],
          ['Durée', run.durationMs ? `${Math.round(run.durationMs / 1000)} s` : '—'],
          ['Finalisation', run.finalization
            ? (run.finalization.succeeded ? 'vérifiée' : `NON — ${run.finalization.error ?? ''}`)
            : 'non applicable'],
        ] as Array<[string, string]>).map(([cle, valeur]) => (
          <div key={cle} className="flex justify-between gap-3 border-b border-border/40 py-1">
            <dt className="text-muted-foreground">{cle}</dt>
            <dd className="truncate text-right font-medium">{valeur}</dd>
          </div>
        ))}
      </dl>

      {/* — FILTRES — */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {SOURCES.filter((s) => s === 'Tous' || compte[s]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSource(s)}
            className={cn(
              'rounded-full px-2.5 py-1 text-xs font-medium transition',
              source === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground',
            )}
          >
            {ETIQUETTE[s] ?? s} {compte[s] ? <span className="opacity-70">({compte[s]})</span> : null}
          </button>
        ))}
      </div>

      {/* — TIMELINE — */}
      <ol className="max-h-[28rem] space-y-0.5 overflow-y-auto overscroll-contain rounded-lg border border-border/50 p-2">
        {lignes.map((e, i) => {
          const detaillable = Boolean(e.details || e.stack || e.errorCode);
          return (
            <li key={`${e.at}-${i}`} className="text-xs">
              <button
                type="button"
                disabled={!detaillable}
                onClick={() => setOuverte(ouverte === i ? null : i)}
                className={cn(
                  'flex w-full items-start gap-2 rounded px-1.5 py-1 text-left',
                  detaillable && 'hover:bg-muted',
                )}
              >
                <span className="shrink-0 font-mono text-muted-foreground">{heure(e.at)}</span>
                <span className="w-20 shrink-0 font-medium text-muted-foreground">{ETIQUETTE[e.source] ?? e.source}</span>
                <span className={cn('min-w-0 flex-1', TON[e.level] ?? '')}>
                  {(e.level === 'error' || e.level === 'warning') && (
                    <AlertTriangle className="mr-1 inline h-3 w-3 align-[-2px]" />
                  )}
                  <span className="font-mono">{e.eventCode}</span>
                  {e.stepId && <span className="text-muted-foreground"> · {e.stepId}</span>}
                  {e.message && <span className="block text-muted-foreground">{e.message}</span>}
                </span>
                {detaillable && (
                  <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition', ouverte === i && 'rotate-180')} />
                )}
              </button>

              {ouverte === i && detaillable && (
                <div className="ml-6 mb-1 space-y-1 rounded bg-muted/60 p-2">
                  {e.errorCode && (
                    <p><span className="text-muted-foreground">code :</span> <span className="font-mono">{e.errorCode}</span></p>
                  )}
                  {/*
                    FAIT OBSERVÉ ET CAUSE DÉDUITE — jamais mélangés.

                    Une coupure de flux porte les deux : ce qu'on a VU, et ce
                    qu'on en conclut. Les afficher pêle-mêle dans un JSON brut
                    fait lire la déduction comme une observation — et c'est
                    exactement la confusion qui a coûté un diagnostic entier.
                    Quand la cause n'est PAS certaine, on le dit ici.
                  */}
                  {deduction(e) ? (
                    <div className="space-y-1 rounded border border-border/60 p-1.5">
                      <p>
                        <span className="text-muted-foreground">cause déduite :</span>{' '}
                        <span className="font-mono">{deduction(e)!.cause}</span>{' '}
                        <span className={deduction(e)!.certain ? 'text-muted-foreground' : 'font-medium'}>
                          {deduction(e)!.certain ? '(établie par les faits)' : '(NON établie — hypothèse)'}
                        </span>
                      </p>
                      <p className="text-muted-foreground">faits observés :</p>
                      <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px]">
                        {JSON.stringify(deduction(e)!.faits, null, 2)}
                      </pre>
                    </div>
                  ) : null}
                  {e.details ? (
                    <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px]">
                      {JSON.stringify(e.details, null, 2)}
                    </pre>
                  ) : null}
                  {e.stack && (
                    <details>
                      <summary className="cursor-pointer text-muted-foreground">pile d’appel</summary>
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px]">{e.stack}</pre>
                    </details>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * La déduction portée par une entrée, si elle en porte une.
 *
 * Seules les entrées de coupure de flux en ont : on ne fabrique rien pour les
 * autres, et une entrée sans cause déduite reste affichée telle quelle.
 */
function deduction(e: NonNullable<DeploymentRunFull['journal']>[number]): { cause: string; certain: boolean; faits: unknown } | null {
  const d = e.details as Record<string, unknown> | null | undefined;
  if (!d || typeof d !== 'object' || !('causeDeduite' in d)) return null;
  return {
    cause: String(d.causeDeduite),
    certain: d.certain === true,
    faits: d.faits ?? null,
  };
}

export default RunDiagnostics;
