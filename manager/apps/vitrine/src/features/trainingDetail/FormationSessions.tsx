import { useQuery } from '@tanstack/react-query';
import { Badge, LoadingState, ErrorState, EmptyState } from '@bs/ui';
import { getFormationSessions, type PublicFormationSession } from '@bs/api-client';

// RX3 — Sessions présentielles d'une formation (date, durée, places restantes, disponibilité). Consomme
// le wrapper api-client (champs sûrs, jamais le token QR). Sélectionnable (RX3 S3) pour l'ajout au panier.

function fmtDate(iso: string | null): string {
  if (!iso) return 'Date à confirmer';
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return 'Date à confirmer';
  }
}

function SessionRow({
  session,
  selectable,
  selected,
  onSelect,
}: {
  session: PublicFormationSession;
  selectable: boolean;
  selected: boolean;
  onSelect?: (s: PublicFormationSession) => void;
}) {
  const full = session.placesRemaining <= 0 || !session.isAvailable || session.isCanceled;
  const firstDay = session.schedule?.[0];
  const inner = (
    <>
      <div className="td-session__main">
        <span className="td-session__date">{fmtDate(session.startDate)}</span>
        <span className="td-session__meta">
          {session.durationLabel ? <span>{session.durationLabel}</span> : null}
          {firstDay?.startTime ? (
            <span>
              {firstDay.startTime}
              {firstDay.endTime ? `–${firstDay.endTime}` : ''}
            </span>
          ) : null}
        </span>
      </div>
      {full ? (
        <Badge tone="muted">Complet</Badge>
      ) : (
        <Badge tone="success">
          {session.placesRemaining} place{session.placesRemaining > 1 ? 's' : ''}
        </Badge>
      )}
    </>
  );

  if (!selectable) return <li className="td-session">{inner}</li>;
  return (
    <li>
      <button
        type="button"
        className={`td-session td-session--btn${selected ? ' td-session--selected' : ''}`}
        disabled={full}
        aria-pressed={selected}
        onClick={() => onSelect?.(session)}
      >
        {inner}
      </button>
    </li>
  );
}

export interface FormationSessionsProps {
  formationId: string;
  selectable?: boolean;
  selectedId?: string | null;
  onSelect?: (session: PublicFormationSession) => void;
}

export function FormationSessions({ formationId, selectable = false, selectedId = null, onSelect }: FormationSessionsProps) {
  const { data, isPending, isError } = useQuery({
    queryKey: ['formation', 'sessions', formationId],
    queryFn: ({ signal }) => getFormationSessions(formationId, signal),
    staleTime: 30_000,
  });

  return (
    <section className="td-section" aria-label="Prochaines sessions">
      <h2 className="td-section__title">Prochaines sessions</h2>
      {isPending ? <LoadingState label="Chargement des sessions…" /> : null}
      {isError ? <ErrorState title="Sessions indisponibles pour le moment." /> : null}
      {!isPending && !isError ? (
        data && data.length ? (
          <ul className="td-sessions">
            {data.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                selectable={selectable}
                selected={selectedId === s.id}
                onSelect={onSelect}
              />
            ))}
          </ul>
        ) : (
          <EmptyState label="Aucune session programmée pour le moment." />
        )
      ) : null}
    </section>
  );
}
