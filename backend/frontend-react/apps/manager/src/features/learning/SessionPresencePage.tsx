// C2 — Présence d'une session présentielle (manager). Réutilise les cards/badges. Scan QR
// (html5-qrcode) + marquage manuel présent/absent. Mobile-first.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge, ErrorState } from '@bs/ui';
import type { SessionParticipant } from '@bs/api-client';
import { useParticipants, useAttendanceMutations } from './useAttendance';
import { QrScanner } from './QrScanner';
import { CatalogueEmptyState, CatalogueSkeleton } from '../catalogue/components';
import './learningPresence.css';

function StatusBadge({ status }: { status: SessionParticipant['status'] }) {
  if (status === 'present') return <Badge tone="success">Présent</Badge>;
  if (status === 'absent') return <Badge tone="danger">Absent</Badge>;
  return <Badge tone="muted">En attente</Badge>;
}

type PresenceFilter = 'all' | 'present' | 'absent' | 'pending';

export function SessionPresencePage() {
  const { id = '', sessionId = '' } = useParams();
  const participants = useParticipants(sessionId);
  const { mark, scan } = useAttendanceMutations(sessionId);
  const [scanning, setScanning] = useState(false);
  const [flash, setFlash] = useState('');
  const [filter, setFilter] = useState<PresenceFilter>('all');

  function onDecode(text: string) {
    scan.mutate(text, {
      // Aucun token affiché : seulement le nom du participant validé.
      onSuccess: (p) => setFlash(`✓ ${p.name} — présent`),
      onError: () => setFlash('✗ QR non reconnu'),
    });
  }

  const data = participants.data;
  const FILTERS: { key: PresenceFilter; label: string }[] = [
    { key: 'all', label: 'Tous' },
    { key: 'present', label: 'Présents' },
    { key: 'absent', label: 'Absents' },
    { key: 'pending', label: 'En attente' },
  ];
  const visibleParticipants = (data?.participants ?? []).filter((p) => filter === 'all' || p.status === filter);

  return (
    <div className="cat-page">
      <Link to={`/catalogue/formations/${id}`} className="cat-back">← Formation</Link>
      <div className="lrn-presencehead">
        <h1 className="cat-head__title">Présence</h1>
        {data ? (
          <div className="lrn-presencestats">
            <span><strong>{data.summary.present}</strong> présents</span>
            <span><strong>{data.summary.remaining}</strong> en attente</span>
            <span><strong>{data.summary.total}</strong> inscrits</span>
          </div>
        ) : null}
      </div>

      <div className="lrn-presenceactions">
        <button type="button" className="cat-btn cat-btn--primary" onClick={() => setScanning((v) => !v)}>
          <i className="bi bi-qr-code-scan" aria-hidden="true" /> {scanning ? 'Arrêter le scan' : 'Scanner un QR'}
        </button>
        {flash ? <span className="lrn-flash" role="status">{flash}</span> : null}
      </div>

      {scanning ? <QrScanner onDecode={onDecode} onClose={() => setScanning(false)} /> : null}

      {data && data.participants.length > 0 ? (
        <div className="lrn-presencefilters" role="tablist" aria-label="Filtrer la présence">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" role="tab" aria-selected={filter === f.key}
              className={`lrn-filter${filter === f.key ? ' lrn-filter--active' : ''}`} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
      ) : null}

      {participants.status === 'pending' ? (
        <CatalogueSkeleton rows={3} />
      ) : participants.status === 'error' ? (
        <ErrorState title="Impossible de charger les participants." detail="Réessayez plus tard." />
      ) : data && data.participants.length > 0 ? (
        <div className="lrn-participants">
          {visibleParticipants.map((p) => (
            <article key={p.userId} className="lrn-participant" data-testid="lrn-participant">
              <span className="lrn-participant__name">{p.name}</span>
              <StatusBadge status={p.status} />
              <div className="lrn-participant__actions">
                <button type="button" className="cat-btn cat-btn--ghost" disabled={mark.isPending} onClick={() => mark.mutate({ userId: p.userId, status: 'present' })}>Présent</button>
                <button type="button" className="cat-btn cat-btn--ghost" disabled={mark.isPending} onClick={() => mark.mutate({ userId: p.userId, status: 'absent' })}>Absent</button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <CatalogueEmptyState icon="bi-people" title="Aucun participant" description="Aucune réservation pour cette session." />
      )}
    </div>
  );
}
