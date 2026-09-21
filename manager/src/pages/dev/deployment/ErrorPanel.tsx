/**
 * Panneau d'erreur « métier » : jamais de stack, jamais de commande Linux.
 * Titre rassurant + cause + solution + Réessayer. Les détails techniques
 * restent disponibles, repliés par défaut.
 */
import * as React from 'react';
import { AlertTriangle, RotateCw, ArrowLeft, Lightbulb, FileText } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { Panel, DetailsDisclosure, Reveal } from './ui';
import { humanizeError } from './friendly';

export function ErrorPanel({
  code,
  message,
  step,
  technical,
  onRetry,
  onBack,
  onViewReport,
}: {
  code?: string;
  message?: string;
  step?: string | null;
  technical?: React.ReactNode;
  onRetry?: () => void;
  onBack?: () => void;
  onViewReport?: () => void;
}) {
  const err = humanizeError(code, message);
  return (
    <Reveal>
      <Panel className="mx-auto max-w-xl text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-100 text-red-600">
          <AlertTriangle className="h-7 w-7" />
        </div>
        <h2 className="mt-4 text-xl font-semibold tracking-tight">{err.title}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{err.cause}</p>

        <div className="mt-4 flex items-start gap-2 rounded-xl bg-muted/50 p-3 text-left text-sm">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <span>{err.solution}</span>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {onBack && (
            <Button variant="ghost" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" /> Retour
            </Button>
          )}
          {onViewReport && (
            <Button variant="outline" onClick={onViewReport}>
              <FileText className="h-4 w-4" /> Voir le rapport
            </Button>
          )}
          {onRetry && (
            <Button onClick={onRetry}>
              <RotateCw className="h-4 w-4" /> Réessayer
            </Button>
          )}
        </div>

        {(technical || code) && (
          <DetailsDisclosure>
            <div className="text-left">
              {code && (
                <div>
                  code : <span className="text-foreground">{code}</span>
                  {step ? ` · étape : ${step}` : ''}
                </div>
              )}
              {message && <div className="mt-1 break-words">{message}</div>}
              {technical}
            </div>
          </DetailsDisclosure>
        )}
      </Panel>
    </Reveal>
  );
}

export default ErrorPanel;
