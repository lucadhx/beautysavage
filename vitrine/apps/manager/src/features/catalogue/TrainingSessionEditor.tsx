// C1 — Sessions présentielles + QR de présence. Réutilise le pattern calendrier M10 (cards +
// badges + form phase-machine), prefixe cat-. Une seule UX calendrier dans tout le produit.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@bs/ui';
import type { CatalogueTrainingSession } from '@bs/api-client';
import { useSessionsList, useSessionMutations } from './useCatalogue';
import { CatalogueEmptyState, CatalogueSkeleton, CatField } from './components';

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

function SessionCard({
  session,
  formationId,
  durationDays,
  onDelete,
  onQr,
  qrBusy,
}: {
  session: CatalogueTrainingSession;
  formationId: string;
  durationDays: number;
  onDelete: () => void;
  onQr: (regenerate: boolean) => void;
  qrBusy: boolean;
}) {
  const [showQr, setShowQr] = useState(false);
  return (
    <article className="cat-session" data-testid="cat-session">
      <div className="cat-session__head">
        <span className="cat-session__date">{fmtDate(session.startDate)}</span>
        <Badge tone={session.isAvailable ? 'success' : 'muted'}>
          {session.placesRemaining}/{session.maxClients} places
        </Badge>
      </div>
      <div className="cat-session__meta">
        <span><i className="bi bi-clock" aria-hidden="true" /> {session.durationLabel}</span>
        {session.qr.hasToken ? <span className="cat-session__qrflag"><i className="bi bi-qr-code" aria-hidden="true" /> QR généré</span> : null}
      </div>
      <div className="cat-session__actions">
        <Link to={`/catalogue/formations/${formationId}/sessions/${session.id}/presence`} className="cat-btn cat-btn--ghost">
          <i className="bi bi-people" aria-hidden="true" /> Présence
        </Link>
        <button type="button" className="cat-btn cat-btn--ghost" onClick={() => { setShowQr((v) => !v); if (!session.qr.hasToken) onQr(false); }}>
          <i className="bi bi-qr-code" aria-hidden="true" /> QR session
        </button>
        <button type="button" className="cat-iconbtn" aria-label="Supprimer la session" onClick={onDelete}>
          <i className="bi bi-trash" aria-hidden="true" />
        </button>
      </div>
      {showQr && session.qr.payload ? (
        <div className="cat-qrbox" data-testid="cat-qrbox">
          <p className="cat-qrbox__label">Jeton de présence (à afficher / scanner le jour J)</p>
          <code className="cat-qrbox__payload">{session.qr.payload}</code>
          <button type="button" className="cat-btn cat-btn--ghost" disabled={qrBusy} onClick={() => onQr(true)}>
            {qrBusy ? 'Régénération…' : 'Régénérer'}
          </button>
        </div>
      ) : null}
      <p className="cat-session__note">Durée : {durationDays} jour(s). Scan caméra et attestation : prévus en C2.</p>
    </article>
  );
}

export function TrainingSessionEditor({ formationId, durationDays }: { formationId: string; durationDays: number }) {
  const sessions = useSessionsList(formationId);
  const { save, remove, qr } = useSessionMutations(formationId);
  const [date, setDate] = useState('');
  const [maxClients, setMaxClients] = useState(8);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [phase, setPhase] = useState<'idle' | 'submitting' | 'error'>('idle');
  const [error, setError] = useState('');

  async function addSession() {
    if (!date) { setPhase('error'); setError('La date est requise.'); return; }
    if (startTime >= endTime) { setPhase('error'); setError('Heure de fin après le début.'); return; }
    const schedule = Array.from({ length: Math.max(1, durationDays) }, (_, i) => ({ dayIndex: i + 1, startTime, endTime }));
    setPhase('submitting'); setError('');
    try {
      await save.mutateAsync({ input: { startDate: date, maxClients: Number(maxClients), schedule } });
      setDate('');
      setPhase('idle');
    } catch (e) {
      setPhase('error');
      setError(e instanceof Error ? e.message : "Création impossible (conflit de créneau ?).");
    }
  }

  return (
    <div className="cat-form">
      <div className="cat-sessform">
        <h3 className="cat-sessform__title">Nouvelle session</h3>
        <div className="cat-form__row">
          <CatField label="Date de début" required>
            <input className="cat-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </CatField>
          <CatField label="Places">
            <input className="cat-input" type="number" min={1} value={maxClients} onChange={(e) => setMaxClients(Number(e.target.value))} />
          </CatField>
        </div>
        <div className="cat-form__row">
          <CatField label="Heure de début">
            <input className="cat-input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </CatField>
          <CatField label="Heure de fin">
            <input className="cat-input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </CatField>
        </div>
        {phase === 'error' ? <p className="cat-note cat-note--error" role="alert">{error}</p> : null}
        <button type="button" className="cat-btn cat-btn--primary" disabled={phase === 'submitting'} onClick={addSession}>
          {phase === 'submitting' ? 'Ajout…' : 'Ajouter la session'}
        </button>
      </div>

      {sessions.status === 'pending' ? (
        <CatalogueSkeleton rows={2} />
      ) : sessions.data && sessions.data.length > 0 ? (
        <div className="cat-sesslist">
          {sessions.data.map((s) => (
            <SessionCard
              key={s.id}
              session={s}
              formationId={formationId}
              durationDays={durationDays}
              onDelete={() => remove.mutate(s.id)}
              onQr={(regenerate) => qr.mutate({ sessionId: s.id, regenerate })}
              qrBusy={qr.isPending}
            />
          ))}
        </div>
      ) : (
        <CatalogueEmptyState icon="bi-calendar-x" title="Aucune session" description="Ajoutez une première session présentielle." />
      )}
    </div>
  );
}
