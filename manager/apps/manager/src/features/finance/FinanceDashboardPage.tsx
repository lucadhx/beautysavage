// RX2.1 — Finance Dashboard : la page d'accueil financière. On ouvre, on comprend tout.
// « Aujourd'hui : +2 480 € · 32 ventes · X soldes à encaisser · Y remboursements · Z factures. »
// Cards + KPIs + actions. Jamais de tableau. Mobile = desktop.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { FinanceRange } from '@bs/api-client';
import { useFinanceDashboard } from './useFinance';
import {
  RangeSwitch, FinanceHero, BreakdownChips, ActionCard,
  FinanceSkeleton, FinanceError,
} from './components';
import './finance.css';

export function FinanceDashboardPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState<FinanceRange>('today');
  const { data, isLoading, isError, refetch } = useFinanceDashboard(range);

  return (
    <div className="fin-page" data-testid="finance-dashboard">
      <header className="fin-head">
        <div className="fin-head__titles">
          <h1 className="fin-head__title">Finance</h1>
          <p className="fin-head__subtitle">Vue d'ensemble</p>
        </div>
        <RangeSwitch value={range} onChange={setRange} />
      </header>

      {isLoading ? <FinanceSkeleton /> : null}
      {isError ? <FinanceError onRetry={() => void refetch()} /> : null}

      {data ? (
        <>
          <div className="fin-hero-row">
            <FinanceHero label={data.rangeLabel} revenue={data.today.revenue} salesCount={data.today.salesCount} />

            <section className="fin-section fin-section--card" aria-label="Ventilation des ventes">
              <h2 className="fin-section__title"><i className="bi-pie-chart" aria-hidden="true" /> Ventilation</h2>
              <BreakdownChips breakdown={data.today.breakdown} giftCardConsumption={data.today.giftCardConsumption} />
            </section>
          </div>

          <div className="fin-columns">
          <section className="fin-section" aria-label="À traiter">
            <h2 className="fin-section__title"><i className="bi-list-check" aria-hidden="true" /> À traiter</h2>
            <div className="fin-actions">
              <ActionCard
                icon="bi-cash-coin"
                label="À encaisser sur place"
                unit="solde"
                metric={data.actions.balancesToCollect}
                onClick={() => navigate('/planning')}
              />
              <ActionCard
                icon="bi-arrow-counterclockwise"
                label="Remboursements à traiter"
                unit="remboursement"
                warn
                metric={data.actions.refundsToProcess}
                onClick={() => navigate('/finance/timeline?type=refund')}
              />
              <ActionCard
                icon="bi-file-earmark-text"
                label="Factures impayées"
                unit="facture"
                warn
                metric={data.actions.unpaidInvoices}
                onClick={() => navigate('/finance/timeline?type=sale')}
              />
            </div>
          </section>

          <section className="fin-section" aria-label="Explorer">
            <h2 className="fin-section__title"><i className="bi-compass" aria-hidden="true" /> Explorer</h2>
            <nav className="fin-quicklinks" aria-label="Accès rapides finance">
              <Link to="/finance/timeline" className="fin-quicklink" data-testid="fin-timeline-link">
                <span className="fin-quicklink__icon fin-quicklink__icon--indigo"><i className="bi-list-ul" aria-hidden="true" /></span>
                <span className="fin-quicklink__body">
                  <span className="fin-quicklink__value">Timeline financière</span>
                  <span className="fin-quicklink__label">Tous les mouvements, ordonnés</span>
                </span>
                <i className="bi-chevron-right fin-quicklink__chev" aria-hidden="true" />
              </Link>

              <Link to="/finance/commissions" className="fin-quicklink" data-testid="fin-commissions-link">
                <span className="fin-quicklink__icon fin-quicklink__icon--violet"><i className="bi-bank" aria-hidden="true" /></span>
                <span className="fin-quicklink__body">
                  <span className="fin-quicklink__value">Commissions plateforme</span>
                  <span className="fin-quicklink__label">Commission du mois, détail, paiement</span>
                </span>
                <i className="bi-chevron-right fin-quicklink__chev" aria-hidden="true" />
              </Link>

              <Link to="/finance/cartes-cadeaux" className="fin-quicklink" data-testid="fin-giftcards-link">
                <span className="fin-quicklink__icon fin-quicklink__icon--pink"><i className="bi-gift" aria-hidden="true" /></span>
                <span className="fin-quicklink__body">
                  <span className="fin-quicklink__value">Cartes cadeaux</span>
                  <span className="fin-quicklink__label">Solde actif, cycle de vie, transactions</span>
                </span>
                <i className="bi-chevron-right fin-quicklink__chev" aria-hidden="true" />
              </Link>
            </nav>
          </section>
          </div>
        </>
      ) : null}
    </div>
  );
}
