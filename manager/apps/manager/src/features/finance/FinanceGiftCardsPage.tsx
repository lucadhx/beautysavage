// RX2.6 — Gift Card Finance : liste + résumé. Cards premium, résumé sticky, filtres. Pas de tableau.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useFinanceGiftCards } from './useGiftCardFinance';
import { GiftCardFinanceSummary, GiftCardFinanceFilters, GiftCardFinanceList, GiftCardSkeleton } from './giftCards';
import { FinanceError } from './components';
import './giftCards.css';

export function FinanceGiftCardsPage() {
  const [creationMode, setCreationMode] = useState<'' | 'online' | 'manual_institute'>('');
  const [status, setStatus] = useState<'' | 'active' | 'redeemed'>('');
  const { data, isLoading, isError, refetch } = useFinanceGiftCards({
    creationMode: creationMode || undefined,
    status: status || undefined,
  });

  return (
    <div className="fin-gc-page" data-testid="finance-gift-cards">
      <div className="fin-gc-head">
        <h1 className="fin-gc-head__title">Cartes cadeaux</h1>
        <Link to="/finance" className="fin-gc-btn" aria-label="Retour au tableau de bord finance"><i className="bi-grid-1x2" aria-hidden="true" /></Link>
      </div>

      {data ? <GiftCardFinanceSummary summary={data.summary} /> : null}
      <GiftCardFinanceFilters creationMode={creationMode} status={status} onCreation={setCreationMode} onStatus={setStatus} />

      {isLoading ? <GiftCardSkeleton /> : null}
      {isError ? <FinanceError onRetry={() => void refetch()} /> : null}
      {data ? <GiftCardFinanceList cards={data.cards} /> : null}
    </div>
  );
}
