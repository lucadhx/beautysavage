// RX2.5 — Commissions premium : page d'accueil. Card « Commission ce mois » + règles + historique.
import { Link } from 'react-router-dom';
import { useCommissionOverview, useCommissionHistory } from './useCommissions';
import {
  CommissionCurrentCard, CommissionSettingsPreview, CommissionHistoryList,
  CommissionSkeleton, CommissionEmptyState,
} from './commissions';
import { FinanceError } from './components';
import './commissions.css';

export function CommissionOverviewPage() {
  const overview = useCommissionOverview();
  const history = useCommissionHistory();

  return (
    <div className="fin-comm-page" data-testid="commission-overview">
      <div className="fin-comm-head">
        <h1 className="fin-comm-head__title">Commissions</h1>
        <Link to="/finance" className="fin-comm-btn" aria-label="Retour au tableau de bord finance"><i className="bi-grid-1x2" aria-hidden="true" /></Link>
      </div>

      {overview.isLoading ? <CommissionSkeleton /> : null}
      {overview.isError ? <FinanceError onRetry={() => void overview.refetch()} /> : null}

      <div className="fin-comm-cols">
        <div className="fin-comm-col">
          {overview.data ? (
            !overview.data.hasContract ? (
              <CommissionEmptyState label="Aucun contrat actif — pas de commission à régler." icon="bi-file-earmark" />
            ) : overview.data.current ? (
              <>
                <CommissionCurrentCard current={overview.data.current} />
                <CommissionSettingsPreview terms={overview.data.terms} />
              </>
            ) : (
              <CommissionEmptyState label="Aucune commission en cours pour le moment." icon="bi-hourglass" />
            )
          ) : null}
        </div>

        <section className="fin-comm-col" aria-label="Historique des commissions">
          <h2 className="fin-comm-section__title"><i className="bi-clock-history" aria-hidden="true" /> Historique</h2>
          {history.isLoading ? <CommissionSkeleton /> : null}
          {history.data?.items ? <CommissionHistoryList items={history.data.items} /> : null}
        </section>
      </div>
    </div>
  );
}
