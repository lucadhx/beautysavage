import { CheckCircle2, Circle, XCircle, RefreshCw } from 'lucide-react';
import { formatDateTime } from '@/lib/utils';
import type { TimelineEvent } from '@/types';

/**
 * QUI a produit la ligne. `WEBHOOK` disait « Yousign » : le fournisseur a
 * changé, et une timeline est un dossier qu'on relit des années plus tard —
 * elle aurait attribué à l'ancien des actes du nouveau.
 *
 * « Plateforme de signature » reste vrai des deux côtés de la bascule. Le nom
 * du prestataire, quand il compte, se lit sur la demande elle-même.
 */
const ACTOR_LABEL: Record<string, string> = {
  DEV: 'Équipe technique', ADMIN: 'Client', SYSTEM: 'Système', WEBHOOK: 'Plateforme de signature',
};

function iconFor(action: string) {
  if (action === 'SIGNATURE_FAILED') return <XCircle className="h-4 w-4 text-red-500" />;
  if (action === 'RECONCILED' || action === 'SIGNATURE_RESTARTED') return <RefreshCw className="h-4 w-4 text-blue-500" />;
  if (['DEV_SIGNED', 'ADMIN_SIGNED', 'FULLY_SIGNED', 'SIGNED_PDF_FETCHED', 'VALIDATED_LOCKED', 'ACTIVATED'].includes(action))
    return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  return <Circle className="h-4 w-4 text-muted-foreground" />;
}

/** Timeline verticale des événements d'un contrat (du plus ancien au plus récent). */
export function ContractTimeline({ events }: { events: TimelineEvent[] }) {
  if (!events.length) return <p className="text-sm text-muted-foreground">Aucun événement pour le moment.</p>;
  return (
    <ol className="relative space-y-4 border-l border-border pl-5">
      {events.map((e, i) => (
        <li key={i} className="relative">
          <span className="absolute -left-[27px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-card ring-2 ring-border">
            {iconFor(e.action)}
          </span>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium">{e.label}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(e.at)}</span>
          </div>
          <span className="text-xs text-muted-foreground">{ACTOR_LABEL[e.actorType] || e.actorType}</span>
        </li>
      ))}
    </ol>
  );
}
