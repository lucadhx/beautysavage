// RX4 S3 — Page décision post-annulation (lien e-mail, sans compte). Résume la situation et propose
// UNIQUEMENT les options réellement disponibles (flow.options). Reporter → page report ; rembourser /
// carte cadeau / confirmer = traités ici (confirmation → succès). Le serveur fait foi.
import { useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { Button, Card, LoadingState, Skeleton } from '@bs/ui';
import { formatPrice } from '@bs/api-client';
import { TokenFlowLayout, TokenErrorState, DecisionHeroCard } from '../features/tokenizedFlows/components';
import { useDecisionFlow, useRequestDecisionRefund, useRequestDecisionGiftCard, useConfirmDecision } from '../features/tokenizedFlows/hooks';
import { availableDecisionOptions, tokenStateFromError, formatSessionDate } from '../features/tokenizedFlows/format';

export function DecisionFlowPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const flowId = params.get('flowId');
  const token = params.get('token');
  const query = useDecisionFlow(flowId, token);

  const [action, setAction] = useState<'refund' | 'gift_card' | 'confirm' | null>(null);
  const [giftCode, setGiftCode] = useState<string>('');
  const refund = useRequestDecisionRefund(flowId ?? '', token ?? '');
  const giftCard = useRequestDecisionGiftCard(flowId ?? '', token ?? '');
  const confirm = useConfirmDecision(flowId ?? '', token ?? '');

  if (!flowId || !token) return <TokenFlowLayout><TokenErrorState state="invalid" /></TokenFlowLayout>;
  if (query.isPending) return <TokenFlowLayout><LoadingState label="Chargement de votre demande…" /></TokenFlowLayout>;
  if (query.isError) { const s = tokenStateFromError(query.error); return <TokenFlowLayout><TokenErrorState state={s === 'ok' ? 'error' : s} /></TokenFlowLayout>; }

  const flow = query.data;

  // Déjà traité (usage unique).
  if (flow.decision !== 'pending') {
    return (
      <TokenFlowLayout>
        <DecisionHeroCard icon="bi-check2-circle" kicker="Demande traitée" title="Votre choix a bien été enregistré">
          <p style={{ color: 'var(--bs-color-muted)', margin: 0 }}>Aucune action supplémentaire n’est nécessaire.</p>
          <Link className="bs-btn bs-btn--secondary" to="/" style={{ marginTop: 'var(--bs-space-2)' }}>Retour à l’accueil</Link>
        </DecisionHeroCard>
      </TokenFlowLayout>
    );
  }

  const isFormation = flow.kind === 'formation';
  const situationTitle = isFormation
    ? (flow.formation?.name || 'Votre formation')
    : (flow.service?.name || 'Votre prestation');
  const when = isFormation
    ? formatSessionDate(flow.canceledSession?.startDate)
    : formatSessionDate(flow.bookingSnapshot?.startAt);
  const amount = isFormation ? undefined : flow.refundAmount;
  const options = availableDecisionOptions(flow);

  // ── Succès (après action) ──
  if (giftCard.isSuccess) {
    return <TokenFlowLayout><SuccessCard icon="bi-gift" title="Votre carte cadeau est prête"
      body={giftCode ? `Code : ${giftCode}` : 'Vous la retrouverez dans votre espace client et par e-mail.'} /></TokenFlowLayout>;
  }
  if (refund.isSuccess) {
    return <TokenFlowLayout><SuccessCard icon="bi-arrow-counterclockwise" title="Votre remboursement est lancé"
      body="Vous recevrez le suivi détaillé par e-mail." /></TokenFlowLayout>;
  }
  if (confirm.isSuccess) {
    return <TokenFlowLayout><SuccessCard icon="bi-check2-circle" title="Votre présence est confirmée"
      body="Merci, tout est en ordre." /></TokenFlowLayout>;
  }

  // ── Confirmation d'une action ──
  if (action === 'refund') {
    return (
      <TokenFlowLayout>
        <ConfirmCard
          title="Confirmer le remboursement"
          body={amount ? `Un remboursement de ${formatPrice(amount)} sera lancé. Le suivi vous sera envoyé par e-mail.` : 'Un remboursement sera lancé selon votre paiement d’origine. Le suivi vous sera envoyé par e-mail.'}
          confirmLabel="Confirmer le remboursement"
          pending={refund.isPending}
          error={refund.isError}
          onCancel={() => setAction(null)}
          onConfirm={() => refund.mutate()}
        />
      </TokenFlowLayout>
    );
  }
  if (action === 'gift_card') {
    return (
      <TokenFlowLayout>
        <ConfirmCard
          title="Recevoir une carte cadeau"
          body="Une carte cadeau du montant payé sera créée. Vous pourrez l’utiliser sur votre prochaine commande."
          confirmLabel="Créer ma carte cadeau"
          pending={giftCard.isPending}
          error={giftCard.isError}
          onCancel={() => setAction(null)}
          onConfirm={() => giftCard.mutate(undefined, { onSuccess: (r) => setGiftCode(r.code) })}
        />
      </TokenFlowLayout>
    );
  }
  if (action === 'confirm') {
    return (
      <TokenFlowLayout>
        <ConfirmCard
          title="Confirmer ma présence"
          body="Vous conservez la session modifiée."
          confirmLabel="Confirmer ma présence"
          pending={confirm.isPending}
          error={confirm.isError}
          onCancel={() => setAction(null)}
          onConfirm={() => confirm.mutate()}
        />
      </TokenFlowLayout>
    );
  }

  // ── Vue principale : situation + options ──
  return (
    <TokenFlowLayout>
      <DecisionHeroCard
        icon={isFormation ? 'bi-mortarboard' : 'bi-calendar-x'}
        kicker={isFormation ? 'Formation' : 'Rendez-vous annulé'}
        title={situationTitle}
        meta={
          <>
            {when ? <span><i className="bi bi-calendar3" aria-hidden="true" /> {when}</span> : null}
            {flow.reason ? <span><i className="bi bi-info-circle" aria-hidden="true" /> {flow.reason}</span> : null}
          </>
        }
      >
        <p style={{ margin: 0, color: 'var(--bs-color-muted)', fontSize: '0.9rem' }}>
          Que souhaitez-vous faire ?{flow.autoRefundDays > 0 ? ` Sans réponse, un remboursement automatique est prévu sous ${flow.autoRefundDays} jours.` : ''}
        </p>
      </DecisionHeroCard>

      {options.length === 0 ? (
        <Card><p style={{ margin: 0 }}>Aucune action n’est disponible pour le moment. Contactez l’institut.</p></Card>
      ) : (
        <div className="bs-tf-options">
          {options.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`bs-tf-option${opt.key === 'refund' ? ' bs-tf-option--danger' : ''}`}
              onClick={() => {
                if (opt.key === 'reschedule') navigate(`/decision/report?flowId=${encodeURIComponent(flowId)}&token=${encodeURIComponent(token)}`);
                else setAction(opt.key);
              }}
            >
              <span className="bs-tf-option__icon" aria-hidden="true"><i className={`bi ${opt.icon}`} /></span>
              <span className="bs-tf-option__body">
                <span className="bs-tf-option__label">{opt.label}</span>
                <span className="bs-tf-option__desc">{opt.desc}</span>
              </span>
              <i className="bi bi-chevron-right bs-tf-option__chev" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </TokenFlowLayout>
  );
}

function ConfirmCard({ title, body, confirmLabel, pending, error, onCancel, onConfirm }: {
  title: string; body: string; confirmLabel: string; pending: boolean; error: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <Card className="bs-tf-hero">
      <h1 className="bs-tf-hero__title">{title}</h1>
      <p style={{ margin: 0, color: 'var(--bs-color-muted)' }}>{body}</p>
      {error ? <p role="alert" style={{ color: 'var(--bs-color-danger)', margin: 0 }}>Une erreur est survenue. Réessayez.</p> : null}
      {pending ? <Skeleton variant="line" /> : null}
      <div className="bs-bk-actions">
        <Button variant="secondary" onClick={onCancel} disabled={pending}>Retour</Button>
        <Button onClick={onConfirm} disabled={pending}>{pending ? 'Traitement…' : confirmLabel}</Button>
      </div>
    </Card>
  );
}

function SuccessCard({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="bs-card bs-tf-state" role="status">
      <i className={`bi ${icon} bs-tf-state__icon`} aria-hidden="true" />
      <h1 className="bs-tf-state__title">{title}</h1>
      <p className="bs-tf-state__body">{body}</p>
      <Link className="bs-btn bs-btn--secondary" to="/">Retour à l’accueil</Link>
    </div>
  );
}
