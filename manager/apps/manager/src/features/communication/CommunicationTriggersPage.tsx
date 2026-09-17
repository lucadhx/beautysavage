// LOT2 §3 — Matrice des déclencheurs (LECTURE SEULE). Rend lisible le registre code-first
// mailDispatchRules : événement → catégorie → template → expéditeur → destinataire → actif →
// envoi direct → moteur → dernier envoi → statut. Filtre par catégorie.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LoadingState, ErrorState } from '@bs/ui';
import { getCommunicationTriggers, type CommunicationTriggerRow } from '@bs/api-client';
import './communication.css';

const CATEGORIES = ['toutes', 'réservation', 'formation', 'paiement', 'remboursement', 'carte cadeau', 'avis', 'système'];

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="cc-triggers__muted">—</span>;
  const tone = status === 'sent' || status === 'delivered' ? 'ok' : status === 'failed' || status === 'bounced' ? 'ko' : 'neutral';
  return <span className={`cc-triggers__status cc-triggers__status--${tone}`}>{status}</span>;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }); } catch { return '—'; }
}

export function CommunicationTriggersPage() {
  const [category, setCategory] = useState('toutes');
  const query = useQuery({ queryKey: ['communication-triggers'], queryFn: getCommunicationTriggers, retry: false });

  const rows = useMemo<CommunicationTriggerRow[]>(() => {
    const all = query.data?.rows ?? [];
    return category === 'toutes' ? all : all.filter((r) => r.category === category);
  }, [query.data, category]);

  if (query.status === 'pending') return <LoadingState label="Chargement de la matrice…" />;
  if (query.status === 'error') return <ErrorState title="Impossible de charger la matrice des déclencheurs." />;

  return (
    <div className="cc-triggers">
      <header className="cc-triggers__head">
        <div>
          <h2 className="cc-triggers__title">Déclencheurs</h2>
          <p className="cc-triggers__hint">
            Registre code-first (lecture seule). Moteur événementiel :{' '}
            <strong>{query.data?.engineEnabled ? 'activé' : 'désactivé (envois directs)'}</strong>.
          </p>
        </div>
        <label className="cc-triggers__filter">
          Catégorie
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </header>

      <div className="cc-triggers__scroll">
        <table className="cc-triggers__table">
          <thead>
            <tr>
              <th>Événement</th><th>Catégorie</th><th>Template</th><th>Expéditeur</th>
              <th>Destinataire</th><th>Actif</th><th>Direct</th><th>Moteur</th>
              <th>Dernier envoi</th><th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.event}>
                <td className="cc-triggers__mono">{r.event}</td>
                <td>{r.category}</td>
                <td className="cc-triggers__mono">
                  {r.templateKey}{!r.templatePublished ? <span className="cc-triggers__warn" title="Template non publié"> ⚠</span> : null}
                </td>
                <td>{r.fromRole}</td>
                <td>{r.toRole}</td>
                <td>{r.active ? 'Oui' : 'Non'}</td>
                <td>{r.directSender ? 'Oui' : 'Non'}</td>
                <td>{r.engine ? 'Oui' : 'Non'}</td>
                <td>{fmtDate(r.lastSentAt)}</td>
                <td><StatusBadge status={r.lastStatus} /></td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td colSpan={10} className="cc-triggers__muted">Aucun déclencheur dans cette catégorie.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
