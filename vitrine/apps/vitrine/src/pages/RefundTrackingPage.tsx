// RX4 S3 — Suivi remboursement (lien e-mail, sans compte). Statut réel uniquement (aucune invention),
// split Stripe / carte cadeau, timeline lisible. Token en path. Le serveur fait foi.
import { useParams, Link } from 'react-router-dom';
import { Badge, Card, LoadingState } from '@bs/ui';
import { formatPrice, type RefundStatus } from '@bs/api-client';
import { TokenFlowLayout, TokenErrorState, DecisionHeroCard } from '../features/tokenizedFlows/components';
import { useRefundTracking } from '../features/tokenizedFlows/hooks';
import { refundStatusLabel, refundStatusTone, splitStatusLabel, splitStatusTone, tokenStateFromError, formatSessionDate } from '../features/tokenizedFlows/format';

// Étapes de la timeline dérivées du statut réel (pas de statut inventé).
const STEPS: { key: RefundStatus | 'requested'; title: string }[] = [
  { key: 'requested', title: 'Demande reçue' },
  { key: 'pending', title: 'Traitement en cours' },
  { key: 'succeeded', title: 'Remboursement effectué' },
];
function stepIndex(status: RefundStatus): number {
  if (status === 'succeeded') return 2;
  if (status === 'pending') return 1;
  return 0; // requested / failed / canceled → départ (statut terminal géré par le badge)
}

export function RefundTrackingPage() {
  const { token } = useParams<{ token: string }>();
  const query = useRefundTracking(token ?? null);

  if (!token) return <TokenFlowLayout><TokenErrorState state="invalid" /></TokenFlowLayout>;
  if (query.isPending) return <TokenFlowLayout><LoadingState label="Chargement de votre remboursement…" /></TokenFlowLayout>;
  if (query.isError) { const s = tokenStateFromError(query.error); return <TokenFlowLayout><TokenErrorState state={s === 'ok' ? 'error' : s} /></TokenFlowLayout>; }

  const r = query.data;
  const terminalFail = r.status === 'failed' || r.status === 'canceled';
  const current = stepIndex(r.status);

  return (
    <TokenFlowLayout>
      <DecisionHeroCard
        icon="bi-arrow-counterclockwise"
        kicker="Suivi de remboursement"
        title={r.itemTitle || 'Votre remboursement'}
        meta={r.itemDate ? <span><i className="bi bi-calendar3" aria-hidden="true" /> {formatSessionDate(r.itemDate) || r.itemDate}</span> : undefined}
      >
        <div className="bs-hl__row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--bs-space-2)' }}>
          <span className="bs-tf-amount">{formatPrice(r.amount)}</span>
          <Badge tone={refundStatusTone(r.status)}>{refundStatusLabel(r.status)}</Badge>
        </div>
        {r.estimatedDelay && !terminalFail && r.status !== 'succeeded'
          ? <p className="bs-row__meta" style={{ margin: 0 }}>Délai estimé : {r.estimatedDelay}</p> : null}
      </DecisionHeroCard>

      {/* Répartition (split) */}
      {r.isSplitRefund || (r.stripe.status !== 'not_applicable' && r.giftCard.status !== 'not_applicable') ? (
        <Card>
          <h2 className="bs-hub__section-title" style={{ marginTop: 0 }}>Répartition</h2>
          <div className="bs-tf-split">
            {r.stripe.status !== 'not_applicable' ? (
              <SplitRow icon="bi-credit-card" label="Remboursement bancaire" amount={r.stripe.amount} statusLabel={splitStatusLabel(r.stripe.status)} tone={splitStatusTone(r.stripe.status)} />
            ) : null}
            {r.giftCard.status !== 'not_applicable' ? (
              <SplitRow icon="bi-gift" label="Recrédit carte cadeau" amount={r.giftCard.amount} statusLabel={splitStatusLabel(r.giftCard.status)} tone={splitStatusTone(r.giftCard.status)} />
            ) : null}
          </div>
          {r.giftCard.card ? (
            <p className="bs-row__meta" style={{ marginBottom: 0 }}>
              Carte cadeau : <strong>{r.giftCard.card.code}</strong> · solde {formatPrice(r.giftCard.card.balance)}
            </p>
          ) : null}
        </Card>
      ) : null}

      {/* Timeline */}
      <Card>
        {terminalFail ? (
          <p style={{ margin: 0 }}>
            {r.status === 'failed'
              ? 'Le traitement n’a pas abouti. Notre équipe peut finaliser avec vous — contactez l’institut.'
              : 'Cette demande de remboursement a été annulée.'}
          </p>
        ) : (
          <div className="bs-tf-steps">
            {STEPS.map((step, i) => (
              <div key={step.key} className={`bs-tf-step${i < current ? ' bs-tf-step--on' : ''}${i === current ? ' bs-tf-step--current' : ''}`}>
                <span className="bs-tf-step__dot" aria-hidden="true" />
                <span className="bs-tf-step__body">
                  <span className="bs-tf-step__title">{step.title}</span>
                  {step.key === 'succeeded' && r.refundedAt ? <span className="bs-tf-step__meta">{formatSessionDate(r.refundedAt)}</span> : null}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <p style={{ textAlign: 'center' }}><Link className="bs-btn bs-btn--secondary" to="/">Retour à l’accueil</Link></p>
    </TokenFlowLayout>
  );
}

function SplitRow({ icon, label, amount, statusLabel, tone }: {
  icon: string; label: string; amount: number | null; statusLabel: string; tone: 'success' | 'info' | 'danger' | 'warning' | 'muted';
}) {
  return (
    <div className="bs-tf-split__row">
      <span className="bs-tf-split__label"><i className={`bi ${icon}`} aria-hidden="true" /> {label}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--bs-space-2)' }}>
        <strong>{amount != null ? formatPrice(amount) : '—'}</strong>
        {statusLabel ? <Badge tone={tone}>{statusLabel}</Badge> : null}
      </span>
    </div>
  );
}
