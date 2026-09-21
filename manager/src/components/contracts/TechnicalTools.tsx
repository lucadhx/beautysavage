import * as React from 'react';
import { Wrench, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { CollapsibleCard } from '@/components/contracts/CollapsibleCard';
import { formatDateTime } from '@/lib/utils';

/**
 * « Diagnostic et synchronisation » — outils de RÉCONCILIATION réservés au DEV.
 *
 * Ces actions interrogent le fournisseur (paiement, signature) pour réaligner l'état
 * local quand un webhook a été manqué, retardé, ou qu'une opération a été faite
 * directement dans le back-office du fournisseur. Elles **ne créent jamais rien** :
 * aucun paiement, aucun abonnement, aucune demande de signature.
 *
 * Elles vivent donc dans une section REPLIÉE par défaut, à l'écart des CTA
 * contractuels : à côté d'« Activer » ou « Payer », un bouton « Synchroniser »
 * se lit comme une action métier, alors que c'est un outil de dépannage.
 */

export function TechnicalTools({ children }: { children: React.ReactNode }) {
  return (
    <CollapsibleCard
      icon={Wrench}
      title="Diagnostic et synchronisation"
      description="Outils de dépannage. Ils interrogent le fournisseur et remettent à jour l'état local — ils ne déclenchent aucune opération commerciale."
    >
      {children}
    </CollapsibleCard>
  );
}

export interface SyncOutcome {
  at: string;
  changes: string[];
}

/**
 * Un outil de synchronisation : bouton + explication + résultat du dernier passage.
 *
 * Le résultat est affiché explicitement, y compris « aucun écart » : une
 * synchronisation qui ne change rien est une information utile, pas un échec.
 */
export function SyncAction({
  label,
  description,
  onSync,
  pending,
  last,
  currentStatus,
}: {
  label: string;
  description: string;
  onSync: () => Promise<{ changes?: string[] } | void>;
  pending?: boolean;
  last?: SyncOutcome | null;
  /** Statut local après synchronisation, pour montrer l'effet réel. */
  currentStatus?: React.ReactNode;
}) {
  const [busy, setBusy] = React.useState(false);
  const [outcome, setOutcome] = React.useState<SyncOutcome | null>(last ?? null);
  const [failed, setFailed] = React.useState(false);

  const click = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const res = await onSync();
      setOutcome({ at: new Date().toISOString(), changes: (res && 'changes' in res && res.changes) || [] });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <Button size="sm" variant="outline" onClick={click} loading={busy || pending}>
          <RefreshCw className="h-4 w-4" /> Synchroniser
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>

      {currentStatus && <div className="mt-2 flex items-center gap-2 text-xs">{currentStatus}</div>}

      {failed && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-red-600">
          <AlertTriangle className="h-3.5 w-3.5" /> La synchronisation a échoué. Réessayez.
        </p>
      )}
      {!failed && outcome && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
          <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-500" />
          <span>
            Dernier passage : {formatDateTime(outcome.at)} —{' '}
            {outcome.changes.length ? (
              <span className="text-foreground">{outcome.changes.join(', ')}</span>
            ) : (
              'aucun écart détecté'
            )}
          </span>
        </p>
      )}
    </div>
  );
}
