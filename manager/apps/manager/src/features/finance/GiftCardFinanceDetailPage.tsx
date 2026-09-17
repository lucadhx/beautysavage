// RX2.6 — Gift Card Finance : détail (cycle de vie, solde, acteurs, source, QR masqué, refunds splittés).
// AUCUNE mention d'expiration.
import { useParams, Link } from 'react-router-dom';
import { useFinanceGiftCardDetail } from './useGiftCardFinance';
import {
  GiftCardBalanceCard, GiftCardActorsCard, GiftCardPaymentSourceCard, GiftCardQrCard,
  GiftCardLifecycleTimeline, GiftCardTransactionTimeline, GiftCardRefundSplitCard,
  GiftCardFinanceActions, GiftCardStatusBadge, GiftCardSkeleton,
} from './giftCards';
import { FinanceError } from './components';
import { GiftCardResendControl } from './GiftCardResendControl';
import './giftCards.css';

export function GiftCardFinanceDetailPage() {
  const { giftCardId } = useParams();
  const { data, isLoading, isError, refetch } = useFinanceGiftCardDetail(giftCardId);
  const debitAction = data?.actions.find((a) => a.kind === 'gift_card_debit');

  return (
    <div className="fin-gc-page" data-testid="gift-card-detail">
      <div className="fin-gc-head">
        <Link to="/finance/cartes-cadeaux" className="fin-gc-btn" aria-label="Retour aux cartes cadeaux"><i className="bi-chevron-left" aria-hidden="true" /></Link>
        <h1 className="fin-gc-head__title">{data ? data.giftCard.maskedCode : 'Carte cadeau'}</h1>
        {data ? <GiftCardStatusBadge status={data.giftCard.status} /> : null}
      </div>

      {isLoading ? <GiftCardSkeleton /> : null}
      {isError ? <FinanceError onRetry={() => void refetch()} /> : null}

      {data ? (
        <>
          <GiftCardBalanceCard balance={data.currentBalance} />
          <GiftCardActorsCard actors={data.actors} />
          <GiftCardPaymentSourceCard paymentSource={data.paymentSource} />
          <GiftCardQrCard qr={data.qr} debitTo={debitAction?.enabled ? debitAction.to : null} />

          <div className="fin-gc-block">
            <span className="fin-gc-block__title"><i className="bi-clock-history" aria-hidden="true" /> Cycle de vie</span>
            <GiftCardLifecycleTimeline items={data.lifecycle} />
          </div>

          <GiftCardRefundSplitCard refunds={data.refunds} />
          <GiftCardTransactionTimeline transactions={data.transactions} />
          <GiftCardFinanceActions actions={data.actions} />
          {giftCardId ? <GiftCardResendControl giftCardId={giftCardId} status={data.giftCard.status} /> : null}
        </>
      ) : null}
    </div>
  );
}
