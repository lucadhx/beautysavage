// RX2.5 — Détail d'une commission mensuelle : calcul (carry-over visible) + statut + facture + paiement.
import { useParams, Link } from 'react-router-dom';
import { useCommissionDetail } from './useCommissions';
import {
  CommissionBreakdownCard, CommissionPaymentStatusCard, CommissionInvoiceCard,
  CommissionPaymentAction, CommissionLateStatusBadge, CommissionSkeleton,
} from './commissions';
import { FinanceError, money } from './components';
import './commissions.css';

export function CommissionDetailPage() {
  const params = useParams();
  const year = Number(params.year);
  const month = Number(params.month); // 1-12
  const { data, isLoading, isError, refetch } = useCommissionDetail(
    Number.isInteger(year) ? year : undefined,
    Number.isInteger(month) ? month : undefined,
  );
  const detail = data?.detail;

  return (
    <div className="fin-comm-page" data-testid="commission-detail">
      <div className="fin-comm-head">
        <Link to="/finance/commissions" className="fin-comm-btn" aria-label="Retour aux commissions"><i className="bi-chevron-left" aria-hidden="true" /></Link>
        <h1 className="fin-comm-head__title">{detail ? detail.label : 'Commission'}</h1>
        {detail ? <CommissionLateStatusBadge lateStatus={detail.lateStatus} /> : null}
      </div>

      {isLoading ? <CommissionSkeleton /> : null}
      {isError ? <FinanceError onRetry={() => void refetch()} /> : null}

      {detail ? (
        <>
          <div className="fin-comm-cols">
            <div className="fin-comm-col">
              <div className="fin-comm-current" data-testid="fin-comm-detail-amount">
                <span className="fin-comm-current__label">À payer</span>
                <span className="fin-comm-current__amount">{money(detail.netAmountDue)}</span>
              </div>
              <CommissionBreakdownCard lines={detail.lines} />
            </div>
            <div className="fin-comm-col">
              <CommissionPaymentStatusCard payment={detail} />
              <CommissionInvoiceCard invoice={detail.invoice} />
            </div>
          </div>
          <CommissionPaymentAction payment={detail} />
        </>
      ) : null}
    </div>
  );
}
